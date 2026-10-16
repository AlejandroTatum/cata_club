"""Cumpleaños de los jugadores del club (S6): listado del día, bloque del Panel
y aviso diario in-app a los administradores.

- `cumpleanos_de_hoy`: jugadores con membresía ACTIVA y persona activa, el día
  del CLUB, con la edad que cumplen. Quien nació un 29 de febrero se muestra el
  28 de febrero en los años no bisiestos. Una persona con supresión de datos
  ejecutada no figura.
- `GET /dashboard/stats` (solo ADMINISTRADOR) trae `cumpleanosHoy`.
- `avisar_cumpleanos_del_dia`: una notificación por administrador por día del
  club, sin duplicar al reejecutar y sin fila si no hay cumpleaños.
"""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

import app.infraestructura.tareas.cumpleanos_tareas as tareas_mod
import app.infraestructura.repositorios.cumpleanos_repositorio as repo_mod
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, TipoModalidad, TipoNotificacion, TipoRol
from app.dominio.modelos import (
    Membresia,
    Notificacion,
    Persona,
    Rol,
    SolicitudSupresionDatos,
    TipoMembresia,
    Usuario,
)
from app.infraestructura.repositorios.cumpleanos_repositorio import cumpleanos_de_hoy
from app.soporte_transversal.tiempo import hoy_club

HOY = date(2029, 6, 15)  # 2029 no es bisiesto, 2028 sí


@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(tareas_mod, "SessionLocal", _factory)
    return db_session


@pytest.fixture()
def hoy_fijo(monkeypatch):
    def _fijar(dia: date) -> None:
        monkeypatch.setattr(repo_mod, "hoy_club", lambda: dia)
        monkeypatch.setattr(tareas_mod, "hoy_club", lambda: dia)

    _fijar(HOY)
    return _fijar


_siguiente_cedula = iter(range(5000, 6000))


def _jugador(
    db,
    nacimiento: date,
    *,
    nombres: str = "Ana",
    apellidos: str = "Gómez",
    estado: EstadoMembresia | None = EstadoMembresia.ACTIVA,
    activo: bool = True,
) -> Persona:
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula_valida(next(_siguiente_cedula)),
        fecha_nacimiento=nacimiento, telefono="0991112222", activo=activo,
    )
    db.add(persona)
    db.flush()
    if estado is not None:
        tipo = TipoMembresia(
            categoria=f"Cumple {persona.id}", precio=Decimal("35.00"), modalidad=TipoModalidad.MENSUAL,
        )
        db.add(tipo)
        db.flush()
        db.add(Membresia(
            estado=estado, monto_aplicado=Decimal("35.00"),
            fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
            persona_id=persona.id, tipo_membresia_id=tipo.id,
        ))
        db.flush()
    return persona


def _admin(db, activo: bool = True) -> Persona:
    persona = Persona(
        nombres="Admin", apellidos="Club", cedula=cedula_valida(next(_siguiente_cedula)),
        fecha_nacimiento=date(1980, 3, 3), telefono="0990000000",
    )
    db.add(persona)
    db.flush()
    rol = db.query(Rol).filter(Rol.tipo_rol == TipoRol.ADMINISTRADOR).one_or_none()
    if rol is None:
        rol = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")
    db.add(Usuario(
        correo=f"admin{persona.id}@cataclub.test", contrasenia="hash",
        persona_id=persona.id, roles=[rol], activo=activo,
    ))
    db.flush()
    return persona


def _avisos(db, persona_id: int | None = None) -> list[Notificacion]:
    consulta = db.query(Notificacion).filter(Notificacion.tipo == TipoNotificacion.CUMPLEANOS_HOY_ADMIN)
    if persona_id is not None:
        consulta = consulta.filter(Notificacion.persona_id == persona_id)
    return consulta.all()


# --- Servicio ----------------------------------------------------------------

def test_lista_a_quien_cumple_hoy_con_la_edad_que_cumple(db_session):
    _jugador(db_session, date(2015, 6, 15), nombres="Luis", apellidos="Pérez")

    assert [(c.nombre, c.edad) for c in cumpleanos_de_hoy(db_session, HOY)] == [("Luis Pérez", 14)]


