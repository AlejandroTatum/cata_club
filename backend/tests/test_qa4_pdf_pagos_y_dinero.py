"""QA4 (#1534): PDF de pagos legibles y un solo formato de dinero.

ADMB-05/06/07, FAM-07, FAM-19 y TXT-08: el PDF es el documento que el club
imprime o entrega, así que habla como la pantalla (etiquetas humanas, sin
«None», sin códigos internos) y el dinero se escribe siempre «$40,00».
"""
import io
from datetime import date, datetime
from decimal import Decimal

import pytest
from reportlab.platypus import Paragraph

from app.dominio.enums import EstadoPago, TipoPago
from app.infraestructura import generador_pdf
from app.presentacion.routers import membresias_pagos_router as router_pagos
from app.presentacion.routers.membresias_pagos_router import (
    _COLUMNAS_PAGOS_PDF,
    _pagos_a_filas,
)
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoListItemDTO


def _pago(**cambios) -> PagoListItemDTO:
    datos = dict(
        id=1, monto=Decimal("40"), estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.REGULARIZACION, fecha_registro=datetime(2026, 10, 3, 13, 14),
        fecha_inicio=date(2026, 10, 1), fecha_fin=date(2026, 10, 31),
        persona_id=1, persona_nombre_completo="Ana Pérez", membresia_id=1,
    )
    return PagoListItemDTO(**{**datos, **cambios})


# --- ADMB-05 / ADMB-06 / TXT-08: filas del PDF de pagos ----------------------

def test_columnas_del_pdf_de_pagos_usan_los_nombres_de_la_pantalla():
    assert _COLUMNAS_PAGOS_PDF == [
        "Estudiante", "Responsable de pago", "Desde", "Hasta", "Monto", "Método",
        "Fecha de registro", "Estado",
    ]


# --- ADMB-06: «Responsable de pago» viaja en el listado y en el PDF ----------

def test_fila_de_pago_trae_el_responsable_de_pago():
    fila = _pagos_a_filas([_pago(responsable_pago_nombre_completo="Rosa Mora")])[0]
    assert fila[_COLUMNAS_PAGOS_PDF.index("Responsable de pago")] == "Rosa Mora"


def test_fila_de_pago_sin_responsable_queda_vacia_y_nunca_none():
    fila = _pagos_a_filas([_pago()])[0]
    assert fila[_COLUMNAS_PAGOS_PDF.index("Responsable de pago")] == ""
    assert "None" not in fila


def test_listado_de_pagos_expone_el_representante_como_responsable(client, db_session):
    from app.dominio.enums import EstadoMembresia
    from tests.fabricas_pagos import (
        crear_membresia_orm, crear_pago_orm, crear_persona_orm, crear_tipo_membresia_orm,
    )

    representante = crear_persona_orm(db_session, "1710034065", nombres="Rosa", apellidos="Mora")
    menor = crear_persona_orm(
        db_session, "1710034081", nombres="Luis", apellidos="Mora",
        fecha_nacimiento=date(2015, 1, 1),
    )
    menor.representante_id = representante.id
    tipo = crear_tipo_membresia_orm(db_session)
    membresia = crear_membresia_orm(db_session, menor, tipo, EstadoMembresia.INACTIVA)
    crear_pago_orm(db_session, menor, membresia, EstadoPago.PENDIENTE_VALIDACION)
    db_session.flush()

    resp = client.get("/api/v1/membresias/pagos")

    assert resp.status_code == 200, resp.text
    item = next(i for i in resp.json()["items"] if i["personaId"] == menor.id)
    assert item["responsablePagoNombreCompleto"] == "Rosa Mora"


@pytest.mark.parametrize(
    "estado, etiqueta",
    [
        (EstadoPago.PENDIENTE_VALIDACION, "Pendiente"),
        (EstadoPago.APROBADO, "Validado"),
        (EstadoPago.RECHAZADO, "Rechazado"),
    ],
)
def test_fila_de_pago_traduce_el_estado(estado, etiqueta):
    fila = _pagos_a_filas([_pago(estado_pago=estado)])[0]

    assert fila[_COLUMNAS_PAGOS_PDF.index("Estado")] == etiqueta


@pytest.mark.parametrize(
    "tipo, etiqueta",
    [
        (TipoPago.EFECTIVO, "Efectivo"),
        (TipoPago.TRANSFERENCIA, "Transferencia"),
        (TipoPago.REGULARIZACION, "Regularización"),
    ],
)
def test_fila_de_pago_traduce_el_metodo(tipo, etiqueta):
    fila = _pagos_a_filas([_pago(tipo_pago=tipo)])[0]

    assert fila[_COLUMNAS_PAGOS_PDF.index("Método")] == etiqueta


