"""QA4 ADMB-04: una categoría (o un día) con alumnos se puede eliminar solo
cuando queda vacía. El administrador tiene dos caminos: pasar a TODOS los
alumnos a UNA categoría destino y borrar en la misma transacción
(`mover-y-eliminar`, o `mover_alumnos_a` al quitar un día), o pasarlos de a
uno (`mover-alumnos` con `persona_ids`). Todo o nada: si algo falla, no
cambia nada."""
from datetime import date, time
from decimal import Decimal

import pytest

from app.dominio.enums import DiaSemana, EstadoAsistencia, EstadoMembresia, TipoModalidad
from app.dominio.modelos import AlumnoHorario, CategoriaHorario, Membresia, TipoMembresia
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from app.servicios_negocio.dtos.asistencia_schemas import (
    AlumnoHorarioCreateDTO, AsistenciaCreateDTO, CategoriaCreateDTO,
)

pytestmark = pytest.mark.usefixtures("sin_ventana_de_registro")

BASE = "/api/v1/asistencias"


def _persona(client, cedula, nombres="Ana"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": nombres, "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()["id"]


def _habilitar(db_session, persona_id):
    tipo = TipoMembresia(categoria="Formativo", precio=Decimal("25.00"), modalidad=TipoModalidad.MENSUAL)
    db_session.add(tipo)
    db_session.flush()
    db_session.add(Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("25.00"),
        fecha_activacion=date(2026, 1, 1), persona_id=persona_id, tipo_membresia_id=tipo.id,
    ))
    db_session.flush()


def _categoria(servicio, nombre, dias, inicio=time(15, 0), fin=time(16, 0)):
    return servicio.crear_categoria(CategoriaCreateDTO(
        nombre=nombre, hora_inicio=inicio, hora_fin=fin, dias=dias,
    ))


def _inscribir(servicio, persona_id, codigo):
    servicio.asignar_alumno_a_horario(AlumnoHorarioCreateDTO(
        persona_id=persona_id, horario_id=servicio.listar_horarios(codigo)[0].id,
    ))


def _categorias_de(db_session, persona_id):
    filas = db_session.query(AlumnoHorario).filter(AlumnoHorario.persona_id == persona_id).all()
    return sorted((f.horario.categoria, f.horario.dia_semana.value) for f in filas)


@pytest.fixture()
def escenario(db_session, client):
    """Origen (lun+mié) con dos alumnos; destino (lun+mié+vie) vacío."""
    servicio = AsistenciaServicio(db_session)
    origen = _categoria(servicio, "Origen", [DiaSemana.LUNES, DiaSemana.MIERCOLES])
    destino = _categoria(
        servicio, "Destino", [DiaSemana.LUNES, DiaSemana.MIERCOLES, DiaSemana.VIERNES],
        inicio=time(17, 0), fin=time(18, 0),
    )
    ana = _persona(client, "1710034065", "Ana")
    luis = _persona(client, "1700000001", "Luis")
    for p in (ana, luis):
        _habilitar(db_session, p)
        _inscribir(servicio, p, origen.codigo)
    return servicio, origen, destino, ana, luis


def test_mover_y_eliminar_pasa_a_todos_y_borra_en_una_operacion(client, db_session, escenario):
    servicio, origen, destino, ana, luis = escenario

    r = client.post(
        f"{BASE}/categorias/{origen.codigo}/mover-y-eliminar",
        json={"categoria_destino": destino.codigo},
    )

    assert r.status_code == 200, r.text
    assert r.json() == {
        "movidos": 2, "categoriaDestino": destino.codigo, "categoriaDestinoLabel": "Destino",
    }
    assert db_session.get(CategoriaHorario, origen.codigo) is None
    esperado = [(destino.codigo, d) for d in ("LUNES", "MIERCOLES", "VIERNES")]
    assert _categorias_de(db_session, ana) == sorted(esperado)
    assert _categorias_de(db_session, luis) == sorted(esperado)


def test_mover_y_eliminar_no_duplica_a_quien_ya_esta_en_el_destino(client, db_session, escenario):
    servicio, origen, destino, ana, luis = escenario
    _inscribir(servicio, ana, destino.codigo)

    r = client.post(
        f"{BASE}/categorias/{origen.codigo}/mover-y-eliminar",
        json={"categoria_destino": destino.codigo},
    )

    assert r.status_code == 200, r.text
    assert r.json()["movidos"] == 2
    assert len(_categorias_de(db_session, ana)) == 3
    assert len(_categorias_de(db_session, luis)) == 3


def test_mover_y_eliminar_sin_alumnos_solo_elimina(client, db_session):
    servicio = AsistenciaServicio(db_session)
    origen = _categoria(servicio, "Vacia", [DiaSemana.LUNES])
    destino = _categoria(servicio, "Otra", [DiaSemana.MARTES])

    r = client.post(
        f"{BASE}/categorias/{origen.codigo}/mover-y-eliminar",
        json={"categoria_destino": destino.codigo},
    )

    assert r.status_code == 200
    assert r.json()["movidos"] == 0
    assert db_session.get(CategoriaHorario, origen.codigo) is None


