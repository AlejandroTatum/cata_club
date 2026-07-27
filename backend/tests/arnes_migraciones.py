"""
Arnés reutilizable para probar migraciones Alembic contra datos EXISTENTES.

Motivación (hueco de cobertura real):
    El job `migraciones-desde-cero` de `.github/workflows/ci.yml` solo prueba
    `alembic upgrade head` contra una base VACÍA, y `esquema_migrado` en
    `conftest.py` hace lo mismo. Ninguno de los dos puede detectar el fallo
    más caro de una migración: que corra bien sobre un esquema vacío pero
    corrompa o pierda las filas que ya viven en producción (`ALTER COLUMN
    ... TYPE`, `ALTER TYPE`, `ADD COLUMN NOT NULL`, backfills).

Contrato del arnés:
    1. `preparar(revision)`  -> esquema limpio migrado hasta `revision`.
    2. `ejecutar(sql)`       -> siembra filas con SQL crudo.
    3. `migrar(revision)`    -> corre la migración bajo prueba.
    4. `consultar(sql)`      -> verifica que los datos sobrevivieron.

    La siembra es SQL crudo a propósito: el ORM (`app.dominio.modelos`)
    describe el esquema de HOY, no el de la revisión histórica bajo prueba.
    Usarlo para sembrar haría que la prueba mintiera.

Aislamiento:
    El arnés crea y destruye su PROPIA base de datos en el mismo servidor
    Postgres que la suite (`TEST_DATABASE_URL`, ver decisión de diseño 1.1).
    No puede compartir la base de la suite: su `DROP SCHEMA public CASCADE`
    destruiría el esquema que `esquema_migrado` (scope=session) construye
    una sola vez para las ~400 pruebas restantes.

Cómo llega Alembic a esa base:
    `alembic/env.py` acepta una conexión preexistente vía
    `config.attributes["connection"]` (receta estándar de Alembic para
    ejecución programática). Así el arnés no tiene que mutar el singleton
    `settings` ni variables de entorno globales.
"""
from __future__ import annotations

import os
from typing import Any, Optional, Sequence

from alembic import command as alembic_command
from alembic.config import Config as AlembicConfig
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool


RAIZ_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Sufijo de la base efímera del arnés. Se deriva del nombre de la base de la
# suite para que un servidor Postgres compartido (dev local, CI) nunca vea
# dos arneses de proyectos distintos peleando por el mismo nombre.
SUFIJO_BD_ARNES = "_arnes_migraciones"


def urls_del_arnes(url_suite: str) -> tuple[str, str, str]:
    """Deriva, desde la URL de la suite, la terna
    (url_de_mantenimiento, url_del_arnes, nombre_de_la_bd_del_arnes).

    La URL de mantenimiento apunta a la base `postgres` porque `CREATE
    DATABASE` / `DROP DATABASE` no pueden ejecutarse desde la base que se
    está creando o destruyendo.
    """
    url = make_url(url_suite)
    nombre_bd = f"{url.database}{SUFIJO_BD_ARNES}"
    return (
        url.set(database="postgres").render_as_string(hide_password=False),
        url.set(database=nombre_bd).render_as_string(hide_password=False),
        nombre_bd,
    )


def crear_bd_del_arnes(url_suite: str) -> tuple[Engine, str]:
    """Crea (recreando si ya existía) la base efímera del arnés y devuelve
    su motor junto al nombre de la base, para poder destruirla después."""
    url_mantenimiento, url_arnes, nombre_bd = urls_del_arnes(url_suite)
    _ejecutar_en_mantenimiento(url_mantenimiento, [
        f'DROP DATABASE IF EXISTS "{nombre_bd}" WITH (FORCE)',
        f'CREATE DATABASE "{nombre_bd}"',
    ])
    return create_engine(url_arnes, poolclass=NullPool), nombre_bd


def destruir_bd_del_arnes(url_suite: str, nombre_bd: str) -> None:
    """Destruye la base efímera. `WITH (FORCE)` (Postgres 13+) desconecta
    cualquier sesión colgada en vez de fallar con 'database is being
    accessed by other users'."""
    url_mantenimiento, _, _ = urls_del_arnes(url_suite)
    _ejecutar_en_mantenimiento(url_mantenimiento, [
        f'DROP DATABASE IF EXISTS "{nombre_bd}" WITH (FORCE)',
    ])


