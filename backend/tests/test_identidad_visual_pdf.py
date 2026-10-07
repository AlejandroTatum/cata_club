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


def test_el_comprobante_deja_aire_para_el_membrete(monkeypatch):
    """El banner y las tres líneas del membrete se dibujan por fuera del flujo:
    el margen superior tiene que cubrir el banner escalado al ancho del
    contenido más las líneas, o el título del comprobante se les encima."""
    capturado = _comprobante_construido(monkeypatch)

    doc = capturado["doc"]
    alto_banner = doc.width * generador_pdf._MEMBRETE_PROPORCION
    assert doc.topMargin >= alto_banner + 2 * mm
    assert doc.bottomMargin >= 16 * mm


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
        if isinstance(elemento, Paragraph) and "Nº de recibo" in elemento.text
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


# --- ADM-05 (QA3): el texto de usuario se escapa antes de ir a un Paragraph --
# `Paragraph` interpreta un mini-XML: un nombre como `<b>Ana` (etiqueta sin
# cerrar) hacía fallar el parseo y la descarga del reporte terminaba en 500.
_NOMBRE_HOSTIL = "<b>Ana & <i>Pérez</u>"


def test_reporte_pdf_con_marcado_en_los_datos_no_falla():
    pdf = generador_pdf.generar_reporte_pdf(
        titulo="Reporte <b>de & prueba",
        columnas=["Nombre <b>", "Estado & más"],
        filas=[[_NOMBRE_HOSTIL, "ok"]],
        generado_por="<admin & co",
    )
    assert pdf.startswith(b"%PDF")


def test_comprobante_pdf_con_marcado_en_los_datos_no_falla():
    datos = {
        **_DATOS_COMPROBANTE,
        "persona_nombre": _NOMBRE_HOSTIL,
        "membresia_categoria": "<b>Infantil & Juvenil",
        "estado_pago": "<raro & estado",
    }
    assert generar_comprobante_pago_pdf(**datos).startswith(b"%PDF")


# --- QA3 FAM-07: textos del comprobante -----------------------------------

def _textos_del_comprobante(capturado: dict) -> list[str]:
    parrafos = [
        e.getPlainText() for e in capturado["elementos"] if isinstance(e, Paragraph)
    ]
    celdas = [str(c) for fila in capturado["tabla"]._cellvalues for c in fila]
    return parrafos + celdas


def test_comprobante_sin_telefono_dice_no_registrado(monkeypatch):
    capturado = _comprobante_construido(monkeypatch, persona_telefono=None)

    textos = _textos_del_comprobante(capturado)

    assert "Teléfono: No registrado" in textos
    assert not any("None" in t for t in textos)


def test_comprobante_con_telefono_lo_imprime(monkeypatch):
    textos = _textos_del_comprobante(_comprobante_construido(monkeypatch))

    assert "Teléfono: 0987654321" in textos


def test_comprobante_imprime_el_monto_con_formato_del_club(monkeypatch):
    capturado = _comprobante_construido(monkeypatch, monto=Decimal("40"))

    celdas = [list(fila) for fila in capturado["tabla"]._cellvalues]

    assert ["Monto pagado", "$40,00"] in celdas
    assert not any("USD" in str(c) for fila in celdas for c in fila)


def test_comprobante_convierte_la_aprobacion_a_hora_de_ecuador(monkeypatch):
    from datetime import timezone

    capturado = _comprobante_construido(
        monkeypatch, fecha_aprobacion=datetime(2026, 8, 18, 1, 5, tzinfo=timezone.utc),
    )

    textos = _textos_del_comprobante(capturado)

    assert "Fecha de aprobación: 17/08/2026 20:05 (hora de Ecuador)" in textos


# --- QA4 FAM-07: nombre del club y pie del comprobante --------------------

