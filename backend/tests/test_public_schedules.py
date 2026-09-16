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
