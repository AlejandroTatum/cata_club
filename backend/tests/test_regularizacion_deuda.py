"""
Regularización de deuda de membresías (issue #284).

La deuda es un valor DERIVADO: meses adeudados desde la última cobertura
aprobada (`fecha_fin_maxima_aprobada`) hasta hoy, sin columna nueva. Solo la ve
un administrador y se regulariza con fechas retroactivas explícitas + motivo
obligatorio. El flujo normal de `registrar_pago` NO cambia (sigue anclando en
`max(última_fecha_fin, hoy)`).

Ver `app.servicios_negocio.membresia_pago_servicio.PagoServicio.regularizar_deuda`
para las decisiones conservadoras (APROBADO directo, sin tocar membresía, sin
notificaciones/PDF/regla familiar).
"""
from contextlib import contextmanager
from datetime import date
from decimal import Decimal

import app.infraestructura.tareas.alertas_tareas as alertas_mod
import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.modelos import Pago, Persona, Usuario
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import crear_persona_orm, crear_tipo_membresia_orm, crear_membresia_orm


def _crear_persona_membresia(sesion, monto_aplicado: str = "30.00"):
    persona = crear_persona_orm(sesion, "1710034065")
    tipo = crear_tipo_membresia_orm(sesion, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        sesion, persona, tipo, EstadoMembresia.ACTIVA,
        monto_aplicado=Decimal(monto_aplicado),
    )
    return persona, membresia


def _crear_pago_aprobado(sesion, persona, membresia, fecha_fin: date, monto: str = "30.00") -> Pago:
    """Pago APROBADO con `fecha_fin` arbitraria (el factory `crear_pago_orm`
    hardcodea julio; acá necesitamos marzo/abril para la deuda)."""
    pago = Pago(
        monto=Decimal(monto),
        estado_pago=EstadoPago.APROBADO,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(fecha_fin.year, fecha_fin.month, 1),
        fecha_fin=fecha_fin,
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    sesion.add(pago)
    sesion.flush()
    return pago


# --- Cálculo de meses adeudados ---------------------------------------------

def test_calcular_meses_adeudados_sin_pagos_aprobados(db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    _, membresia = _crear_persona_membresia(db_session)
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 0


def test_calcular_meses_adeudados_cobertura_hasta_hoy(db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 8, 15))
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 0


def test_calcular_meses_adeudados_cobertura_hasta_marzo(db_session, monkeypatch):
    """Ejemplo del issue: cobertura hasta 2026-03-31, hoy 2026-08-15 → 4 meses
    (abril, mayo, junio, julio)."""
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 4


def test_calcular_meses_adeudados_borde_dia_15_exacto(db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 4, 15))
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 4


def test_calcular_meses_adeudados_borde_dia_16(db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 4, 16))
    assert PagoServicio(db_session).calcular_meses_adeudados(membresia.id) == 3


# --- GET deuda (solo admin) ---------------------------------------------------

def test_get_deuda_admin_la_ve(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.get(f"/api/v1/membresias/{membresia.id}/deuda")
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["mesesAdeudados"] == 4
    assert cuerpo["ultimaCoberturaFin"] == "2026-03-31"
    assert Decimal(str(cuerpo["montoMensual"])) == Decimal("30.00")


def test_get_deuda_sin_rol_admin_da_403(client_sin_permisos, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    _, membresia = _crear_persona_membresia(db_session)
    resp = client_sin_permisos.get(f"/api/v1/membresias/{membresia.id}/deuda")
    assert resp.status_code == 403


def test_get_deuda_incluye_es_gratuidad_familiar(client, db_session, monkeypatch):
    """`DeudaMembresiaResponseDTO` no es ORM pass-through (issue #400, slice
    4c-a): `PagoServicio.obtener_deuda` arma un dict a mano, así que el flag
    necesita su propia cobertura además de la de `MembresiaResponseDTO`."""
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    membresia.es_gratuidad_familiar = True
    db_session.flush()
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.get(f"/api/v1/membresias/{membresia.id}/deuda")
    assert resp.status_code == 200
    assert resp.json()["esGratuidadFamiliar"] is True


# --- Regularización -----------------------------------------------------------

def test_regularizacion_total(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "120.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-07-31",
            "motivo": "Regularización por demora del club",
        },
    )
    assert resp.status_code == 201, resp.text
    pago = resp.json()
    assert pago["estadoPago"] == "APROBADO"
    assert pago["tipoPago"] == "REGULARIZACION"
    assert pago["fechaInicio"] == "2026-04-01"
    assert pago["fechaFin"] == "2026-07-31"
    assert pago["fechaValidacion"] is not None

    fila = db_session.get(Pago, pago["id"])
    assert fila.regularizada_por_persona_id == 1
    assert fila.motivo_regularizacion == "Regularización por demora del club"


def test_regularizacion_parcial_deja_deuda_restante(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-04-30",
            "motivo": "Regularización parcial de abril",
        },
    )
    assert resp.status_code == 201, resp.text

    deuda = client.get(f"/api/v1/membresias/{membresia.id}/deuda")
    assert deuda.status_code == 200
    assert deuda.json()["mesesAdeudados"] == 3


def test_regularizacion_solapada_da_400(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-03-15",
            "fecha_fin": "2026-04-15",
            "motivo": "Pisa cobertura ya aprobada",
        },
    )
    assert resp.status_code == 400
    assert "cubierto por un pago aprobado" in resp.json()["detail"]


def test_regularizacion_monto_no_multiplo_da_400(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "50.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-04-30",
            "motivo": "Monto no múltiplo",
        },
    )
    assert resp.status_code == 400


