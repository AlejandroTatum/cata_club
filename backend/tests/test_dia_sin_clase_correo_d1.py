"""Correo del día sin clase el día ANTERIOR, no al crearlo (issue #1709).

El 2026-10-08 se crearon tres días sin clase en tres minutos y los correos de
los tres salieron juntos: agotaron el tope diario de 100 y se perdieron 52.
Ahora la campana sale al crear, pero el correo sale a las 08:00 (hora del
club) del día anterior, uno por cuenta, encolado en `correo_outbox`. Con unas
70 cuentas por día queda reserva para el resto de los correos del club.

Datos ficticios.
"""
from contextlib import contextmanager
from datetime import date, datetime, time, timezone
from unittest.mock import MagicMock, patch

import pytest

import app.infraestructura.tareas.dia_sin_clase_tareas as tareas
from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, TipoNotificacion
from app.dominio.modelos import (
    ContadorCorreoDiario, CorreoOutbox, DiaSinClase, Notificacion, Persona, Usuario,
)
from app.infraestructura import notificaciones_servicio as notificaciones_mod
from app.infraestructura.tareas.celery_app import celery_app
from app.servicios_negocio.dia_sin_clase_servicio import DiaSinClaseServicio
from app.servicios_negocio.dtos.dia_sin_clase_schemas import DiaSinClaseUpdateDTO
from app.soporte_transversal.configuracion import settings
from app.soporte_transversal.tiempo import ZONA_HORARIA_CLUB
from tests import arnes_outbox as arnes
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

FERIADO = date(2029, 7, 4)
VISPERA = date(2029, 7, 3)
TAREA_D1 = "app.infraestructura.tareas.dia_sin_clase_tareas.enviar_correos_del_dia_anterior"


def _a_las(dia: date, hora: int, minuto: int = 0) -> datetime:
    return datetime.combine(dia, time(hora, minuto), tzinfo=ZONA_HORARIA_CLUB)


@pytest.fixture()
def reloj(db_session, monkeypatch):
    """Inyecta la sesión del test y deja fijar la hora del club."""
    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(tareas, "SessionLocal", _factory)
    estado = {"ahora": _a_las(date(2029, 6, 14), 12)}
    monkeypatch.setattr(tareas, "ahora_club", lambda: estado["ahora"])
    # El reenvío y el alta publican la tarea; acá solo importa lo que escribe.
    monkeypatch.setattr(celery_app, "send_task", lambda *a, **k: None)

    def fijar(instante: datetime) -> None:
        estado["ahora"] = instante

    return fijar


def _dia(db, inicio=FERIADO, fin=None, motivo="Feriado") -> DiaSinClase:
    dia = DiaSinClase(fecha_inicio=inicio, fecha_fin=fin or inicio, motivo=motivo)
    db.add(dia)
    db.commit()
    return dia


def _socio(db, cedula: int, correo: str, estado=EstadoMembresia.ACTIVA) -> Persona:
    persona = crear_persona_orm(db, cedula_valida(cedula), nombres="Socio")
    db.add(Usuario(correo=correo, contrasenia="hash", persona_id=persona.id))
    db.flush()
    crear_membresia_orm(db, persona, crear_tipo_membresia_orm(db, categoria=f"Plan {cedula}"), estado)
    db.commit()
    return persona


def _correos(db) -> list[CorreoOutbox]:
    db.expire_all()
    return db.query(CorreoOutbox).order_by(CorreoOutbox.id).all()


def _campanas(db) -> list[Notificacion]:
    db.expire_all()
    return (
        db.query(Notificacion).filter(Notificacion.tipo == TipoNotificacion.DIA_SIN_CLASE)
        .order_by(Notificacion.id).all()
    )


def test_crear_un_dia_lejano_crea_la_campana_y_no_manda_correo(db_session, reloj):
    _socio(db_session, 1701, "s1701@cataclub.test")
    dia = _dia(db_session)

    tareas.avisar_dia_sin_clase(dia.id)

    assert len(_campanas(db_session)) == 1
    assert _correos(db_session) == []


def test_la_vispera_a_las_ocho_sale_un_correo_por_cuenta_y_solo_una_vez(db_session, reloj):
    _socio(db_session, 1702, "s1702@cataclub.test")
    _socio(db_session, 1703, "s1703@cataclub.test")
    dia = _dia(db_session)
    tareas.avisar_dia_sin_clase(dia.id)
    reloj(_a_las(VISPERA, 8))

    primera = tareas.enviar_correos_del_dia_anterior()
    segunda = tareas.enviar_correos_del_dia_anterior()

    assert primera["correos"] == 2 and segunda["correos"] == 0
    assert sorted(c.destinatario for c in _correos(db_session)) == [
        "s1702@cataclub.test", "s1703@cataclub.test",
    ]
    assert all(c.asunto == "Cata Club | Día sin clase" for c in _correos(db_session))


