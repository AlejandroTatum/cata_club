"""
La mitad de base de datos del issue #762: la invariante "un solo rol activo
por cuenta" impuesta por Postgres, y la migración que la instala.

Por qué existe este archivo aparte de `test_rol_unico_por_cuenta.py`:

  - El chequeo de servicio pierde contra dos peticiones simultáneas. Cada
    una lee "esta cuenta no tiene otro rol", cada una escribe, y la cuenta
    termina con dos. Solo la base puede serializar eso, y solo se puede
    demostrar con dos sesiones reales corriendo a la vez -- imposible bajo
    la `db_session` de la suite, que vive dentro de una única transacción
    externa.
  - La migración tiene que sobrevivir a DOS bases distintas: una limpia y
    una que ya contiene una cuenta multirol legada (hay una real en
    staging). El arnés (`tests/arnes_migraciones.py`) es lo único que puede
    montar la segunda.

Regla que gobierna el legado, y es la parte delicada: la migración DETECTA
y REGISTRA, nunca elige, borra ni corrige. Por eso la invariante es un
trigger y no un `UNIQUE (usuario_id)`: un índice único se valida contra las
filas existentes al crearse, así que sobre la base con el legado el
`alembic upgrade` moriría y el deploy con él. El trigger solo mira filas
NUEVAS, que es exactamente lo que "detectar sin corregir" significa.
"""
from concurrent.futures import ThreadPoolExecutor
import time

import pytest
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.dominio.enums import TipoRol


REVISION_ANTERIOR = "c556legal01"
REVISION_ROL_UNICO = "e762rolunico"

SQL_TRIGGER = (
    "SELECT tgname FROM pg_trigger "
    "WHERE tgrelid = 'usuario_rol'::regclass AND NOT tgisinternal"
)
SQL_TABLA_REPORTE = (
    "SELECT table_name FROM information_schema.tables "
    "WHERE table_name = 'rol_multiple_detectado'"
)


def _sembrar_catalogo(arnes) -> None:
    """SQL crudo, nunca el ORM: el ORM describe el esquema de HOY, no el de
    la revisión bajo prueba."""
    arnes.ejecutar(
        """
        INSERT INTO rol (id, tipo_rol, descripcion) VALUES
            (1, 'ADMINISTRADOR', 'Administrador'),
            (2, 'ALUMNO', 'Alumno'),
            (3, 'ENTRENADOR', 'Entrenador')
        """
    )


def _sembrar_cuenta(arnes, usuario_id: int, cedula: str) -> None:
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (:uid, 'Ana', 'Torres', :cedula, DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """,
        uid=usuario_id, cedula=cedula,
    )
    arnes.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,
                             version_contrasenia, activo, version_sesion,
                             persona_id)
        VALUES (:uid, :correo, 'hash',
                TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, TRUE, 5, :uid)
        """,
        uid=usuario_id, correo=f"cuenta{usuario_id}@cataclub.test",
    )


# --- La migración sobre una base LIMPIA -------------------------------------

def test_la_invariante_no_existia_antes(arnes_migracion):
    """Ancla: si esto dejara de fallar sin la migración, el trigger habría
    llegado al esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TRIGGER) == []
    assert arnes_migracion.consultar(SQL_TABLA_REPORTE) == []


def test_una_base_limpia_migra_y_queda_con_la_invariante(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_catalogo(arnes_migracion)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065")
    arnes_migracion.ejecutar("INSERT INTO usuario_rol VALUES (1, 2)")

    arnes_migracion.migrar(REVISION_ROL_UNICO)

    assert arnes_migracion.revision_actual() == REVISION_ROL_UNICO
    assert arnes_migracion.consultar(SQL_TRIGGER) != []
    assert arnes_migracion.consultar(SQL_TABLA_REPORTE) == [("rol_multiple_detectado",)]
    # Nada que reportar: la cuenta de una sola fila no es un hallazgo.
    assert arnes_migracion.consultar(
        "SELECT count(*) FROM rol_multiple_detectado"
    ) == [(0,)]
    assert arnes_migracion.consultar(
        "SELECT usuario_id, rol_id FROM usuario_rol"
    ) == [(1, 2)]


# --- La migración sobre una base CON el legado ------------------------------

def test_la_migracion_no_falla_con_una_cuenta_multirol_preexistente(arnes_migracion):
    """El escenario que decide el diseño: existe una cuenta real
    ADMINISTRADOR+ALUMNO en staging. Si la invariante fuera un índice único,
    este `upgrade` moriría y con él el deploy."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_catalogo(arnes_migracion)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065")
    arnes_migracion.ejecutar("INSERT INTO usuario_rol VALUES (1, 1), (1, 2)")

    arnes_migracion.migrar(REVISION_ROL_UNICO)

    assert arnes_migracion.revision_actual() == REVISION_ROL_UNICO


