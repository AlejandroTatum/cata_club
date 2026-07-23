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

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, PageBreak,
)

_LOGO_PATH = Path(__file__).parent / "assets" / "cata-club-logo.jpeg"
_ROJO_INSTITUCIONAL = "#D92128"
_NEGRO_INSTITUCIONAL = "#111111"
_FILAS_POR_PAGINA = 10


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
      - Encabezado de la academia (cata club)
      - Datos del alumno (nombre, cédula, teléfono)
      - Detalle del pago (monto, tipo, estado, fechas)
      - Sello de aprobación / datos de rechazo (si aplica)
      - Pie de página con timestamp de emisión

    El buffer se cierra internamente para liberar conexiones de ReportLab.
    """
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=16 * mm,
        title=f"Comprobante de Pago #{pago_id}",
        author="Cata Club - Academia de Tenis",
    )

    estilos = getSampleStyleSheet()
    titulo = ParagraphStyle(
        "TituloComprobante", parent=estilos["Title"],
        fontSize=18, textColor=colors.HexColor("#0B3D91"), spaceAfter=4,
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
        Paragraph("Cata Club - Academia de Tenis", titulo),
        Paragraph("Comprobante digital de pago de membresía", subtitulo),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor("#0B3D91")),
        Spacer(1, 8),

        Paragraph(f"<b>Nº de comprobante:</b> P-2024-{pago_id:06d}", cuerpo),
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
        f"{datetime.now().strftime('%d/%m/%Y %H:%M:%S')}."
        f" Valor sin firma física tiene plena validez interna.",
        ParagraphStyle("Pie", parent=cuerpo, fontSize=8, textColor=colors.grey),
    ))

    doc.build(elementos)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


def _estilo_tabla() -> TableStyle:
    """Devuelve los estilos de la tabla de detalle (TableStyle)."""
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0B3D91")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor("#F3F6FF")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ])


def _estilo_tabla_reporte() -> TableStyle:
    """TableStyle de la tabla de filas para `generar_reporte_pdf`, con la
    paleta institucional (rojo/negro) en lugar del azul del comprobante."""
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(_ROJO_INSTITUCIONAL)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor("#F5F5F5")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ])


def _dibujar_encabezado_pagina(canvas, doc) -> None:
    """Callback `onFirstPage`/`onLaterPages` de `SimpleDocTemplate`: dibuja el
    logo del club y una barra de acento roja institucional en TODAS las
    páginas (incluida la página de "sin resultados"), independientemente del
    contenido de la tabla."""
    canvas.saveState()
    ancho_pagina, alto_pagina = A4

    if _LOGO_PATH.exists():
        try:
            canvas.drawImage(
                str(_LOGO_PATH),
                18 * mm, alto_pagina - 26 * mm,
                width=22 * mm, height=22 * mm,
                preserveAspectRatio=True, mask="auto",
            )
        except Exception:
            # Un logo corrupto/ilegible no debe impedir generar el reporte.
            pass

    canvas.setFillColor(colors.HexColor(_ROJO_INSTITUCIONAL))
    canvas.rect(0, alto_pagina - 28 * mm, ancho_pagina, 2 * mm, stroke=0, fill=1)

    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor(_NEGRO_INSTITUCIONAL))
    canvas.drawRightString(
        ancho_pagina - 18 * mm, 12 * mm,
        f"Página {doc.page}",
    )
    canvas.restoreState()


def generar_reporte_pdf(
    *,
    titulo: str,
    columnas: list[str],
    filas: list[list[str]],
    generado_por: str | None = None,
) -> bytes:
    """
    Construye un PDF tabular genérico (usado por los 3 reportes exportables
    de `/reports`: etiquetas, nuevos por periodo, asistencia) en memoria y
    devuelve bytes.

    Reglas:
      - `filas` se pagina manualmente en bloques de `_FILAS_POR_PAGINA` (10),
        cada bloque como una `Table` independiente separada por `PageBreak()`,
        para evitar que ReportLab corte una fila a la mitad en el borde de
        página.
      - El logo del club y la barra roja institucional se dibujan en TODAS
        las páginas vía el callback `onFirstPage`/`onLaterPages`.
      - Si `filas` está vacío se reemplaza la tabla por un `Paragraph`
        centrado ("No hay resultados...") en vez de una tabla vacía; la
        respuesta sigue siendo un PDF válido (HTTP 200).
      - Esta función es independiente de `generar_comprobante_pago_pdf`
        (no la modifica ni depende de ella).
    """
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=32 * mm,
        bottomMargin=18 * mm,
        title=titulo,
        author="Cata Club - Academia de Tenis",
    )

    estilos = getSampleStyleSheet()
    estilo_titulo = ParagraphStyle(
        "TituloReporte", parent=estilos["Title"],
        fontSize=16, textColor=colors.HexColor(_NEGRO_INSTITUCIONAL), spaceAfter=4,
    )
    estilo_meta = ParagraphStyle(
        "MetaReporte", parent=estilos["Normal"],
        fontSize=9, textColor=colors.grey, spaceAfter=12,
    )
    estilo_vacio = ParagraphStyle(
        "SinResultados", parent=estilos["Normal"],
        fontSize=12, textColor=colors.HexColor(_NEGRO_INSTITUCIONAL),
        alignment=TA_CENTER, spaceBefore=40,
    )

    fecha_generacion = datetime.now().strftime("%d/%m/%Y %H:%M")
    meta_texto = f"Generado el {fecha_generacion}"
    if generado_por:
        meta_texto += f" por {generado_por}"

    elementos: list = [
        Paragraph(titulo, estilo_titulo),
        Paragraph(meta_texto, estilo_meta),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor(_ROJO_INSTITUCIONAL)),
        Spacer(1, 10),
    ]

    if not filas:
        elementos.append(Paragraph(
            "No hay resultados para los filtros seleccionados.", estilo_vacio,
        ))
    else:
        bloques = [
            filas[i:i + _FILAS_POR_PAGINA]
            for i in range(0, len(filas), _FILAS_POR_PAGINA)
        ]
        for indice, bloque in enumerate(bloques):
            datos_tabla = [columnas] + bloque
            tabla = Table(datos_tabla, hAlign="LEFT", repeatRows=1)
            tabla.setStyle(_estilo_tabla_reporte())
            elementos.append(tabla)
            if indice < len(bloques) - 1:
                elementos.append(PageBreak())

    doc.build(
        elementos,
        onFirstPage=_dibujar_encabezado_pagina,
        onLaterPages=_dibujar_encabezado_pagina,
    )
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
