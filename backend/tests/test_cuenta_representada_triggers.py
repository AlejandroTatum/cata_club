"""Candado de base para la cuenta de un representado (issue #1137, Fase 4).

Invariante B: una persona con `Persona.representante_id` no nulo nunca tiene
una fila en `usuario`. Las Fases 1-3 cerraron cada camino de aplicación que
podía violarlo; esta suite demuestra que la BASE es la garantía final: SQL
crudo que bypasea la aplicación choca contra los dos triggers de la
migración `j1142ctarep` (uno por tabla y por dirección de la escritura),
serializados por el mismo mecanismo de mutex de fila que
`g1139repmenor`/`i1141relinteg` usan para el invariante A.
"""
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona, Usuario


def _sembrar_persona(db, seed, fnac, rep_id=None, activo=True):
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula_valida(seed),
        fecha_nacimiento=fnac, telefono="0991234567", activo=activo,
        representante_id=rep_id,
    )
    db.add(persona)
    db.flush()
    return persona


def _sembrar_cuenta(db, persona_id, correo):
    cuenta = Usuario(correo=correo, contrasenia="hash", persona_id=persona_id)
    db.add(cuenta)
    db.flush()
    return cuenta


def _liquidar_diferidos(db):
    """Fuerza la evaluación de los `CONSTRAINT TRIGGER ... DEFERRED`
    pendientes AHORA, contra el estado actual (correcto en este punto de la
    siembra). Sin esto, el chequeo de sembrar una cuenta sana quedaría
    pendiente hasta el `SET CONSTRAINTS` del propio `_ejecutar_y_preservar`
    y se re-evaluaría ahí con el estado YA atacado -- confundiendo cuál de
    los dos triggers rechazó qué."""
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


def _ejecutar_y_preservar(db, sql, params, sondeo):
    """Corre una escritura cruda que DEBE ser rechazada y verifica que el
    grafo quedó intacto (el escenario "la base rechaza y no cambia nada").
    Mismo criterio que `test_representacion_triggers.py`: el rechazo va
    dentro de un SAVEPOINT propio porque Postgres aborta la transacción al
    dispararse el trigger.

    `SET CONSTRAINTS ALL IMMEDIATE` fuerza la evaluación de los dos
    `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` de la migración:
    diferidos, solo se evalúan en el `COMMIT` real de la transacción, y
    `db_session` nunca comitea (aísla con `rollback()` en el teardown) --
    sin este forzado, la escritura ofensiva pasaría en silencio y el
    `SAVEPOINT` se liberaría sin que el trigger llegara a correr."""
    antes = db.execute(text(sondeo)).all()
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text(sql), params)
        db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    assert db.execute(text(sondeo)).all() == antes


# --- SQL crudo: la cuenta no puede llegar a un representado -----------------

def test_sql_directo_rechaza_el_alta_de_cuenta_para_un_representado(db_session):
    rep = _sembrar_persona(db_session, 700, date(1990, 1, 1))
    menor = _sembrar_persona(db_session, 701, date(2020, 1, 1), rep_id=rep.id)
    _ejecutar_y_preservar(
        db_session,
        "INSERT INTO usuario (correo, contrasenia, persona_id, fecha_creacion,"
        " version_contrasenia, activo) VALUES (:correo, 'hash', :pid, now(),"
        " 1, true)",
        {"correo": "cuenta701@cataclub.test", "pid": menor.id},
        "SELECT id, persona_id FROM usuario ORDER BY id",
    )


def test_sql_directo_rechaza_reapuntar_una_cuenta_a_un_representado(db_session):
    rep = _sembrar_persona(db_session, 710, date(1990, 1, 1))
    otro = _sembrar_persona(db_session, 711, date(1992, 1, 1))
    cuenta = _sembrar_cuenta(db_session, otro.id, "cuenta711@cataclub.test")
    menor = _sembrar_persona(db_session, 712, date(2020, 1, 1), rep_id=rep.id)
    _ejecutar_y_preservar(
        db_session,
        "UPDATE usuario SET persona_id = :pid WHERE id = :uid",
        {"pid": menor.id, "uid": cuenta.id},
        "SELECT id, persona_id FROM usuario ORDER BY id",
    )


def test_sql_directo_rechaza_vincular_un_representante_a_quien_ya_tiene_cuenta(
    db_session,
):
    """El destino tiene que ser MENOR (el candado de `i1141relinteg` ya
    rechaza vincular a un adulto por edad, sin llegar a evaluar este
    candado): una cuenta de menor sembrada por SQL crudo -- nada distinto lo
    impide hoy -- es exactamente el bypass que el invariante B cierra."""
    rep = _sembrar_persona(db_session, 720, date(1990, 1, 1))
    menor = _sembrar_persona(db_session, 721, date(2020, 1, 1))
    _sembrar_cuenta(db_session, menor.id, "cuenta721@cataclub.test")
    # Liquida el candado diferido de la cuenta recién sembrada MIENTRAS
    # `menor` todavía no tiene representante: si quedara pendiente, el
    # `SET CONSTRAINTS` de `_ejecutar_y_preservar` lo re-evaluaría contra el
    # estado YA atacado (representante_id seteado) y el rechazo saldría del
    # trigger de `usuario`, no del de `persona` que este test ejercita.
    _liquidar_diferidos(db_session)
    _ejecutar_y_preservar(
        db_session,
        "UPDATE persona SET representante_id = :destino WHERE id = :pid",
        {"destino": rep.id, "pid": menor.id},
        "SELECT id, representante_id FROM persona ORDER BY id",
    )


