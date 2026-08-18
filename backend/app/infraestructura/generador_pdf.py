"""
Generador de comprobantes PDF en memoria (ReportLab).

Reglas del servicio:
    - El PDF se construye en un `io.BytesIO` (memoria) y se devuelve como
      `bytes`. NUNCA se persiste en disco del servidor.
    - La responsabilidad termina aquí: la subida a Cloudinary la hace
      `cloudinary_cliente`.
"""
from __future__ import annotations

import io
from datetime import datetime, date
from decimal import Decimal
from pathlib import Path

from fastapi import Response
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable,
)

from app.soporte_transversal.tiempo import ahora_club

_LOGO_PATH = Path(__file__).parent / "assets" / "cata-club-logo.jpeg"
_ROJO_INSTITUCIONAL = "#D92128"
_NEGRO_INSTITUCIONAL = "#111111"
# Gris de las filas pares: el rojo institucional lavado hasta el punto en que
# solo sirve para que el ojo no se salte de renglón. Lo comparten las dos
# tablas porque una familia y un administrador miran documentos del mismo club.
_GRIS_FILAS_ALTERNAS = "#F3F0F0"
_NOMBRE_CLUB = "Cata Club - Academia de Tenis"

# Alto que la cabecera institucional se reserva arriba de la hoja: el logo baja
# hasta 24mm del borde y la barra roja se dibuja a 26mm. Ninguno de los dos es
# un flowable, así que no empujan el contenido: si el margen superior no los
# deja pasar, el texto les cae encima.
_MARGEN_SUPERIOR_CON_CABECERA = 30 * mm

FORMATO_SELLO_COMPROBANTE = "%d/%m/%Y %H:%M:%S"
FORMATO_SELLO_REPORTE = "%d/%m/%Y %H:%M"

# Tipografía y relleno de la tabla de reporte. Son constantes y no números
# sueltos porque el cálculo de anchos de columna necesita medir el texto con
# exactamente la misma fuente y el mismo padding con que después se dibuja:
# si los dos lados se desincronizan, la tabla vuelve a desbordar la hoja.
_TAM_FUENTE_REPORTE = 9
_RELLENO_REPORTE = 5


def sello_de_tiempo(formato: str) -> str:
    """Hora del CLUB formateada para imprimir en un PDF.

    Es una hora que una persona lee en papel: un comprobante emitido a las
    19:30 del lunes no puede decir "martes 00:30". Por eso NO usa
    `datetime.now()`, que en un contenedor UTC devuelve la hora UTC
    (ver `app/soporte_transversal/tiempo.py`)."""
    return ahora_club().strftime(formato)


