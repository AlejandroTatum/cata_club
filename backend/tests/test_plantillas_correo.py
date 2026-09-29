"""
Layout compartido de marca para los correos transaccionales (issue #1375).

Los cinco correos transaccionales (recuperación, verificación, pago
aprobado, pago rechazado y bienvenida) comparten a partir de acá UNA sola
maquetación: tablas con CSS inline (lo único que los clientes de correo
respetan de forma consistente), ancho máximo de 600 px, `lang="es"`,
`role="presentation"` en las tablas de estructura y TODO dato dinámico
escapado con `html.escape`. Sin celdas vacías de relleno: si un bloque
opcional (CTA, filas de detalle) no viaja, no se emite.

Los tests son de módulo puro: sin SMTP, sin base, sin `settings`. El texto
plano y el HTML se derivan de la MISMA entrada; lo que acá se fija es el
contrato de forma (marca, accesibilidad, escape) que los tests de SMTP de
`test_correo_plantillas.py` después corroboran punta a punta.
"""
from app.infraestructura.plantillas_correo import (
    ALT_ESCUDO,
    ID_CONTENIDO_ESCUDO,
    bytes_del_escudo,
    construir_correo,
)

FRONTEND = "https://app.cataclub.test"

ENTRADA = {
    "titulo": "Pago aprobado",
    "preheader": "Tu pago quedó registrado y tu membresía sigue activa.",
    "saludo": "Hola Ana,",
    "parrafos": ["Su pago del plan Adultos fue aprobado.", "Gracias por seguir con nosotros."],
}


# --- Contrato general: texto y HTML salen de la misma entrada ---------------

def test_devuelve_texto_y_html_con_el_mismo_contenido():
    texto, html = construir_correo(**ENTRADA)

    assert texto.startswith("Pago aprobado")
    assert "Hola Ana," in texto
    assert "Su pago del plan Adultos fue aprobado." in texto
    assert "Gracias por seguir con nosotros." in texto
    assert "Saludos," in texto and "Equipo Cata Club" in texto
    # En HTML vive la misma historia, más la marca.
    assert "Su pago del plan Adultos fue aprobado." in html
    assert "Hola Ana," in html
    assert "Equipo Cata Club" in html


def test_el_html_declara_idioma_y_estructura_presentacional():
    """Accesibilidad: `lang="es"` en la raíz y `role="presentation"` en las
    tablas de maquetación (los lectores de pantalla no las leen como datos)."""
    _, html = construir_correo(**ENTRADA)

    assert '<html lang="es">' in html
    assert html.count('role="presentation"') >= 2


def test_el_html_respeta_un_ancho_maximo_de_600px():
    _, html = construir_correo(**ENTRADA)

    assert "600" in html


# --- Marca: escudo embebido (cid:), texto alternativo y marca en texto -----

def test_los_bytes_del_escudo_viajan_embebidos_en_el_paquete():
    """El PNG vive DENTRO del paquete de backend (no entre los assets del
    frontend): el contenedor del backend no comparte archivos con el
    frontend, y una URL remota la bloquean muchos clientes de correo."""
    datos = bytes_del_escudo()

    assert datos.startswith(b"\x89PNG\r\n\x1a\n")
    assert 0 < len(datos) <= 40 * 1024  # presupuesto: adjunto chico (~25 KB)


def test_el_escudo_se_referencia_como_cid_con_alt_de_marca():
    """El HTML no apunta a ninguna URL remota: referencia el adjunto inline
    por `cid:`. Si el cliente bloquea imágenes, el alt + la marca en texto
    llenan la cabecera: no queda una región vacía."""
    _, html = construir_correo(**ENTRADA)

    assert f'src="cid:{ID_CONTENIDO_ESCUDO}"' in html
    assert f'alt="{ALT_ESCUDO}"' in html
    assert "/brand/" not in html  # ninguna referencia remota al asset
    assert "Cata Club" in html


def test_el_preheader_viaja_oculto_en_el_html():
    _, html = construir_correo(**ENTRADA)

    assert ENTRADA["preheader"] in html
    assert "display:none" in html or "display: none" in html


# --- Escape: ningún dato dinámico puede inyectar HTML ------------------------

def test_los_datos_del_usuario_viajan_escapados_en_el_html():
    entrada = {
        **ENTRADA,
        "saludo": "Hola <b>Ana</b> & Cía,",
        "parrafos": ["Motivo: <script>alert(1)</script> revisión & reintento."],
        "titulo": "Pago & <reintegro>",
    }
    _, html = construir_correo(**entrada)

    assert "<script>" not in html
    assert "<b>Ana</b>" not in html
    assert "Hola &lt;b&gt;Ana&lt;/b&gt; &amp; Cía," in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "Pago &amp; &lt;reintegro&gt;" in html
    # El texto plano NO escapa: lo que ve el usuario es el dato real.
    texto, _ = construir_correo(**entrada)
    assert "Motivo: <script>alert(1)</script> revisión & reintento." in texto


