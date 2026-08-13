"""
Paginación de los dos endpoints de asistencia que devolvían el padrón entero
en una sola respuesta (TRA-6): `GET /asistencias/persona/{id}` (historial de
un alumno) y `GET /asistencias/reportes` (reporte de administrador). Mismo
envelope `PaginatedResponse` que ya usan `GET /personas/`, `GET
/membresias/pagos` y `GET /asistencias/horarios/{id}/alumnos` (ver
`test_paginacion_listados.py`): `{items, total, skip, limit}`, con
`skip >= 0` y `1 <= limit <= 200`.

`GET /asistencias/reportes/pdf` NO se toca acá: sigue llamando a
`AsistenciaServicio.generar_reporte` sin `skip`/`limit` (ver el propio
router) -- descarga un único documento de una vez, no un listado que alguien
recorra en pantalla.
"""
from datetime import date, time

from app.dominio.cedula import cedula_valida
from app.dominio.enums import Categoria, DiaSemana, EstadoAsistencia
from app.dominio.modelos import Asistencia, HorarioEntrenamiento, Persona


# --- Fábricas ---------------------------------------------------------------
def _crear_persona(db_session, nombres, apellidos, cedula) -> Persona:
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    return persona


def _crear_horario(db_session, dia_semana=DiaSemana.LUNES) -> HorarioEntrenamiento:
    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=dia_semana,
        hora_inicio=time(18, 0), hora_fin=time(19, 30),
    )
    db_session.add(horario)
    db_session.flush()
    return horario


def _crear_asistencia(db_session, persona, horario, fecha, estado=EstadoAsistencia.PRESENTE) -> Asistencia:
    asistencia = Asistencia(
        fecha_entrenamiento=fecha, estado=estado,
        persona_id=persona.id, horario_id=horario.id,
    )
    db_session.add(asistencia)
    db_session.flush()
    return asistencia


def _paginas_sin_solape_y_completas(client, url, ids_esperados, tamano_pagina):
    """Misma aserción compartida que `test_paginacion_listados.py`: recorre
    el listado por páginas y verifica que no haya solape y que la unión
    cubra exactamente el orden esperado (más reciente primero)."""
    vistos: list[int] = []
    skip = 0
    while True:
        resp = client.get(f"{url}skip={skip}&limit={tamano_pagina}")
        assert resp.status_code == 200
        cuerpo = resp.json()
        assert cuerpo["total"] == len(ids_esperados)
        pagina = [item["id"] for item in cuerpo["items"]]
        assert len(pagina) <= tamano_pagina
        assert not set(pagina) & set(vistos), "las páginas se solapan"
        vistos.extend(pagina)
        skip += tamano_pagina
        if len(pagina) < tamano_pagina:
            break
    assert vistos == ids_esperados


# --- GET /asistencias/persona/{persona_id} -----------------------------------
def test_historial_persona_responde_el_envelope_paginado(client, db_session):
    persona = _crear_persona(db_session, "Ana", "Torres", cedula_valida(480))
    horario = _crear_horario(db_session)
    for i in range(5):
        _crear_asistencia(db_session, persona, horario, date(2026, 7, 1 + i))
    db_session.commit()

    resp = client.get(f"/api/v1/asistencias/persona/{persona.id}?skip=0&limit=2")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert set(cuerpo.keys()) == {"items", "total", "skip", "limit"}
    assert len(cuerpo["items"]) == 2
    assert cuerpo["total"] == 5
    assert cuerpo["limit"] == 2


def test_historial_persona_rechaza_limit_por_encima_del_tope(client):
    base = "/api/v1/asistencias/persona/999"
    assert client.get(f"{base}?limit=201").status_code == 422
    assert client.get(f"{base}?limit=0").status_code == 422
    assert client.get(f"{base}?skip=-1").status_code == 422


