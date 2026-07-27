"""
Pruebas del propio arnés de migraciones (`arnes_migraciones.py`).

Por qué existe este archivo: el job `migraciones-desde-cero` de CI solo
demuestra que `alembic upgrade head` corre contra una base VACÍA. Nada
demostraba que una migración fuera segura contra una base que YA tiene
filas — que es justo el caso peligroso (`ALTER TYPE`, `ALTER COLUMN`,
`ADD COLUMN NOT NULL`, backfills). El arnés cubre ese hueco y estas pruebas
verifican que el arnés hace lo que promete antes de que otras pruebas se
apoyen en él.

Se ejercita una migración REAL ya existente (`644d352bf590`, que agrega
`usuario.version_sesion NOT NULL` con `server_default='1'`) sobre filas
preexistentes: es exactamente el patrón que el arnés debe poder probar.
"""
from datetime import datetime

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "a1b2c3d4e5f6"
REVISION_VERSION_SESION = "644d352bf590"


def _sembrar_usuario(arnes: ArnesMigracion) -> None:
    """Inserta una persona y su usuario con SQL crudo (nunca el ORM: el ORM
    describe el esquema de HOY, no el de la revisión bajo prueba)."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMP '2024-03-01 12:00:00')
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,
                             persona_id, version_contrasenia, activo)
        VALUES (1, 'ana@cataclub.test', 'hash',
                TIMESTAMP '2024-03-01 12:00:00', 1, 0, true)
        """
    )


def test_arnes_deja_la_base_en_la_revision_pedida(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.tipo_de_columna("usuario", "version_sesion") is None


def test_arnes_migra_datos_preexistentes_sin_perderlos(arnes_migracion):
    """El caso que `migraciones-desde-cero` no puede detectar: la migración
    corre sobre filas que ya existían, y esas filas deben sobrevivir."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_usuario(arnes_migracion)

    arnes_migracion.migrar(REVISION_VERSION_SESION)

    filas = arnes_migracion.consultar(
        "SELECT correo, fecha_creacion, version_sesion FROM usuario ORDER BY id"
    )
    assert filas == [("ana@cataclub.test", datetime(2024, 3, 1, 12, 0), 1)]
    assert arnes_migracion.revision_actual() == REVISION_VERSION_SESION


def test_arnes_revierte_la_migracion(arnes_migracion):
    """El repositorio implementa `downgrade()` en sus migraciones; el arnés
    debe poder ejercitarlo para que un rollback de producción no sea la
    primera vez que ese código corre."""
    arnes_migracion.preparar(REVISION_VERSION_SESION)
    _sembrar_usuario(arnes_migracion)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.tipo_de_columna("usuario", "version_sesion") is None
    assert arnes_migracion.consultar("SELECT correo FROM usuario") == [
        ("ana@cataclub.test",)
    ]


def test_cada_prueba_recibe_una_base_limpia(arnes_migracion):
    """`preparar()` debe borrar el esquema anterior: si no, las filas
    sembradas por otra prueba contaminarían los asserts de esta."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar("SELECT count(*) FROM usuario") == [(0,)]


def test_arnes_no_toca_la_base_de_la_suite(arnes_migracion, motor_test):
    """Garantía de aislamiento: el arnés crea y destruye su PROPIA base de
    datos. Si compartiera la base de la suite, su `DROP SCHEMA` borraría el
    esquema que `esquema_migrado` (scope=session) creó una sola vez y todas
    las demás pruebas se caerían."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.motor.url.database != motor_test.url.database
