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

3. Carrera de inserción de comprobante (auditoría degradacion-controlada,
   slice 1, bug 3): dos disparos concurrentes de `generar_comprobante_pdf_
   tarea` para el mismo `pago_id` -- el perdedor debe recibir el
   `IntegrityError` de la restricción única de `comprobante_pago.pago_id`
   SIN propagarlo, re-leer la fila ya commiteada por el ganador y devolver
   su URL.

CONVENIOS DE FIXTURE:
- Las fábricas del grafo persona→tipo→membresía→pago viven en
  `tests/fabricas_pagos.py` (compartidas con `test_invariantes_constraints.py`).
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
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

import app.servicios_negocio.membresia_pago_servicio as mps
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import (
    ComprobantePago, Membresia, Notificacion, Pago, Persona, TipoMembresia,
)
from app.infraestructura.tareas import comprobante_tareas as ct
from app.presentacion.schemas.membresia_pago_schemas import PagoValidarDTO
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.fabricas_pagos import (
    crear_membresia_orm,
    crear_pago_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
    escenario_pago_pendiente_api,
)

# Capturado en tiempo de colección: el método REAL, antes del stub autouse.
_DISPARO_ORIGINAL = mps.PagoServicio._disparar_generacion_comprobante_pdf


# --- Helpers locales ---------------------------------------------------------

def _validar(client, pago_id: int, estado: str, motivo: str | None = None):
    """PATCH /validar con el payload mínimo del caso."""
    payload = {"estado_pago": estado}
    if motivo is not None:
        payload["motivo_rechazo"] = motivo
    return client.patch(f"/api/v1/membresias/pagos/{pago_id}/validar", json=payload)


def _contar_notificaciones(db_session, pago_id: int) -> int:
    return (
        db_session.query(Notificacion)
        .filter(Notificacion.entidad_relacionada_id == pago_id)
        .count()
    )


def _usar_sesion_del_test(monkeypatch, db_session) -> None:
    """Inyecta el `db_session` del fixture en el `SessionLocal` que abren las
    tareas de `comprobante_tareas` (mismo patrón que
    `test_vencimientos_tareas.py::_run_task`)."""

    @contextmanager
    def _sesion():
        yield db_session

    monkeypatch.setattr(ct, "SessionLocal", _sesion)


def _espiar_redespachos(monkeypatch) -> list[int]:
    """Reemplaza `generar_comprobante_pdf_tarea.delay` por un registro de los
    pago_id despachados (no hay broker en el entorno de test)."""
    redespachos: list[int] = []
    monkeypatch.setattr(
        ct.generar_comprobante_pdf_tarea, "delay", lambda pid: redespachos.append(pid)
    )
    return redespachos


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


# --- 1. Guardia de estado ---------------------------------------------------

def test_reaprobar_pago_aprobado_devuelve_400_sin_repetir_efectos(
    client, db_session, espia_disparo
):
    """Revalidar un pago ya APROBADO debe rechazarse con 400 y NO repetir
    ningún efecto: ni segunda notificación, ni segundo disparo de la tarea."""
    persona, membresia, pago = escenario_pago_pendiente_api(client)

    assert _validar(client, pago["id"], "APROBADO").status_code == 200
    assert espia_disparo == [pago["id"]]
    assert _contar_notificaciones(db_session, pago["id"]) == 1

    resp_2 = _validar(client, pago["id"], "APROBADO")
    assert resp_2.status_code == 400
    # El mensaje nombra el estado en castellano, no el literal del enum: el
    # `EstadoPago.APROBADO` crudo ahora va al log, en `detalle_tecnico`.
    assert "ya está aprobado" in resp_2.json()["detail"]

    # Ningún efecto repetido.
    assert espia_disparo == [pago["id"]]
    assert _contar_notificaciones(db_session, pago["id"]) == 1
    assert client.get(
        f"/api/v1/membresias/{membresia['id']}"
    ).json()["estado"] == "ACTIVA"


def test_rechazar_pago_ya_aprobado_devuelve_400(client, db_session, espia_disparo):
    """Un pago APROBADO no puede pasar a RECHAZADO: el ciclo de vida termina
    al validar. La membresía activada no debe verse afectada."""
    persona, membresia, pago = escenario_pago_pendiente_api(client)
    assert _validar(client, pago["id"], "APROBADO").status_code == 200

    resp = _validar(client, pago["id"], "RECHAZADO", motivo="Cambio de opinión")
    assert resp.status_code == 400
    assert "ya está aprobado" in resp.json()["detail"]

    pago_actual = client.get(f"/api/v1/membresias/pagos/{pago['id']}").json()
    assert pago_actual["estadoPago"] == "APROBADO"
    assert _contar_notificaciones(db_session, pago["id"]) == 1


