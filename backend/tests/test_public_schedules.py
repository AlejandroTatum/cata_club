from datetime import time

from app.dominio.enums import DiaSemana
from app.dominio.modelos import CategoriaHorario, CategoriaHorarioDia, HorarioEntrenamiento


RUTA = "/api/v1/asistencias/horarios-publicos"


def test_public_schedule_catalog_is_empty_without_any_session(client_sin_permisos):
    """Issue #1248: el catálogo público se deriva de sesiones reales
    (`horario_entrenamiento`), no del catálogo de categorías. La migración
    de siembra crea 5 categorías pero ninguna sesión, así que sin sesiones
    el catálogo público arranca vacío."""
    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    assert response.json() == []


def test_public_schedule_only_publishes_days_with_a_real_session(client_sin_permisos, db_session):
    """Una categoría que permite Lunes/Miércoles/Viernes pero solo tiene una
    sesión el Lunes publica ÚNICAMENTE ese día -- y una categoría del
    catálogo sin ninguna sesión no aparece en absoluto."""
    con_sesion = CategoriaHorario(
        codigo="public-con-sesion", label="Public Con Sesión",
        hora_inicio=time(8), hora_fin=time(9),
        edades="Mayores de 18 años",
        dias_permitidos=[
            CategoriaHorarioDia(dia_semana=DiaSemana.LUNES),
            CategoriaHorarioDia(dia_semana=DiaSemana.MIERCOLES),
            CategoriaHorarioDia(dia_semana=DiaSemana.VIERNES),
        ],
    )
    sin_sesion = CategoriaHorario(
        codigo="public-sin-sesion", label="Public Sin Sesión",
        hora_inicio=time(10), hora_fin=time(11),
        dias_permitidos=[CategoriaHorarioDia(dia_semana=DiaSemana.MARTES)],
    )
    db_session.add_all([con_sesion, sin_sesion])
    db_session.add(HorarioEntrenamiento(
        categoria="public-con-sesion", dia_semana=DiaSemana.LUNES,
        hora_inicio=time(8), hora_fin=time(9),
    ))
    db_session.commit()

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    body = response.json()
    public_items = [item for item in body if item["category"].startswith("Public ")]
    assert public_items == [
        {
            "category": "Public Con Sesión",
            "ages": "Mayores de 18 años",
            "blocks": [{"days": ["LUNES"], "startTime": "08:00", "endTime": "09:00"}],
        },
    ]


def test_public_schedule_groups_sessions_on_different_days_into_one_block(
    client_sin_permisos, db_session
):
    """Dos sesiones de la misma categoría en días distintos con la misma
    franja horaria se agrupan en UN solo bloque con ambos días, no en dos
    bloques separados."""
    categoria = CategoriaHorario(
        codigo="public-dos-dias", label="Public Dos Días",
        hora_inicio=time(18), hora_fin=time(19),
        dias_permitidos=[
            CategoriaHorarioDia(dia_semana=DiaSemana.LUNES),
            CategoriaHorarioDia(dia_semana=DiaSemana.JUEVES),
        ],
    )
    db_session.add(categoria)
    db_session.add_all([
        HorarioEntrenamiento(
            categoria="public-dos-dias", dia_semana=DiaSemana.JUEVES,
            hora_inicio=time(18), hora_fin=time(19),
        ),
        HorarioEntrenamiento(
            categoria="public-dos-dias", dia_semana=DiaSemana.LUNES,
            hora_inicio=time(18), hora_fin=time(19),
        ),
    ])
    db_session.commit()

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    body = response.json()
    public_items = [item for item in body if item["category"].startswith("Public ")]
    assert public_items == [
        {
            "category": "Public Dos Días",
            "ages": None,
            "blocks": [{"days": ["LUNES", "JUEVES"], "startTime": "18:00", "endTime": "19:00"}],
        },
    ]


def test_public_schedule_catalog_groups_ordered_blocks_without_internal_fields(
    client_sin_permisos, db_session
):
    adultos = CategoriaHorario(
        codigo="public-adultos", label="Public Adultos", hora_inicio=time(8), hora_fin=time(9, 15),
        edades="Mayores de 18 años",
        dias_permitidos=[CategoriaHorarioDia(dia_semana=DiaSemana.VIERNES)],
    )
    # Sin `edades`: una categoría puede no publicar etiqueta de edades, y el
    # catálogo público tiene que seguir devolviéndola (con `ages: null`) en
    # vez de omitirla o de inventar un texto.
    formativo = CategoriaHorario(
        codigo="public-formativo", label="Public Formativo", hora_inicio=time(15), hora_fin=time(16),
        dias_permitidos=[
            CategoriaHorarioDia(dia_semana=DiaSemana.MIERCOLES),
            CategoriaHorarioDia(dia_semana=DiaSemana.LUNES),
        ],
    )
    db_session.add_all([adultos, formativo])
    db_session.add_all([
        HorarioEntrenamiento(
            categoria="public-adultos", dia_semana=DiaSemana.VIERNES,
            hora_inicio=time(8), hora_fin=time(9, 15),
        ),
        HorarioEntrenamiento(
            categoria="public-formativo", dia_semana=DiaSemana.MIERCOLES,
            hora_inicio=time(15), hora_fin=time(16),
        ),
        HorarioEntrenamiento(
            categoria="public-formativo", dia_semana=DiaSemana.LUNES,
            hora_inicio=time(15), hora_fin=time(16),
        ),
    ])
    db_session.commit()

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    body = response.json()
    public_items = [item for item in body if item["category"].startswith("Public ")]
    assert public_items == [
        {
            "category": "Public Adultos",
            "ages": "Mayores de 18 años",
            "blocks": [{"days": ["VIERNES"], "startTime": "08:00", "endTime": "09:15"}],
        },
        {
            "category": "Public Formativo",
            "ages": None,
            "blocks": [{"days": ["LUNES", "MIERCOLES"], "startTime": "15:00", "endTime": "16:00"}],
        },
    ]
    assert [item["category"] for item in body] == sorted(item["category"] for item in body)
    assert all(set(item) == {"category", "ages", "blocks"} for item in body)


