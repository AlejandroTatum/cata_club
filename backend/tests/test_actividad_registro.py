"""Registro de actividad por usuario, día y franja (issue #1314).

`registrar_actividad` es lo que alimenta "Personas que ingresaron": una fila
por (usuario, día del CLUB, franja de 2 h del club), idempotente, más
`Usuario.ultimo_acceso`. Login y refresh lo invocan; una falla del registro
jamás puede tumbar el login.
"""
from datetime import datetime, timezone

from sqlalchemy import select

from app.dominio.modelos import ActividadUsuario, Usuario
from app.infraestructura import actividad
from app.servicios_negocio.auth_servicio import AuthServicio
from tests.fabricas_auth import crear_usuario_auth


def _filas(db_session):
    return [
        (f.fecha.isoformat(), f.franja)
        for f in db_session.scalars(select(ActividadUsuario).order_by(ActividadUsuario.fecha, ActividadUsuario.franja))
    ]


def test_franja_y_dia_son_del_club_no_de_utc():
    # 2026-10-02 03:00 UTC = 2026-10-01 22:00 en Guayaquil (UTC-5): día 1, franja 11.
    fecha, franja = actividad.fecha_y_franja_del_club(datetime(2026, 10, 2, 3, 0, tzinfo=timezone.utc))
    assert (fecha.isoformat(), franja) == ("2026-10-01", 11)
    # 2026-10-01 05:00 UTC = 00:00 del club: franja 0 del mismo día.
    fecha, franja = actividad.fecha_y_franja_del_club(datetime(2026, 10, 1, 5, 0, tzinfo=timezone.utc))
    assert (fecha.isoformat(), franja) == ("2026-10-01", 0)
    # Un segundo antes todavía es el día anterior, franja 11.
    fecha, franja = actividad.fecha_y_franja_del_club(datetime(2026, 10, 1, 4, 59, 59, tzinfo=timezone.utc))
    assert (fecha.isoformat(), franja) == ("2026-09-30", 11)


def test_registrar_actividad_inserta_una_fila_y_marca_ultimo_acceso(db_session):
    usuario = crear_usuario_auth(db_session)
    ahora = datetime(2026, 10, 1, 20, 30, tzinfo=timezone.utc)  # 15:30 del club -> franja 7

    actividad.registrar_actividad(db_session, usuario.id, ahora)
    db_session.commit()

    assert _filas(db_session) == [("2026-10-01", 7)]
    db_session.refresh(usuario)
    assert usuario.ultimo_acceso == ahora


def test_registrar_actividad_es_idempotente_dentro_de_la_misma_franja(db_session):
    usuario = crear_usuario_auth(db_session)
    ahora = datetime(2026, 10, 1, 20, 30, tzinfo=timezone.utc)

    actividad.registrar_actividad(db_session, usuario.id, ahora)
    actividad.registrar_actividad(db_session, usuario.id, ahora.replace(minute=45))
    db_session.commit()

    assert _filas(db_session) == [("2026-10-01", 7)]


def test_registrar_actividad_agrega_una_fila_por_franja_y_por_dia(db_session):
    usuario = crear_usuario_auth(db_session)

    for instante in (
        datetime(2026, 10, 1, 20, 30, tzinfo=timezone.utc),  # franja 7
        datetime(2026, 10, 1, 22, 30, tzinfo=timezone.utc),  # franja 8
        datetime(2026, 10, 2, 20, 30, tzinfo=timezone.utc),  # día siguiente, franja 7
    ):
        actividad.registrar_actividad(db_session, usuario.id, instante)
    db_session.commit()

    assert _filas(db_session) == [("2026-10-01", 7), ("2026-10-01", 8), ("2026-10-02", 7)]


def test_login_exitoso_registra_actividad(db_session):
    usuario = crear_usuario_auth(db_session)

    AuthServicio(db_session).login(usuario.correo, "clave12345")

    assert len(_filas(db_session)) == 1
    db_session.refresh(usuario)
    assert usuario.ultimo_acceso is not None


def test_login_fallido_no_registra_actividad(db_session):
    usuario = crear_usuario_auth(db_session)
    servicio = AuthServicio(db_session, dormir=lambda _s: None)

    try:
        servicio.login(usuario.correo, "incorrecta")
    except Exception:
        pass

    assert _filas(db_session) == []
    db_session.refresh(usuario)
    assert usuario.ultimo_acceso is None


def test_refresh_registra_actividad(db_session):
    usuario = crear_usuario_auth(db_session)
    servicio = AuthServicio(db_session)
    tokens = servicio.login(usuario.correo, "clave12345")
    db_session.execute(ActividadUsuario.__table__.delete())
    db_session.commit()

    servicio.refrescar_sesion(tokens["refresh_token"])

    assert len(_filas(db_session)) == 1


def test_una_falla_del_registro_no_tumba_el_login(db_session, monkeypatch):
    usuario = crear_usuario_auth(db_session)

    def _explota(*_a, **_k):
        raise RuntimeError("boom")

    monkeypatch.setattr(actividad, "registrar_actividad", _explota)

    tokens = AuthServicio(db_session).login(usuario.correo, "clave12345")

    assert tokens["access_token"] and tokens["refresh_token"]
    assert db_session.get(Usuario, usuario.id) is not None
