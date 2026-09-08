"""
La mitad de base de datos del issue #1139: ningún menor puede quedar con
`representante_id` apuntando a una cuenta inactiva, ni con `representante_id`
nulo mientras siga siendo menor.

Por qué dos triggers y no un CHECK
-----------------------------------
Un `CHECK` se reevalúa contra la fila COMPLETA en cada UPDATE, aunque la
columna que cambió no tenga nada que ver con la condición -- el mismo motivo
por el que `persona.telefono` no lleva ninguno (ver el comentario en
`app/dominio/modelos.py`). Acá la condición además depende del ESTADO DE
OTRA FILA (si el representado es menor, si la cuenta destino está activa) y
de la FECHA (`age(CURRENT_DATE, ...)`): ninguna de las dos cosas es válida en
un CHECK, que Postgres exige inmutable. `NOT VALID` tampoco lo salva: solo
evita el recorrido inicial, no las reevaluaciones futuras. Mismo criterio que
`e762rolunico` (issue #762): un trigger `BEFORE ... OF <columnas>` acotado a
las columnas relevantes.

Dos triggers, uno por tabla y por dirección del vínculo:
  1. `trg_usuario_bloquea_baja_con_representados_menores` (BEFORE INSERT OR
     UPDATE OF activo ON usuario): no deja desactivar una cuenta que
     representa a un menor activo.
  2. `trg_persona_representante_alcanzable` (BEFORE UPDATE OF
     representante_id ON persona): no deja nulear el vínculo de un menor, ni
     vincularlo a una cuenta ya desactivada.

Sin tabla de legado ni backfill: a diferencia de #762 (una cuenta multirol ya
existía en staging), no hay ninguna fila hoy que ya viole este invariante --
los dos triggers son `BEFORE`, así que ninguno reevalúa filas existentes; la
base queda cerrada hacia adelante desde el `alembic upgrade`.
"""
import pytest
from sqlalchemy.exc import DBAPIError


REVISION_ANTERIOR = "f1023correobtrim"
REVISION_NUEVA = "g1139repmenor"

SQL_TRIGGER_USUARIO = (
    "SELECT tgname FROM pg_trigger "
    "WHERE tgrelid = 'usuario'::regclass AND NOT tgisinternal "
    "AND tgname = 'trg_usuario_bloquea_baja_con_representados_menores'"
)
SQL_TRIGGER_PERSONA = (
    "SELECT tgname FROM pg_trigger "
    "WHERE tgrelid = 'persona'::regclass AND NOT tgisinternal "
    "AND tgname = 'trg_persona_representante_alcanzable'"
)


def _sembrar_persona(arnes, persona_id: int, cedula: str, fecha_nacimiento: str,
                     representante_id: "int | None" = None, activo: bool = True) -> None:
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo, representante_id)
        VALUES (:pid, 'Ana', 'Torres', :cedula, CAST(:fnac AS date),
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', :activo, :repid)
        """,
        pid=persona_id, cedula=cedula, fnac=fecha_nacimiento,
        activo=activo, repid=representante_id,
    )


def _sembrar_usuario(arnes, usuario_id: int, persona_id: int, activo: bool = True) -> None:
    arnes.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,
                             version_contrasenia, activo, version_sesion,
                             persona_id)
        VALUES (:uid, :correo, 'hash',
                TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, :activo, 5, :pid)
        """,
        uid=usuario_id, correo=f"cuenta{usuario_id}@cataclub.test",
        activo=activo, pid=persona_id,
    )


# --- La migración sobre una base LIMPIA -------------------------------------