def test_regularizacion_motivo_solo_espacios_da_422(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    _, membresia = _crear_persona_membresia(db_session)

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-04-30",
            "motivo": "   ",
        },
    )
    assert resp.status_code == 422


def test_regularizacion_fecha_inicio_futura_da_400(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-09-01",
            "fecha_fin": "2026-09-30",
            "motivo": "Fecha futura",
        },
    )
    assert resp.status_code == 400


def test_regularizacion_sin_rol_admin_da_403(client_sin_permisos, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    _, membresia = _crear_persona_membresia(db_session)

    resp = client_sin_permisos.post(
        f"/api/v1/membresias/{membresia.id}/regularizar-deuda",
        json={
            "monto": "30.00",
            "fecha_inicio": "2026-04-01",
            "fecha_fin": "2026-04-30",
            "motivo": "Sin permisos",
        },
    )
    assert resp.status_code == 403


# --- El flujo normal NO cambia -------------------------------------------------

def test_registrar_pago_sigue_anclando_en_hoy(client, db_session, monkeypatch):
    """PAG-5 convive sin agujero: con cobertura aprobada hasta marzo y hoy en
    agosto, un pago normal de 1 mes arranca en agosto (max(última_fecha_fin, hoy)),
    no en marzo ni perdona el hueco."""
    monkeypatch.setattr(mps, "hoy_club", lambda: date(2026, 8, 15))
    persona, membresia = _crear_persona_membresia(db_session)
    _crear_pago_aprobado(db_session, persona, membresia, date(2026, 3, 31))

    resp = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1,
            "tipo_pago": "TRANSFERENCIA",
            "persona_id": persona.id,
            "membresia_id": membresia.id,
        },
    )
    assert resp.status_code == 201, resp.text
    pago = resp.json()
    assert pago["fechaInicio"] == "2026-08-15"
    assert pago["fechaFin"] == "2026-09-15"


# --- Migración desde el cuaderno (issue #1492) ---------------------------------

HOY_MIGRACION = date(2026, 10, 5)


def _crear_membresia_inactiva(sesion, representante_id: int | None = None):
    """Socio recién registrado: membresía INACTIVA, sin ningún pago aprobado.
    Con `representante_id` la persona es un representado (menor), lo que
    permite listarla por `listar_membresias_activas_por_representante`."""
    persona = Persona(
        nombres="Socio", apellidos="Migrado", cedula="1710034065",
        fecha_nacimiento=date(2015, 1, 1) if representante_id else date(1990, 1, 1),
        telefono="0990001111", representante_id=representante_id,
    )
    sesion.add(persona)
    sesion.flush()
    tipo = crear_tipo_membresia_orm(sesion, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(
        sesion, persona, tipo, EstadoMembresia.INACTIVA,
        monto_aplicado=Decimal("30.00"),
    )
    return persona, membresia


def _regularizar(client, membresia_id: int, inicio: str, fin: str):
    return client.post(
        f"/api/v1/membresias/{membresia_id}/regularizar-deuda",
        json={
            "monto": "30.00", "fecha_inicio": inicio, "fecha_fin": fin,
            "motivo": "Migración cuaderno",
        },
    )


def test_regularizacion_que_cubre_hoy_activa_y_queda_vigente(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: HOY_MIGRACION)
    representante = crear_persona_orm(db_session, "1710034040")
    _, membresia = _crear_membresia_inactiva(db_session, representante.id)

    resp = _regularizar(client, membresia.id, "2026-09-15", "2026-10-15")
    assert resp.status_code == 201, resp.text

    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.ACTIVA
    vigentes = MembresiaRepositorio(db_session).listar_membresias_activas_por_representante(
        representante.id, HOY_MIGRACION,
    )
    assert [m.id for m in vigentes] == [membresia.id]


def test_regularizacion_solo_pasada_deja_la_membresia_inactiva(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: HOY_MIGRACION)
    _, membresia = _crear_membresia_inactiva(db_session)

    resp = _regularizar(client, membresia.id, "2026-08-15", "2026-09-15")
    assert resp.status_code == 201, resp.text

    db_session.refresh(membresia)
    assert membresia.estado == EstadoMembresia.INACTIVA


def test_registrar_pago_tras_migracion_ancla_en_fecha_fin_regularizada(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: HOY_MIGRACION)
    persona, membresia = _crear_membresia_inactiva(db_session)
    assert _regularizar(client, membresia.id, "2026-09-15", "2026-10-15").status_code == 201

    resp = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": 1, "tipo_pago": "TRANSFERENCIA",
            "persona_id": persona.id, "membresia_id": membresia.id,
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["fechaInicio"] == "2026-10-15"
    assert resp.json()["fechaFin"] == "2026-11-15"


def test_alerta_de_5_dias_incluye_la_membresia_migrada(client, db_session, monkeypatch):
    monkeypatch.setattr(mps, "hoy_club", lambda: HOY_MIGRACION)
    persona, membresia = _crear_membresia_inactiva(db_session)
    db_session.add(Usuario(correo="migrado@cataclub.test", contrasenia="hash", persona_id=persona.id))
    db_session.flush()
    assert _regularizar(client, membresia.id, "2026-09-15", "2026-10-15").status_code == 201

    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(alertas_mod, "SessionLocal", _factory)
    monkeypatch.setattr(alertas_mod, "hoy_club", lambda: date(2026, 10, 10))
    monkeypatch.setattr(ServicioNotificaciones, "enviar_correo", lambda self, **kwargs: None)

    resultado = alertas_mod.alertar_vencimientos_hoy_mas_5()

    assert resultado["total_alertas"] == 1
