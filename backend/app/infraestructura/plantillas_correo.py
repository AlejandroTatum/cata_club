"""
Layout compartido de marca para los correos transaccionales (issue #1375):
recuperación de contraseña, bienvenida con verificación de correo, pago
aprobado y pago rechazado.

Una sola función, `construir_correo`, recibe el contenido ya redactado y
devuelve la pareja `(texto, html)`. El HTML es la maquetación de email que
los clientes respetan de verdad: tablas con `role="presentation"`, CSS
inline, ancho máximo de 600 px y `lang="es"`. Sin dependencias: solo
stdlib, igual que `asuntos_correo.py`.

El diseño (ronda 2, por el feedback del usuario: "no se ve el logo y el
formato muy plano") usa la paleta de la landing
(`frontend/src/app/landing/landing.css`): rojo `#d92128`, amarillo
`#ffd600`, negro `#111111` y gris claro `#f9fafb`, con neutros derivados
para texto secundario y bordes. Cabecera oscura con el escudo y línea fina
amarilla; tarjeta blanca con esquinas redondeadas; título con barra de
acento roja; tipografía de 16 px con interlineado 1,5; los detalles del
evento (plan, período, motivo, ...) en una caja gris con columnas
etiqueta/valor; chip de estado verde/rojo para pagos; botón primario
blindado con el enlace crudo de respaldo debajo; pie gris que nombra al
club y dice por qué llega el correo.

Dos reglas duras del diseño:

- **Nada de datos sin escapar.** Todo el contenido dinámico (saludo,
  párrafos, filas, chip, etiqueta del botón y URLs) pasa por `html.escape`
  en la parte HTML: un nombre o un motivo con `<`, `>` o `&` no puede
  romper ni inyectar en el mensaje. El texto plano NO escapa: ahí el dato
  viaja tal cual lo escribió el club.

- **Sin regiones vacías.** Los bloques opcionales (chip, CTA, filas de
  detalle) no se emiten si no viajan, y el escudo va acompañado siempre
  del wordmark en texto: si el cliente bloquea imágenes, la cabecera
  sigue mostrando "Cata Club" en vez de un hueco.

El escudo viaja DENTRO del mensaje: el backend adjunta el PNG como parte
`image/png` con `Content-ID` dentro de `multipart/related` (que cuelga del
`multipart/alternative` junto a la parte de texto) y el HTML lo referencia
como `src="cid:..."`. La primera versión salía por URL absoluta contra
`FRONTEND_URL` y el feedback del usuario fue tajante (issue #1375): "no se
ve el logo" -- muchos clientes bloquean imágenes remotas y el host puede no
ser público. Un adjunto inline viaja dentro del propio mensaje: se ve en
cualquier cliente sin red externa. Qué controla el AVATAR del buzón --
BIMI, perfil del remitente, no el cuerpo del mensaje -- está documentado en
`docs/operations/entrega-de-correo.md`; la configuración del proveedor
pertenece al repositorio `cata_club-docs`.
"""
from html import escape as escapar_html
from importlib import resources
from typing import Optional, Sequence

# El escudo es el asset de marca "light" del frontend (calado blanco, el que
# la landing usa sobre fondos oscuros), copiado al paquete de backend: el
# contenedor del backend no comparte archivos con el frontend, así que la
# única fuente confiable en runtime es el propio paquete
# (`app.infraestructura.recursos`). 256×256 y ~25 KB: se muestra a 64 px
# (retina 4x) sin redimensionado ni dependencia nueva.
_RECURSO_ESCUDO = "recursos/cata-club-crest.png"
ID_CONTENIDO_ESCUDO = "escudo-cata-club"
ALT_ESCUDO = "Cata Club"

# Texto de firma, compartido por las cinco superficies (es la misma frase
# que ya cerraba cada correo antes del layout de marca).
FIRMA_TEXTO = "Saludos,\nEquipo Cata Club"
FIRMA_HTML = "Saludos,<br>Equipo Cata Club"

# Paleta de la landing (ver la nota del docstring del módulo).
_NEGRO = "#111111"
_ROJO = "#d92128"
_AMARILLO = "#ffd600"
_LIENZO = "#f9fafb"
_TEXTO = "#374151"
_TINTA_2 = "#6b7280"
_BORDE = "#e5e7eb"
_BLANCO = "#FFFFFF"
# Chip de estado: (fondo, borde, tinta) para aprobado y rechazado.
_CHIP_EXITO = ("#e7f6ec", "#bfe3cc", "#1a7f37")
_CHIP_ERROR = ("#fdecec", "#f5c2c2", "#b42318")

_FUENTE = "font-family:Arial,Helvetica,sans-serif;"
_CELDA_BASE = "padding:0;"


def bytes_del_escudo() -> bytes:
    """Bytes del PNG del escudo, embebido en el paquete de backend."""
    return (resources.files("app.infraestructura") / _RECURSO_ESCUDO).read_bytes()


