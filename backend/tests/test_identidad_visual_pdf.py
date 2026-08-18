"""Candados de identidad visual de los PDF que emite el club.

El comprobante de pago es el ÚNICO PDF que llega a las manos de una familia, y
durante mucho tiempo se dibujó con un azul `#0B3D91` que no existe en ninguna
parte del club: ni en `docs/ux/rediseno-visual-2026-08.md`, ni en la landing, ni
en los reportes. Dos generadores en el mismo archivo, dos identidades distintas.

Estos tests fijan la unificación: el comprobante viste la misma cabecera que el
reporte (logo + barra roja), el mismo rojo institucional en su tabla y el mismo
negro en su título. Lo único que NO se unifica es el sello de estado: verde y
rojo ahí significan aprobado y rechazado, y eso es semántica, no marca.
"""
from datetime import datetime, date
from decimal import Decimal
from pathlib import Path

import pytest
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Paragraph

from app.infraestructura import generador_pdf
from app.infraestructura.generador_pdf import (
    _NEGRO_INSTITUCIONAL,
    _ROJO_INSTITUCIONAL,
    generar_comprobante_pago_pdf,
)

_AZUL_HUERFANO = "#0B3D91"

# Colores del sello de estado. No son identidad de marca: un socio distingue
# "aprobado" de "rechazado" por el color antes que por el texto, así que estos
# dos valores sobreviven a propósito a la unificación.
_VERDE_APROBADO = "#1B8F2E"
_ROJO_RECHAZADO = "#B22222"

_DATOS_COMPROBANTE = dict(
    pago_id=42,
    persona_nombre="María Fernanda Chiliquinga",
    persona_cedula="1710034065",
    persona_telefono="0987654321",
    membresia_id=7,
    membresia_categoria="Sub-14 Competencia",
    monto=Decimal("35.00"),
    monto_aplicado=Decimal("35.00"),
    estado_pago="APROBADO",
    tipo_pago="TRANSFERENCIA",
    fecha_inicio=date(2026, 8, 1),
    fecha_fin=date(2026, 8, 31),
    fecha_aprobacion=datetime(2026, 8, 17, 19, 30),
)


def _comprobante_construido(monkeypatch, **sobrescrituras):
    """Genera un comprobante real y devuelve lo que armó por dentro.

    Se espía en vez de leer los bytes del PDF porque el color en un PDF vive
    dentro de un stream comprimido: un `assert b"0B3D91" not in pdf` pasaría
    aunque toda la hoja saliera azul. Lo que se inspecciona son los objetos que
    el generador le entregó a ReportLab -- estilos, `TableStyle`, callbacks --,
    que es donde el color se decide de verdad.
    """
    capturado: dict = {}
    documento_original = generador_pdf.SimpleDocTemplate
    tabla_original = generador_pdf.Table

    def _capturar_documento(*args, **kwargs):
        doc = documento_original(*args, **kwargs)
        construir_original = doc.build

        def _capturar_build(elementos, **kw):
            capturado["elementos"] = list(elementos)
            capturado["build"] = kw
            return construir_original(elementos, **kw)

        doc.build = _capturar_build
        capturado["doc"] = doc
        return doc

    def _capturar_tabla(celdas, *args, **kwargs):
        tabla = tabla_original(celdas, *args, **kwargs)
        aplicar_original = tabla.setStyle

        def _capturar_estilo(estilo):
            capturado["estilo_tabla"] = estilo
            return aplicar_original(estilo)

        tabla.setStyle = _capturar_estilo
        capturado["tabla"] = tabla
        return tabla

    monkeypatch.setattr(generador_pdf, "SimpleDocTemplate", _capturar_documento)
    monkeypatch.setattr(generador_pdf, "Table", _capturar_tabla)
    generar_comprobante_pago_pdf(**{**_DATOS_COMPROBANTE, **sobrescrituras})
    return capturado


def _colores_dibujados(capturado: dict) -> list[colors.Color]:
    """Todo color que el comprobante le pide a ReportLab: el de cada párrafo,
    el de cada línea divisoria y el de cada instrucción de la tabla."""
    encontrados: list[colors.Color] = []
    for elemento in capturado["elementos"]:
        if isinstance(elemento, Paragraph):
            encontrados.append(elemento.style.textColor)
        elif isinstance(elemento, HRFlowable):
            encontrados.append(elemento.color)
    for comando in capturado["estilo_tabla"].getCommands():
        encontrados += [
            valor for valor in comando[3:] if isinstance(valor, colors.Color)
        ]
        # ROWBACKGROUNDS lleva la lista de colores anidada en un solo argumento.
        for valor in comando[3:]:
            if isinstance(valor, (list, tuple)):
                encontrados += [c for c in valor if isinstance(c, colors.Color)]
    return encontrados


