"""
Issue #1592: `GET /portal/alumno/{persona_id}` is the single backend call
behind the BFF's `GET /api/student`. It must return exactly what the BFF used
to assemble from ~4 calls per profile, under the same authorization rules as
the per-profile endpoints, without per-profile queries.
"""
from datetime import date, time

from app.dominio.cedula import cedula_valida
from app.dominio.enums import Categoria, DiaSemana, EstadoAsistencia, EstadoMembresia
from app.dominio.modelos import Asistencia, HorarioEntrenamiento
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm,
)

URL = "/api/v1/portal/alumno"


def _como(persona_id, roles):
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": f"p{persona_id}@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _horario(db_session):
    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES,
        hora_inicio=time(18, 0), hora_fin=time(19, 30),
    )
    db_session.add(horario)
    db_session.flush()
    return horario


def _familia(db_session, base=7000):
    """Representante + dos hijos, cada uno con una asistencia y una membresía."""
    tipo = crear_tipo_membresia_orm(db_session)
    horario = _horario(db_session)
    padre = crear_persona_orm(db_session, cedula_valida(base), nombres="Pat", apellidos="Padre")
    hijos = []
    for i in (1, 2):
        hijo = crear_persona_orm(db_session, cedula_valida(base + i), nombres=f"Hijo{i}", apellidos="Padre",
            fecha_nacimiento=date(2018, 1, 1))
        hijo.representante_id = padre.id
        db_session.add(Asistencia(
            fecha_entrenamiento=date(2026, 7, 6), estado=EstadoAsistencia.PRESENTE,
            persona_id=hijo.id, horario_id=horario.id,
        ))
        crear_membresia_orm(db_session, hijo, tipo, EstadoMembresia.ACTIVA)
        hijos.append(hijo)
    db_session.add(Asistencia(
        fecha_entrenamiento=date(2026, 7, 6), estado=EstadoAsistencia.PRESENTE,
        persona_id=padre.id, horario_id=horario.id,
    ))
    crear_membresia_orm(db_session, padre, tipo, EstadoMembresia.ACTIVA)
    db_session.commit()
    return padre, hijos, tipo, horario


def test_portal_devuelve_titular_representados_y_catalogos(client, db_session):
    padre, hijos, tipo, horario = _familia(db_session)
    _como(padre.id, ["REPRESENTANTE"])

    resp = client.get(f"{URL}/{padre.id}")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["titular"]["persona"]["id"] == padre.id
    assert cuerpo["titular"]["representante"] is None
    assert len(cuerpo["titular"]["historial"]) == 1
    assert cuerpo["titular"]["membresias"][0]["estado"] == "ACTIVA"
    assert {r["persona"]["id"] for r in cuerpo["representados"]} == {h.id for h in hijos}
    for representado in cuerpo["representados"]:
        assert representado["representante"] == {"nombres": "Pat", "apellidos": "Padre"}
        assert len(representado["historial"]) == 1
        assert len(representado["membresias"]) == 1
    assert [h["id"] for h in cuerpo["horarios"]] == [horario.id]
    assert [t["id"] for t in cuerpo["tipos"]] == [tipo.id]


def test_portal_sin_representados_devuelve_lista_vacia(client, db_session):
    persona = crear_persona_orm(db_session, cedula_valida(7100))
    db_session.commit()
    _como(persona.id, ["ALUMNO"])

    resp = client.get(f"{URL}/{persona.id}")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["representados"] == []
    assert cuerpo["titular"]["historial"] == []
    assert cuerpo["titular"]["membresias"] == []
    assert cuerpo["horarios"] == []


def test_portal_no_expone_perfiles_de_otra_cuenta(client, db_session):
    padre, hijos, _, _ = _familia(db_session)
    intruso = crear_persona_orm(db_session, cedula_valida(7200))
    db_session.commit()
    _como(intruso.id, ["REPRESENTANTE"])

    resp = client.get(f"{URL}/{padre.id}")

    assert resp.status_code == 403
    assert "Hijo1" not in resp.text


