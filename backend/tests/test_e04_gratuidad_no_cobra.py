"""E04-RF002 deja de cobrar, no de tener tarifa (issue #400, slice 4c-b).

Contexto: hasta este slice, la gratuidad del 4to miembro familiar zereaba
`membresia.monto_aplicado` -- el precio en cero ERA la señal de "no paga".
Este slice deja la tarifa real intacta (`_aplicar_regla_familiar_si_
corresponde` solo prende `es_gratuidad_familiar`) y convierte a esa bandera
en la ÚNICA señal autorizada de "no paga". El riesgo que este archivo
existe para cerrar, señalado por el relevamiento de #400: sin un gate
explícito en `PagoServicio.registrar_pago`, un socio gratuito habría
empezado a pagar plata real apenas la tarifa dejara de ser cero -- porque
`registrar_pago` no tenía, hasta este slice, ningún chequeo sobre la
bandera.

Complementa (no repite):
  - `test_membresias_pagos.py::test_e04_rf002_cuarta_membresia_familiar_
    con_gratuidad`, que ya cubre que la bandera se prende al llegar al 4to
    miembro.
  - `test_inventario_anomalias_membresias.py` / `test_inventario_
    anomalias_pagos.py`, que ya cubren en detalle la reclasificación de las
    anomalías A2/A3b/A5; acá solo se ejercita el caso end-to-end de un pago
    real contra los dos inventarios, sin repetir sus tablas de casos.
"""
from datetime import date
from decimal import Decimal

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Pago
from scripts.inventario_anomalias_membresias import detectar_importes_cero
from scripts.inventario_anomalias_pagos import (
    detectar_cobertura_incompatible,
    detectar_meses_no_derivables,
)
from tests.conftest import FECHA_CONGELADA_HOY
import app.servicios_negocio.membresia_pago_servicio as mps


def _congelar_hoy_en_pagos(monkeypatch, fecha: date = FECHA_CONGELADA_HOY) -> None:
    """Mismo patrón que `test_periodo_cobertura.py`: `hoy_club()` en
    `membresia_pago_servicio` NO está cubierto por el autouse de
    `conftest` (ese solo congela `persona_servicio`)."""
    monkeypatch.setattr(mps, "hoy_club", lambda: fecha)


def _crear_persona(client, cedula, *, representante_id=None):
    payload = {
        "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
        "fecha_nacimiento": "2010-05-14", "telefono": "0991234567",
    }
    if representante_id is not None:
        payload["representante_id"] = representante_id
    return client.post("/api/v1/personas/", json=payload).json()


def _crear_tipo_membresia(client, precio="35.00"):
    return client.post(
        "/api/v1/membresias/tipos",
        json={"categoria": "Adultos", "precio": precio, "modalidad": "MENSUAL"},
    ).json()


def _crear_membresia(client, persona_id, tipo_id):
    return client.post(
        "/api/v1/membresias/",
        json={"persona_id": persona_id, "tipo_membresia_id": tipo_id},
    ).json()