def test_historial_persona_total_solo_cuenta_su_propio_historial(client, db_session):
    """`total` no puede filtrarse por accidente al historial de otro alumno:
    dos personas, cada una con el suyo, y el total de una no ve las filas de
    la otra."""
    horario = _crear_horario(db_session)
    persona_a = _crear_persona(db_session, "Ana", "Torres", cedula_valida(481))
    persona_b = _crear_persona(db_session, "Beto", "Diaz", cedula_valida(482))
    for i in range(3):
        _crear_asistencia(db_session, persona_a, horario, date(2026, 7, 1 + i))
    for i in range(7):
        _crear_asistencia(db_session, persona_b, horario, date(2026, 7, 1 + i))
    db_session.commit()

    resp = client.get(f"/api/v1/asistencias/persona/{persona_a.id}?limit=2")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["total"] == 3
    assert all(item["personaId"] == persona_a.id for item in cuerpo["items"])


def test_historial_persona_pagina_sin_solape_con_orden_estable(client, db_session):
    """Más reciente primero (mismo criterio que `MembresiaRepositorio.listar`):
    páginas sin solape que cubren el historial completo."""
    persona = _crear_persona(db_session, "Cata", "Ibarra", "1720020005")
    horario = _crear_horario(db_session)
    asistencias = [
        _crear_asistencia(db_session, persona, horario, date(2026, 7, 1 + i))
        for i in range(5)
    ]
    db_session.commit()
    esperados = [
        a.id for a in sorted(asistencias, key=lambda x: (x.fecha_entrenamiento, x.id), reverse=True)
    ]

    _paginas_sin_solape_y_completas(
        client, f"/api/v1/asistencias/persona/{persona.id}?", esperados, tamano_pagina=2,
    )


# --- GET /asistencias/reportes ------------------------------------------------
def test_reporte_asistencia_responde_el_envelope_paginado(client, db_session):
    persona = _crear_persona(db_session, "Carla", "Mera", cedula_valida(483))
    horario = _crear_horario(db_session)
    for i in range(5):
        _crear_asistencia(db_session, persona, horario, date(2026, 7, 1 + i))
    db_session.commit()

    resp = client.get("/api/v1/asistencias/reportes?skip=0&limit=2")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert set(cuerpo.keys()) == {"items", "total", "skip", "limit"}
    assert len(cuerpo["items"]) == 2
    assert cuerpo["total"] == 5
    assert cuerpo["limit"] == 2


def test_reporte_asistencia_rechaza_limit_por_encima_del_tope(client):
    base = "/api/v1/asistencias/reportes"
    assert client.get(f"{base}?limit=201").status_code == 422
    assert client.get(f"{base}?limit=0").status_code == 422
    assert client.get(f"{base}?skip=-1").status_code == 422


def test_reporte_asistencia_total_respeta_los_filtros(client, db_session):
    """`total` cuenta el conjunto FILTRADO (por `horario_id` acá), no la
    tabla entera -- otro horario con más filas no puede inflarlo."""
    horario_a = _crear_horario(db_session, DiaSemana.LUNES)
    horario_b = _crear_horario(db_session, DiaSemana.MARTES)
    persona = _crear_persona(db_session, "Dana", "Ruiz", cedula_valida(484))
    for i in range(2):
        _crear_asistencia(db_session, persona, horario_a, date(2026, 7, 1 + i))
    for i in range(6):
        _crear_asistencia(db_session, persona, horario_b, date(2026, 7, 10 + i))
    db_session.commit()

    resp = client.get(f"/api/v1/asistencias/reportes?horario_id={horario_a.id}&limit=1")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["total"] == 2
    assert all(item["horarioId"] == horario_a.id for item in cuerpo["items"])


def test_reporte_asistencia_pagina_sin_solape_con_orden_estable(client, db_session):
    persona = _crear_persona(db_session, "Elsa", "Vega", cedula_valida(485))
    horario = _crear_horario(db_session)
    asistencias = [
        _crear_asistencia(db_session, persona, horario, date(2026, 7, 1 + i))
        for i in range(5)
    ]
    db_session.commit()
    esperados = [
        a.id for a in sorted(asistencias, key=lambda x: (x.fecha_entrenamiento, x.id), reverse=True)
    ]

    _paginas_sin_solape_y_completas(
        client, "/api/v1/asistencias/reportes?", esperados, tamano_pagina=2,
    )