def generar_comprobante_pago_pdf(
    *,
    pago_id: int,
    persona_nombre: str,
    persona_cedula: str,
    persona_telefono: str,
    membresia_id: int,
    membresia_categoria: str,
    monto: Decimal,
    monto_aplicado: Decimal,
    estado_pago: str,
    tipo_pago: str,
    fecha_inicio: date,
    fecha_fin: date,
    fecha_aprobacion: datetime,
    motivo_rechazo: str | None = None,
) -> bytes:
    """
    Construye un PDF de comprobante digital de pago en memoria y devuelve bytes.

    El PDF incluye:
      - Cabecera institucional (logo + barra roja), la misma que el reporte
      - Encabezado de la academia (cata club)
      - Datos del alumno (nombre, cédula, teléfono)
      - Detalle del pago (monto, tipo, estado, fechas)
      - Sello de aprobación / datos de rechazo (si aplica)
      - Pie de página con timestamp de emisión

    Este es el único PDF que sale del club hacia una familia, así que viste la
    identidad de la casa y no la de ReportLab: el logo y la barra roja llegan
    por el mismo callback `_dibujar_encabezado_pagina` que usan los reportes.
    Lo único que no responde a la marca es el sello de estado, que es verde o
    rojo porque informa si el pago se aprobó o se rechazó.

    El buffer se cierra internamente para liberar conexiones de ReportLab.
    """
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=_MARGEN_SUPERIOR_CON_CABECERA,
        bottomMargin=16 * mm,
        title=f"Comprobante de Pago #{pago_id}",
        author=_NOMBRE_CLUB,
    )

    estilos = getSampleStyleSheet()
    titulo = ParagraphStyle(
        "TituloComprobante", parent=estilos["Title"],
        fontSize=18, textColor=colors.HexColor(_NEGRO_INSTITUCIONAL), spaceAfter=4,
    )
    subtitulo = ParagraphStyle(
        "Sub", parent=estilos["Normal"],
        fontSize=10, textColor=colors.grey, spaceAfter=10,
    )
    cuerpo = ParagraphStyle(
        "Cuerpo", parent=estilos["Normal"], fontSize=10, leading=14,
    )
    sello = ParagraphStyle(
        "Sello", parent=estilos["Normal"],
        fontSize=14, textColor=colors.HexColor("#1B8F2E"),
        alignment=1, spaceBefore=12, spaceAfter=12,
    )

    elementos = [
        Paragraph(_NOMBRE_CLUB, titulo),
        Paragraph("Comprobante digital de pago de membresía", subtitulo),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor(_ROJO_INSTITUCIONAL)),
        Spacer(1, 8),

        Paragraph(f"<b>Nº de comprobante:</b> P-{fecha_aprobacion.year}-{pago_id:06d}", cuerpo),
        Paragraph(
            f"<b>Fecha de aprobación:</b> {fecha_aprobacion.strftime('%d/%m/%Y %H:%M')}",
            cuerpo,
        ),
        Spacer(1, 10),

        Paragraph("<b>Datos del alumno</b>", estilos["Heading3"]),
        Paragraph(f"Nombre: {persona_nombre}", cuerpo),
        Paragraph(f"Cédula: {persona_cedula}", cuerpo),
        Paragraph(f"Teléfono: {persona_telefono}", cuerpo),
        Spacer(1, 10),

        Paragraph("<b>Detalle de la membresía</b>", estilos["Heading3"]),
        Paragraph(f"Categoría: {membresia_categoria}", cuerpo),
        Paragraph(f"Membresía Nº: {membresia_id}", cuerpo),
        Spacer(1, 10),

        Paragraph("<b>Detalle del pago</b>", estilos["Heading3"]),
    ]

    tabla_datos: list[list[str]] = [
        ["Concepto", "Valor"],
        ["Monto pagado", f"USD {monto:.2f}"],
        ["Monto aplicado", f"USD {monto_aplicado:.2f}"],
        ["Tipo de pago", tipo_pago],
        ["Estado", estado_pago],
        ["Vigencia desde", fecha_inicio.strftime("%d/%m/%Y")],
        ["Vigencia hasta", fecha_fin.strftime("%d/%m/%Y")],
    ]
    if motivo_rechazo:
        tabla_datos.append(["Motivo de rechazo", motivo_rechazo])

    tabla = Table(tabla_datos, colWidths=[60 * mm, 90 * mm], hAlign="LEFT")
    tabla.setStyle(_estilo_tabla())
    elementos.append(tabla)
    elementos.append(Spacer(1, 18))

    if estado_pago.upper() == "APROBADO":
        elementos.append(Paragraph("PAGO APROBADO - MEMBRESÍA ACTIVA", sello))
    elif estado_pago.upper() == "RECHAZADO":
        sello_rechazo = ParagraphStyle(
            "SelloRechazo", parent=sello, textColor=colors.HexColor("#B22222"),
        )
        elementos.append(Paragraph("PAGO RECHAZADO", sello_rechazo))
    else:
        elementos.append(Paragraph(f"Estado: {estado_pago}", cuerpo))

    elementos.append(Spacer(1, 24))
    elementos.append(HRFlowable(width="50%", thickness=0.5, color=colors.grey))
    elementos.append(Paragraph(
        f"Documento generado electrónicamente el "
        f"{sello_de_tiempo(FORMATO_SELLO_COMPROBANTE)}."
        f" Valor sin firma física tiene plena validez interna.",
        ParagraphStyle("Pie", parent=cuerpo, fontSize=8, textColor=colors.grey),
    ))

    doc.build(
        elementos,
        onFirstPage=_dibujar_encabezado_pagina,
        onLaterPages=_dibujar_encabezado_pagina,
    )
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