def test_ignora_otros_dias_y_ordena_por_nombre(db_session):
    _jugador(db_session, date(2010, 6, 16), nombres="Mañana", apellidos="Z")
    _jugador(db_session, date(2010, 6, 14), nombres="Ayer", apellidos="Z")
    _jugador(db_session, date(2012, 6, 15), nombres="Zoe", apellidos="Alba")
    _jugador(db_session, date(2008, 6, 15), nombres="Beto", apellidos="Alba")

    assert [(c.nombre, c.edad) for c in cumpleanos_de_hoy(db_session, HOY)] == [
        ("Beto Alba", 21), ("Zoe Alba", 17),
    ]


def test_nacido_hoy_no_es_cumpleanos(db_session):
    _jugador(db_session, HOY)

    assert cumpleanos_de_hoy(db_session, HOY) == []


def test_29_de_febrero_se_muestra_el_28_en_anio_no_bisiesto(db_session):
    _jugador(db_session, date(2012, 2, 29), nombres="Bisiesto", apellidos="Uno")

    assert [(c.nombre, c.edad) for c in cumpleanos_de_hoy(db_session, date(2029, 2, 28))] == [
        ("Bisiesto Uno", 17),
    ]
    assert cumpleanos_de_hoy(db_session, date(2029, 3, 1)) == []


def test_29_de_febrero_en_anio_bisiesto_solo_el_29(db_session):
    _jugador(db_session, date(2012, 2, 29), nombres="Bisiesto", apellidos="Uno")
    _jugador(db_session, date(2012, 2, 28), nombres="Normal", apellidos="Dos")

    assert [(c.nombre, c.edad) for c in cumpleanos_de_hoy(db_session, date(2028, 2, 28))] == [
        ("Normal Dos", 16),
    ]
    assert [(c.nombre, c.edad) for c in cumpleanos_de_hoy(db_session, date(2028, 2, 29))] == [
        ("Bisiesto Uno", 16),
    ]


@pytest.mark.parametrize("estado", [EstadoMembresia.VENCIDA, EstadoMembresia.INACTIVA, EstadoMembresia.SUSPENDIDA, None])
def test_sin_membresia_activa_no_figura(db_session, estado):
    _jugador(db_session, date(2010, 6, 15), estado=estado)

    assert cumpleanos_de_hoy(db_session, HOY) == []


def test_persona_inactiva_no_figura(db_session):
    _jugador(db_session, date(2010, 6, 15), activo=False)

    assert cumpleanos_de_hoy(db_session, HOY) == []


def test_persona_con_supresion_de_datos_ejecutada_no_figura(db_session):
    admin = _admin(db_session)
    suprimida = _jugador(db_session, date(2010, 6, 15), nombres="ANONIMIZADO", apellidos="ANONIMIZADO")
    db_session.add(SolicitudSupresionDatos(
        persona_id=suprimida.id, solicitada_por_persona_id=admin.id,
        estado="EJECUTADA", motivo="Solicitud de la familia",
    ))
    db_session.flush()
    _jugador(db_session, date(2010, 6, 15), nombres="Visible", apellidos="Ana")

    assert [c.nombre for c in cumpleanos_de_hoy(db_session, HOY)] == ["Visible Ana"]


def test_persona_con_supresion_solo_aprobada_sigue_figurando(db_session):
    admin = _admin(db_session)
    jugador = _jugador(db_session, date(2010, 6, 15), nombres="Aun", apellidos="Visible")
    db_session.add(SolicitudSupresionDatos(
        persona_id=jugador.id, solicitada_por_persona_id=admin.id,
        estado="APROBADA", motivo="Pendiente de ejecutar",
    ))
    db_session.flush()

    assert [c.nombre for c in cumpleanos_de_hoy(db_session, HOY)] == ["Aun Visible"]


# --- Endpoint (bloque del Panel) --------------------------------------------

def test_stats_incluye_cumpleanos_hoy(client, db_session, hoy_fijo):
    _jugador(db_session, date(2015, 6, 15), nombres="Luis", apellidos="Pérez")

    respuesta = client.get("/api/v1/dashboard/stats")

    assert respuesta.status_code == 200
    assert respuesta.json()["cumpleanosHoy"] == [{"nombre": "Luis Pérez", "edad": 14}]


def test_stats_sin_cumpleanos_devuelve_lista_vacia(client, db_session, hoy_fijo):
    assert client.get("/api/v1/dashboard/stats").json()["cumpleanosHoy"] == []


def test_stats_con_cumpleanos_sigue_siendo_solo_admin(client_sin_permisos, db_session, hoy_fijo):
    _jugador(db_session, date(2015, 6, 15))

    assert client_sin_permisos.get("/api/v1/dashboard/stats").status_code == 403