def test_portal_un_hijo_no_ve_la_cuenta_de_su_representante(client, db_session):
    padre, hijos, _, _ = _familia(db_session)
    _como(hijos[0].id, ["ALUMNO"])

    assert client.get(f"{URL}/{padre.id}").status_code == 403


def test_portal_entrenador_no_accede(client, db_session):
    padre, _, _, _ = _familia(db_session)
    _como(9999, ["ENTRENADOR"])

    assert client.get(f"{URL}/{padre.id}").status_code == 403


def test_portal_administrador_accede(client, db_session):
    padre, hijos, _, _ = _familia(db_session)
    _como(9999, ["ADMINISTRADOR"])

    resp = client.get(f"{URL}/{padre.id}")

    assert resp.status_code == 200
    assert len(resp.json()["representados"]) == len(hijos)


def test_portal_persona_inexistente_es_404(client):
    _como(9999, ["ADMINISTRADOR"])

    assert client.get(f"{URL}/424242").status_code == 404


def test_portal_no_incurre_en_n_mas_uno(client, db_session, contar_selects):
    """Cantidad de SELECTs constante: no crece con la cantidad de hijos."""
    padre, hijos, tipo, horario = _familia(db_session, base=7300)
    _como(padre.id, ["REPRESENTANTE"])

    def medir():
        db_session.expire_all()
        with contar_selects() as sentencias:
            assert client.get(f"{URL}/{padre.id}").status_code == 200
        return len([s for s in sentencias if s.strip().upper().startswith("SELECT")])

    base_selects = medir()
    for i in range(3, 6):
        hijo = crear_persona_orm(db_session, cedula_valida(7300 + i), nombres=f"Hijo{i}", fecha_nacimiento=date(2018, 1, 1))
        hijo.representante_id = padre.id
        db_session.add(Asistencia(
            fecha_entrenamiento=date(2026, 7, 6), estado=EstadoAsistencia.PRESENTE,
            persona_id=hijo.id, horario_id=horario.id,
        ))
        crear_membresia_orm(db_session, hijo, tipo, EstadoMembresia.ACTIVA)
    db_session.commit()

    assert medir() == base_selects


def test_portal_historial_limite_acota_el_historial_de_cada_perfil(client, db_session):
    padre, hijos, _, horario = _familia(db_session, base=7400)
    for dia in (13, 20, 27):
        for persona in (padre, *hijos):
            db_session.add(Asistencia(
                fecha_entrenamiento=date(2026, 7, dia), estado=EstadoAsistencia.PRESENTE,
                persona_id=persona.id, horario_id=horario.id,
            ))
    db_session.commit()
    _como(padre.id, ["REPRESENTANTE"])

    cuerpo = client.get(f"{URL}/{padre.id}?historial_limite=2").json()

    for perfil in (cuerpo["titular"], *cuerpo["representados"]):
        assert [a["fechaEntrenamiento"] for a in perfil["historial"]] == ["2026-07-27", "2026-07-20"]


def test_portal_historial_total_cuenta_todo_el_historial_aunque_el_limite_lo_recorte(client, db_session):
    padre, hijos, _, horario = _familia(db_session, base=7500)
    # `_familia` ya siembra una asistencia por persona: el titular termina con 5.
    for dia in (13, 20, 27, 28):
        db_session.add(Asistencia(
            fecha_entrenamiento=date(2026, 7, dia), estado=EstadoAsistencia.PRESENTE,
            persona_id=padre.id, horario_id=horario.id,
        ))
    db_session.commit()
    _como(padre.id, ["REPRESENTANTE"])

    cuerpo = client.get(f"{URL}/{padre.id}?historial_limite=2").json()

    assert len(cuerpo["titular"]["historial"]) == 2
    assert cuerpo["titular"]["historialTotal"] == 5
    for hijo in cuerpo["representados"]:
        assert hijo["historialTotal"] == len(hijo["historial"]) == 1

