"""
Paginación de los listados que crecen con el padrón (issue #7).

Los tres listados que devolvían la tabla completa (`GET
/ranking/alumnos-con-nivel`, `GET /ranking/asignaciones` y `GET
/asistencias/horarios/{id}/alumnos`) pasan a responder el mismo envelope
`PaginatedResponse` que ya usan `GET /personas/` y `GET /membresias/pagos`:
`{items, total, skip, limit}`, con `skip >= 0` y `1 <= limit <= 200`.

Contratos que fija este archivo, por endpoint:
- `skip`/`limit` se respetan y `limit` tiene tope duro (201 -> 422).
- `total` cuenta el conjunto FILTRADO completo (baja lógica incluida),
  no la página devuelta.
- El orden es determinista: dos páginas consecutivas no se solapan y entre
  ambas cubren todas las filas.
- La semántica de visibilidad NO cambia: los listados operativos siguen
  excluyendo a las personas con `activo = False`, y `total` es consistente
  con eso.

`GET /personas/` ya estaba paginado con tope `le=200`; sus tests de acá son
la guardia de regresión de ese tope.
"""
from datetime import date, time

from app.dominio.enums import Categoria, DiaSemana, TipoEscuela, TipoRol
from app.dominio.modelos import (
    AlumnoHorario, HorarioEntrenamiento, Institucion, NivelRanking, Persona,
    Ranking, Rol, Usuario,
)
from tests.conftest import crear_entrenador


# --- Fábricas ---------------------------------------------------------------
def _alta_alumno(db_session, nombres, apellidos, cedula, activo=True):
    """Persona + Usuario con rol ALUMNO (el criterio de rol que usa
    `PersonaRepositorio.listar_por_rol_con_ranking`)."""
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
        activo=activo,
    )
    db_session.add(persona)
    db_session.flush()
    db_session.add(Usuario(
        correo=f"alumno{cedula}@cataclub.test", contrasenia="hash",
        persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")],
    ))
    db_session.commit()
    return persona


def _crear_nivel(db_session, numero_nivel=1, nombre="Elite"):
    nivel = NivelRanking(numero_nivel=numero_nivel, nombre=nombre)
    db_session.add(nivel)
    db_session.commit()
    return nivel


def _asignar_ranking(db_session, persona_id, nivel_id):
    db_session.add(Ranking(persona_id=persona_id, nivel_ranking_id=nivel_id))
    db_session.commit()


def _crear_horario(db_session):
    horario = HorarioEntrenamiento(
        categoria=Categoria.JUVENIL, dia_semana=DiaSemana.LUNES,
        hora_inicio=time(18, 0), hora_fin=time(19, 30),
    )
    db_session.add(horario)
    db_session.commit()
    return horario


def _paginas_sin_solape_y_completas(client, url, ids_esperados, tamano_pagina, clave="personaId"):
    """Aserción compartida: recorre el listado por páginas y verifica que no
    haya solape entre páginas y que la unión cubra exactamente lo esperado.
    El orden dentro de cada página debe ser el mismo que el del listado
    completo (orden estable declarado con ORDER BY). `clave` es el campo del
    item que identifica cada fila (`personaId` por defecto; `id` para
    listados que no son de personas, como instituciones)."""
    vistos: list[int] = []
    skip = 0
    while True:
        resp = client.get(f"{url}skip={skip}&limit={tamano_pagina}")
        assert resp.status_code == 200
        cuerpo = resp.json()
        assert cuerpo["total"] == len(ids_esperados)
        pagina = [item[clave] for item in cuerpo["items"]]
        assert len(pagina) <= tamano_pagina
        assert not set(pagina) & set(vistos), "las páginas se solapan"
        vistos.extend(pagina)
        skip += tamano_pagina
        if len(pagina) < tamano_pagina:
            break
    assert vistos == ids_esperados


def _crear_institucion(db_session, nombre, tipo_escuela=TipoEscuela.FISCAL):
    institucion = Institucion(nombre=nombre, tipo_escuela=tipo_escuela)
    db_session.add(institucion)
    db_session.commit()
    return institucion


