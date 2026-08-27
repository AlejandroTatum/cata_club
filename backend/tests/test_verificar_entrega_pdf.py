"""
Tests del smoke check de entrega de PDF por Cloudinary.

El script corre DENTRO del contenedor backend
(`docker compose exec backend uv run python scripts/verificar_entrega_pdf.py`,
`make qa-pdf-delivery-check`) y es el ÚNICO chequeo del repo que descarga de
verdad la URL de entrega. Estos tests NO tocan la red ni la cuenta real: le
inyectan las dependencias al script para probar su lógica de decisión, que es
lo que decide si un despliegue corta o sigue.

Lo que se prueba acá:

  - un `200` con bytes de PDF es el único caso que sale con éxito;
  - el `401` de la cuenta que deniega PDF por CDN (el fallo que motivó el
    fix) y el `404` del `public_id` sin carpeta (issue #480) salen con código
    de fallo, no en silencio;
  - un `200` que no trae bytes de PDF tampoco pasa;
  - el recurso desechable se borra SIEMPRE, también cuando la entrega falla;
  - nada de lo que imprime contiene la URL firmada (lleva la `api_key`) ni el
    `api_secret`.

Mismo montaje `importlib` que `test_verificar_chatbot.py`: el script vive
fuera del paquete `app`, y así se ejercita el archivo real que corre en
producción, no una copia.
"""
import importlib.util
from pathlib import Path

import pytest

from app.soporte_transversal.configuracion import settings

SCRIPT = Path(__file__).parents[1] / "scripts" / "verificar_entrega_pdf.py"

PDF_DEVUELTO = b"%PDF-1.4\nreal\n%%EOF\n"


def _cargar_modulo():
    spec = importlib.util.spec_from_file_location("verificar_entrega_pdf", SCRIPT)
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modulo)
    return modulo


class _CloudinaryFalso:
    """Doble de la cuenta: registra qué se subió, qué se borró y responde la
    descarga con lo que el test quiera."""

    def __init__(self, respuesta):
        self.respuesta = respuesta
        self.subidos: list[str] = []
        self.borrados: list[str] = []
        self.urls_generadas: list[str] = []

    def subir(self, contenido, nombre_publico, sobreescribir=False):
        assert contenido.startswith(b"%PDF-"), "el chequeo debe subir un PDF real"
        self.subidos.append(nombre_publico)
        return "https://api.cloudinary.test/no-usar"

    def resolver(self, public_id, *, resource_type, folder, formato=None, version=None):
        assert resource_type == "raw", "un comprobante oficial es siempre raw"
        assert formato == "pdf"
        assert folder == settings.cloudinary_carpeta_comprobantes
        url = (
            f"https://api.cloudinary.com/v1_1/cuenta/raw/download"
            f"?public_id={folder}/{public_id}.pdf&api_key=123456789012345"
            f"&signature=firma-de-prueba"
        )
        self.urls_generadas.append(url)
        return url

    def descargar(self, url):
        assert url in self.urls_generadas
        return self.respuesta

    def borrar(self, public_id_completo):
        self.borrados.append(public_id_completo)


def _correr(argv, respuesta, *, hay_credenciales=True):
    """Corre `main` con la cuenta falsa inyectada y devuelve
    `(codigo_de_salida, texto_impreso, cuenta_falsa)`."""
    modulo = _cargar_modulo()
    cuenta = _CloudinaryFalso(respuesta)
    salida: list[str] = []

    def verificar(*, escribir):
        modulo.verificar_entrega(
            subir=cuenta.subir,
            resolver=cuenta.resolver,
            descargar_url=cuenta.descargar,
            borrar=cuenta.borrar,
            escribir=escribir,
        )

    codigo = modulo.main(
        argv,
        verificar=verificar,
        credenciales=lambda: hay_credenciales,
        escribir=salida.append,
    )
    return codigo, "\n".join(salida), cuenta


# ─── El único caso que pasa: 200 con bytes de PDF ──────────────────────────

def test_una_entrega_que_devuelve_el_pdf_sale_con_exito():
    codigo, texto, cuenta = _correr([], (200, PDF_DEVUELTO, ""))

    assert codigo == 0
    assert "HTTP 200" in texto
    assert cuenta.subidos, "el chequeo tiene que subir algo para poder descargarlo"