def _registrar_pago(client, persona_id, membresia_id, meses):
    resp = client.post(
        "/api/v1/membresias/pagos",
        json={
            "meses": meses, "tipo_pago": "EFECTIVO",
            "persona_id": persona_id, "membresia_id": membresia_id,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _aprobar(client, pago_id):
    resp = client.patch(
        f"/api/v1/membresias/pagos/{pago_id}/validar",
        json={"estado_pago": "APROBADO"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _crear_familia_con_gratuidad(client, monkeypatch, tipo):
    """Arma una familia de 4 (representante + 3 membresías activas + el
    4to miembro, que recibe gratuidad) y devuelve
    (alumno_4, membresia_4_id)."""
    _congelar_hoy_en_pagos(monkeypatch)
    representante = _crear_persona(client, cedula_valida(600))
    for i in range(3):
        alumno = _crear_persona(client, cedula_valida(601 + i), representante_id=representante["id"])
        membresia = _crear_membresia(client, alumno["id"], tipo["id"])
        pago = _registrar_pago(client, alumno["id"], membresia["id"], 1)
        _aprobar(client, pago["id"])

    alumno_4 = _crear_persona(client, cedula_valida(604), representante_id=representante["id"])
    membresia_4 = _crear_membresia(client, alumno_4["id"], tipo["id"])
    pago_4 = _registrar_pago(client, alumno_4["id"], membresia_4["id"], 1)
    _aprobar(client, pago_4["id"])
    return alumno_4, membresia_4["id"]


# --- La tarifa real se conserva, la bandera es la única señal ---------------

def test_gratuidad_conserva_la_tarifa_real_no_la_zerea(client, monkeypatch):
    tipo = _crear_tipo_membresia(client, precio="35.00")
    _, membresia_4_id = _crear_familia_con_gratuidad(client, monkeypatch, tipo)

    membresia = client.get(f"/api/v1/membresias/{membresia_4_id}").json()

    assert membresia["esGratuidadFamiliar"] is True
    assert Decimal(membresia["montoAplicado"]) == Decimal("35.00")


def test_el_pago_que_dispara_la_gratuidad_tambien_cobra_cero(client, monkeypatch):
    """Hallazgo del revisor adversarial, reproducido contra Postgres real:
    `registrar_pago` congela el `monto` del 4to pago ANTES de que la
    bandera exista (se determina recién al aprobar, en
    `_aplicar_regla_familiar_si_corresponde`). Sin el fix de esa función,
    el pago que le DA la gratuidad a la familia era el único que la
    cobraba -- exactamente la familia a la que el club prometió membresía
    gratis terminaba facturada. Este test aprueba ESE MISMO pago (no uno
    posterior, como `test_pago_de_socio_gratuito_cobra_cero_sin_importar_
    meses_ni_tarifa`) y verifica su `monto` DESPUÉS de la aprobación."""
    _congelar_hoy_en_pagos(monkeypatch)
    tipo = _crear_tipo_membresia(client, precio="35.00")
    representante = _crear_persona(client, cedula_valida(620))
    for i in range(3):
        alumno = _crear_persona(client, cedula_valida(621 + i), representante_id=representante["id"])
        membresia = _crear_membresia(client, alumno["id"], tipo["id"])
        pago = _registrar_pago(client, alumno["id"], membresia["id"], 1)
        _aprobar(client, pago["id"])

    alumno_4 = _crear_persona(client, cedula_valida(624), representante_id=representante["id"])
    membresia_4 = _crear_membresia(client, alumno_4["id"], tipo["id"])

    # Al REGISTRAR, la familia todavía tiene 3 activos: la bandera no existe
    # todavía y `registrar_pago` congela la tarifa real completa.
    pago_4 = _registrar_pago(client, alumno_4["id"], membresia_4["id"], 1)
    assert Decimal(pago_4["monto"]) == Decimal("35.00")

    # Al APROBAR, la familia llega a 4: este pago es el que cruza el umbral.
    pago_4_aprobado = _aprobar(client, pago_4["id"])
    assert Decimal(pago_4_aprobado["monto"]) == Decimal("0.00")

    membresia_4_actualizada = client.get(f"/api/v1/membresias/{membresia_4['id']}").json()
    assert membresia_4_actualizada["esGratuidadFamiliar"] is True
    assert Decimal(membresia_4_actualizada["montoAplicado"]) == Decimal("35.00")


# --- El gate de cobro: la bandera, nunca el precio ---------------------------

def test_pago_de_socio_gratuito_cobra_cero_sin_importar_meses_ni_tarifa(client, monkeypatch):
    """El hallazgo crítico del relevamiento: sin este gate, un pago
    registrado DESPUÉS de que la gratuidad ya está activa cobraría la
    tarifa real completa. Se registran 5 meses (no 1) para probar que el
    gate no depende de cuántos meses se pidan."""
    tipo = _crear_tipo_membresia(client, precio="35.00")
    alumno_4, membresia_4_id = _crear_familia_con_gratuidad(client, monkeypatch, tipo)

    pago = _registrar_pago(client, alumno_4["id"], membresia_4_id, 5)

    assert Decimal(pago["monto"]) == Decimal("0.00")
    assert pago["descuentoId"] is None


def test_pago_gratuito_deriva_cobertura_real(client, monkeypatch):
    """El cobro es cero, pero la cobertura sigue siendo la real: 5 meses
    reales desde donde terminó la cobertura anterior, no un período
    inventado ni recortado."""
    tipo = _crear_tipo_membresia(client, precio="35.00")
    alumno_4, membresia_4_id = _crear_familia_con_gratuidad(client, monkeypatch, tipo)

    pago = _registrar_pago(client, alumno_4["id"], membresia_4_id, 5)

    ultima_fecha_fin = date(FECHA_CONGELADA_HOY.year, FECHA_CONGELADA_HOY.month + 1, FECHA_CONGELADA_HOY.day)
    esperada_fin = date(FECHA_CONGELADA_HOY.year, FECHA_CONGELADA_HOY.month + 6, FECHA_CONGELADA_HOY.day)
    assert pago["fechaInicio"] == ultima_fecha_fin.isoformat()
    assert pago["fechaFin"] == esperada_fin.isoformat()


def test_snapshot_de_pago_gratuito_lleva_valores_reales(client, monkeypatch, db_session):
    """El snapshot (`tarifa_mensual_aplicada`/`meses_comprados`/
    `monto_base`) se escribe con los valores REALES aunque el cobro sea
    cero -- no está expuesto en `PagoResponseDTO`, así que se lee el ORM
    directo con la misma sesión que usa el cliente de pruebas."""
    tipo = _crear_tipo_membresia(client, precio="35.00")
    alumno_4, membresia_4_id = _crear_familia_con_gratuidad(client, monkeypatch, tipo)

    pago_resp = _registrar_pago(client, alumno_4["id"], membresia_4_id, 5)
    pago = db_session.get(Pago, pago_resp["id"])

    assert pago.monto == Decimal("0.00")
    assert pago.tarifa_mensual_aplicada == Decimal("35.00")
    assert pago.meses_comprados == 5
    assert pago.monto_base == Decimal("175.00")


# --- Los inventarios de anomalías no confunden esto con un dato roto --------

def test_inventario_membresias_no_marca_incoherente_una_gratuidad_normal(client, monkeypatch, db_session):
    tipo = _crear_tipo_membresia(client, precio="35.00")
    _, membresia_4_id = _crear_familia_con_gratuidad(client, monkeypatch, tipo)

    resultado = detectar_importes_cero(db_session)

    ids_gratuidad = {f["membresia_id"] for f in resultado["a2_gratuidad"]}
    ids_incoherente = {f["membresia_id"] for f in resultado["a2_gratuidad_incoherente"]}
    assert membresia_4_id in ids_gratuidad
    assert membresia_4_id not in ids_incoherente


def test_inventario_pagos_no_flaggea_un_pago_gratuito(client, monkeypatch, db_session):
    tipo = _crear_tipo_membresia(client, precio="35.00")
    alumno_4, membresia_4_id = _crear_familia_con_gratuidad(client, monkeypatch, tipo)
    pago = _registrar_pago(client, alumno_4["id"], membresia_4_id, 5)
    _aprobar(client, pago["id"])

    incompatibles = {f["pago_id"] for f in detectar_cobertura_incompatible(db_session)}
    no_derivables = {f["pago_id"] for f in detectar_meses_no_derivables(db_session)}
    assert pago["id"] not in incompatibles
    assert pago["id"] not in no_derivables


# --- Ancla de regresión: un socio que SÍ paga no se ve afectado -------------

def test_pago_no_gratuito_no_se_afecta_por_el_gate(client, monkeypatch):
    _congelar_hoy_en_pagos(monkeypatch)
    tipo = _crear_tipo_membresia(client, precio="35.00")
    persona = _crear_persona(client, cedula_valida(610))
    membresia = _crear_membresia(client, persona["id"], tipo["id"])

    pago = _registrar_pago(client, persona["id"], membresia["id"], 3)

    assert Decimal(pago["monto"]) == Decimal("105.00")