# --- GET /ranking/alumnos-con-nivel -----------------------------------------
def test_alumnos_con_nivel_responde_el_envelope_paginado(client, db_session):
    nivel = _crear_nivel(db_session)
    alumnos = [
        _alta_alumno(db_session, f"Alumno{i}", f"Apellido{i:02d}", f"17200100{i:02d}")
        for i in range(5)
    ]
    _asignar_ranking(db_session, alumnos[0].id, nivel.id)

    resp = client.get("/api/v1/ranking/alumnos-con-nivel?skip=0&limit=2")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert set(cuerpo.keys()) == {"items", "total", "skip", "limit"}
    assert len(cuerpo["items"]) == 2
    assert cuerpo["total"] == 5
    assert cuerpo["skip"] == 0
    assert cuerpo["limit"] == 2
    # La forma de cada fila no cambia con el envelope.
    assert cuerpo["items"][0] == {
        "personaId": alumnos[0].id, "nombres": "Alumno0",
        "apellidos": "Apellido00", "nivelRankingId": nivel.id,
    }


def test_alumnos_con_nivel_rechaza_limit_por_encima_del_tope(client):
    assert client.get("/api/v1/ranking/alumnos-con-nivel?limit=201").status_code == 422
    assert client.get("/api/v1/ranking/alumnos-con-nivel?limit=0").status_code == 422
    assert client.get("/api/v1/ranking/alumnos-con-nivel?skip=-1").status_code == 422


def test_alumnos_con_nivel_total_cuenta_solo_el_conjunto_filtrado(client, db_session):
    """`total` debe contar a los alumnos ACTIVOS con rol ALUMNO (el filtro
    del listado), no la página devuelta ni la tabla persona entera."""
    for i in range(3):
        _alta_alumno(db_session, f"Activo{i}", f"Apellido{i:02d}", f"172001010{i}")
    _alta_alumno(db_session, "Baja", "Zulueta", "1720010199", activo=False)
    # Un entrenador sin rol ALUMNO: jamás pertenece a este listado.
    crear_entrenador(db_session, cedula="1720010198")

    resp = client.get("/api/v1/ranking/alumnos-con-nivel?limit=2")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert len(cuerpo["items"]) == 2
    assert cuerpo["total"] == 3


def test_alumnos_con_nivel_pagina_sin_solape_con_orden_estable(client, db_session):
    """Orden de nómina (apellidos, nombres, id): dos páginas consecutivas no
    comparten filas y entre todas cubren el roster completo. Se insertan en
    orden inverso al alfabético para que un listado sin ORDER BY falle."""
    alumnos = [
        _alta_alumno(db_session, f"Alumno{i}", f"Apellido{9 - i:02d}", f"172001020{i}")
        for i in range(5)
    ]
    esperados = [a.id for a in sorted(alumnos, key=lambda p: (p.apellidos, p.nombres, p.id))]

    _paginas_sin_solape_y_completas(
        client, "/api/v1/ranking/alumnos-con-nivel?", esperados, tamano_pagina=2,
    )


# --- GET /ranking/asignaciones ----------------------------------------------
def test_asignaciones_responde_el_envelope_paginado(client, db_session):
    nivel = _crear_nivel(db_session)
    for i in range(5):
        alumno = _alta_alumno(
            db_session, f"Alumno{i}", f"Apellido{i:02d}", f"172001030{i}"
        )
        _asignar_ranking(db_session, alumno.id, nivel.id)

    resp = client.get("/api/v1/ranking/asignaciones?skip=0&limit=2")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert set(cuerpo.keys()) == {"items", "total", "skip", "limit"}
    assert len(cuerpo["items"]) == 2
    assert cuerpo["total"] == 5
    assert cuerpo["limit"] == 2


def test_asignaciones_rechaza_limit_por_encima_del_tope(client):
    assert client.get("/api/v1/ranking/asignaciones?limit=201").status_code == 422
    assert client.get("/api/v1/ranking/asignaciones?limit=0").status_code == 422
    assert client.get("/api/v1/ranking/asignaciones?skip=-1").status_code == 422