def test_una_cuenta_normal_y_un_vinculo_normal_siguen_funcionando(db_session):
    """El candado no frena el camino sano: un adulto con cuenta propia sin
    representante, y un menor vinculado sin cuenta propia."""
    adulto = _sembrar_persona(db_session, 730, date(1990, 1, 1))
    _sembrar_cuenta(db_session, adulto.id, "cuenta730@cataclub.test")
    rep = _sembrar_persona(db_session, 731, date(1985, 1, 1))
    menor = _sembrar_persona(db_session, 732, date(2020, 1, 1), rep_id=rep.id)

    assert db_session.execute(text(
        "SELECT persona_id FROM usuario WHERE persona_id = :pid"
    ), {"pid": adulto.id}).scalar() == adulto.id
    assert menor.representante_id == rep.id


# --- El guard previo al `upgrade()` -----------------------------------------

REVISION_ANTERIOR = "i1141relinteg"
REVISION_CANDADO = "j1142ctarep"

SQL_TRIGGERS = (
    "SELECT tgname FROM pg_trigger WHERE tgrelid IN"
    " ('usuario'::regclass, 'persona'::regclass) AND NOT tgisinternal"
    " AND tgname IN ('trg_usuario_bloquea_cuenta_de_representado',"
    " 'trg_persona_bloquea_vinculo_con_cuenta') ORDER BY tgname"
)


def _sembrar_par_legado(arnes):
    """Un representante, su representado y la cuenta del representado --
    exactamente el par que el invariante B prohíbe -- sembrado con SQL
    crudo (el ORM describe el esquema de HOY, no el de la revisión bajo
    prueba). El representado se vincula siendo MENOR y envejece en el
    sitio: el candado de relación de `i1141relinteg`, ya activo en
    `REVISION_ANTERIOR`, rechaza el alta cruda de un adulto ya vinculado, así
    que una fila legada real solo puede llegar a la base por ese camino."""
    arnes.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo) VALUES"
        " (1, 'Rep', 'Legado', '1710034065', DATE '1990-01-01', '0991234567',"
        " TIMESTAMPTZ '2024-03-01 12:00:00+00', true)"
    )
    arnes.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo, representante_id) VALUES"
        " (2, 'Representado', 'Legado', '1710034073', DATE '2015-01-01',"
        " '0991234568', TIMESTAMPTZ '2024-03-01 12:00:00+00', true, 1)"
    )
    arnes.ejecutar(
        "UPDATE persona SET fecha_nacimiento = DATE '1995-01-01' WHERE id = 2"
    )
    arnes.ejecutar(
        "INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,"
        " version_contrasenia, activo, version_sesion, persona_id) VALUES"
        " (1, 'legado@cataclub.test', 'hash',"
        " TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, true, 5, 2)"
    )


def test_el_guard_aborta_sobre_un_par_legado_y_no_instala_nada(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_par_legado(arnes_migracion)

    with pytest.raises(RuntimeError, match=r"hay 1 personas representadas"):
        arnes_migracion.migrar(REVISION_CANDADO)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_TRIGGERS) == []


def test_el_guard_pasa_sobre_una_base_limpia(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    arnes_migracion.migrar(REVISION_CANDADO)

    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert arnes_migracion.consultar(SQL_TRIGGERS) == [
        ("trg_persona_bloquea_vinculo_con_cuenta",),
        ("trg_usuario_bloquea_cuenta_de_representado",),
    ]


# --- El `downgrade()`/`upgrade()` hacen ida y vuelta -------------------------

def test_el_round_trip_downgrade_upgrade_restaura_el_candado(arnes_migracion):
    """Mismo criterio que `test_representados_alcanzables.py` para
    `i1141relinteg`: `head -> REVISION_ANTERIOR -> head`, verificando que el
    candado reinstalado vuelve a rechazar el mismo alta cruda."""
    arnes_migracion.preparar("head")
    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert arnes_migracion.consultar(SQL_TRIGGERS) == [
        ("trg_persona_bloquea_vinculo_con_cuenta",),
        ("trg_usuario_bloquea_cuenta_de_representado",),
    ]

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_TRIGGERS) == []

    arnes_migracion.migrar(REVISION_CANDADO)
    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert arnes_migracion.consultar(SQL_TRIGGERS) == [
        ("trg_persona_bloquea_vinculo_con_cuenta",),
        ("trg_usuario_bloquea_cuenta_de_representado",),
    ]

    # Reinstalado, el candado vuelve a rechazar el mismo alta cruda.
    arnes_migracion.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo) VALUES"
        " (100, 'Rep', 'Vuelta', '1710034099', DATE '1990-01-01',"
        " '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', true)"
    )
    arnes_migracion.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo, representante_id) VALUES"
        " (101, 'Menor', 'Vuelta', '1710034107', DATE '2020-01-01',"
        " '0991234568', TIMESTAMPTZ '2024-03-01 12:00:00+00', true, 100)"
    )
    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar(
            "INSERT INTO usuario (correo, contrasenia, persona_id)"
            " VALUES ('vuelta@cataclub.test', 'hash', 101)"
        )