def _etiqueta(texto: str, etiqueta_html: str = "p", estilo: str = "") -> str:
    atributo = f' style="{estilo}"' if estilo else ""
    return f"<{etiqueta_html}{atributo}>{escapar_html(texto)}</{etiqueta_html}>"


def _cabecera_de_marca() -> str:
    """Banda negra con el escudo a 64 px y el wordmark, cerrada por la línea
    fina amarilla. Sin imágenes quedan el alt y el wordmark: la marca sigue
    leyéndose (regla de no-regiones-vacías)."""
    return (
        "<tr>"
        f'<td style="{_CELDA_BASE}padding:28px 40px;background-color:{_NEGRO};">'
        '<table role="presentation" cellpadding="0" cellspacing="0" '
        f'style="{_CELDA_BASE}"><tr>'
        '<td style="padding:0 16px 0 0;">'
        f'<img src="cid:{ID_CONTENIDO_ESCUDO}" alt="{ALT_ESCUDO}" '
        'width="64" height="64" style="display:block;border:0;border-radius:8px;">'
        "</td>"
        f'<td style="{_CELDA_BASE}{_FUENTE}font-size:26px;font-weight:bold;'
        f'letter-spacing:0.5px;color:{_BLANCO};">Cata Club</td>'
        "</tr></table>"
        "</td>"
        "</tr>"
        "<tr>"
        f'<td style="{_CELDA_BASE}background-color:{_AMARILLO};height:4px;'
        'line-height:4px;font-size:0;">&nbsp;</td>'
        "</tr>"
    )


def _titulo_con_barra(titulo: str) -> str:
    """Título del correo con su barra de acento roja a la izquierda."""
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" '
        f'style="{_CELDA_BASE}margin:0 0 20px;"><tr>'
        f'<td style="padding:2px 0 2px 16px;border-left:4px solid {_ROJO};">'
        f'<h1 style="margin:0;{_FUENTE}font-size:24px;line-height:1.3;'
        f'color:{_NEGRO};">{escapar_html(titulo)}</h1>'
        "</td>"
        "</tr></table>"
    )


def _chip_de_estado(chip: tuple[str, str]) -> str:
    """Chip de estado (aprobado/rechazado) como pastilla con fondo y borde."""
    texto, tipo = chip
    fondo, borde, tinta = _CHIP_EXITO if tipo == "exito" else _CHIP_ERROR
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" '
        f'style="{_CELDA_BASE}margin:0 0 20px;"><tr>'
        f'<td style="background-color:{fondo};border:1px solid {borde};'
        f'border-radius:14px;padding:6px 14px;{_FUENTE}font-size:13px;'
        f'font-weight:bold;color:{tinta};">{escapar_html(texto)}</td>'
        "</tr></table>"
    )


def _caja_de_filas(filas: Sequence[tuple[str, str]]) -> str:
    """Detalle del evento en una caja gris con columnas etiqueta/valor."""
    celdas = "".join(
        "<tr>"
        '<td style="padding:10px 16px;'
        + (f'border-top:1px solid {_BORDE};' if indice else "")
        + f'{_FUENTE}font-size:14px;'
        f'color:{_TINTA_2};width:38%;vertical-align:top;">{escapar_html(etiqueta)}</td>'
        '<td style="padding:10px 16px;'
        + (f'border-top:1px solid {_BORDE};' if indice else "")
        + f'{_FUENTE}font-size:14px;font-weight:bold;'
        f'color:{_NEGRO};vertical-align:top;">{escapar_html(valor)}</td>'
        "</tr>"
        for indice, (etiqueta, valor) in enumerate(filas)
    )
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" '
        f'style="{_CELDA_BASE}width:100%;margin:4px 0 24px;'
        f'background-color:{_LIENZO};border:1px solid {_BORDE};'
        f'border-radius:8px;">{celdas}</table>'
    )


def _boton_con_enlace_crudo(etiqueta: str, url: str) -> str:
    """Botón primario blindado (fondo rojo en la CELDA, no solo en el `<a>`)
    con el enlace crudo debajo para clientes que quiten el botón."""
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" '
        f'style="{_CELDA_BASE}margin:4px 0 0;"><tr>'
        f'<td style="background-color:{_ROJO};border-radius:8px;" align="center">'
        f'<a href="{escapar_html(url)}" style="display:inline-block;'
        f'padding:13px 28px;{_FUENTE}font-size:16px;font-weight:bold;'
        f'color:{_BLANCO};text-decoration:none;border-radius:8px;">'
        f"{escapar_html(etiqueta)}</a>"
        "</td>"
        "</tr></table>"
        f'<p style="margin:14px 0 0;{_FUENTE}font-size:13px;line-height:1.5;'
        f'color:{_TINTA_2};word-break:break-all;">'
        f'Si el botón no funciona, copie este enlace: '
        f'<a href="{escapar_html(url)}" style="color:{_ROJO};">'
        f"{escapar_html(url)}</a></p>"
    )