def test_aprobar_pago_rechazado_devuelve_400(client, db_session, espia_disparo):
    """Un pago RECHAZADO no puede resucitar como APROBADO: el socio debe
    registrar un pago nuevo. La membresía sigue INACTIVA y la tarea Celery
    nunca se dispara."""
    persona, membresia, pago = escenario_pago_pendiente_api(client)
    assert _validar(
        client, pago["id"], "RECHAZADO", motivo="Comprobante ilegible"
    ).status_code == 200

    resp = _validar(client, pago["id"], "APROBADO")
    assert resp.status_code == 400
    assert "ya está rechazado" in resp.json()["detail"]

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
    persona = crear_persona_orm(
        sesion, "1799000902", nombres="Carrera", apellidos="Aprobación",
        telefono="0990000902",
    )
    tipo = crear_tipo_membresia_orm(
        sesion, categoria="Concurrencia Pagos", precio=Decimal("35.00"),
    )
    membresia = crear_membresia_orm(
        sesion, persona, tipo, EstadoMembresia.INACTIVA,
        monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    pago = crear_pago_orm(
        sesion, persona, membresia, EstadoPago.PENDIENTE_VALIDACION,
        monto=Decimal("35.00"), tipo_pago=TipoPago.TRANSFERENCIA,
    )
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
    # Camino real de disparo (el autouse de conftest lo anula) + broker caído.
    monkeypatch.setattr(
        mps.PagoServicio, "_disparar_generacion_comprobante_pdf", _DISPARO_ORIGINAL
    )

    def _delay_roto(*args, **kwargs):
        raise ConnectionError("redis caído")

    monkeypatch.setattr(ct.generar_comprobante_pdf_tarea, "delay", _delay_roto)

    persona, membresia, pago = escenario_pago_pendiente_api(client)
    resp = _validar(client, pago["id"], "APROBADO")

    assert resp.status_code == 200
    assert resp.json()["estadoPago"] == "APROBADO"
    assert client.get(
        f"/api/v1/membresias/{membresia['id']}"
    ).json()["estado"] == "ACTIVA"

    # El pago aprobado sin comprobante es visible para la reconciliación
    # (umbral en 0 para no esperar minutos reales en el test).
    redespachos = _espiar_redespachos(monkeypatch)
    monkeypatch.setattr(ct, "UMBRAL_RECONCILIACION_MINUTOS", 0)
    _usar_sesion_del_test(monkeypatch, db_session)

    resultado = ct.reconciliar_comprobantes_faltantes()

    assert pago["id"] in redespachos
    assert resultado["total_redespachados"] >= 1


# --- 4. Tarea de reconciliación ---------------------------------------------

def _sembrar_pago(db, cedula: str, estado_pago: EstadoPago,
                  fecha_validacion: datetime | None) -> Pago:
    """Pago sembrado directo vía ORM sobre las fábricas compartidas
    (patrón de test_vencimientos_tareas.py)."""
    persona = crear_persona_orm(
        db, cedula, nombres="Reconcilia", apellidos=f"Caso{cedula[-3:]}",
        telefono=f"099{cedula[-7:]}",
    )
    tipo = crear_tipo_membresia_orm(
        db, categoria=f"Reconciliación {cedula[-3:]}", precio=Decimal("35.00"),
    )
    membresia = crear_membresia_orm(
        db, persona, tipo, EstadoMembresia.ACTIVA,
        monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    pago = crear_pago_orm(
        db, persona, membresia, estado_pago,
        monto=Decimal("35.00"), tipo_pago=TipoPago.TRANSFERENCIA,
        fecha_validacion=fecha_validacion,
    )
    db.commit()
    return pago


def test_reconciliacion_redespacha_solo_aprobados_viejos_sin_comprobante(
    db_session, monkeypatch
):
    """La reconciliación re-despacha SOLO pagos APROBADOS sin comprobante más
    viejos que el umbral; deja en paz a los recientes (el disparo original
    puede seguir en vuelo), a los que ya tienen comprobante, y a los
    pendientes."""
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

    redespachos = _espiar_redespachos(monkeypatch)
    _usar_sesion_del_test(monkeypatch, db_session)

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
    _usar_sesion_del_test(monkeypatch, db_session)

    resultado = ct.generar_comprobante_pdf_tarea(pago.id)

    assert resultado["comprobante_url"] == url_historica
    assert subidas == []
    total_comprobantes = (
        db_session.query(ComprobantePago)
        .filter(ComprobantePago.pago_id == pago.id)
        .count()
    )
    assert total_comprobantes == 1


def test_genera_comprobante_sin_carrera_ni_comprobante_previo(db_session, monkeypatch):
    """Camino feliz, sin carrera y sin comprobante previo: genera el PDF,
    sube a Cloudinary y persiste el `ComprobantePago`. Cierra la cobertura
    del camino de éxito de `generar_comprobante_pdf_tarea` (las otras
    pruebas de este archivo solo ejercitan las ramas de "ya existe" y de
    "carrera")."""
    viejo = datetime.now(timezone.utc) - timedelta(minutes=30)
    pago = _sembrar_pago(db_session, "1712000006", EstadoPago.APROBADO, viejo)
    url_nueva = "https://res.cloudinary.com/demo/comprobante-nuevo.pdf"
    monkeypatch.setattr(ct, "generar_comprobante_pago_pdf", lambda **kwargs: b"pdf-falso")
    monkeypatch.setattr(ct, "subir_pdf_membresia", lambda *a, **k: url_nueva)
    _usar_sesion_del_test(monkeypatch, db_session)

    resultado = ct.generar_comprobante_pdf_tarea(pago.id)

    assert resultado["comprobante_url"] == url_nueva
    comprobante = (
        db_session.query(ComprobantePago)
        .filter(ComprobantePago.pago_id == pago.id)
        .one()
    )
    assert comprobante.archivo_url == url_nueva


# --- 5. Carrera de inserción de comprobante (bug 3) -------------------------

def test_integrityerror_devuelve_url_del_ganador(motor_test):
    """Carrera de inserción: dos disparos concurrentes de `generar_
    comprobante_pdf_tarea` para el mismo `pago_id` -- el perdedor recibe
    `IntegrityError` de la restricción única de `comprobante_pago.pago_id`.
    NO debe propagarlo (desperdiciando un reintento de Celery): debe
    re-leer la fila ya commiteada por el ganador y devolver su URL.

    La carrera se simula determinísticamente: `subir_pdf_membresia` (llamado
    DESPUÉS de que la tarea ya decidió generar el comprobante, justo antes de
    su propio INSERT) inserta y commitea, desde una sesión real
    independiente, la fila del "ganador" -- exactamente la ventana en la que
    otro worker podría completar su INSERT primero."""
    sesion = Session(bind=motor_test)
    persona = crear_persona_orm(
        sesion, "1799000903", nombres="Carrera", apellidos="Comprobante",
        telefono="0990000903",
    )
    tipo = crear_tipo_membresia_orm(
        sesion, categoria="Carrera Comprobante", precio=Decimal("35.00"),
    )
    membresia = crear_membresia_orm(
        sesion, persona, tipo, EstadoMembresia.ACTIVA,
        monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    pago = crear_pago_orm(
        sesion, persona, membresia, EstadoPago.APROBADO,
        monto=Decimal("35.00"), tipo_pago=TipoPago.TRANSFERENCIA,
    )
    sesion.commit()
    pago_id, membresia_id, tipo_id, persona_id = pago.id, membresia.id, tipo.id, persona.id
    sesion.close()

    url_ganador = "https://res.cloudinary.com/demo/comprobante-ganador.pdf"

    def _subir_y_ganar_la_carrera(*args, **kwargs):
        ganadora = Session(bind=motor_test)
        try:
            ganadora.add(ComprobantePago(
                pago_id=pago_id, archivo_url=url_ganador, formato_archivo="pdf",
            ))
            ganadora.commit()
        finally:
            ganadora.close()
        return "https://no-deberia-usarse.pdf"

    try:
        with patch.object(
            ct, "generar_comprobante_pago_pdf", return_value=b"pdf-falso",
        ), patch.object(
            ct, "subir_pdf_membresia", side_effect=_subir_y_ganar_la_carrera,
        ):
            resultado = ct.generar_comprobante_pdf_tarea(pago_id)

        assert resultado["comprobante_url"] == url_ganador

        verificacion = Session(bind=motor_test)
        try:
            total = verificacion.query(ComprobantePago).filter(
                ComprobantePago.pago_id == pago_id
            ).count()
            assert total == 1
        finally:
            verificacion.close()
    finally:
        limpieza = Session(bind=motor_test)
        limpieza.query(ComprobantePago).filter(
            ComprobantePago.pago_id == pago_id
        ).delete()
        limpieza.query(Pago).filter(Pago.id == pago_id).delete()
        limpieza.query(Membresia).filter(Membresia.id == membresia_id).delete()
        limpieza.query(TipoMembresia).filter(TipoMembresia.id == tipo_id).delete()
        limpieza.query(Persona).filter(Persona.id == persona_id).delete()
        limpieza.commit()
        limpieza.close()