def test_la_migracion_no_elige_ni_borra_el_rol_legado(arnes_migracion):
    """La cuenta legada sale de la migración EXACTAMENTE como entró. Elegir
    por el dueño sería destruir un dato que solo él puede decidir."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_catalogo(arnes_migracion)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065")
    arnes_migracion.ejecutar("INSERT INTO usuario_rol VALUES (1, 1), (1, 2)")

    arnes_migracion.migrar(REVISION_ROL_UNICO)

    assert arnes_migracion.consultar(
        "SELECT usuario_id, rol_id FROM usuario_rol ORDER BY rol_id"
    ) == [(1, 1), (1, 2)]
    # Y tampoco toca la sesión: revocar es parte de la remediación, que el
    # dueño ejecuta aparte, no de la migración.
    assert arnes_migracion.consultar(
        "SELECT version_sesion FROM usuario WHERE id = 1"
    ) == [(5,)]


def test_la_migracion_registra_el_legado_en_la_tabla_de_reporte(arnes_migracion):
    """Detectar sin corregir tiene que dejar algo que el dueño pueda leer
    DESPUÉS del deploy: el log del contenedor se pierde, la remediación es
    una operación posterior y explícita."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_catalogo(arnes_migracion)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065")
    _sembrar_cuenta(arnes_migracion, 2, "1710034073")
    arnes_migracion.ejecutar("INSERT INTO usuario_rol VALUES (1, 1), (1, 2), (2, 3)")

    arnes_migracion.migrar(REVISION_ROL_UNICO)

    assert arnes_migracion.consultar(
        "SELECT usuario_id, roles_detectados, cantidad_roles, rol_conservado, "
        "remediado_en FROM rol_multiple_detectado"
    ) == [(1, "ADMINISTRADOR,ALUMNO", 2, None, None)]