def test_fila_de_pago_usa_el_dinero_del_club_y_fechas_dd_mm_aaaa():
    fila = _pagos_a_filas([_pago(monto=Decimal("1240"))])[0]

    assert fila == [
        "Ana Pérez", "", "01/10/2026", "31/10/2026", "$1.240,00",
        "Regularización", "03/10/2026", "Pendiente",
    ]


# --- ADMB-07: encabezado con rango y total, pie «Página X de N» --------------

def test_resumen_del_pdf_de_pagos_dice_rango_estado_y_total():
    resumen = router_pagos._resumen_de_pagos(
        date(2026, 10, 1), date(2026, 10, 31), EstadoPago.APROBADO, 169,
    )

    assert resumen == "Del 01/10/2026 al 31/10/2026 · Estado: Validado · 169 pagos"


def test_resumen_sin_filtros_dice_todos_y_singulariza_un_pago():
    assert router_pagos._resumen_de_pagos(None, None, None, 1) == (
        "Todas las fechas · Estado: Todos · 1 pago"
    )


def test_nombre_de_archivo_incluye_el_rango_cuando_se_filtra():
    nombre = router_pagos._nombre_archivo_pagos(
        date(2026, 10, 1), date(2026, 10, 31), date(2026, 10, 3),
    )

    assert nombre == "reporte-pagos_2026-10-01_a_2026-10-31.pdf"


def test_nombre_de_archivo_sin_rango_conserva_el_dia_del_club():
    assert router_pagos._nombre_archivo_pagos(None, None, date(2026, 10, 3)) == (
        "reporte-pagos_2026-10-03.pdf"
    )


def _parrafos_del_reporte(monkeypatch, **kwargs) -> list[str]:
    capturado: list[str] = []
    documento_original = generador_pdf.SimpleDocTemplate

    def _capturar_documento(*args, **kw):
        doc = documento_original(*args, **kw)
        construir_original = doc.build

        def _build(elementos, **opciones):
            capturado.extend(
                e.getPlainText() for e in elementos if isinstance(e, Paragraph)
            )
            return construir_original(elementos, **opciones)

        doc.build = _build
        return doc

    monkeypatch.setattr(generador_pdf, "SimpleDocTemplate", _capturar_documento)
    generador_pdf.generar_reporte_pdf(**kwargs)
    return capturado


def test_reporte_pdf_imprime_el_resumen_en_el_encabezado(monkeypatch):
    parrafos = _parrafos_del_reporte(
        monkeypatch, titulo="Reporte de Pagos", columnas=["A"], filas=[["x"]],
        resumen="Del 01/10/2026 al 31/10/2026 · 1 pago",
    )

    assert "Del 01/10/2026 al 31/10/2026 · 1 pago" in parrafos


def test_reporte_pdf_celdas_vacias_salen_como_raya_y_nunca_none(monkeypatch):
    capturado: dict = {}
    tabla_original = generador_pdf.Table

    def _capturar_tabla(celdas, *args, **kwargs):
        capturado["celdas"] = [
            [c.getPlainText() for c in fila] for fila in celdas
        ]
        return tabla_original(celdas, *args, **kwargs)

    monkeypatch.setattr(generador_pdf, "Table", _capturar_tabla)
    generador_pdf.generar_reporte_pdf(
        titulo="T", columnas=["Nombre", "Teléfono"], filas=[["Ana", None]],
    )

    assert capturado["celdas"][1] == ["Ana", "—"]


def test_el_pie_de_pagina_dice_pagina_x_de_n():
    lienzo = generador_pdf._LienzoNumerado(io.BytesIO())
    dibujado: list[str] = []
    lienzo.drawString = lambda x, y, texto, *a, **k: dibujado.append(texto)

    lienzo.showPage()
    lienzo.showPage()
    lienzo.save()

    assert dibujado == ["Página 1 de 2", "Página 2 de 2"]


def test_el_reporte_se_construye_con_el_lienzo_numerado(monkeypatch):
    opciones: dict = {}
    documento_original = generador_pdf.SimpleDocTemplate

    def _capturar_documento(*args, **kw):
        doc = documento_original(*args, **kw)
        construir_original = doc.build

        def _build(elementos, **kwargs):
            opciones.update(kwargs)
            return construir_original(elementos, **kwargs)

        doc.build = _build
        return doc

    monkeypatch.setattr(generador_pdf, "SimpleDocTemplate", _capturar_documento)
    generador_pdf.generar_reporte_pdf(titulo="T", columnas=["A"], filas=[["x"]])

    assert opciones["canvasmaker"] is generador_pdf._LienzoNumerado


