"""Aviso de un día sin clase (issue #1665): campana + correo, una vez por cuenta.

Datos ficticios. La tarea real corre sobre la transacción del test y el correo
pasa por el clasificador real de `notificaciones_servicio` (SMTP falso)."""
from contextlib import contextmanager
from datetime import date, time

import pytest

import app.infraestructura.tareas.dia_sin_clase_tareas as tareas
import app.infraestructura.tareas.recordatorio_sesion_tareas as recordatorio
from app.dominio.cedula import cedula_valida
from app.dominio.enums import DiaSemana, EstadoMembresia, TipoNotificacion
from app.dominio.modelos import (
    AlumnoHorario, CategoriaHorario, CategoriaHorarioDia, DiaSinClase,
    HorarioEntrenamiento, Notificacion, Persona, Usuario,
)
from app.infraestructura.tareas.celery_app import celery_app
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm
from tests.smtp_falso import configurar_smtp_falso

HOY = date(2029, 6, 14)


@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(tareas, "SessionLocal", _factory)
    monkeypatch.setattr(tareas, "hoy_club", lambda: HOY)
    return db_session


def _dia(db, inicio=date(2029, 7, 4), fin=None, motivo="Feriado") -> DiaSinClase:
    dia = DiaSinClase(fecha_inicio=inicio, fecha_fin=fin or inicio, motivo=motivo)
    db.add(dia)
    db.flush()
    return dia


def _socio(db, cedula: int, *, correo: str | None, estado=EstadoMembresia.ACTIVA,
           representante: Persona | None = None) -> Persona:
    persona = crear_persona_orm(
        db, cedula_valida(cedula), nombres="Socio",
        fecha_nacimiento=date(2015, 1, 1) if representante else date(1990, 1, 1),
    )
    if representante:
        persona.representante_id = representante.id
        db.flush()
    if correo:
        db.add(Usuario(correo=correo, contrasenia="hash", persona_id=persona.id))
        db.flush()
    crear_membresia_orm(db, persona, crear_tipo_membresia_orm(db, categoria=f"Plan {cedula}"), estado)
    return persona


def _avisos(db) -> list[Notificacion]:
    return (
        db.query(Notificacion).filter(Notificacion.tipo == TipoNotificacion.DIA_SIN_CLASE)
        .order_by(Notificacion.persona_id).all()
    )


def test_socio_activo_recibe_campana_y_un_correo(sesion_inyectada, monkeypatch):
    smtp = configurar_smtp_falso(monkeypatch)
    socio = _socio(sesion_inyectada, 910, correo="socio910@cataclub.test")
    dia = _dia(sesion_inyectada)

    resultado = tareas.avisar_dia_sin_clase(dia.id)

    assert resultado["avisados"] == 1
    (aviso,) = _avisos(sesion_inyectada)
    assert aviso.persona_id == socio.id
    assert aviso.entidad_relacionada_id == dia.id
    assert aviso.leida is False
    assert aviso.mensaje == "Sin clases el 04/07/2029: Feriado."
    assert smtp.enviados == ["socio910@cataclub.test"]


def test_rango_nombra_las_dos_fechas(sesion_inyectada, monkeypatch):
    configurar_smtp_falso(monkeypatch)
    _socio(sesion_inyectada, 911, correo="socio911@cataclub.test")
    dia = _dia(sesion_inyectada, fin=date(2029, 7, 6), motivo="Cancha cerrada")

    tareas.avisar_dia_sin_clase(dia.id)

    assert _avisos(sesion_inyectada)[0].mensaje == (
        "Sin clases del 04/07/2029 al 06/07/2029: Cancha cerrada."
    )


@pytest.mark.parametrize("estado", [EstadoMembresia.SUSPENDIDA, EstadoMembresia.VENCIDA, EstadoMembresia.INACTIVA])
def test_socio_sin_membresia_vigente_no_recibe_nada(sesion_inyectada, monkeypatch, estado):
    smtp = configurar_smtp_falso(monkeypatch)
    _socio(sesion_inyectada, 912, correo="socio912@cataclub.test", estado=estado)
    dia = _dia(sesion_inyectada)

    assert tareas.avisar_dia_sin_clase(dia.id)["avisados"] == 0

    assert _avisos(sesion_inyectada) == []
    assert smtp.enviados == []


def test_representado_sin_cuenta_avisa_una_vez_al_representante(sesion_inyectada, monkeypatch):
    smtp = configurar_smtp_falso(monkeypatch)
    representante = _socio(sesion_inyectada, 913, correo="rep913@cataclub.test")
    _socio(sesion_inyectada, 914, correo=None, representante=representante)
    _socio(sesion_inyectada, 915, correo=None, representante=representante)
    dia = _dia(sesion_inyectada)

    tareas.avisar_dia_sin_clase(dia.id)

    assert [a.persona_id for a in _avisos(sesion_inyectada)] == [representante.id]
    assert smtp.enviados == ["rep913@cataclub.test"]