def test_la_cuenta_legada_no_puede_sumar_un_tercer_rol(arnes_migracion):
    """El legado se tolera, no se amplía."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_catalogo(arnes_migracion)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065")
    arnes_migracion.ejecutar("INSERT INTO usuario_rol VALUES (1, 1), (1, 2)")
    arnes_migracion.migrar(REVISION_ROL_UNICO)

    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar("INSERT INTO usuario_rol VALUES (1, 3)")


# --- La invariante, ejercitada por Postgres directo -------------------------

@pytest.fixture()
def base_con_invariante(arnes_migracion):
    """Base al día, con catálogo y una cuenta sin roles."""
    arnes_migracion.preparar("head")
    _sembrar_catalogo(arnes_migracion)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065")
    return arnes_migracion


def test_postgres_rechaza_un_segundo_rol_distinto(base_con_invariante):
    """Sin pasar por ningún servicio: SQL crudo contra la base."""
    base_con_invariante.ejecutar("INSERT INTO usuario_rol VALUES (1, 1)")

    with pytest.raises(DBAPIError):
        base_con_invariante.ejecutar("INSERT INTO usuario_rol VALUES (1, 2)")

    assert base_con_invariante.consultar(
        "SELECT rol_id FROM usuario_rol WHERE usuario_id = 1"
    ) == [(1,)]


def test_postgres_permite_quitar_y_poner_en_la_misma_transaccion(
    base_con_invariante,
):
    """El cambio de rol sigue siendo posible: lo que se prohíbe es
    ACUMULAR, no reemplazar de forma explícita."""
    base_con_invariante.ejecutar("INSERT INTO usuario_rol VALUES (1, 1)")
    base_con_invariante.ejecutar(
        "DELETE FROM usuario_rol WHERE usuario_id = 1; "
        "INSERT INTO usuario_rol VALUES (1, 2)"
    )

    assert base_con_invariante.consultar(
        "SELECT rol_id FROM usuario_rol WHERE usuario_id = 1"
    ) == [(2,)]


def test_postgres_rechaza_mover_un_rol_a_una_cuenta_que_ya_tiene_otro(
    base_con_invariante,
):
    """El `UPDATE` es el agujero que un trigger `BEFORE INSERT` a secas
    dejaría abierto."""
    _sembrar_cuenta(base_con_invariante, 2, "1710034073")
    base_con_invariante.ejecutar(
        "INSERT INTO usuario_rol VALUES (1, 1), (2, 2)"
    )

    with pytest.raises(DBAPIError):
        base_con_invariante.ejecutar(
            "UPDATE usuario_rol SET usuario_id = 1 WHERE usuario_id = 2"
        )


# --- Concurrencia: lo que el chequeo de servicio no puede ganar -------------

def test_dos_sesiones_simultaneas_no_pueden_dejar_dos_roles(base_con_invariante):
    """Dos transacciones REALES corriendo a la vez, no dos llamadas
    seguidas. La primera inserta y se queda abierta; la segunda intenta el
    otro rol y tiene que QUEDARSE BLOQUEADA -- si devolviera de inmediato,
    ambas commitearían y la cuenta terminaría con dos roles, que es
    exactamente el defecto que el chequeo de servicio no puede evitar.

    Se verifica el bloqueo, no solo el error final: un trigger que contara
    sin tomar el lock pasaría un test que solo mirase el resultado en el
    caso feliz del scheduler, y fallaría en producción de forma
    intermitente.
    """
    motor = base_con_invariante.motor
    primera = motor.connect()
    segunda = motor.connect()
    try:
        primera.begin()
        primera.exec_driver_sql("INSERT INTO usuario_rol VALUES (1, 1)")

        def _insertar_el_otro_rol():
            segunda.begin()
            segunda.exec_driver_sql("INSERT INTO usuario_rol VALUES (1, 2)")
            segunda.commit()

        with ThreadPoolExecutor(max_workers=1) as ejecutor:
            futuro = ejecutor.submit(_insertar_el_otro_rol)
            # Margen amplio a propósito: se afirma que sigue BLOQUEADA, no
            # que tarde un tiempo determinado.
            time.sleep(1.0)
            assert not futuro.done(), (
                "la segunda transacción no se bloqueó: sin serialización, "
                "las dos verían la cuenta sin roles y las dos escribirían"
            )

            primera.commit()

            with pytest.raises(Exception):
                futuro.result(timeout=15)
    finally:
        primera.close()
        segunda.close()

    assert base_con_invariante.consultar(
        "SELECT rol_id FROM usuario_rol WHERE usuario_id = 1"
    ) == [(1,)]


def test_dos_sesiones_simultaneas_con_el_mismo_rol_dejan_una_sola_fila(
    base_con_invariante,
):
    """El otro lado de la carrera: el mismo rol dos veces sigue siendo el
    duplicado que la clave primaria ya rechazaba."""
    motor = base_con_invariante.motor
    primera = motor.connect()
    segunda = motor.connect()
    try:
        primera.begin()
        primera.exec_driver_sql("INSERT INTO usuario_rol VALUES (1, 1)")

        def _insertar_el_mismo_rol():
            segunda.begin()
            segunda.exec_driver_sql("INSERT INTO usuario_rol VALUES (1, 1)")
            segunda.commit()

        with ThreadPoolExecutor(max_workers=1) as ejecutor:
            futuro = ejecutor.submit(_insertar_el_mismo_rol)
            time.sleep(1.0)
            assert not futuro.done()
            primera.commit()
            with pytest.raises(Exception):
                futuro.result(timeout=15)
    finally:
        primera.close()
        segunda.close()

    assert base_con_invariante.consultar(
        "SELECT count(*) FROM usuario_rol WHERE usuario_id = 1"
    ) == [(1,)]


# --- Remediación: decisión explícita + revocación de sesiones ---------------

@pytest.fixture()
def base_con_legado(arnes_migracion):
    """Base al día cuya migración YA detectó una cuenta multirol legada."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_catalogo(arnes_migracion)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065")
    arnes_migracion.ejecutar("INSERT INTO usuario_rol VALUES (1, 1), (1, 2)")
    arnes_migracion.migrar("head")
    return arnes_migracion