def test_la_url_del_cta_viaja_escapada_como_atributo():
    entrada = {**ENTRADA, "cta_etiqueta": "Verificar", "cta_url": "https://x.test/?a=1&b=2"}
    _, html = construir_correo(**entrada)

    assert 'href="https://x.test/?a=1&amp;b=2"' in html


# --- CTA: presente con etiqueta y URL, ausente (sin bloque vacío) si no ------

def test_el_cta_aparece_en_texto_y_html_cuando_hay_etiqueta_y_url():
    entrada = {**ENTRADA, "cta_etiqueta": "Verificar mi correo", "cta_url": f"{FRONTEND}/v?t=abc"}
    texto, html = construir_correo(**entrada)

    assert "Verificar mi correo" in texto
    assert f"{FRONTEND}/v?t=abc" in texto
    assert "Verificar mi correo" in html
    assert f'href="{FRONTEND}/v?t=abc"' in html


def test_sin_cta_no_queda_un_bloque_vacio():
    """Sin etiqueta+url no se emite el bloque del botón: nada de una celda
    muerta que un cliente pinte como espacio vacío."""
    _, html = construir_correo(**ENTRADA)

    assert 'role="presentation"' in html  # el resto del layout sigue
    assert "Verificar" not in html


# --- Filas de detalle: etiqueta/valor en ambas partes ------------------------

def test_las_filas_de_detalle_aparecen_en_texto_y_html():
    entrada = {
        **ENTRADA,
        "filas": [("Plan", "Adultos"), ("Vigencia", "31/08/2026")],
    }
    texto, html = construir_correo(**entrada)

    assert "Plan: Adultos" in texto
    assert "Vigencia: 31/08/2026" in texto
    assert "Plan" in html and "Adultos" in html
    assert "Vigencia" in html and "31/08/2026" in html


def test_el_valor_de_las_filas_viaja_escapado():
    entrada = {**ENTRADA, "filas": [("Alumno", "Nico <Torres>")]}
    _, html = construir_correo(**entrada)

    assert "Nico &lt;Torres&gt;" in html


# --- Layout v2 (feedback #1375: "el formato muy plano") ----------------------
# Paleta de la landing (frontend/src/app/landing/landing.css): rojo #d92128,
# amarillo #ffd600, negro #111111, gris claro #f9fafb.

def test_la_cabecera_es_banda_oscura_con_linea_amarilla_de_acento():
    _, html = construir_correo(**ENTRADA)

    assert "background-color:#111111" in html  # banda de cabecera
    assert "background-color:#ffd600" in html  # línea fina de acento


def test_el_titulo_lleva_barra_de_acento_roja():
    _, html = construir_correo(**ENTRADA)

    assert "border-left:4px solid #d92128" in html


def test_el_cuerpo_usa_tipografia_de_16px_con_interlineado_1_5():
    _, html = construir_correo(**ENTRADA)

    assert "font-size:16px" in html
    assert "line-height:1.5" in html


def test_las_filas_de_detalle_van_en_una_caja_resaltada():
    """Énfasis de los datos del evento: caja gris claro con borde y columnas
    etiqueta/valor, no filas sueltas a lo largo del texto."""
    entrada = {**ENTRADA, "filas": [("Plan", "Adultos"), ("Vigencia", "31/08/2026")]}
    _, html = construir_correo(**entrada)

    assert "background-color:#f9fafb;border:1px solid #e5e7eb" in html
    assert "Plan" in html and "Adultos" in html
    assert "Vigencia" in html and "31/08/2026" in html


def test_el_chip_de_estado_aparece_solo_cuando_viaja():
    """Chip de estado para pagos: verde para aprobado, rojo para rechazado.
    Sin chip no hay bloque residual."""
    _, html = construir_correo(**ENTRADA)
    assert "Aprobado" not in html

    _, html = construir_correo(**{**ENTRADA, "chip": ("Aprobado", "exito")})
    assert "Aprobado" in html
    assert "background-color:#e7f6ec" in html

    _, html = construir_correo(**{**ENTRADA, "chip": ("Rechazado", "error")})
    assert "Rechazado" in html
    assert "background-color:#fdecec" in html


def test_el_cta_es_boton_bala_con_enlace_crudo_de_respaldo():
    """Botón blindado (fondo rojo en la celda, no solo en el <a>) + el enlace
    crudo debajo para los clientes que desenmarañan o quitan botones."""
    entrada = {**ENTRADA, "cta_etiqueta": "Verificar", "cta_url": "https://x.test/v"}
    _, html = construir_correo(**entrada)

    assert "background-color:#d92128" in html
    assert html.count("https://x.test/v") >= 2  # href del botón + enlace visible


def test_el_pie_declara_al_club_y_la_razon_del_mensaje():
    _, html = construir_correo(**ENTRADA)

    assert "mensaje automático" in html
    assert "Equipo Cata Club" in html  # la firma cierra el cuerpo; el pie nombra al club