def _ejecutar_en_mantenimiento(url_mantenimiento: str, sentencias: Sequence[str]) -> None:
    """`CREATE`/`DROP DATABASE` no pueden correr dentro de una transacción:
    de ahí el `AUTOCOMMIT` explícito."""
    motor = create_engine(
        url_mantenimiento, poolclass=NullPool, isolation_level="AUTOCOMMIT"
    )
    try:
        with motor.connect() as conexion:
            for sentencia in sentencias:
                conexion.execute(text(sentencia))
    finally:
        motor.dispose()


class ArnesMigracion:
    """Maneja una base de datos desechable donde se ejercita una migración
    sobre datos preexistentes. Una instancia por prueba: `preparar()` deja
    el esquema en cero antes de cada escenario."""

    def __init__(self, motor: Engine) -> None:
        self.motor = motor

    # --- Preparación del escenario -------------------------------------
    def preparar(self, revision: str, zona_horaria_servidor: Optional[str] = None) -> None:
        """Borra el esquema y lo reconstruye migrando hasta `revision`.

        `zona_horaria_servidor` fija el `TimeZone` de la BASE (no de la
        sesión) para que las migraciones posteriores corran bajo esa zona.
        Es lo que permite probar que un `ALTER COLUMN ... TYPE timestamptz`
        no depende de la zona del servidor: sin `USING ... AT TIME ZONE
        'UTC'`, Postgres reinterpretaría los valores naive existentes en la
        zona local y el instante quedaría corrido para siempre.
        """
        with self.motor.begin() as conexion:
            conexion.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
            conexion.execute(text("CREATE SCHEMA public"))
        if zona_horaria_servidor is not None:
            self.fijar_zona_horaria_servidor(zona_horaria_servidor)
        self.migrar(revision)

    def fijar_zona_horaria_servidor(self, zona: str) -> None:
        """`ALTER DATABASE ... SET TimeZone` persiste para toda sesión nueva
        contra esta base, incluidas las que abre Alembic."""
        nombre_bd = self.motor.url.database
        with self.motor.connect().execution_options(
            isolation_level="AUTOCOMMIT"
        ) as conexion:
            conexion.execute(
                text(f"ALTER DATABASE \"{nombre_bd}\" SET TimeZone TO '{zona}'")
            )

    # --- Ejecución de migraciones --------------------------------------
    def migrar(self, revision: str = "head") -> None:
        """Aplica migraciones hacia adelante hasta `revision`."""
        self._correr(alembic_command.upgrade, revision)

    def revertir(self, revision: str) -> None:
        """Aplica `downgrade()` hasta `revision`."""
        self._correr(alembic_command.downgrade, revision)

    def _correr(self, accion: Any, revision: str) -> None:
        """La conexión se entrega SIN transacción abierta a propósito: quien
        maneja el `BEGIN`/`COMMIT` es Alembic. Abrirla con `motor.begin()`
        rompe las migraciones que usan `autocommit_block()` (por ejemplo
        `f1e2d3c4b5a6`, `ALTER TYPE ... ADD VALUE`), porque ese bloque
        necesita poder cerrar la transacción y no puede si el llamador la
        abrió."""
        configuracion = AlembicConfig(os.path.join(RAIZ_BACKEND, "alembic.ini"))
        with self.motor.connect() as conexion:
            configuracion.attributes["connection"] = conexion
            accion(configuracion, revision)
            if conexion.in_transaction():
                conexion.commit()

    # --- Inspección -----------------------------------------------------
    def ejecutar(self, sql: str, **parametros: Any) -> None:
        """Siembra o muta filas con SQL crudo (nunca vía el ORM: el ORM
        describe el esquema actual, no el de la revisión bajo prueba)."""
        with self.motor.begin() as conexion:
            conexion.execute(text(sql), parametros)

    def consultar(self, sql: str, **parametros: Any) -> list[tuple]:
        with self.motor.connect() as conexion:
            return [tuple(fila) for fila in conexion.execute(text(sql), parametros)]

    def revision_actual(self) -> Optional[str]:
        filas = self.consultar(
            "SELECT version_num FROM alembic_version"
        )
        return filas[0][0] if filas else None

    def tipo_de_columna(self, tabla: str, columna: str) -> Optional[str]:
        """Devuelve el `data_type` de la columna (ej. 'timestamp with time
        zone') o `None` si la columna no existe en esta revisión."""
        filas = self.consultar(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :tabla "
            "AND column_name = :columna",
            tabla=tabla,
            columna=columna,
        )
        return filas[0][0] if filas else None