def test_comprobante_nombra_el_deporte_del_club_y_el_pie_sin_firma(monkeypatch):
    """El título decía «Academia de Tenis»: el club es de Tenis de Mesa."""
    capturado = _comprobante_construido(monkeypatch)
    textos = _textos_del_comprobante(capturado)

    assert "Cata Club - Tenis de Mesa" in textos
    assert not any("Academia de Tenis" in t for t in textos)
    assert any(
        "Este recibo se genera electrónicamente y no requiere firma." in t
        for t in textos
    )
    assert not any("plena validez" in t for t in textos)


def test_el_nombre_del_club_es_tenis_de_mesa_en_todo_el_generador():
    assert generador_pdf._NOMBRE_CLUB == "Cata Club - Tenis de Mesa"


# --- Membrete del cliente (HOJA DE MUESTRA) ---------------------------------

_LINEAS_MEMBRETE = [
    "CLUB DEPORTIVO ESPECIALIZADO FORMATIVO \u201cCATA CLUB\u201d",
    "FUNDADO EL 10 DE OCTUBRE DEL 2013",
    "ACUERDO MINISTERIAL 1810",
]
_PIE_TELEFONOS = "Tel\u00e9fonos: 0994219619 \u2013 0990288152"


def _textos_dibujados_en_el_lienzo(monkeypatch, generar) -> list[str]:
    """Espía lo que se dibuja en el lienzo (el membrete y el pie no son
    flowables, así que no pasan por `build`) y devuelve cada cadena impresa."""
    from reportlab.pdfgen.canvas import Canvas

    dibujados: list[str] = []
    for nombre in ("drawString", "drawCentredString", "drawRightString"):
        original = getattr(Canvas, nombre)

        def _espia(self, x, y, texto, *a, _original=original, **k):
            dibujados.append(texto)
            return _original(self, x, y, texto, *a, **k)

        monkeypatch.setattr(Canvas, nombre, _espia)
    generar()
    return dibujados


def _generar_comprobante():
    return generar_comprobante_pago_pdf(**_DATOS_COMPROBANTE)


def _generar_reporte():
    return generador_pdf.generar_reporte_pdf(
        titulo="Pagos", columnas=["Nombre"], filas=[["Ana"]],
    )


@pytest.mark.parametrize("generar", [_generar_comprobante, _generar_reporte])
def test_todo_pdf_lleva_el_membrete_y_el_pie_de_telefonos(monkeypatch, generar):
    textos = _textos_dibujados_en_el_lienzo(monkeypatch, generar)

    for linea in _LINEAS_MEMBRETE:
        assert linea in textos
    assert _PIE_TELEFONOS in textos


def test_el_reporte_conserva_pagina_x_de_n_junto_al_pie_de_telefonos(monkeypatch):
    textos = _textos_dibujados_en_el_lienzo(monkeypatch, _generar_reporte)

    assert "Página 1 de 1" in textos
    assert _PIE_TELEFONOS in textos


@pytest.mark.parametrize("generar", [_generar_comprobante, _generar_reporte])
def test_el_membrete_es_texto_extraible_del_pdf(generar):
    """Lectura real del PDF: confirma que las líneas no solo se piden al
    lienzo sino que quedan en el documento. Requiere `pdftotext`."""
    import shutil
    import subprocess

    if shutil.which("pdftotext") is None:
        pytest.skip("pdftotext no está instalado")
    texto = subprocess.run(
        ["pdftotext", "-", "-"], input=generar(), capture_output=True, check=True,
    ).stdout.decode("utf-8")

    for linea in _LINEAS_MEMBRETE:
        assert linea in texto
    assert _PIE_TELEFONOS in texto


def test_el_comprobante_sigue_en_una_sola_pagina():
    assert _generar_comprobante().count(b"/Type /Page\n") == 1


def test_el_banner_del_membrete_existe_y_conserva_la_proporcion_del_cliente():
    from PIL import Image

    ruta = generador_pdf._MEMBRETE_PATH
    assert ruta.exists()
    ancho, alto = Image.open(ruta).size
    assert (ancho, alto) == (1166, 253)
    assert generador_pdf._MEMBRETE_PROPORCION == pytest.approx(alto / ancho)


