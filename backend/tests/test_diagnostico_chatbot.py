"""
Tests del diagnóstico NO SENSIBLE del proveedor del chatbot (issue #645).

El diagnóstico existe para que un operador pueda responder tres preguntas
distintas sin ver nunca el secreto:

  - ¿la clave está AUSENTE? (el chatbot queda en su FAQ local, es válido)
  - ¿está INCOMPLETA? (hay algo, pero no puede ser una credencial: siempre
    es un error del operador, nunca una decisión)
  - ¿está CONFIGURADA? y, tras una rotación, ¿es OTRA clave que la de antes?

La clave usada acá es falsa a propósito y no tiene ninguna corrida de 8
caracteres que pueda ser hexadecimal, para que las aserciones de no-filtrado
contra la huella (hex) no puedan pasar por coincidencia.
"""
import string

import pytest

from app.soporte_transversal.diagnostico_chatbot import (
    EstadoProveedor,
    diagnosticar,
    huella_no_reversible,
)

CLAVE_FALSA = "clave-inventada-solo-para-tests-qwx9v8u7t6"
OTRA_CLAVE_FALSA = "clave-inventada-tras-rotar-en-tests-t6u7v8"


def _fragmentos(clave: str, largo: int = 8) -> list[str]:
    return [clave[i : i + largo] for i in range(len(clave) - largo + 1)]


# ─── Ausente: vacío es una configuración esperada, no un error ──────────────


@pytest.mark.parametrize("valor", [None, "", "   ", "\t\n"])
def test_una_clave_vacia_o_ausente_se_reporta_como_ausente(valor):
    diagnostico = diagnosticar(valor)

    assert diagnostico.estado is EstadoProveedor.AUSENTE
    assert diagnostico.huella == ""


def test_ausente_no_es_un_fallo_porque_el_chatbot_conserva_su_faq_local():
    assert diagnosticar("").es_utilizable is False
    assert diagnosticar("").es_un_error_de_configuracion is False


# ─── Incompleta: hay algo, pero no puede ser una credencial ────────────────


@pytest.mark.parametrize(
    "valor",
    [
        "<api-key>",  # el placeholder literal de .env.production.example
        f'"{CLAVE_FALSA}"',  # comillas que Compose NO saca al interpolar
        f"'{CLAVE_FALSA}'",
        f" {CLAVE_FALSA}",  # espacio de sobra al pegar
        f"{CLAVE_FALSA} ",
        f"{CLAVE_FALSA} # comentario",  # comentario pegado en el .env
    ],
)
def test_un_valor_que_no_puede_ser_una_credencial_se_reporta_como_incompleto(valor):
    diagnostico = diagnosticar(valor)

    assert diagnostico.estado is EstadoProveedor.INCOMPLETA
    assert diagnostico.es_un_error_de_configuracion is True
    assert diagnostico.es_utilizable is False


def test_incompleta_se_distingue_de_ausente_y_no_las_colapsa_en_un_solo_estado():
    assert diagnosticar("<api-key>").estado is not diagnosticar("").estado


# ─── Configurada, y rotación observable ────────────────────────────────────


def test_una_clave_plausible_se_reporta_como_configurada():
    diagnostico = diagnosticar(CLAVE_FALSA)

    assert diagnostico.estado is EstadoProveedor.CONFIGURADA
    assert diagnostico.es_utilizable is True
    assert diagnostico.es_un_error_de_configuracion is False


def test_la_huella_es_hexadecimal_corta_y_estable_para_la_misma_clave():
    huella = diagnosticar(CLAVE_FALSA).huella

    assert len(huella) == 12
    assert set(huella) <= set(string.hexdigits.lower())
    assert huella == diagnosticar(CLAVE_FALSA).huella


def test_rotar_la_clave_cambia_la_huella_y_eso_es_lo_que_prueba_la_rotacion():
    assert diagnosticar(CLAVE_FALSA).huella != diagnosticar(OTRA_CLAVE_FALSA).huella


# ─── No filtrado: lo único que sale es el estado, el motivo y la huella ────


@pytest.mark.parametrize(
    "valor",
    [CLAVE_FALSA, f'"{CLAVE_FALSA}"', f" {CLAVE_FALSA}", "<api-key>", ""],
)
def test_ningun_texto_del_diagnostico_contiene_la_clave_ni_un_fragmento_suyo(valor):
    diagnostico = diagnosticar(valor)
    texto = "\n".join([diagnostico.motivo, diagnostico.huella, *diagnostico.lineas()])

    assert valor.strip() not in texto or not valor.strip()
    for fragmento in _fragmentos(valor.strip()):
        assert fragmento not in texto, (
            "el diagnóstico filtró un fragmento del valor configurado; "
            "no puede materializar el secreto ni en el motivo ni en la huella"
        )


def test_la_huella_no_es_un_prefijo_ni_un_sufijo_de_la_clave():
    huella = diagnosticar(CLAVE_FALSA).huella

    assert not CLAVE_FALSA.startswith(huella)
    assert not CLAVE_FALSA.endswith(huella)
    assert huella not in CLAVE_FALSA


def test_la_huella_de_una_clave_vacia_no_existe_en_vez_de_ser_una_constante():
    """Una huella de `""` sería el mismo hash en todos los despliegues sin
    clave: un valor constante que parece una configuración real. No se emite."""
    assert diagnosticar("").huella == ""
    assert diagnosticar("   ").huella == ""


def test_huella_no_reversible_no_devuelve_ningun_caracter_de_la_entrada():
    resultado = huella_no_reversible(CLAVE_FALSA)

    for fragmento in _fragmentos(CLAVE_FALSA):
        assert fragmento not in resultado


# ─── Lectura desde la configuración de la app ──────────────────────────────


def test_el_diagnostico_de_la_app_lee_la_misma_clave_que_usa_el_chatbot(monkeypatch):
    """El smoke check tiene que mirar EXACTAMENTE el valor que el servicio le
    pasa a `openai.OpenAI(api_key=...)`, no una relectura de `os.environ`:
    `Settings` es un singleton que ya resolvió `.env` y el entorno."""
    from app.soporte_transversal import configuracion
    from app.soporte_transversal.diagnostico_chatbot import diagnosticar_configuracion_actual

    monkeypatch.setattr(configuracion.settings, "opencode_api_key", CLAVE_FALSA)

    assert diagnosticar_configuracion_actual().estado is EstadoProveedor.CONFIGURADA
    assert diagnosticar_configuracion_actual().huella == diagnosticar(CLAVE_FALSA).huella