@pytest.mark.parametrize("destino_codigo,status", [("no-existe", 404), ("ORIGEN", 400)])
def test_mover_y_eliminar_con_destino_invalido_no_cambia_nada(
    client, db_session, escenario, destino_codigo, status,
):
    servicio, origen, destino, ana, luis = escenario
    antes = _categorias_de(db_session, ana)
    codigo_destino = origen.codigo if destino_codigo == "ORIGEN" else destino_codigo

    r = client.post(
        f"{BASE}/categorias/{origen.codigo}/mover-y-eliminar",
        json={"categoria_destino": codigo_destino},
    )

    assert r.status_code == status
    assert db_session.get(CategoriaHorario, origen.codigo) is not None
    assert _categorias_de(db_session, ana) == antes
    assert _categorias_de(db_session, luis) == antes


def test_mover_y_eliminar_con_asistencias_en_el_origen_rechaza_sin_mover(client, db_session, escenario):
    servicio, origen, destino, ana, luis = escenario
    servicio.registrar_asistencia(AsistenciaCreateDTO(
        fecha_entrenamiento="2026-08-10", estado=EstadoAsistencia.PRESENTE,
        persona_id=ana, horario_id=servicio.listar_horarios(origen.codigo)[0].id,
    ), ["ADMINISTRADOR"], ana)

    r = client.post(
        f"{BASE}/categorias/{origen.codigo}/mover-y-eliminar",
        json={"categoria_destino": destino.codigo},
    )

    assert r.status_code == 400
    assert "historial" in r.json()["detail"]
    assert db_session.get(CategoriaHorario, origen.codigo) is not None
    assert all(c == origen.codigo for c, _ in _categorias_de(db_session, ana))
    assert all(c == origen.codigo for c, _ in _categorias_de(db_session, luis))


def test_mover_y_eliminar_si_el_borrado_falla_nada_se_confirma(db_session, client, escenario, monkeypatch):
    servicio, origen, destino, ana, luis = escenario
    db_session.commit()

    def _falla(*_a, **_k):
        raise RuntimeError("fallo simulado")

    monkeypatch.setattr(servicio.repo_categoria, "eliminar_con_horarios", _falla)
    with pytest.raises(RuntimeError):
        servicio.mover_y_eliminar_categoria(origen.codigo, destino.codigo)
    db_session.rollback()

    assert db_session.get(CategoriaHorario, origen.codigo) is not None
    assert all(c == origen.codigo for c, _ in _categorias_de(db_session, ana))


def test_mover_alumnos_de_a_uno_y_ignora_a_quien_ya_no_esta(client, db_session, escenario):
    servicio, origen, destino, ana, luis = escenario
    ajeno = _persona(client, "1700000019", "Ajeno")

    r = client.post(
        f"{BASE}/categorias/{origen.codigo}/mover-alumnos",
        json={"categoria_destino": destino.codigo, "persona_ids": [ana, ajeno]},
    )

    assert r.status_code == 200, r.text
    assert r.json()["movidos"] == 1
    assert all(c == destino.codigo for c, _ in _categorias_de(db_session, ana))
    assert all(c == origen.codigo for c, _ in _categorias_de(db_session, luis))
    assert _categorias_de(db_session, ajeno) == []
    assert db_session.get(CategoriaHorario, origen.codigo) is not None


def test_mover_alumnos_exige_al_menos_un_alumno(client, escenario):
    _, origen, destino, _, _ = escenario
    r = client.post(
        f"{BASE}/categorias/{origen.codigo}/mover-alumnos",
        json={"categoria_destino": destino.codigo, "persona_ids": []},
    )
    assert r.status_code == 422


def test_quitar_un_dia_con_mover_alumnos_a_pasa_a_todos_y_quita_el_dia(client, db_session, escenario):
    servicio, origen, destino, ana, luis = escenario

    r = client.put(
        f"{BASE}/categorias/{origen.codigo}",
        json={"dias": ["LUNES"], "mover_alumnos_a": destino.codigo},
    )

    assert r.status_code == 200, r.text
    assert r.json()["dias"] == ["LUNES"]
    assert [h.dia_semana for h in servicio.listar_horarios(origen.codigo)] == [DiaSemana.LUNES]
    assert all(c == destino.codigo for c, _ in _categorias_de(db_session, ana))
    assert all(c == destino.codigo for c, _ in _categorias_de(db_session, luis))


def test_quitar_un_dia_sin_mover_alumnos_a_sigue_dando_409(client, db_session, escenario):
    _, origen, _, ana, _ = escenario
    r = client.put(f"{BASE}/categorias/{origen.codigo}", json={"dias": ["LUNES"]})
    assert r.status_code == 409
    assert "Reasigne primero" in r.json()["detail"]


def test_mover_alumnos_a_se_ignora_si_el_dia_quitado_no_tiene_alumnos(client, db_session, escenario):
    servicio, origen, destino, ana, luis = escenario
    r = client.put(
        f"{BASE}/categorias/{destino.codigo}",
        json={"dias": ["LUNES", "MIERCOLES"], "mover_alumnos_a": origen.codigo},
    )
    assert r.status_code == 200, r.text
    assert all(c == origen.codigo for c, _ in _categorias_de(db_session, ana))


@pytest.mark.parametrize("ruta", ["mover-y-eliminar", "mover-alumnos"])
def test_mover_es_solo_de_administrador(client_entrenador, ruta):
    r = client_entrenador.post(
        f"{BASE}/categorias/x/{ruta}",
        json={"categoria_destino": "y", "persona_ids": [1]},
    )
    assert r.status_code == 403