# --- El bloque de título va DENTRO del banner, sobre la franja roja ---------
#
# Medido en el PNG del cliente (1166x253 px): la franja roja ocupa las filas
# 159-200 y el logo las columnas 40-218 de la zona blanca superior. El dueño
# pidió el título «arriba de la línea roja», a la derecha del logo.
_FILA_SUPERIOR_FRANJA_PX = 159
_COLUMNA_FIN_LOGO_PX = 218


def _posiciones_del_membrete(monkeypatch, generar):
    """Devuelve ((x, y, ancho, alto) del banner, {línea: (x, y)})."""
    from reportlab.pdfgen.canvas import Canvas

    banner: list[tuple[float, float, float, float]] = []
    lineas: dict[str, tuple[float, float]] = {}
    imagen_original = Canvas.drawImage
    centrado_original = Canvas.drawCentredString

    def _imagen(self, imagen, x, y, width=None, height=None, *a, **k):
        banner.append((x, y, width, height))
        return imagen_original(self, imagen, x, y, width, height, *a, **k)

    def _centrado(self, x, y, texto, *a, **k):
        if texto in _LINEAS_MEMBRETE:
            lineas[texto] = (x, y)
        return centrado_original(self, x, y, texto, *a, **k)

    monkeypatch.setattr(Canvas, "drawImage", _imagen)
    monkeypatch.setattr(Canvas, "drawCentredString", _centrado)
    generar()
    return banner[0], lineas


@pytest.mark.parametrize("generar", [_generar_comprobante, _generar_reporte])
def test_el_titulo_del_membrete_va_sobre_la_franja_roja(monkeypatch, generar):
    from reportlab.pdfbase.pdfmetrics import stringWidth

    (x_banner, base_banner, ancho, alto), lineas = _posiciones_del_membrete(monkeypatch, generar)
    escala = ancho / 1166
    tope_franja = base_banner + (253 - _FILA_SUPERIOR_FRANJA_PX) * escala
    tope_banner = base_banner + alto
    fin_logo = x_banner + _COLUMNA_FIN_LOGO_PX * escala

    ys = [lineas[t][1] for t in _LINEAS_MEMBRETE]
    assert ys == sorted(ys, reverse=True)
    # Todo el bloque cae en la zona blanca: sobre la franja y bajo el borde superior.
    assert ys[-1] > tope_franja
    assert ys[0] + generador_pdf._TAM_LINEA_MEMBRETE < tope_banner
    for indice, texto in enumerate(_LINEAS_MEMBRETE):
        x_centro, _ = lineas[texto]
        fuente = (
            generador_pdf._FUENTE_MEMBRETE_NEGRITA if indice == 0 else generador_pdf._FUENTE_MEMBRETE
        )
        medio_ancho = stringWidth(texto, fuente, generador_pdf._TAM_LINEA_MEMBRETE) / 2
        # A la derecha del logo y dentro del banner.
        assert x_centro - medio_ancho > fin_logo
        assert x_centro + medio_ancho < x_banner + ancho


@pytest.mark.parametrize(
    "generar, margen_lateral",
    [(_generar_comprobante, 18 * mm), (_generar_reporte, 14 * mm)],
)
def test_el_margen_superior_coincide_con_la_altura_del_banner(
    monkeypatch, generar, margen_lateral,
):
    from reportlab.lib.pagesizes import A4

    (_, base_banner, _, _), _ = _posiciones_del_membrete(monkeypatch, generar)
    inicio_del_cuerpo = A4[1] - generador_pdf._margen_superior(A4[0] - 2 * margen_lateral)

    # Sin líneas bajo el banner, el cuerpo arranca entre 2 y 6 mm bajo su base.
    assert 2 * mm <= base_banner - inicio_del_cuerpo <= 6 * mm