def test_la_remediacion_exige_un_rol_de_los_que_la_cuenta_tiene(base_con_legado):
    from scripts.remediar_rol_multiple import remediar_cuenta

    with Session(bind=base_con_legado.motor) as sesion:
        with pytest.raises(ValueError):
            remediar_cuenta(sesion, usuario_id=1, rol_conservado=TipoRol.ENTRENADOR)

    assert base_con_legado.consultar(
        "SELECT count(*) FROM usuario_rol WHERE usuario_id = 1"
    ) == [(2,)]


def test_la_remediacion_conserva_el_rol_elegido_y_borra_el_otro(base_con_legado):
    from scripts.remediar_rol_multiple import remediar_cuenta

    with Session(bind=base_con_legado.motor) as sesion:
        remediar_cuenta(sesion, usuario_id=1, rol_conservado=TipoRol.ADMINISTRADOR)

    assert base_con_legado.consultar(
        "SELECT rol_id FROM usuario_rol WHERE usuario_id = 1"
    ) == [(1,)]


def test_la_remediacion_revoca_las_sesiones_de_la_cuenta(base_con_legado):
    """Issue #4, criterio unificado: quitar un rol RETIRA acceso, y el rol
    viaja embebido en el access token. Sin bombear `version_sesion`, el
    token viejo sigue autorizando el rol recién quitado."""
    from scripts.remediar_rol_multiple import remediar_cuenta

    antes = base_con_legado.consultar(
        "SELECT version_sesion FROM usuario WHERE id = 1"
    )[0][0]

    with Session(bind=base_con_legado.motor) as sesion:
        remediar_cuenta(sesion, usuario_id=1, rol_conservado=TipoRol.ADMINISTRADOR)

    despues = base_con_legado.consultar(
        "SELECT version_sesion FROM usuario WHERE id = 1"
    )[0][0]
    assert despues > antes


def test_la_remediacion_deja_asentada_la_decision_en_el_reporte(base_con_legado):
    """La fila de reporte pasa de "detectado" a "remediado con esta
    decisión": el rastro de auditoría que un reemplazo implícito no dejaría."""
    from scripts.remediar_rol_multiple import remediar_cuenta

    with Session(bind=base_con_legado.motor) as sesion:
        remediar_cuenta(sesion, usuario_id=1, rol_conservado=TipoRol.ALUMNO)

    filas = base_con_legado.consultar(
        "SELECT rol_conservado, remediado_en IS NOT NULL "
        "FROM rol_multiple_detectado WHERE usuario_id = 1"
    )
    assert filas == [("ALUMNO", True)]


def test_la_remediacion_es_dry_run_por_defecto(base_con_legado):
    """`aplicar=False` diagnostica y no muta: el dueño ve qué pasaría antes
    de autorizar la mutación."""
    from scripts.remediar_rol_multiple import remediar_cuenta

    with Session(bind=base_con_legado.motor) as sesion:
        resumen = remediar_cuenta(
            sesion, usuario_id=1, rol_conservado=TipoRol.ADMINISTRADOR,
            aplicar=False,
        )

    assert resumen["roles_a_quitar"] == ["ALUMNO"]
    assert base_con_legado.consultar(
        "SELECT count(*) FROM usuario_rol WHERE usuario_id = 1"
    ) == [(2,)]
    assert base_con_legado.consultar(
        "SELECT version_sesion FROM usuario WHERE id = 1"
    ) == [(5,)]
