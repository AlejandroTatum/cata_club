"""
Verifica que cada sitio donde "hoy" significa un DÍA DE CALENDARIO DEL CLUB
resuelva ese día con `hoy_club()` y no con `date.today()`.

Mecánica de las pruebas: se parchea el nombre `hoy_club` importado en cada
módulo y se observa el resultado. Si el módulo volviera a `date.today()`, el
parche no tendría efecto y la prueba fallaría — que es exactamente la
regresión que hay que impedir.

El razonamiento por sitio (por qué cada uno ES un día del club) está en la
docstring de cada prueba.
"""
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone

import pytest

from app.dominio.enums import (
    EstadoMembresia, EstadoPago, NivelTecnicoAlumno, TipoModalidad, TipoPago,
)
from app.dominio.modelos import AntecedentesClub, Membresia, Pago, Persona, TipoMembresia


DIA_DEL_CLUB = date(2029, 6, 15)


def _persona(db, cedula="1002003001") -> Persona:
    persona = Persona(
        nombres="Ana", apellidos="Test", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991112222",
    )
    db.add(persona)
    db.flush()
    return persona


def _membresia_con_pago(db, persona: Persona, fecha_fin: date) -> Membresia:
    tipo = TipoMembresia(
        categoria="Mensual Adultos", franja_horaria="18:00-19:00",
        precio=35.00, modalidad=TipoModalidad.MENSUAL,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=35.00,
        fecha_activacion=datetime(2029, 1, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.flush()
    db.add(Pago(
        monto=35.00, estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_registro=datetime(2029, 1, 1, tzinfo=timezone.utc),
        fecha_inicio=date(2029, 1, 1), fecha_fin=fecha_fin,
        persona_id=persona.id, membresia_id=membresia.id,
    ))
    db.commit()
    db.refresh(membresia)
    return membresia


@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    """Las tareas Celery abren su propia sesión con `SessionLocal()`; para
    poder observarlas hay que inyectarles la sesión del test."""
    @contextmanager
    def _factory():
        yield db_session

    def _inyectar(modulo):
        monkeypatch.setattr(modulo, "SessionLocal", _factory)

    return _inyectar


# --- Tareas Celery nocturnas ------------------------------------------------
# Razonamiento: ambas corren de madrugada por Celery Beat, que YA está
# configurado en `America/Guayaquil` (`celery_app.py::timezone`). Si la tarea
# calculara su ventana con `date.today()` (UTC), el planificador y la tarea
# estarían en desacuerdo sobre qué día es. Además `Pago.fecha_fin` es una
# fecha de calendario que el club acordó con el socio, no un instante.

def test_vencimientos_usa_el_dia_del_club(db_session, monkeypatch, sesion_inyectada):
    import app.infraestructura.tareas.vencimientos_tareas as venc_mod

    sesion_inyectada(venc_mod)
    monkeypatch.setattr(venc_mod, "hoy_club", lambda: DIA_DEL_CLUB)
    persona = _persona(db_session)
    membresia = _membresia_con_pago(db_session, persona, fecha_fin=DIA_DEL_CLUB - timedelta(days=5))

    resultado = venc_mod.marcar_membresias_vencidas()

    assert resultado["total_vencidas"] == 1
    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.VENCIDA


def test_alertas_usa_el_dia_del_club(db_session, monkeypatch, sesion_inyectada):
    import app.infraestructura.tareas.alertas_tareas as alertas_mod

    sesion_inyectada(alertas_mod)
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: DIA_DEL_CLUB)
    persona = _persona(db_session)
    _membresia_con_pago(db_session, persona, fecha_fin=DIA_DEL_CLUB + timedelta(days=5))

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 1


# --- Edad del alumno --------------------------------------------------------
# Razonamiento: la edad determina si el alumno necesita representante legal.
# Un cumpleaños ocurre a la medianoche LOCAL del club, no a la medianoche
# UTC; con `date.today()` un alumno "cumplía años" cinco horas antes.

def test_calculo_de_edad_usa_el_dia_del_club(monkeypatch):
    import app.servicios_negocio.persona_servicio as ps

    monkeypatch.setattr(ps, "hoy_club", lambda: date(2029, 6, 15))

    assert ps._calcular_edad(date(2011, 6, 15)) == 18
    assert ps._calcular_edad(date(2011, 6, 16)) == 17


# --- Alta de antecedentes en la autoinscripción -----------------------------
# Razonamiento: `fecha_inicio_club` es "el día que este alumno empezó en el
# club" — un día del calendario del club. Alguien que se inscribe a las
# 20:00 hora local debe quedar registrado ese día, no el siguiente.

def test_inicio_en_el_club_usa_el_dia_del_club(db_session, monkeypatch):
    import app.servicios_negocio.enrollment_servicio as enroll_mod
    from app.presentacion.schemas.enrollment_schemas import (
        EnrollmentAlumnoDTO, EnrollmentAntecedentesDTO, EnrollmentCreateDTO,
        EnrollmentCredencialesDTO,
    )

    monkeypatch.setattr(enroll_mod, "hoy_club", lambda: DIA_DEL_CLUB)
    datos = EnrollmentCreateDTO(
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula="1798765432",
            fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
        ),
        credenciales_alumno=EnrollmentCredencialesDTO(
            correo="lucas@example.com", contrasenia="password8",
        ),
        antecedentes=EnrollmentAntecedentesDTO(
            nivel_tecnico_alumno=NivelTecnicoAlumno.NIVEL_1,
        ),
    )

    enroll_mod.EnrollmentServicio(db_session).enroll(datos)

    antecedentes = db_session.query(AntecedentesClub).one()
    assert antecedentes.fecha_inicio_club == DIA_DEL_CLUB


