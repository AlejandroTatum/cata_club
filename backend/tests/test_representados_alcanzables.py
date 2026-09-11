"""Alcance de los menores representados: paridad documento/base (PR 4a, #1133).

Esta suite ancla que los triggers documentados por la migración
`i1141relinteg` son EXACTAMENTE los instalados en la base, que el trigger
legado de `g1139` fue reemplazado por el de relación, y que el invariante
#1139 de desactivación de cuenta sigue vivo (la migración no lo tocó).

PR 4a ancla los nombres con literales locales: el módulo de dominio
(`app/dominio/representados_alcanzables.py`) recién en PR 4b los adopta como
constantes compartidas (`TRIGGER_RELACION_REPRESENTACION`,
`TRIGGER_TELEFONO_REPRESENTANTE`) junto al helper puro
`exigir_telefono_actual_del_destino`, cuya paridad con la base se prueba ahí.
"""
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona, Usuario

# Mismos literales que la migración `i1141relinteg` instala; PR 4b los mueve a
# constantes de dominio con el mismo criterio de `TRIGGER_ROL_UNICO`.
TRIGGER_RELACION_REPRESENTACION = "trg_relacion_representacion_valida"
TRIGGER_TELEFONO_REPRESENTANTE = "trg_telefono_representante_con_menores"
TRIGGER_USUARIO_BLOQUEA_BAJA = "trg_usuario_bloquea_baja_con_representados_menores"


def _instalados(db):
    return {
        fila[0] for fila in db.execute(text(
            "SELECT tgname FROM pg_trigger WHERE tgrelid IN"
            " ('persona'::regclass, 'usuario'::regclass)"
            " AND NOT tgisinternal"
        )).all()
    }


def test_los_triggers_documentados_son_los_instalados(db_session):
    """Paridad documento/base: los tres triggers del invariante están, y el
    trigger persona de `g1139` ya NO está (lo reemplazó el de relación con
    alcance INSERT + UPDATE)."""
    instalados = _instalados(db_session)
    assert TRIGGER_RELACION_REPRESENTACION in instalados
    assert TRIGGER_TELEFONO_REPRESENTANTE in instalados
    assert TRIGGER_USUARIO_BLOQUEA_BAJA in instalados
    assert "trg_persona_representante_alcanzable" not in instalados


def test_desactivar_cuenta_con_menor_activo_sigue_bloqueada_por_la_base(db_session):
    """Regresión del invariante #1139 que permanece: la base sigue
    rechazando desactivar la cuenta de un representante con menor activo."""
    rep = Persona(
        nombres="María", apellidos="López", cedula=cedula_valida(540),
        fecha_nacimiento=date(1985, 3, 20), telefono="0998765432",
    )
    db_session.add(rep)
    db_session.flush()
    db_session.add(Usuario(
        correo="maria@test.com", contrasenia="hash", persona_id=rep.id,
    ))
    db_session.add(Persona(
        nombres="Lucía", apellidos="Pérez", cedula=cedula_valida(541),
        fecha_nacimiento=date(2020, 6, 15), telefono="0991234568",
        representante_id=rep.id,
    ))
    db_session.flush()

    with pytest.raises(DBAPIError):
        db_session.execute(text(
            "UPDATE usuario SET activo = false WHERE persona_id = :pid"
        ), {"pid": rep.id})
    db_session.rollback()


def test_el_menor_envejecido_libera_la_baja_de_la_cuenta(db_session):
    """El trigger de `usuario` evalúa la edad ACTUAL: el representado que
    cumplió 18 ya no frena la desactivación de la cuenta de su ex
    representante (la evaluación es al momento de la escritura)."""
    rep = Persona(
        nombres="María", apellidos="López", cedula=cedula_valida(550),
        fecha_nacimiento=date(1985, 3, 20), telefono="0998765432",
    )
    db_session.add(rep)
    db_session.flush()
    db_session.add(Usuario(
        correo="maria2@test.com", contrasenia="hash", persona_id=rep.id,
    ))
    hijo = Persona(
        nombres="Lucío", apellidos="Pérez", cedula=cedula_valida(551),
        fecha_nacimiento=date(2013, 6, 15), telefono="0991234568",
        representante_id=rep.id,
    )
    db_session.add(hijo)
    db_session.flush()

    with pytest.raises(DBAPIError):
        db_session.execute(text(
            "UPDATE usuario SET activo = false WHERE persona_id = :pid"
        ), {"pid": rep.id})
    db_session.rollback()

    hijo.fecha_nacimiento = date(2005, 6, 15)
    db_session.flush()
    db_session.execute(text(
        "UPDATE usuario SET activo = false WHERE persona_id = :pid"
    ), {"pid": rep.id})
    db_session.flush()


