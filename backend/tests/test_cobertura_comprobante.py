"""Recibo propio de una cobertura bonificada y su listado de revisión admin
(issue #1609, S11).

Una cobertura 100% nunca crea un `Pago`, así que no tiene `ComprobantePago`
ni PDF en Cloudinary. El recibo se genera al pedirlo, directo desde
`CoberturaBonificada` (número `C-<año>-<id>`, monto $0,00), con la misma
autorización que el historial (`PoliticaAccesoPersona`): titular, su
representante o ADMINISTRADOR. El admin la revisa en un listado de solo
lectura.
"""
from app.dominio.cedula import cedula_valida
from app.infraestructura.generador_pdf import generar_comprobante_cobertura_pdf
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_pagos import (
    asignar_beneficio_api, crear_membresia_api, crear_persona_api,
    crear_tipo_membresia_api,
)

RUTA_APLICAR = "/api/v1/membresias/{membresia_id}/aplicar-beneficio"
RUTA_COMPROBANTE = "/api/v1/membresias/coberturas/{cobertura_id}/comprobante"
RUTA_LISTADO = "/api/v1/membresias/coberturas/todas"


def _autenticar_como(persona_id, roles):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _escenario(client, cedula_base=911):
    """Persona con beneficio 100% y UNA cobertura otorgada. Devuelve
    `(persona, cobertura_json)`."""
    persona = crear_persona_api(client, cedula=cedula_valida(cedula_base))
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    descuento = client.post(
        "/api/v1/descuentos/",
        json={"nombre": "Becado", "activo": True, "porcentaje": "100.00"},
    ).json()
    asignar_beneficio_api(client, persona["id"], descuento["id"])
    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = client.post(RUTA_APLICAR.format(membresia_id=membresia["id"]), json={})
    assert resp.status_code == 201, resp.text
    return persona, resp.json()


def test_el_pdf_incluye_numero_c_monto_cero_y_concepto(monkeypatch):
    """Captura los flowables que ReportLab recibe (el stream del PDF va
    comprimido) y revisa el texto que el recibo imprime."""
    from datetime import date, datetime, timezone
    from decimal import Decimal
    from app.infraestructura import generador_pdf

    capturados = []

    class _DocFalso(generador_pdf.SimpleDocTemplate):
        def build(self, flowables, *args, **kwargs):
            capturados.extend(flowables)
            return super().build(flowables, *args, **kwargs)

    monkeypatch.setattr(generador_pdf, "SimpleDocTemplate", _DocFalso)
    pdf = generar_comprobante_cobertura_pdf(
        cobertura_id=7,
        persona_nombre="Ana Pérez",
        persona_cedula="0102030405",
        persona_telefono=None,
        membresia_categoria="Infantil",
        monto=Decimal("0.00"),
        fecha_inicio=date(2026, 8, 1),
        fecha_fin=date(2026, 9, 1),
        fecha_otorgamiento=datetime(2026, 8, 1, 12, tzinfo=timezone.utc),
    )
    assert pdf.startswith(b"%PDF")
    texto = " ".join(
        getattr(f, "text", "") or " ".join(
            str(c) for fila in getattr(f, "_cellvalues", []) for c in fila
        )
        for f in capturados
    )
    assert "C-2026-000007" in texto
    assert "$0,00" in texto
    assert "Cobertura bonificada" in texto


def test_el_titular_descarga_el_recibo_en_pdf(client):
    persona, cobertura = _escenario(client)
    _autenticar_como(persona["id"], ["ALUMNO"])
    resp = client.get(RUTA_COMPROBANTE.format(cobertura_id=cobertura["id"]))
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    assert resp.content.startswith(b"%PDF")


def test_el_admin_descarga_el_recibo_en_pdf(client):
    persona, cobertura = _escenario(client)
    _autenticar_como(persona["id"] + 100, ["ADMINISTRADOR"])
    resp = client.get(RUTA_COMPROBANTE.format(cobertura_id=cobertura["id"]))
    assert resp.status_code == 200, resp.text
    assert resp.content.startswith(b"%PDF")


def test_un_extrano_recibe_403(client):
    persona, cobertura = _escenario(client)
    _autenticar_como(1, ["ADMINISTRADOR"])
    ajena = crear_persona_api(client, cedula=cedula_valida(912))
    _autenticar_como(ajena["id"], ["ALUMNO"])
    resp = client.get(RUTA_COMPROBANTE.format(cobertura_id=cobertura["id"]))
    assert resp.status_code == 403, resp.text


def test_una_cobertura_inexistente_recibe_404(client):
    _autenticar_como(1, ["ADMINISTRADOR"])
    resp = client.get(RUTA_COMPROBANTE.format(cobertura_id=999999))
    assert resp.status_code == 404, resp.text


def test_el_admin_ve_la_cobertura_en_el_listado_de_revision(client):
    persona, cobertura = _escenario(client)
    _autenticar_como(persona["id"] + 100, ["ADMINISTRADOR"])
    resp = client.get(RUTA_LISTADO)
    assert resp.status_code == 200, resp.text
    cuerpo = resp.json()
    assert cuerpo["total"] == 1
    item = cuerpo["items"][0]
    assert item["id"] == cobertura["id"]
    assert item["personaId"] == persona["id"]
    assert item["personaNombreCompleto"]
    assert item["monto"] == "0.00"
    assert item["fechaInicio"] and item["fechaFin"]


def test_un_alumno_no_puede_usar_el_listado_admin(client):
    persona, _ = _escenario(client)
    _autenticar_como(persona["id"], ["ALUMNO"])
    assert client.get(RUTA_LISTADO).status_code == 403