# --- FAM-07: recibo oficial ---------------------------------------------------

_DATOS_RECIBO = dict(
    pago_id=42, persona_nombre="María Pérez", persona_cedula="1710034065",
    persona_telefono=None, membresia_id=163, membresia_categoria="Mensual Adultos",
    monto=Decimal("35.00"), monto_aplicado=Decimal("35.00"),
    estado_pago="APROBADO", tipo_pago="TRANSFERENCIA",
    fecha_inicio=date(2026, 8, 1), fecha_fin=date(2026, 8, 31),
    fecha_aprobacion=datetime(2026, 8, 17, 19, 30),
)


def _textos_del_recibo(monkeypatch, **cambios) -> list[str]:
    capturado: dict = {"parrafos": [], "celdas": []}
    documento_original = generador_pdf.SimpleDocTemplate
    tabla_original = generador_pdf.Table

    def _capturar_documento(*args, **kw):
        doc = documento_original(*args, **kw)
        construir_original = doc.build

        def _build(elementos, **opciones):
            capturado["parrafos"] = [
                e.getPlainText() for e in elementos if isinstance(e, Paragraph)
            ]
            return construir_original(elementos, **opciones)

        doc.build = _build
        return doc

    def _capturar_tabla(celdas, *args, **kwargs):
        capturado["celdas"] = [str(c) for fila in celdas for c in fila]
        return tabla_original(celdas, *args, **kwargs)

    monkeypatch.setattr(generador_pdf, "SimpleDocTemplate", _capturar_documento)
    monkeypatch.setattr(generador_pdf, "Table", _capturar_tabla)
    generador_pdf.generar_comprobante_pago_pdf(**{**_DATOS_RECIBO, **cambios})
    return capturado["parrafos"] + capturado["celdas"]


def test_recibo_muestra_forma_de_pago_y_estado_en_lenguaje_humano(monkeypatch):
    textos = _textos_del_recibo(monkeypatch)

    assert "Forma de pago" in textos and "Transferencia" in textos
    assert "Aprobado" in textos
    assert "TRANSFERENCIA" not in textos and "APROBADO" not in textos
    assert "Tipo de pago" not in textos


def test_recibo_no_repite_el_monto_aplicado_si_es_igual(monkeypatch):
    textos = _textos_del_recibo(monkeypatch)

    assert "Monto aplicado" not in textos


def test_recibo_conserva_el_monto_aplicado_si_difiere(monkeypatch):
    textos = _textos_del_recibo(monkeypatch, monto_aplicado=Decimal("30.00"))

    assert "Monto aplicado" in textos and "$30,00" in textos


def test_recibo_no_imprime_el_numero_interno_de_membresia(monkeypatch):
    textos = _textos_del_recibo(monkeypatch)

    assert not any("Membresía Nº" in t for t in textos)


def test_recibo_usa_el_pie_aprobado_por_el_club(monkeypatch):
    textos = _textos_del_recibo(monkeypatch)

    assert any(
        "Este comprobante se genera electrónicamente y no requiere firma." in t
        for t in textos
    )
    assert not any("plena validez interna" in t for t in textos)


def test_recibo_rechazado_conserva_su_sello(monkeypatch):
    textos = _textos_del_recibo(monkeypatch, estado_pago="RECHAZADO")

    assert "PAGO RECHAZADO" in textos and "Rechazado" in textos


# --- FAM-19: el mensaje del archivo dañado termina en punto -------------------

def test_mensaje_de_archivo_danado_separa_las_dos_frases():
    from pathlib import Path

    from app.servicios_negocio import membresia_pago_servicio

    fuente = Path(membresia_pago_servicio.__file__).read_text(encoding="utf-8")

    assert "intente otra vez." in fuente
    assert 'intente otra vez"' not in fuente


# --- TXT-08: dinero «$40,00» en notificaciones y errores ----------------------

def test_los_textos_de_dinero_no_usan_punto_decimal_en_el_fuente():
    import re
    from pathlib import Path

    import app.infraestructura.tareas.alertas_tareas as alertas
    from app.servicios_negocio import beneficio_servicio, membresia_pago_servicio

    for modulo in (alertas, beneficio_servicio, membresia_pago_servicio):
        fuente = Path(modulo.__file__).read_text(encoding="utf-8")
        assert not re.search(r"\(?\$\{[^}]*(monto|valor|descuento)[^}]*\}", fuente), (
            f"{modulo.__name__} interpola dinero con «$» a mano"
        )
        assert ":,.2f" not in fuente