def _construir_estilo_tabla(
    *,
    tamano_fuente: int,
    relleno: int,
) -> TableStyle:
    """Builder compartido de `TableStyle` para las tablas de comprobante y
    reporte.

    El color ya no se parametriza. Antes sí, y el comentario que estaba acá lo
    justificaba diciendo que cada tabla «conserva su identidad visual propia»:
    en los hechos, la del comprobante iba en un azul que no figuraba en la guía
    visual ni en ningún otro rincón del club. No eran dos identidades sino una
    sola y un huérfano, y el huérfano era justo el que veía la familia. Hoy las
    dos tablas visten igual -- rojo institucional en el encabezado, gris de la
    casa en las filas pares -- y lo único que las separa es la densidad: el
    comprobante lista siete conceptos y respira; el reporte puede listar
    doscientas filas y necesita fuente y relleno más chicos.
    """
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(_ROJO_INSTITUCIONAL)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), tamano_fuente),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor(_GRIS_FILAS_ALTERNAS)]),
        ("LEFTPADDING", (0, 0), (-1, -1), relleno),
        ("RIGHTPADDING", (0, 0), (-1, -1), relleno),
        ("TOPPADDING", (0, 0), (-1, -1), relleno - 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), relleno - 1),
    ])


def _estilo_tabla() -> TableStyle:
    """Devuelve los estilos de la tabla de detalle (TableStyle).

    Más grande y más aireada que la del reporte: son siete conceptos que una
    familia lee una vez, no un listado que hay que recorrer."""
    return _construir_estilo_tabla(
        tamano_fuente=10,
        relleno=6,
    )


def generar_reporte_pdf(
    *,
    titulo: str,
    columnas: list[str],
    filas: list[list[str]],
    generado_por: str | None = None,
) -> bytes:
    """
    Construye un PDF de reporte tabular genérico en memoria y devuelve bytes.

    Reglas:
      - Todas las filas van en una única `Table` (`repeatRows=1`); ReportLab
        la parte automáticamente donde el contenido deja de entrar en la
        página, repitiendo el encabezado en cada continuación. Antes se
        forzaba un corte fijo cada 10 filas (`PageBreak` manual) sin importar
        cuánto espacio real ocupaban esas filas, dejando la mayor parte de
        cada página en blanco.
      - La tabla nunca es más ancha que el frame: los anchos de columna se
        calculan contra `doc.width` (ver `_tabla_de_reporte`) en vez de
        dejárselos a ReportLab, que los deduce del dato más largo y dibuja
        fuera del papel lo que no entra.
      - El logo institucional y una barra roja `#D92128` se dibujan en cada
        página vía callback `onFirstPage`/`onLaterPages` de `doc.build`.
      - Si `filas` está vacío se emite un `Paragraph` centrado indicando que
        no hay resultados, en vez de una tabla vacía. Siempre devuelve un PDF
        válido (nunca lanza excepción por falta de datos).
    """
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=_MARGEN_SUPERIOR_CON_CABECERA,
        bottomMargin=16 * mm,
        title=titulo,
        author=_NOMBRE_CLUB,
    )

    estilos = getSampleStyleSheet()
    titulo_estilo = ParagraphStyle(
        "TituloReporte", parent=estilos["Title"],
        fontSize=16, textColor=colors.HexColor(_NEGRO_INSTITUCIONAL), spaceAfter=4,
    )
    subtitulo_estilo = ParagraphStyle(
        "SubReporte", parent=estilos["Normal"],
        fontSize=9, textColor=colors.grey, spaceAfter=10,
    )
    sin_resultados_estilo = ParagraphStyle(
        "SinResultados", parent=estilos["Normal"],
        fontSize=11, alignment=1, textColor=colors.HexColor(_NEGRO_INSTITUCIONAL),
        spaceBefore=30,
    )

    elementos: list = [
        Paragraph(titulo, titulo_estilo),
        Paragraph(
            f"Generado el {sello_de_tiempo(FORMATO_SELLO_REPORTE)}"
            + (f" por {generado_por}" if generado_por else ""),
            subtitulo_estilo,
        ),
        Spacer(1, 6),
    ]

    if not filas:
        elementos.append(Paragraph(
            "No hay resultados para los filtros seleccionados.",
            sin_resultados_estilo,
        ))
    else:
        elementos.append(_tabla_de_reporte(columnas, filas, doc.width))

    doc.build(
        elementos,
        onFirstPage=_dibujar_encabezado_pagina,
        onLaterPages=_dibujar_encabezado_pagina,
    )
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