def test_socio_sin_ninguna_cuenta_alcanzable_se_omite(sesion_inyectada, monkeypatch):
    smtp = configurar_smtp_falso(monkeypatch)
    _socio(sesion_inyectada, 916, correo=None)
    dia = _dia(sesion_inyectada)

    resultado = tareas.avisar_dia_sin_clase(dia.id)

    assert resultado["avisados"] == 0 and resultado["sin_cuenta_alcanzable"] == 1
    assert _avisos(sesion_inyectada) == [] and smtp.enviados == []


def test_un_reintento_no_duplica_campana_ni_correo(sesion_inyectada, monkeypatch):
    smtp = configurar_smtp_falso(monkeypatch)
    _socio(sesion_inyectada, 917, correo="socio917@cataclub.test")
    dia = _dia(sesion_inyectada)

    tareas.avisar_dia_sin_clase(dia.id)
    segunda = tareas.avisar_dia_sin_clase(dia.id)

    assert segunda["avisados"] == 0
    assert len(_avisos(sesion_inyectada)) == 1
    assert smtp.enviados == ["socio917@cataclub.test"]


def test_dia_que_ya_paso_o_inexistente_no_avisa(sesion_inyectada, monkeypatch):
    smtp = configurar_smtp_falso(monkeypatch)
    _socio(sesion_inyectada, 918, correo="socio918@cataclub.test")
    pasado = _dia(sesion_inyectada, inicio=date(2029, 6, 1))

    assert tareas.avisar_dia_sin_clase(pasado.id)["avisados"] == 0
    assert tareas.avisar_dia_sin_clase(999999)["avisados"] == 0
    assert _avisos(sesion_inyectada) == [] and smtp.enviados == []


def test_un_correo_fallido_no_deshace_la_campana_ni_corta_el_lote(sesion_inyectada, monkeypatch):
    smtp = configurar_smtp_falso(
        monkeypatch, rechazos={"malo@cataclub.test": (550, "no such user")},
    )
    _socio(sesion_inyectada, 919, correo="malo@cataclub.test")
    _socio(sesion_inyectada, 920, correo="bueno@cataclub.test")
    dia = _dia(sesion_inyectada)

    tareas.avisar_dia_sin_clase(dia.id)

    assert len(_avisos(sesion_inyectada)) == 2
    assert smtp.enviados == ["bueno@cataclub.test"]


def test_crear_el_dia_por_la_api_encola_el_aviso_una_vez(client, monkeypatch):
    publicadas = []
    monkeypatch.setattr(celery_app, "send_task", lambda nombre, args=None, **_: publicadas.append((nombre, args)))

    creado = client.post("/api/v1/dias-sin-clase/", json={"fecha_inicio": "2029-07-04", "motivo": "Feriado"}).json()
    client.put(f"/api/v1/dias-sin-clase/{creado['id']}", json={"fecha_inicio": "2029-07-05", "motivo": "Otro"})
    client.delete(f"/api/v1/dias-sin-clase/{creado['id']}")

    assert publicadas == [
        ("app.infraestructura.tareas.dia_sin_clase_tareas.avisar_dia_sin_clase", [creado["id"]]),
    ]


def test_la_tarea_esta_en_el_include_del_worker():
    assert "app.infraestructura.tareas.dia_sin_clase_tareas" in celery_app.conf.include


def test_el_recordatorio_de_sesion_omite_un_dia_sin_clase(db_session, monkeypatch):
    """Mañana es día sin clase: ningún alumno recibe el recordatorio de entrenar."""
    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(recordatorio, "SessionLocal", _factory)
    monkeypatch.setattr(recordatorio, "hoy_club", lambda: HOY)
    sesion = date(2029, 6, 15)  # viernes
    db_session.add(CategoriaHorario(
        codigo="DSCFORM", label="DSC Formativo", hora_inicio=time(15), hora_fin=time(16),
        dias_permitidos=[CategoriaHorarioDia(dia_semana=DiaSemana.VIERNES)],
    ))
    db_session.flush()
    horario = HorarioEntrenamiento(
        categoria="DSCFORM", dia_semana=DiaSemana.VIERNES, hora_inicio=time(15), hora_fin=time(16),
    )
    db_session.add(horario)
    db_session.flush()
    alumno = _socio(db_session, 921, correo="alumno921@cataclub.test")
    db_session.add(AlumnoHorario(persona_id=alumno.id, horario_id=horario.id))
    db_session.flush()

    assert recordatorio.recordar_sesion_de_manana()["total_recordatorios"] == 1
    db_session.query(Notificacion).delete()
    _dia(db_session, inicio=sesion)

    resultado = recordatorio.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 0
    assert db_session.query(Notificacion).count() == 0