def test_public_schedule_omits_hidden_categories(client_sin_permisos, db_session):
    """`visible_en_landing` es un filtro de publicación, no de datos: la
    categoría oculta tiene su sesión real y sigue viva en el ABM, pero no
    sale en el catálogo público."""
    visible = CategoriaHorario(
        codigo="public-visible", label="Public Visible",
        hora_inicio=time(8), hora_fin=time(9),
        dias_permitidos=[CategoriaHorarioDia(dia_semana=DiaSemana.LUNES)],
    )
    oculta = CategoriaHorario(
        codigo="public-oculta", label="Public Oculta",
        hora_inicio=time(10), hora_fin=time(11),
        visible_en_landing=False,
        dias_permitidos=[CategoriaHorarioDia(dia_semana=DiaSemana.MARTES)],
    )
    db_session.add_all([visible, oculta])
    db_session.add_all([
        HorarioEntrenamiento(
            categoria="public-visible", dia_semana=DiaSemana.LUNES,
            hora_inicio=time(8), hora_fin=time(9),
        ),
        HorarioEntrenamiento(
            categoria="public-oculta", dia_semana=DiaSemana.MARTES,
            hora_inicio=time(10), hora_fin=time(11),
        ),
    ])
    db_session.commit()

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    labels = [item["category"] for item in response.json()]
    assert "Public Visible" in labels
    assert "Public Oculta" not in labels


def test_public_schedule_is_empty_when_every_category_is_hidden(client_sin_permisos, db_session):
    """El estado que la landing ya sabe mostrar ("Aún no hay horarios
    publicados."): con TODAS las categorías ocultas el catálogo público es
    una lista vacía con un 200 -- no un error ni un catálogo parcial."""
    oculta = CategoriaHorario(
        codigo="public-todas-ocultas", label="Public Todas Ocultas",
        hora_inicio=time(8), hora_fin=time(9),
        visible_en_landing=False,
        dias_permitidos=[CategoriaHorarioDia(dia_semana=DiaSemana.LUNES)],
    )
    db_session.add(oculta)
    db_session.add(HorarioEntrenamiento(
        categoria="public-todas-ocultas", dia_semana=DiaSemana.LUNES,
        hora_inicio=time(8), hora_fin=time(9),
    ))
    db_session.commit()

    response = client_sin_permisos.get(RUTA)

    assert response.status_code == 200
    assert response.json() == []


def test_patch_publicacion_vuelve_a_publicar_una_categoria_oculta(client, db_session):
    """Round-trip del toggle del admin: la categoría oculta vuelve al
    catálogo público en la misma franja que ya tenía. (Solo `client`: el
    GET público no exige token y el PATCH exige admin -- pedir además
    `client_sin_permisos` pisaría la sobrecarga del token con un rol sin
    permisos, por el orden de los fixtures.)"""
    categoria = CategoriaHorario(
        codigo="public-republicada", label="Public Republicada",
        hora_inicio=time(16), hora_fin=time(17),
        visible_en_landing=False,
        dias_permitidos=[CategoriaHorarioDia(dia_semana=DiaSemana.JUEVES)],
    )
    db_session.add(categoria)
    db_session.add(HorarioEntrenamiento(
        categoria="public-republicada", dia_semana=DiaSemana.JUEVES,
        hora_inicio=time(16), hora_fin=time(17),
    ))
    db_session.commit()

    oculta = client.get(RUTA).json()
    assert "Public Republicada" not in [item["category"] for item in oculta]

    respuesta = client.patch(
        f"/api/v1/asistencias/categorias/{categoria.codigo}/publicacion",
        json={"visible": True},
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["visible"] is True
    publicada = client.get(RUTA).json()
    assert {
        "category": "Public Republicada",
        "ages": None,
        "blocks": [{"days": ["JUEVES"], "startTime": "16:00", "endTime": "17:00"}],
    } in publicada
