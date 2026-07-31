"""
Aprobación de pago y generación de comprobante: atómicas o reconciliables
(auditoría, hallazgo 5) + guardia de estado en `validar_pago`.

Dos familias de pruebas:

1. Guardia de estado y concurrencia sobre `PagoServicio.validar_pago`:
   solo un pago PENDIENTE_VALIDACION puede aprobarse o rechazarse. Revalidar
   un pago ya resuelto debe dar 400 SIN repetir efectos (sin segunda
   notificación, sin re-disparo de la tarea Celery, sin reactivar la
   membresía). Dos aprobaciones concurrentes se serializan con
   `SELECT ... FOR UPDATE`: exactamente una gana.

2. Comprobante reconciliable: si Redis falla DESPUÉS del commit de la
   aprobación, la aprobación sigue siendo válida (el dinero ya fue
   validado) y el pago queda visible para la tarea de reconciliación
   `reconciliar_comprobantes_faltantes`, que re-despacha la generación del
   PDF para pagos APROBADOS sin comprobante más viejos que el umbral.

CONVENIOS DE FIXTURE:
- `_DISPARO_ORIGINAL` se captura en import (durante la colección), ANTES de
  que el autouse `_mock_disparo_celery_comprobante` de conftest.py parchee el
  método por test. Así los tests que necesitan el camino real pueden
  restaurarlo.
- Las pruebas de concurrencia NO usan `client`/`db_session` (una sola
  transacción jamás compite consigo misma): abren sesiones independientes
  sobre `motor_test`, commitean de verdad y limpian en el `finally`, igual
  que `test_ranking_concurrencia.py`.
"""
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.enums import (
    EstadoMembresia, EstadoPago, TipoModalidad, TipoPago,
)
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import (
    ComprobantePago, Membresia, Notificacion, Pago, Persona, TipoMembresia,
)
from app.presentacion.schemas.membresia_pago_schemas import PagoValidarDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio

# Capturado en tiempo de colección: el método REAL, antes del stub autouse.
_DISPARO_ORIGINAL = mps.PagoServicio._disparar_generacion_comprobante_pdf


# --- Helpers HTTP (mismo patrón que test_membresias_pagos.py) ---------------

def _crear_persona(client, cedula="1710034065"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
        },
    ).json()


def _crear_tipo_membresia(client):
    return client.post(
        "/api/v1/membresias/tipos",
        json={
            "categoria": "Adultos", "franja_horaria": "18:00-19:00",
            "precio": "35.00", "modalidad": "MENSUAL",
        },
    ).json()


def _crear_membresia(client, persona_id, tipo_id):
    return client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona_id, "tipo_membresia_id": tipo_id,
        },
    ).json()


def _crear_pago(client, persona_id, membresia_id):
    return client.post(
        "/api/v1/membresias/pagos",
        json={
            "monto": "35.00", "tipo_pago": "TRANSFERENCIA",
            "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
            "persona_id": persona_id, "membresia_id": membresia_id,
        },
    ).json()


def _escenario_pago_pendiente(client):
    """Persona + tipo + membresía + pago PENDIENTE_VALIDACION vía API."""
    persona = _crear_persona(client)
    tipo = _crear_tipo_membresia(client)
    membresia = _crear_membresia(client, persona["id"], tipo["id"])
    pago = _crear_pago(client, persona["id"], membresia["id"])
    return persona, membresia, pago


@pytest.fixture()
def espia_disparo(monkeypatch):
    """Reemplaza el stub autouse de conftest por un espía que registra cada
    pago_id despachado, para poder afirmar cuántas veces se disparó la
    tarea Celery (cero re-disparos al revalidar)."""
    llamadas: list[int] = []
    monkeypatch.setattr(
        mps.PagoServicio,
        "_disparar_generacion_comprobante_pdf",
        lambda self, pago_id: llamadas.append(pago_id),
    )
    return llamadas


def _contar_notificaciones(db_session, pago_id: int) -> int:
    return (
        db_session.query(Notificacion)
        .filter(Notificacion.entidad_relacionada_id == pago_id)
        .count()
    )


# --- 1. Guardia de estado ---------------------------------------------------