def _estilo_tabla_reporte() -> TableStyle:
    """Devuelve los estilos de la tabla de un reporte tabular genérico."""
    return _construir_estilo_tabla(
        tamano_fuente=_TAM_FUENTE_REPORTE,
        relleno=_RELLENO_REPORTE,
    )


def _anchos_de_columna_reporte(
    datos_tabla: list[list[str]], ancho_disponible: float,
) -> list[float]:
    """Reparte `ancho_disponible` entre las columnas de un reporte.

    Sin `colWidths`, ReportLab le da a cada columna el ancho de su celda más
    larga y, si la suma excede el frame, dibuja la tabla igual desde el margen
    izquierdo: las columnas de la derecha caen fuera del papel sin excepción y
    sin warning, y cuál se pierde depende de a quién liste el reporte.

    Si la tabla entra, se respeta el ancho natural. Si no entra, cada columna
    baja hasta su mínimo -- la palabra más larga, que es lo único que no se
    puede partir en dos renglones -- y el sobrante se reparte proporcional a
    la holgura que cada columna pedía de más, para que el espacio se lo lleve
    la columna de nombres y no las cuatro de fecha, que ya están cómodas.
    """
    # Lo que la celda ocupa además de su texto: el padding de los dos lados
    # más el trazo del grid que la separa de la vecina.
    extra = 2 * _RELLENO_REPORTE + 1
    naturales: list[float] = []
    minimos: list[float] = []
    for indice in range(len(datos_tabla[0])):
        anchos_celda: list[float] = []
        anchos_palabra: list[float] = [0.0]
        for numero_fila, fila in enumerate(datos_tabla):
            fuente = "Helvetica-Bold" if numero_fila == 0 else "Helvetica"
            texto = str(fila[indice])
            anchos_celda.append(stringWidth(texto, fuente, _TAM_FUENTE_REPORTE))
            anchos_palabra += [
                stringWidth(palabra, fuente, _TAM_FUENTE_REPORTE)
                for palabra in texto.split()
            ]
        naturales.append(max(anchos_celda) + extra)
        minimos.append(max(anchos_palabra) + extra)

    if sum(naturales) <= ancho_disponible:
        return naturales

    sobrante = ancho_disponible - sum(minimos)
    if sobrante <= 0:
        # Ni las palabras sueltas entran (un `PENDIENTE_VALIDACION` de 121pt
        # junto a otras seis columnas): se escala todo por igual y ReportLab
        # parte las palabras. Feo, pero adentro de la hoja.
        factor = ancho_disponible / sum(minimos)
        anchos = [minimo * factor for minimo in minimos]
    else:
        holgura = sum(naturales) - sum(minimos)
        anchos = [
            minimo + (natural - minimo) * sobrante / holgura
            for minimo, natural in zip(minimos, naturales)
        ]

    # El reparto suma el ancho disponible en teoría, pero en punto flotante
    # puede pasarse por una millonésima de punto: invisible en el papel y
    # suficiente para que la tabla vuelva a medir más que el frame. El
    # excedente se lo come la columna más ancha, que es la que menos lo nota.
    exceso = sum(anchos) - ancho_disponible
    if exceso > 0:
        mas_ancha = max(range(len(anchos)), key=anchos.__getitem__)
        anchos[mas_ancha] -= exceso + 1e-9
    return anchos