def test_dos_cierres_que_empiezan_manana_van_en_un_solo_correo(db_session, reloj, monkeypatch):
    arnes.configurar_smtp(monkeypatch)
    _socio(db_session, 1704, "s1704@cataclub.test")
    _dia(db_session, motivo="Feriado nacional")
    _dia(db_session, fin=date(2029, 7, 6), motivo="Cancha en mantenimiento")
    reloj(_a_las(VISPERA, 8))

    tareas.enviar_correos_del_dia_anterior()

    [fila] = _correos(db_session)
    with patch("app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()) as smtp:
        arnes.despachar_correos_encolados(db_session)
        _r, destinatario, mensaje = arnes.mensaje_enviado(smtp)
    texto = arnes.texto_plano(mensaje)
    assert destinatario == "s1704@cataclub.test"
    assert "Feriado nacional" in texto and "Cancha en mantenimiento" in texto
    assert "04/07/2029" in texto and "06/07/2029" in texto


def test_un_socio_activado_despues_de_crear_el_dia_recibe_campana_y_correo(db_session, reloj):
    _socio(db_session, 1705, "s1705@cataclub.test")
    dia = _dia(db_session)
    tareas.avisar_dia_sin_clase(dia.id)
    nuevo = _socio(db_session, 1706, "s1706@cataclub.test")
    reloj(_a_las(VISPERA, 8))

    tareas.enviar_correos_del_dia_anterior()

    assert nuevo.id in {c.persona_id for c in _campanas(db_session)}
    assert "s1706@cataclub.test" in {c.destinatario for c in _correos(db_session)}
    assert len(_campanas(db_session)) == 2, "la campana del primero no se repite"


def test_creado_la_vispera_despues_de_las_ocho_manda_el_correo_al_instante(db_session, reloj):
    _socio(db_session, 1707, "s1707@cataclub.test")
    reloj(_a_las(VISPERA, 15))
    dia = _dia(db_session)

    tareas.avisar_dia_sin_clase(dia.id)
    tareas.enviar_correos_del_dia_anterior()

    assert [c.destinatario for c in _correos(db_session)] == ["s1707@cataclub.test"]


def test_creado_la_vispera_antes_de_las_ocho_espera_al_envio_de_las_ocho(db_session, reloj):
    _socio(db_session, 1708, "s1708@cataclub.test")
    reloj(_a_las(VISPERA, 7, 59))
    dia = _dia(db_session)

    tareas.avisar_dia_sin_clase(dia.id)
    assert _correos(db_session) == []

    reloj(_a_las(VISPERA, 8))
    tareas.enviar_correos_del_dia_anterior()
    assert len(_correos(db_session)) == 1


def test_un_dia_que_empieza_hoy_se_avisa_por_correo_al_instante(db_session, reloj):
    _socio(db_session, 1709, "s1709@cataclub.test")
    reloj(_a_las(FERIADO, 6))
    dia = _dia(db_session)

    tareas.avisar_dia_sin_clase(dia.id)

    assert len(_correos(db_session)) == 1


def test_la_hora_del_club_decide_y_no_la_hora_utc(db_session, reloj):
    """10:00 UTC de la víspera son las 05:00 en el club: todavía no es la
    hora del envío, así que el alta no manda el correo al instante."""
    _socio(db_session, 1710, "s1710@cataclub.test")
    reloj(datetime(2029, 7, 3, 10, 0, tzinfo=timezone.utc).astimezone(ZONA_HORARIA_CLUB))
    dia = _dia(db_session)

    tareas.avisar_dia_sin_clase(dia.id)

    assert _correos(db_session) == []


def test_un_dia_borrado_no_se_avisa_por_correo(db_session, reloj):
    _socio(db_session, 1711, "s1711@cataclub.test")
    dia = _dia(db_session)
    tareas.avisar_dia_sin_clase(dia.id)
    DiaSinClaseServicio(db_session).eliminar(dia.id)
    reloj(_a_las(VISPERA, 8))

    assert tareas.enviar_correos_del_dia_anterior()["correos"] == 0
    assert _correos(db_session) == []


def test_mover_la_fecha_avisa_la_vispera_de_la_fecha_nueva(db_session, reloj):
    _socio(db_session, 1712, "s1712@cataclub.test")
    dia = _dia(db_session)
    reloj(_a_las(VISPERA, 8))
    tareas.enviar_correos_del_dia_anterior()
    assert len(_correos(db_session)) == 1

    reloj(_a_las(VISPERA, 9))
    DiaSinClaseServicio(db_session).actualizar(
        dia.id, DiaSinClaseUpdateDTO(fecha_inicio=date(2029, 7, 10), motivo="Feriado"),
    )
    reloj(_a_las(date(2029, 7, 9), 8))
    tareas.enviar_correos_del_dia_anterior()

    assert len(_correos(db_session)) == 2


def test_mover_la_fecha_a_manana_pasadas_las_ocho_avisa_por_correo_al_instante(db_session, reloj, monkeypatch):
    """La víspera de la fecha nueva ya pasó: si el correo esperara a la
    víspera, no saldría nunca. Editar publica el aviso y la tarea lo manda."""
    publicadas = []
    monkeypatch.setattr(
        celery_app, "send_task",
        lambda nombre, args=None, kwargs=None, **_: publicadas.append((nombre, args, kwargs)),
    )
    _socio(db_session, 1714, "s1714@cataclub.test")
    dia = _dia(db_session, inicio=date(2029, 7, 20))
    reloj(_a_las(VISPERA, 9))

    DiaSinClaseServicio(db_session).actualizar(
        dia.id, DiaSinClaseUpdateDTO(fecha_inicio=FERIADO, motivo="Feriado"),
    )
    [(nombre, args, kwargs)] = publicadas
    tareas.avisar_dia_sin_clase(*args, **(kwargs or {}))

    assert nombre.endswith(".avisar_dia_sin_clase")
    assert [c.destinatario for c in _correos(db_session)] == ["s1714@cataclub.test"]


def test_la_vispera_cerca_de_medianoche_utc_usa_el_dia_del_club(db_session, reloj):
    """01:00 UTC del 4 son las 20:00 del 3 en el club: "mañana" es el 4."""
    _socio(db_session, 1715, "s1715@cataclub.test")
    _dia(db_session)
    reloj(datetime(2029, 7, 4, 1, 0, tzinfo=timezone.utc).astimezone(ZONA_HORARIA_CLUB))

    resultado = tareas.enviar_correos_del_dia_anterior()

    assert resultado["fecha"] == "2029-07-04" and resultado["correos"] == 1


def test_el_correo_de_la_vispera_se_difiere_si_el_cupo_esta_agotado(db_session, reloj, monkeypatch):
    arnes.configurar_smtp(monkeypatch)
    monkeypatch.setattr(settings, "limite_correos_diario", 1)
    db_session.query(ContadorCorreoDiario).delete()
    db_session.add(ContadorCorreoDiario(fecha=datetime.now(timezone.utc).date(), enviados=1))
    db_session.commit()
    _socio(db_session, 1716, "s1716@cataclub.test")
    _dia(db_session)
    reloj(_a_las(VISPERA, 8))
    tareas.enviar_correos_del_dia_anterior()

    with patch("app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()) as smtp:
        with arnes.sesion_inyectada_en(notificaciones_mod, db_session, monkeypatch):
            arnes.despachar_correos_encolados(db_session)
        assert arnes.envios(smtp) == []
    [fila] = _correos(db_session)
    assert fila.status == "PENDIENTE" and fila.attempts == 0


def test_el_reenvio_del_admin_es_solo_in_app(db_session, reloj):
    socio = _socio(db_session, 1713, "s1713@cataclub.test")
    reloj(_a_las(FERIADO, 6))
    dia = _dia(db_session)

    tareas.avisar_dia_sin_clase(dia.id, con_correo=False)

    assert [c.persona_id for c in _campanas(db_session)] == [socio.id]
    assert _correos(db_session) == []


def test_el_beat_corre_el_envio_de_la_vispera_a_las_ocho_del_club():
    [entrada] = [
        v for v in celery_app.conf.beat_schedule.values() if v["task"] == TAREA_D1
    ]
    assert entrada["schedule"].hour == {tareas.HORA_CORREO_VISPERA.hour}
    assert entrada["schedule"].minute == {tareas.HORA_CORREO_VISPERA.minute}
    assert celery_app.conf.timezone == "America/Guayaquil"