def test_reaprobar_pago_aprobado_devuelve_400_sin_repetir_efectos(
    client, db_session, espia_disparo
):
    """Revalidar un pago ya APROBADO debe rechazarse con 400 y NO repetir
    ningún efecto: ni segunda notificación, ni segundo disparo de la tarea."""
    persona, membresia, pago = _escenario_pago_pendiente(client)

    resp_1 = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp_1.status_code == 200
    assert espia_disparo == [pago["id"]]
    assert _contar_notificaciones(db_session, pago["id"]) == 1

    resp_2 = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp_2.status_code == 400
    assert "APROBADO" in resp_2.json()["detail"]

    # Ningún efecto repetido.
    assert espia_disparo == [pago["id"]]
    assert _contar_notificaciones(db_session, pago["id"]) == 1
    assert client.get(
        f"/api/v1/membresias/{membresia['id']}"
    ).json()["estado"] == "ACTIVA"


def test_rechazar_pago_ya_aprobado_devuelve_400(client, db_session, espia_disparo):
    """Un pago APROBADO no puede pasar a RECHAZADO: el ciclo de vida termina
    al validar. La membresía activada no debe verse afectada."""
    persona, membresia, pago = _escenario_pago_pendiente(client)
    assert client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    ).status_code == 200

    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Cambio de opinión"},
    )
    assert resp.status_code == 400
    assert "APROBADO" in resp.json()["detail"]

    pago_actual = client.get(f"/api/v1/membresias/pagos/{pago['id']}").json()
    assert pago_actual["estadoPago"] == "APROBADO"
    assert _contar_notificaciones(db_session, pago["id"]) == 1


def test_aprobar_pago_rechazado_devuelve_400(client, db_session, espia_disparo):
    """Un pago RECHAZADO no puede resucitar como APROBADO: el socio debe
    registrar un pago nuevo. La membresía sigue INACTIVA y la tarea Celery
    nunca se dispara."""
    persona, membresia, pago = _escenario_pago_pendiente(client)
    assert client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "RECHAZADO", "motivo_rechazo": "Comprobante ilegible"},
    ).status_code == 200

    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp.status_code == 400
    assert "RECHAZADO" in resp.json()["detail"]

    assert espia_disparo == []
    assert client.get(
        f"/api/v1/membresias/{membresia['id']}"
    ).json()["estado"] == "INACTIVA"


# --- 2. Concurrencia real: dos aprobaciones simultáneas ---------------------