def _tabla_de_reporte(
    columnas: list[str], filas: list[list[str]], ancho_disponible: float,
) -> Table:
    """Arma la tabla del reporte con anchos fijos y celdas que hacen wrap.

    Las celdas viajan como `Paragraph` y no como texto plano porque un texto
    plano no se parte en renglones: exige todo su ancho de una y empuja la
    columna. Con `Paragraph`, un nombre largo baja a una segunda línea y la
    columna respeta el ancho que se le asignó.

    OJO con el encabezado: un `Paragraph` pinta su propio texto, así que el
    `TEXTCOLOR` del `TableStyle` deja de aplicarle. El blanco tiene que viajar
    en su `ParagraphStyle` o el título queda negro sobre el rojo institucional
    y no se lee.
    """
    estilos = getSampleStyleSheet()
    celda_estilo = ParagraphStyle(
        "CeldaReporte", parent=estilos["BodyText"],
        fontName="Helvetica", fontSize=_TAM_FUENTE_REPORTE,
        leading=_TAM_FUENTE_REPORTE + 2, spaceBefore=0, spaceAfter=0,
    )
    encabezado_estilo = ParagraphStyle(
        "EncabezadoReporte", parent=celda_estilo,
        fontName="Helvetica-Bold", textColor=colors.white,
    )

    anchos = _anchos_de_columna_reporte([columnas] + filas, ancho_disponible)
    contenido = [[Paragraph(str(c), encabezado_estilo) for c in columnas]]
    contenido += [[Paragraph(str(c), celda_estilo) for c in fila] for fila in filas]

    tabla = Table(contenido, colWidths=anchos, hAlign="LEFT", repeatRows=1)
    tabla.setStyle(_estilo_tabla_reporte())
    return tabla


def _dibujar_encabezado_pagina(canvas, doc) -> None:
    """Callback de página: logo institucional + barra roja en cada página."""
    canvas.saveState()
    ancho_pagina, alto_pagina = A4

    if _LOGO_PATH.exists():
        alto_logo = 14 * mm
        ancho_logo = 14 * mm
        canvas.drawImage(
            str(_LOGO_PATH),
            14 * mm,
            alto_pagina - 24 * mm,
            width=ancho_logo,
            height=alto_logo,
            preserveAspectRatio=True,
            mask="auto",
        )

    canvas.setFillColor(colors.HexColor(_ROJO_INSTITUCIONAL))
    canvas.rect(0, alto_pagina - 26 * mm, ancho_pagina, 2 * mm, stroke=0, fill=1)

    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(colors.grey)
    canvas.drawString(
        ancho_pagina - 30 * mm, 10 * mm, f"Página {doc.page}",
    )
    canvas.restoreState()


def construir_respuesta_pdf(pdf_bytes: bytes, nombre_archivo: str) -> Response:
    """Empaqueta bytes de PDF ya generados en una `Response` HTTP para
    descarga (`Content-Disposition: attachment`).

    Helper compartido por los routers de exportación a PDF
    (`personas_router.reporte_nuevos_por_periodo_pdf`,
    `asistencias_router.reporte_asistencia_pdf`) para no duplicar la misma
    construcción de `Response` en cada endpoint.
    """
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{nombre_archivo}"'},
    )