def test_los_triggers_no_existian_antes(arnes_migracion):
    """Ancla: si esto dejara de fallar sin la migración, los triggers
    habrían llegado al esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TRIGGER_USUARIO) == []
    assert arnes_migracion.consultar(SQL_TRIGGER_PERSONA) == []


def test_una_base_limpia_migra_y_queda_con_los_dos_triggers(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    arnes_migracion.migrar(REVISION_NUEVA)

    assert arnes_migracion.revision_actual() == REVISION_NUEVA
    assert arnes_migracion.consultar(SQL_TRIGGER_USUARIO) != []
    assert arnes_migracion.consultar(SQL_TRIGGER_PERSONA) != []


# --- La invariante, ejercitada por Postgres directo -------------------------

def base_con_invariante(arnes_migracion):
    arnes_migracion.preparar("head")
    return arnes_migracion


def test_postgres_rechaza_desactivar_una_cuenta_con_representado_menor_activo(
    arnes_migracion,
):
    base = base_con_invariante(arnes_migracion)
    _sembrar_persona(base, 1, "1710034065", "1990-01-01")
    _sembrar_usuario(base, 1, 1)
    _sembrar_persona(base, 2, "1710034073", "2015-05-14", representante_id=1)

    with pytest.raises(DBAPIError):
        base.ejecutar("UPDATE usuario SET activo = false WHERE id = 1")

    assert base.consultar("SELECT activo FROM usuario WHERE id = 1") == [(True,)]


def test_postgres_permite_desactivar_una_cuenta_sin_representados(arnes_migracion):
    base = base_con_invariante(arnes_migracion)
    _sembrar_persona(base, 1, "1710034065", "1990-01-01")
    _sembrar_usuario(base, 1, 1)

    base.ejecutar("UPDATE usuario SET activo = false WHERE id = 1")

    assert base.consultar("SELECT activo FROM usuario WHERE id = 1") == [(False,)]


def test_postgres_permite_desactivar_con_representado_mayor_de_edad(arnes_migracion):
    base = base_con_invariante(arnes_migracion)
    _sembrar_persona(base, 1, "1710034065", "1990-01-01")
    _sembrar_usuario(base, 1, 1)
    _sembrar_persona(base, 2, "1710034073", "1995-01-01", representante_id=1)

    base.ejecutar("UPDATE usuario SET activo = false WHERE id = 1")

    assert base.consultar("SELECT activo FROM usuario WHERE id = 1") == [(False,)]


def test_postgres_permite_desactivar_con_representado_menor_ya_dado_de_baja(
    arnes_migracion,
):
    base = base_con_invariante(arnes_migracion)
    _sembrar_persona(base, 1, "1710034065", "1990-01-01")
    _sembrar_usuario(base, 1, 1)
    _sembrar_persona(
        base, 2, "1710034073", "2015-05-14", representante_id=1, activo=False,
    )

    base.ejecutar("UPDATE usuario SET activo = false WHERE id = 1")

    assert base.consultar("SELECT activo FROM usuario WHERE id = 1") == [(False,)]


def test_postgres_rechaza_nulear_el_representante_de_un_menor(arnes_migracion):
    base = base_con_invariante(arnes_migracion)
    _sembrar_persona(base, 1, "1710034065", "1990-01-01")
    _sembrar_persona(base, 2, "1710034073", "2015-05-14", representante_id=1)

    with pytest.raises(DBAPIError):
        base.ejecutar("UPDATE persona SET representante_id = NULL WHERE id = 2")

    assert base.consultar(
        "SELECT representante_id FROM persona WHERE id = 2"
    ) == [(1,)]


def test_postgres_permite_nulear_el_representante_de_un_mayor_de_edad(arnes_migracion):
    """El camino de `independizar()`."""
    base = base_con_invariante(arnes_migracion)
    _sembrar_persona(base, 1, "1710034065", "1990-01-01")
    _sembrar_persona(base, 2, "1710034073", "1995-01-01", representante_id=1)

    base.ejecutar("UPDATE persona SET representante_id = NULL WHERE id = 2")

    assert base.consultar(
        "SELECT representante_id FROM persona WHERE id = 2"
    ) == [(None,)]


def test_postgres_rechaza_vincular_un_representado_a_una_cuenta_desactivada(
    arnes_migracion,
):
    base = base_con_invariante(arnes_migracion)
    _sembrar_persona(base, 1, "1710034065", "1990-01-01")
    _sembrar_usuario(base, 1, 1, activo=False)
    _sembrar_persona(base, 2, "1710034073", "2015-05-14")

    with pytest.raises(DBAPIError):
        base.ejecutar("UPDATE persona SET representante_id = 1 WHERE id = 2")

    assert base.consultar(
        "SELECT representante_id FROM persona WHERE id = 2"
    ) == [(None,)]


def test_postgres_permite_vincular_un_representado_a_una_cuenta_activa(arnes_migracion):
    base = base_con_invariante(arnes_migracion)
    _sembrar_persona(base, 1, "1710034065", "1990-01-01")
    _sembrar_usuario(base, 1, 1)
    _sembrar_persona(base, 2, "1710034073", "2015-05-14")

    base.ejecutar("UPDATE persona SET representante_id = 1 WHERE id = 2")

    assert base.consultar(
        "SELECT representante_id FROM persona WHERE id = 2"
    ) == [(1,)]


def test_postgres_permite_vincular_un_representado_a_alguien_sin_usuario_propio(
    arnes_migracion,
):
    """Un tutor cargado a mano, sin login, no tiene ninguna cuenta que
    pueda estar desactivada."""
    base = base_con_invariante(arnes_migracion)
    _sembrar_persona(base, 1, "1710034065", "1990-01-01")
    _sembrar_persona(base, 2, "1710034073", "2015-05-14")

    base.ejecutar("UPDATE persona SET representante_id = 1 WHERE id = 2")

    assert base.consultar(
        "SELECT representante_id FROM persona WHERE id = 2"
    ) == [(1,)]


# --- El `downgrade()` es real ------------------------------------------------

def test_el_downgrade_quita_los_dos_triggers(arnes_migracion):
    arnes_migracion.preparar(REVISION_NUEVA)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_TRIGGER_USUARIO) == []
    assert arnes_migracion.consultar(SQL_TRIGGER_PERSONA) == []