@pytest.fixture()
def escenario_pago_concurrente(motor_test):
    """Persona + tipo + membresía + pago PENDIENTE_VALIDACION COMMITEADOS de
    verdad (dos conexiones distintas solo pueden competir por filas ya
    commiteadas). Limpia sus filas al terminar, como
    `test_ranking_concurrencia.py::escenario_concurrente`."""
    sesion = Session(bind=motor_test)
    persona = Persona(
        nombres="Carrera", apellidos="Aprobación", cedula="1799000902",
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000902",
    )
    tipo = TipoMembresia(
        categoria="Concurrencia Pagos", franja_horaria="18:00-19:00",
        precio=Decimal("35.00"), modalidad=TipoModalidad.MENSUAL,
    )
    sesion.add_all([persona, tipo])
    sesion.flush()
    membresia = Membresia(
        estado=EstadoMembresia.INACTIVA,
        monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 7, 1, tzinfo=timezone.utc),
        persona_id=persona.id,
        tipo_membresia_id=tipo.id,
    )
    sesion.add(membresia)
    sesion.flush()
    pago = Pago(
        monto=Decimal("35.00"),
        estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_inicio=date(2026, 7, 1),
        fecha_fin=date(2026, 7, 31),
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    sesion.add(pago)
    sesion.commit()
    ids = (pago.id, membresia.id, tipo.id, persona.id)
    sesion.close()

    try:
        yield ids
    finally:
        limpieza = Session(bind=motor_test)
        limpieza.query(Notificacion).filter(
            Notificacion.entidad_relacionada_id == ids[0]
        ).delete()
        limpieza.query(ComprobantePago).filter(
            ComprobantePago.pago_id == ids[0]
        ).delete()
        limpieza.query(Pago).filter(Pago.id == ids[0]).delete()
        limpieza.query(Membresia).filter(Membresia.id == ids[1]).delete()
        limpieza.query(TipoMembresia).filter(TipoMembresia.id == ids[2]).delete()
        limpieza.query(Persona).filter(Persona.id == ids[3]).delete()
        limpieza.commit()
        limpieza.close()


def test_dos_aprobaciones_concurrentes_solo_una_gana(
    motor_test, escenario_pago_concurrente, monkeypatch
):
    """Dos hilos aprueban el MISMO pago a la vez. El `SELECT ... FOR UPDATE`
    serializa: exactamente uno gana; el otro relee el estado ya commiteado y
    recibe `OperacionInvalida`. Los efectos (notificación, disparo Celery)
    ocurren UNA sola vez."""
    pago_id, membresia_id, _, _ = escenario_pago_concurrente

    despachos: list[int] = []
    candado_despachos = threading.Lock()

    def registrar_despacho(self, pago_id_despachado):
        with candado_despachos:
            despachos.append(pago_id_despachado)

    monkeypatch.setattr(
        mps.PagoServicio, "_disparar_generacion_comprobante_pdf", registrar_despacho
    )

    barrera = threading.Barrier(2, timeout=15)
    resultados: list = [None, None]

    def aprobar(indice: int):
        sesion = Session(bind=motor_test)
        try:
            barrera.wait()
            resultados[indice] = PagoServicio(sesion).validar_pago(
                pago_id, PagoValidarDTO(estado_pago=EstadoPago.APROBADO)
            )
        except BaseException as error:  # noqa: BLE001 -- el test inspecciona el fallo
            resultados[indice] = error
            sesion.rollback()
        finally:
            sesion.close()

    hilos = [threading.Thread(target=aprobar, args=(i,)) for i in (0, 1)]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join(timeout=30)

    exitos = [r for r in resultados if isinstance(r, Pago)]
    rechazos = [r for r in resultados if isinstance(r, OperacionInvalida)]
    assert len(exitos) == 1, f"esperaba exactamente un ganador: {resultados}"
    assert len(rechazos) == 1, f"esperaba exactamente un perdedor 400: {resultados}"

    assert despachos == [pago_id]

    verificacion = Session(bind=motor_test)
    try:
        pago_final = verificacion.get(Pago, pago_id)
        assert pago_final.estado_pago == EstadoPago.APROBADO
        assert verificacion.get(Membresia, membresia_id).estado == EstadoMembresia.ACTIVA
        total_notifs = (
            verificacion.query(Notificacion)
            .filter(Notificacion.entidad_relacionada_id == pago_id)
            .count()
        )
        assert total_notifs == 1
    finally:
        verificacion.close()


# --- 3. Fallo del broker DESPUÉS del commit ---------------------------------

def test_fallo_al_encolar_no_pierde_la_aprobacion(client, db_session, monkeypatch):
    """Si Redis cae después del commit de la aprobación, la petición debe
    responder 200 igual (el dinero ya fue validado); el pago queda APROBADO
    y visible para la reconciliación, que lo re-despacha."""
    from app.infraestructura.tareas import comprobante_tareas as ct

    # Camino real de disparo (el autouse de conftest lo anula) + broker caído.
    monkeypatch.setattr(
        mps.PagoServicio, "_disparar_generacion_comprobante_pdf", _DISPARO_ORIGINAL
    )

    def _delay_roto(*args, **kwargs):
        raise ConnectionError("redis caído")

    monkeypatch.setattr(ct.generar_comprobante_pdf_tarea, "delay", _delay_roto)

    persona, membresia, pago = _escenario_pago_pendiente(client)
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago['id']}/validar",
        json={"estado_pago": "APROBADO"},
    )

    assert resp.status_code == 200
    assert resp.json()["estadoPago"] == "APROBADO"
    assert client.get(
        f"/api/v1/membresias/{membresia['id']}"
    ).json()["estado"] == "ACTIVA"

    # El pago aprobado sin comprobante es visible para la reconciliación
    # (umbral en 0 para no esperar minutos reales en el test).
    redespachos: list[int] = []
    monkeypatch.setattr(
        ct.generar_comprobante_pdf_tarea, "delay", lambda pid: redespachos.append(pid)
    )
    monkeypatch.setattr(ct, "UMBRAL_RECONCILIACION_MINUTOS", 0)

    @contextmanager
    def _sesion_del_test():
        yield db_session

    monkeypatch.setattr(ct, "SessionLocal", _sesion_del_test)

    resultado = ct.reconciliar_comprobantes_faltantes()

    assert pago["id"] in redespachos
    assert resultado["total_redespachados"] >= 1


# --- 4. Tarea de reconciliación ---------------------------------------------