def test_asignaciones_total_excluye_a_los_dados_de_baja(client, db_session):
    """La baja lógica ya excluía a la persona de `items`; `total` tiene que
    contar con el MISMO filtro, no la tabla ranking completa."""
    nivel = _crear_nivel(db_session)
    activos = []
    for i in range(3):
        alumno = _alta_alumno(
            db_session, f"Activo{i}", f"Apellido{i:02d}", f"172001040{i}"
        )
        _asignar_ranking(db_session, alumno.id, nivel.id)
        activos.append(alumno)
    baja = _alta_alumno(db_session, "Baja", "Zulueta", "1720010499", activo=False)
    _asignar_ranking(db_session, baja.id, nivel.id)

    resp = client.get("/api/v1/ranking/asignaciones?limit=2")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["total"] == 3
    assert baja.id not in [fila["personaId"] for fila in cuerpo["items"]]


def test_asignaciones_pagina_sin_solape_con_orden_estable(client, db_session):
    """El listado ordena por `persona_id`: páginas consecutivas sin solape
    que cubren todas las asignaciones activas."""
    nivel = _crear_nivel(db_session)
    ids = []
    for i in range(5):
        alumno = _alta_alumno(
            db_session, f"Alumno{i}", f"Apellido{i:02d}", f"172001050{i}"
        )
        _asignar_ranking(db_session, alumno.id, nivel.id)
        ids.append(alumno.id)

    _paginas_sin_solape_y_completas(
        client, "/api/v1/ranking/asignaciones?", sorted(ids), tamano_pagina=2,
    )


# --- GET /asistencias/horarios/{id}/alumnos ---------------------------------
def test_alumnos_por_horario_responde_el_envelope_paginado(client, db_session):
    horario = _crear_horario(db_session)
    for i in range(5):
        alumno = _alta_alumno(
            db_session, f"Alumno{i}", f"Apellido{i:02d}", f"172001060{i}"
        )
        db_session.add(AlumnoHorario(persona_id=alumno.id, horario_id=horario.id))
    db_session.commit()

    resp = client.get(
        f"/api/v1/asistencias/horarios/{horario.id}/alumnos?skip=0&limit=2"
    )

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert set(cuerpo.keys()) == {"items", "total", "skip", "limit"}
    assert len(cuerpo["items"]) == 2
    assert cuerpo["total"] == 5
    assert cuerpo["limit"] == 2


def test_alumnos_por_horario_rechaza_limit_por_encima_del_tope(client, db_session):
    horario = _crear_horario(db_session)
    base = f"/api/v1/asistencias/horarios/{horario.id}/alumnos"
    assert client.get(f"{base}?limit=201").status_code == 422
    assert client.get(f"{base}?limit=0").status_code == 422
    assert client.get(f"{base}?skip=-1").status_code == 422


def test_alumnos_por_horario_total_excluye_a_los_dados_de_baja(client, db_session):
    """La nómina de la clase ya excluía a los inactivos; `total` cuenta con
    ese mismo filtro (y solo las filas de ESTE horario)."""
    horario = _crear_horario(db_session)
    for i in range(3):
        alumno = _alta_alumno(
            db_session, f"Activo{i}", f"Apellido{i:02d}", f"172001070{i}"
        )
        db_session.add(AlumnoHorario(persona_id=alumno.id, horario_id=horario.id))
    baja = _alta_alumno(db_session, "Baja", "Zulueta", "1720010799", activo=False)
    db_session.add(AlumnoHorario(persona_id=baja.id, horario_id=horario.id))
    db_session.commit()

    resp = client.get(f"/api/v1/asistencias/horarios/{horario.id}/alumnos?limit=2")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert len(cuerpo["items"]) == 2
    assert cuerpo["total"] == 3
    assert baja.id not in [fila["personaId"] for fila in cuerpo["items"]]