# --- Nombre de archivo de los reportes PDF ----------------------------------
# Razonamiento: la fecha del nombre de archivo es la que un humano lee para
# saber "de cuándo es este reporte". Un reporte descargado a las 19:30 del
# lunes no puede llamarse `..._martes.pdf`.

@pytest.mark.parametrize(
    "modulo_router, ruta, prefijo_archivo",
    [
        (
            "app.presentacion.routers.personas_router",
            "/api/v1/personas/reportes/nuevos-por-periodo/pdf"
            "?fecha_inicio=2029-01-01&fecha_fin=2029-12-31",
            "reporte-periodo_",
        ),
        (
            "app.presentacion.routers.asistencias_router",
            "/api/v1/asistencias/reportes/pdf",
            "reporte-asistencia_",
        ),
        (
            "app.presentacion.routers.membresias_pagos_router",
            "/api/v1/membresias/pagos/reportes/pdf",
            "reporte-pagos_",
        ),
    ],
)
def test_nombre_de_reporte_pdf_usa_el_dia_del_club(
    client, monkeypatch, modulo_router, ruta, prefijo_archivo
):
    import importlib

    monkeypatch.setattr(
        importlib.import_module(modulo_router), "hoy_club", lambda: DIA_DEL_CLUB
    )

    respuesta = client.get(ruta)

    assert respuesta.status_code == 200, respuesta.text
    assert (
        f"{prefijo_archivo}{DIA_DEL_CLUB.isoformat()}.pdf"
        in respuesta.headers["content-disposition"]
    )


# --- Sello de tiempo impreso en los PDF -------------------------------------
# Razonamiento: es una hora que un humano lee en papel ("Generado el ..."). Un
# comprobante emitido a las 19:30 del lunes no puede decir martes 00:30.

def test_sello_de_tiempo_del_pdf_usa_la_hora_del_club(monkeypatch):
    import app.infraestructura.generador_pdf as pdf_mod

    momento = datetime(2029, 6, 15, 19, 30, tzinfo=timezone(timedelta(hours=-5)))
    monkeypatch.setattr(pdf_mod, "ahora_club", lambda: momento)

    assert pdf_mod.sello_de_tiempo("%d/%m/%Y %H:%M") == "15/06/2029 19:30"