def _sembrar_pago(db, cedula: str, estado_pago: EstadoPago,
                  fecha_validacion: datetime | None) -> Pago:
    """Pago sembrado directo vía ORM (patrón de test_vencimientos_tareas.py)."""
    persona = Persona(
        nombres="Reconcilia", apellidos=f"Caso{cedula[-3:]}", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono=f"099{cedula[-7:]}",
    )
    db.add(persona)
    db.flush()
    tipo = TipoMembresia(
        categoria=f"Reconciliación {cedula[-3:]}", franja_horaria="18:00-19:00",
        precio=Decimal("35.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA,
        monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 7, 1, tzinfo=timezone.utc),
        persona_id=persona.id,
        tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.flush()
    pago = Pago(
        monto=Decimal("35.00"),
        estado_pago=estado_pago,
        tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_validacion=fecha_validacion,
        fecha_inicio=date(2026, 7, 1),
        fecha_fin=date(2026, 7, 31),
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db.add(pago)
    db.commit()
    return pago


def test_reconciliacion_redespacha_solo_aprobados_viejos_sin_comprobante(
    db_session, monkeypatch
):
    """La reconciliación re-despacha SOLO pagos APROBADOS sin comprobante más
    viejos que el umbral; deja en paz a los recientes (el disparo original
    puede seguir en vuelo), a los que ya tienen comprobante, y a los
    pendientes."""
    from app.infraestructura.tareas import comprobante_tareas as ct

    ahora = datetime.now(timezone.utc)
    viejo = ahora - timedelta(minutes=30)
    reciente = ahora - timedelta(minutes=1)

    perdido = _sembrar_pago(db_session, "1712000001", EstadoPago.APROBADO, viejo)
    fresco = _sembrar_pago(db_session, "1712000002", EstadoPago.APROBADO, reciente)
    completado = _sembrar_pago(db_session, "1712000003", EstadoPago.APROBADO, viejo)
    db_session.add(ComprobantePago(
        pago_id=completado.id,
        archivo_url="https://res.cloudinary.com/demo/comprobante-completado.pdf",
        formato_archivo="pdf",
    ))
    pendiente = _sembrar_pago(
        db_session, "1712000004", EstadoPago.PENDIENTE_VALIDACION, None
    )
    db_session.commit()

    redespachos: list[int] = []
    monkeypatch.setattr(
        ct.generar_comprobante_pdf_tarea, "delay", lambda pid: redespachos.append(pid)
    )

    @contextmanager
    def _sesion_del_test():
        yield db_session

    monkeypatch.setattr(ct, "SessionLocal", _sesion_del_test)

    resultado = ct.reconciliar_comprobantes_faltantes()

    assert redespachos == [perdido.id]
    assert fresco.id not in redespachos
    assert completado.id not in redespachos
    assert pendiente.id not in redespachos
    assert resultado["total_redespachados"] == 1
    assert resultado["pago_ids"] == [perdido.id]


def test_redespacho_es_idempotente_si_ya_hay_comprobante(db_session, monkeypatch):
    """Garantía que hace seguro re-despachar: si el pago ya tiene su
    ComprobantePago, la tarea de generación NO regenera ni vuelve a subir a
    Cloudinary — reutiliza la URL histórica. (El public_id determinístico
    `comprobante-{id:08d}` cubre además la carrera de dos workers: el segundo
    upload sobrescribe el mismo objeto, nunca duplica.)"""
    from app.infraestructura.tareas import comprobante_tareas as ct

    viejo = datetime.now(timezone.utc) - timedelta(minutes=30)
    pago = _sembrar_pago(db_session, "1712000005", EstadoPago.APROBADO, viejo)
    url_historica = "https://res.cloudinary.com/demo/comprobante-historico.pdf"
    db_session.add(ComprobantePago(
        pago_id=pago.id, archivo_url=url_historica, formato_archivo="pdf",
    ))
    db_session.commit()

    subidas: list[str] = []
    monkeypatch.setattr(
        ct, "subir_pdf_membresia",
        lambda *a, **k: subidas.append("subida") or "https://no-deberia-usarse",
    )

    @contextmanager
    def _sesion_del_test():
        yield db_session

    monkeypatch.setattr(ct, "SessionLocal", _sesion_del_test)

    resultado = ct.generar_comprobante_pdf_tarea(pago.id)

    assert resultado["comprobante_url"] == url_historica
    assert subidas == []
    total_comprobantes = (
        db_session.query(ComprobantePago)
        .filter(ComprobantePago.pago_id == pago.id)
        .count()
    )
    assert total_comprobantes == 1