def test_alumnos_por_horario_pagina_sin_solape_con_orden_estable(client, db_session):
    """Orden de nómina de la clase (apellidos, nombres, id de asignación):
    páginas sin solape que cubren el roster completo del horario."""
    horario = _crear_horario(db_session)
    alumnos = [
        _alta_alumno(db_session, f"Alumno{i}", f"Apellido{9 - i:02d}", f"172001080{i}")
        for i in range(5)
    ]
    for alumno in alumnos:
        db_session.add(AlumnoHorario(persona_id=alumno.id, horario_id=horario.id))
    db_session.commit()
    esperados = [a.id for a in sorted(alumnos, key=lambda p: (p.apellidos, p.nombres, p.id))]

    _paginas_sin_solape_y_completas(
        client,
        f"/api/v1/asistencias/horarios/{horario.id}/alumnos?",
        esperados,
        tamano_pagina=2,
    )


# --- GET /personas/instituciones --------------------------------------------
def test_instituciones_responde_el_envelope_paginado(client, db_session):
    for nombre in ["Colegio A", "Colegio B", "Colegio C", "Colegio D", "Colegio E"]:
        _crear_institucion(db_session, nombre)

    resp = client.get("/api/v1/personas/instituciones?skip=0&limit=2")

    assert resp.status_code == 200
    cuerpo = resp.json()
    assert set(cuerpo.keys()) == {"items", "total", "skip", "limit"}
    assert len(cuerpo["items"]) == 2
    assert cuerpo["total"] == 5
    assert cuerpo["skip"] == 0
    assert cuerpo["limit"] == 2


def test_instituciones_rechaza_limit_por_encima_del_tope(client):
    assert client.get("/api/v1/personas/instituciones?limit=201").status_code == 422
    assert client.get("/api/v1/personas/instituciones?limit=0").status_code == 422
    assert client.get("/api/v1/personas/instituciones?skip=-1").status_code == 422


def test_instituciones_no_requiere_autenticacion(client, db_session):
    """El selector de instituciones del wizard de inscripción es público
    (visitantes anónimos): sin token, con parámetros válidos, debe responder
    200 y no 401/403."""
    _crear_institucion(db_session, "Colegio A")

    resp = client.get("/api/v1/personas/instituciones?skip=0&limit=10")

    assert resp.status_code == 200


def test_instituciones_pagina_sin_solape_con_orden_estable(client, db_session):
    """`nombre` NO es UNIQUE (D4): se insertan dos instituciones con el mismo
    nombre para forzar el desempate por `id`. Sin un orden TOTAL,
    OFFSET/LIMIT puede repetir o saltear filas entre páginas."""
    instituciones = [
        _crear_institucion(db_session, "Colegio Igual") for _ in range(3)
    ] + [
        _crear_institucion(db_session, f"Colegio Z{i}") for i in range(2)
    ]
    esperados = [i.id for i in sorted(instituciones, key=lambda inst: (inst.nombre, inst.id))]

    _paginas_sin_solape_y_completas(
        client, "/api/v1/personas/instituciones?", esperados, tamano_pagina=2, clave="id",
    )


# --- GET /personas/: guardia de regresión del tope existente -----------------
def test_personas_rechaza_limit_por_encima_del_tope(client):
    """El tope `le=200` de `GET /personas/` es el techo que asumen los tres
    consumidores del BFF (`PERSONAS_PAGE_LIMIT = 200`). Si alguien lo quita,
    `limit=100000` vuelve a pedir el padrón entero de una sola vez."""
    assert client.get("/api/v1/personas/?limit=201").status_code == 422
    assert client.get("/api/v1/personas/?limit=0").status_code == 422
    assert client.get("/api/v1/personas/?skip=-1").status_code == 422


def test_personas_acepta_exactamente_el_limite_del_bff(client, db_session):
    """`limit=200` (lo que envía el BFF) tiene que seguir siendo válido."""
    resp = client.get("/api/v1/personas/?limit=200")

    assert resp.status_code == 200
    assert resp.json()["limit"] == 200