# ─── Los fallos reales que este chequeo existe para agarrar ────────────────

def test_el_401_de_pdf_denegado_por_la_cdn_falla():
    """El defecto que motivó el fix: la CDN de la cuenta deniega todo PDF y
    responde 401 con el cuerpo vacío. El backend nunca se enteraba porque
    firmar la URL no toca la red."""
    codigo, texto, cuenta = _correr([], (401, b"", "deny or ACL failure"))

    assert codigo == 1
    assert "HTTP 401" in texto
    assert "deny or ACL failure" in texto
    assert cuenta.borrados, "el recurso de prueba se borra aunque la entrega falle"


def test_el_404_del_public_id_sin_carpeta_falla():
    """Issue #480: firma válida sobre un `public_id` que Cloudinary nunca tuvo
    bajo ese nombre. Misma clase de punto ciego, mismo chequeo."""
    codigo, texto, _ = _correr([], (404, b'{"error":{"message":"Resource not found"}}', ""))

    assert codigo == 1
    assert "HTTP 404" in texto


def test_un_200_que_no_trae_un_pdf_falla():
    """Un `200` no alcanza: Cloudinary podría devolver un JSON de error o un
    GIF de 1x1 con estado 200 y el chequeo lo daría por bueno."""
    codigo, texto, _ = _correr([], (200, b"GIF89a", ""))

    assert codigo == 1
    assert "sin bytes de PDF" in texto


def test_una_url_de_entrega_vacia_falla():
    """`resolver_url_entrega` degrada a `None` sin credenciales de firma; si
    eso pasara con credenciales presentes, es un fallo, no un éxito."""
    modulo = _cargar_modulo()
    borrados: list[str] = []

    with pytest.raises(modulo.EntregaRota):
        modulo.verificar_entrega(
            subir=lambda *a, **k: None,
            resolver=lambda *a, **k: None,
            descargar_url=lambda url: (200, PDF_DEVUELTO, ""),
            borrar=borrados.append,
            escribir=lambda _: None,
        )

    assert borrados, "también se limpia cuando no hubo URL que descargar"


def test_un_fallo_al_borrar_no_tapa_el_resultado_de_la_entrega():
    """La limpieza es higiene, no el veredicto: si borrar falla, el chequeo
    sigue reportando lo que pasó con la entrega."""
    modulo = _cargar_modulo()
    salida: list[str] = []

    def borrar_roto(_):
        raise RuntimeError("Cloudinary rechazó el destroy")

    modulo.verificar_entrega(
        subir=lambda *a, **k: None,
        resolver=lambda *a, **k: "https://api.cloudinary.com/v1_1/c/raw/download?x=1",
        descargar_url=lambda url: (200, PDF_DEVUELTO, ""),
        borrar=borrar_roto,
        escribir=salida.append,
    )

    assert any("no se pudo borrar" in linea for linea in salida)


# ─── Cloudinary opcional por diseño ────────────────────────────────────────

def test_sin_credenciales_no_falla_salvo_que_se_exija():
    codigo, texto, cuenta = _correr([], (200, PDF_DEVUELTO, ""), hay_credenciales=False)

    assert codigo == 0
    assert not cuenta.subidos, "sin credenciales no se sube nada a ninguna cuenta"

    codigo_exigido, _, _ = _correr(["--exigir"], (200, PDF_DEVUELTO, ""), hay_credenciales=False)

    assert codigo_exigido == 2


# ─── Nada de lo que imprime es un secreto ──────────────────────────────────

def test_no_imprime_la_url_firmada_ni_el_api_secret():
    """La URL de descarga lleva la `api_key` y es un link vivo durante la
    vigencia configurada: no va a un log de despliegue."""
    codigo, texto, cuenta = _correr([], (200, PDF_DEVUELTO, ""))

    assert codigo == 0
    for url in cuenta.urls_generadas:
        assert url not in texto
    assert "signature=" not in texto
    assert "api_key=" not in texto
    assert settings.cloudinary_api_secret
    assert settings.cloudinary_api_secret not in texto