# --- El round trip del `downgrade()`/`upgrade()` restaura el candado ---------

REVISION_ANTERIOR = "h1140rep_auditoria"
REVISION_CANDADO = "i1141relinteg"
TRIGGER_LEGADO_G1139 = "trg_persona_representante_alcanzable"


def _trigger_en_persona(arnes, nombre):
    return arnes.consultar(
        "SELECT tgname FROM pg_trigger"
        " WHERE tgrelid = 'persona'::regclass AND NOT tgisinternal"
        " AND tgname = :nombre",
        nombre=nombre,
    )


def _candado_de_relacion(arnes):
    return _trigger_en_persona(arnes, TRIGGER_RELACION_REPRESENTACION)


def _sembrar_destino_valido(arnes, persona_id, cedula):
    arnes.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo) VALUES (:pid, 'María', 'López',"
        " :cedula, DATE '1990-01-01', '0998765432',"
        " TIMESTAMPTZ '2024-03-01 12:00:00+00', true)",
        pid=persona_id, cedula=cedula,
    )


def _insertar_persona_vinculada(arnes, persona_id, cedula, fecha_nacimiento):
    arnes.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo, representante_id) VALUES"
        " (:pid, 'Ana', 'Torres', :cedula, CAST(:fnac AS date), '0991234567',"
        " TIMESTAMPTZ '2024-03-01 12:00:00+00', true, 1)",
        pid=persona_id, cedula=cedula, fnac=fecha_nacimiento,
    )


def test_el_round_trip_downgrade_upgrade_restaura_el_candado(arnes_migracion):
    """Prueba REAL del borde de rollback: `head -> h1140rep_auditoria -> head`.

    El veredicto independiente de PR4a marcó el downgrade como no probado. Acá
    se ejercita de punta a punta sobre una base limpia del arnés: el downgrade
    restituye el trigger legado de `g1139` (con su CONTRATO, no solo su nombre)
    y el upgrade reinstala el candado de relación, que vuelve a rechazar el
    mismo alta cruda de adulto que sin él se admitía."""
    arnes_migracion.preparar("head")
    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert _candado_de_relacion(arnes_migracion) == [
        (TRIGGER_RELACION_REPRESENTACION,)
    ]
    assert _trigger_en_persona(arnes_migracion, TRIGGER_LEGADO_G1139) == []

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert _candado_de_relacion(arnes_migracion) == []
    assert _trigger_en_persona(arnes_migracion, TRIGGER_LEGADO_G1139) == [
        (TRIGGER_LEGADO_G1139,)
    ]
    # El trigger legado vuelve con su CONTRATO: sin el candado nuevo, el alta
    # cruda de un adulto se admite (por eso hay que probar la restauración) y
    # el menor activo no puede quedar sin representante.
    _sembrar_destino_valido(arnes_migracion, 1, cedula_valida(601))
    _insertar_persona_vinculada(
        arnes_migracion, 2, cedula_valida(602), "1995-01-01",
    )
    assert arnes_migracion.consultar(
        "SELECT representante_id FROM persona WHERE id = 2"
    ) == [(1,)]
    _insertar_persona_vinculada(
        arnes_migracion, 3, cedula_valida(603), "2015-05-14",
    )
    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar(
            "UPDATE persona SET representante_id = NULL WHERE id = 3"
        )

    arnes_migracion.migrar("head")
    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert _candado_de_relacion(arnes_migracion) == [
        (TRIGGER_RELACION_REPRESENTACION,)
    ]
    assert _trigger_en_persona(arnes_migracion, TRIGGER_LEGADO_G1139) == []
    # ...y el candado restaurado RECHAZA de nuevo la misma fila.
    with pytest.raises(DBAPIError):
        _insertar_persona_vinculada(
            arnes_migracion, 4, cedula_valida(604), "1995-01-01",
        )
    assert arnes_migracion.consultar(
        "SELECT count(*) FROM persona WHERE id = 4"
    ) == [(0,)]