def test_stats_sin_token_da_401(client_sin_token, db_session, hoy_fijo):
    _jugador(db_session, date(2015, 6, 15))

    assert client_sin_token.get("/api/v1/dashboard/stats").status_code == 401


# --- Aviso diario a los administradores -------------------------------------

def test_una_notificacion_por_admin_activo_con_los_cumpleaneros(db_session, sesion_inyectada, hoy_fijo):
    admin_uno, admin_dos = _admin(db_session), _admin(db_session)
    _admin(db_session, activo=False)
    _jugador(db_session, date(2015, 6, 15), nombres="Luis", apellidos="Pérez")
    _jugador(db_session, date(2010, 6, 15), nombres="Ana", apellidos="Gómez")
    db_session.commit()

    resultado = tareas_mod.avisar_cumpleanos_del_dia()

    assert resultado["total_cumpleanos"] == 2
    assert resultado["avisos_admin"] == 2
    filas = _avisos(db_session)
    assert {f.persona_id for f in filas} == {admin_uno.id, admin_dos.id}
    mensaje = filas[0].mensaje
    assert "Ana Gómez (19)" in mensaje and "Luis Pérez (14)" in mensaje
    assert mensaje.startswith("Cumpleaños de hoy")


def test_reejecutar_el_mismo_dia_no_duplica(db_session, sesion_inyectada, hoy_fijo):
    # La dedup compara contra `fecha_creacion` (reloj real), así que este test
    # corre sobre el día real del club en vez de sobre `HOY`.
    hoy = hoy_club()
    hoy_fijo(hoy)
    admin = _admin(db_session)
    _jugador(db_session, date(2012, hoy.month, hoy.day))
    db_session.commit()

    tareas_mod.avisar_cumpleanos_del_dia()
    segunda = tareas_mod.avisar_cumpleanos_del_dia()

    assert len(_avisos(db_session, admin.id)) == 1
    assert segunda["avisos_admin"] == 0


def test_al_dia_siguiente_vuelve_a_avisar(db_session, sesion_inyectada, hoy_fijo):
    hoy = hoy_club()
    hoy_fijo(hoy)
    admin = _admin(db_session)
    _jugador(db_session, date(2012, hoy.month, hoy.day))
    manana = hoy + timedelta(days=1)
    _jugador(db_session, date(2012, manana.month, manana.day), nombres="Otro", apellidos="Dia")
    db_session.commit()
    tareas_mod.avisar_cumpleanos_del_dia()
    # El aviso de hoy no cuenta como "ya avisado" para el día siguiente.
    hoy_fijo(manana)
    _avisos(db_session, admin.id)[0].fecha_creacion -= timedelta(days=1)
    db_session.commit()

    tareas_mod.avisar_cumpleanos_del_dia()

    assert len(_avisos(db_session, admin.id)) == 2


def test_sin_cumpleanos_no_crea_notificaciones(db_session, sesion_inyectada, hoy_fijo):
    _admin(db_session)
    db_session.commit()

    resultado = tareas_mod.avisar_cumpleanos_del_dia()

    assert resultado["total_cumpleanos"] == 0
    assert resultado["avisos_admin"] == 0
    assert _avisos(db_session) == []


def test_no_avisa_a_jugadores_ni_familias_ni_envia_correo(db_session, sesion_inyectada, hoy_fijo, monkeypatch):
    from app.infraestructura.notificaciones_servicio import ServicioNotificaciones

    def _no_debe_llamarse(self, **kwargs):
        raise AssertionError("el aviso de cumpleaños es solo in-app")

    monkeypatch.setattr(ServicioNotificaciones, "enviar_correo", _no_debe_llamarse)
    admin = _admin(db_session)
    jugador = _jugador(db_session, date(2015, 6, 15))
    db_session.commit()

    tareas_mod.avisar_cumpleanos_del_dia()

    assert {f.persona_id for f in _avisos(db_session)} == {admin.id}
    assert jugador.id not in {f.persona_id for f in _avisos(db_session)}


def test_la_tarea_esta_en_el_calendario_de_beat():
    from app.infraestructura.tareas.celery_app import celery_app

    tareas = {entrada["task"] for entrada in celery_app.conf.beat_schedule.values()}
    assert "app.infraestructura.tareas.cumpleanos_tareas.avisar_cumpleanos_del_dia" in tareas