def _pie() -> str:
    """Pie gris: el club y la razón del correo, en texto chico y apagado."""
    return (
        "<tr>"
        f'<td style="{_CELDA_BASE}padding:20px 40px;background-color:{_LIENZO};'
        f'border-top:1px solid {_BORDE};">'
        f'<p style="margin:0 0 6px;{_FUENTE}font-size:13px;font-weight:bold;'
        f'color:{_NEGRO};">Cata Club</p>'
        f'<p style="margin:0;{_FUENTE}font-size:12px;line-height:1.5;'
        f'color:{_TINTA_2};">'
        "Este es un mensaje automático de Cata Club: se envía por una gestión "
        "de su cuenta (verificación de correo, inscripción o pago). Si no lo "
        "esperaba, puede ignorarlo.</p>"
        "</td>"
        "</tr>"
    )


def construir_correo(
    *,
    titulo: str,
    preheader: str,
    saludo: str,
    parrafos: Sequence[str],
    cta_etiqueta: Optional[str] = None,
    cta_url: Optional[str] = None,
    filas: Optional[Sequence[tuple[str, str]]] = None,
    chip: Optional[tuple[str, str]] = None,
) -> tuple[str, str]:
    """Arma `(texto, html)` para un correo transaccional de marca.

    `parrafos` es la historia del correo, ya redactada; `filas` suma pares
    etiqueta/valor de detalle (plan, vigencia, ...); `chip` es la pastilla
    de estado `(texto, tipo)` con tipo "exito" o "error"; y `cta_etiqueta` +
    `cta_url` activan el botón de acción. Todo dato dinámico viaja escapado
    en el HTML; el texto plano se deriva de la misma entrada sin escapar.

    El escudo no viaja en el HTML devuelto: el HTML lo REFERENCIA por
    `cid:` y es el servicio de envío (`notificaciones_servicio`) quien
    adjunta los bytes (`bytes_del_escudo`) como parte inline con el
    `Content-ID` correspondiente.
    """
    # --- Parte de texto plano, derivada de la misma entrada -------------
    lineas_texto = [titulo, "", saludo, ""]
    lineas_texto.extend(parrafo for parrafo in parrafos)
    if filas:
        lineas_texto.append("")
        lineas_texto.extend(f"{etiqueta}: {valor}" for etiqueta, valor in filas)
    if chip:
        lineas_texto.append(f"[{chip[0]}]")
    if cta_etiqueta and cta_url:
        lineas_texto.extend(["", f"{cta_etiqueta}: {cta_url}"])
    lineas_texto.extend(["", "--", "", FIRMA_TEXTO])
    texto = "\n".join(lineas_texto)

    # --- Parte HTML: tablas de maquetación con CSS inline ---------------
    parrafos_html = "".join(
        _etiqueta(
            parrafo, "p",
            f"margin:0 0 16px;{_FUENTE}font-size:16px;"
            f"line-height:1.5;color:{_TEXTO};",
        )
        for parrafo in parrafos
    )
    cta_html = (
        _boton_con_enlace_crudo(cta_etiqueta, cta_url)
        if cta_etiqueta and cta_url
        else ""
    )
    filas_html = _caja_de_filas(filas) if filas else ""
    chip_html = _chip_de_estado(chip) if chip else ""

    cuerpo = (
        "<tr>"
        f'<td style="{_CELDA_BASE}padding:32px 40px;background-color:{_BLANCO};">'
        + _titulo_con_barra(titulo)
        + chip_html
        + _etiqueta(
            saludo, "p",
            f"margin:0 0 16px;{_FUENTE}font-size:16px;font-weight:bold;"
            f"line-height:1.5;color:{_NEGRO};",
        )
        + parrafos_html
        + filas_html
        + cta_html
        + _etiqueta(
            FIRMA_TEXTO.replace("\n", " "), "p",
            f"margin:24px 0 0;{_FUENTE}font-size:16px;line-height:1.5;"
            f"color:{_TEXTO};",
        )
        + "</td>"
        "</tr>"
    )

    html = (
        '<!DOCTYPE html>\n<html lang="es">\n'
        '<head><meta charset="utf-8"><meta name="viewport" '
        'content="width=device-width,initial-scale=1"></head>\n'
        f'<body style="margin:0;padding:0;background-color:{_LIENZO};">\n'
        # Preheader oculto: el resumen que muestran los listados de bandeja.
        f'<div style="display:none;max-height:0;overflow:hidden;">{escapar_html(preheader)}</div>\n'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        f'style="{_CELDA_BASE}background-color:{_LIENZO};padding:24px 12px;">'
        '<tr><td align="center">\n'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        f'style="{_CELDA_BASE}width:100%;max-width:600px;background-color:{_BLANCO};'
        f'border:1px solid {_BORDE};border-radius:12px;overflow:hidden;">\n'
        + _cabecera_de_marca()
        + "\n"
        + cuerpo
        + "\n"
        + _pie()
        + "\n</table>\n</td></tr></table>\n</body>\n</html>"
    )

    return texto, html