def test_el_comprobante_no_pinta_el_azul_huerfano(monkeypatch):
    """El `#0B3D91` no sale de ninguna decisión de diseño del club: no está en
    la guía visual ni en ningún otro lado. Era el color por defecto de un
    generador que nadie volvió a mirar, y es el que ve la familia."""
    capturado = _comprobante_construido(monkeypatch)

    azul = colors.HexColor(_AZUL_HUERFANO)

    assert azul not in _colores_dibujados(capturado)


def test_el_azul_huerfano_no_sobrevive_en_el_generador(monkeypatch):
    """Un color muerto que sigue escrito en el archivo vuelve solo: el próximo
    estilo que se agregue lo copia del de al lado. Se borra del fuente, no se
    deja de usar."""
    fuente = Path(generador_pdf.__file__).read_text(encoding="utf-8")

    assert _AZUL_HUERFANO not in fuente.upper()


def test_el_comprobante_lleva_la_cabecera_institucional(monkeypatch):
    """El logo y la barra roja no son flowables: los dibuja el callback de
    página. Si el comprobante no lo engancha, sale sin marca ninguna -- que es
    exactamente lo que pasaba y lo que el dueño llamó «genérico»."""
    capturado = _comprobante_construido(monkeypatch)

    assert capturado["build"].get("onFirstPage") is generador_pdf._dibujar_encabezado_pagina
    assert capturado["build"].get("onLaterPages") is generador_pdf._dibujar_encabezado_pagina


def test_el_comprobante_deja_aire_para_la_barra_roja(monkeypatch):
    """La barra se dibuja a 26mm del borde superior, por fuera del flujo. Con
    el margen viejo de 18mm el título del comprobante quedaría por debajo del
    logo pero encima de la barra: el texto y la barra se pisan."""
    capturado = _comprobante_construido(monkeypatch)

    assert capturado["doc"].topMargin >= 26 * mm


def test_el_encabezado_de_la_tabla_del_comprobante_es_rojo(monkeypatch):
    """La franja del encabezado es lo primero que el ojo agarra de la tabla:
    es la que tiene que decir «Cata Club» y no «plantilla de ReportLab»."""
    capturado = _comprobante_construido(monkeypatch)

    fondos_encabezado = [
        comando[3]
        for comando in capturado["estilo_tabla"].getCommands()
        if comando[0] == "BACKGROUND" and comando[1] == (0, 0)
    ]

    assert fondos_encabezado == [colors.HexColor(_ROJO_INSTITUCIONAL)]


def test_el_titulo_y_la_divisoria_del_comprobante_visten_de_la_casa(monkeypatch):
    """Mismo par que usa el reporte: título en negro institucional, divisoria
    en rojo. Un comprobante y un reporte apoyados uno al lado del otro tienen
    que leerse como emitidos por el mismo club."""
    capturado = _comprobante_construido(monkeypatch)

    titulo = capturado["elementos"][0]
    divisorias = [e for e in capturado["elementos"] if isinstance(e, HRFlowable)]

    assert titulo.style.textColor == colors.HexColor(_NEGRO_INSTITUCIONAL)
    assert divisorias[0].color == colors.HexColor(_ROJO_INSTITUCIONAL)


def test_el_folio_del_comprobante_usa_el_anio_de_la_aprobacion(monkeypatch):
    """El folio traía `P-2024-` grabado a fuego, sin importar cuándo se aprobó
    el pago. Un comprobante aprobado en 2026 tiene que decir 2026: el folio
    sale de `fecha_aprobacion`, nunca de un año pegado en el código."""
    capturado = _comprobante_construido(
        monkeypatch, pago_id=123, fecha_aprobacion=datetime(2026, 8, 17, 19, 30),
    )

    folios = [
        elemento
        for elemento in capturado["elementos"]
        if isinstance(elemento, Paragraph) and "Nº de comprobante" in elemento.text
    ]

    assert len(folios) == 1
    assert "P-2026-000123" in folios[0].text


@pytest.mark.parametrize(
    "estado, texto_esperado, color_esperado",
    [
        ("APROBADO", "PAGO APROBADO", _VERDE_APROBADO),
        ("RECHAZADO", "PAGO RECHAZADO", _ROJO_RECHAZADO),
    ],
)
def test_el_sello_de_estado_conserva_su_color_propio(
    monkeypatch, estado, texto_esperado, color_esperado,
):
    """El verde y el rojo del sello NO son identidad de marca: son el estado
    del pago. Unificar la paleta institucional no puede llevárselos puestos, o
    un comprobante rechazado pasa a verse igual que uno aprobado."""
    capturado = _comprobante_construido(monkeypatch, estado_pago=estado)

    sellos = [
        elemento
        for elemento in capturado["elementos"]
        if isinstance(elemento, Paragraph) and texto_esperado in elemento.text
    ]

    assert len(sellos) == 1
    assert sellos[0].style.textColor == colors.HexColor(color_esperado)
