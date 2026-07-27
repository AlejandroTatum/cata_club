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
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable,
)

from app.soporte_transversal.tiempo import ahora_club

_LOGO_PATH = Path(__file__).parent / "assets" / "cata-club-logo.jpeg"
_ROJO_INSTITUCIONAL = "#D92128"
_NEGRO_INSTITUCIONAL = "#111111"
_NOMBRE_CLUB = "Cata Club - Academia de Tenis"

FORMATO_SELLO_COMPROBANTE = "%d/%m/%Y %H:%M:%S"
FORMATO_SELLO_REPORTE = "%d/%m/%Y %H:%M"


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
        author=_NOMBRE_CLUB,
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
        Paragraph(_NOMBRE_CLUB, titulo),
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
        f"{sello_de_tiempo(FORMATO_SELLO_COMPROBANTE)}."
        f" Valor sin firma física tiene plena validez interna.",
        ParagraphStyle("Pie", parent=cuerpo, fontSize=8, textColor=colors.grey),
    ))

    doc.build(elementos)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


def _construir_estilo_tabla(
    *,
    color_encabezado: str,
    tamano_fuente: int,
    color_filas_alternas: str,
    relleno: int,
) -> TableStyle:
    """Builder compartido de `TableStyle` para las tablas de comprobante y
    reporte: mismas reglas base (encabezado en negrita, grid gris, filas
    alternadas), parametrizadas por color/tamaño/relleno para que cada tabla
    conserve su identidad visual propia sin duplicar la lista de reglas."""
    return TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(color_encabezado)),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), tamano_fuente),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#BBBBBB")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.HexColor(color_filas_alternas)]),
        ("LEFTPADDING", (0, 0), (-1, -1), relleno),
        ("RIGHTPADDING", (0, 0), (-1, -1), relleno),
        ("TOPPADDING", (0, 0), (-1, -1), relleno - 1),
        ("BOTTOMPADDING", (0, 0), (-1, -1), relleno - 1),
    ])


def _estilo_tabla() -> TableStyle:
    """Devuelve los estilos de la tabla de detalle (TableStyle)."""
    return _construir_estilo_tabla(
        color_encabezado="#0B3D91",
        tamano_fuente=10,
        color_filas_alternas="#F3F6FF",
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
        topMargin=30 * mm,
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
        datos_tabla = [columnas] + filas
        tabla = Table(datos_tabla, hAlign="LEFT", repeatRows=1)
        tabla.setStyle(_estilo_tabla_reporte())
        elementos.append(tabla)

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
        color_encabezado=_ROJO_INSTITUCIONAL,
        tamano_fuente=9,
        color_filas_alternas="#F3F0F0",
        relleno=5,
    )


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
