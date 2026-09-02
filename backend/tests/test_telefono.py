"""
`es_telefono_valido`: solo Ecuador, sin números extranjeros (PR 4b, issue
#228). Celular = 10 dígitos empezando en 09; fijo = 9 dígitos empezando en
0. Cualquier carácter que no sea dígito se rechaza, nunca se descarta en
silencio.

`normalizar_telefono` (issue #855): un celular autocompletado en formato
internacional (`+593991234567`, `593991234567`) se convierte a la forma
local `09XXXXXXXX` -- `es_telefono_valido` en sí no cambia (sigue
rechazando el prefijo internacional, ver `test_prefijo_internacional_se_
rechaza` arriba), la conversión vive en esta función aparte y la llama
`_validar_telefono` (validadores.py) antes de validar.
"""

import pytest

from app.dominio.telefono import es_telefono_valido, normalizar_telefono, telefonos_coinciden


def test_celular_10_digitos_09_es_valido():
    assert es_telefono_valido("0991234567") is True


def test_fijo_9_digitos_0_es_valido():
    assert es_telefono_valido("022345678") is True


def test_celular_que_no_empieza_en_09_es_invalido():
    assert es_telefono_valido("0891234567") is False


def test_fijo_que_no_empieza_en_0_es_invalido():
    assert es_telefono_valido("122345678") is False


def test_largo_distinto_de_nueve_o_diez_es_invalido():
    assert es_telefono_valido("09912345678") is False  # 11 dígitos
    assert es_telefono_valido("12345") is False


def test_nueve_digitos_que_empiezan_en_09_es_fijo_valido_no_celular_corto():
    # 9 dígitos + prefijo "0" ya alcanza la regla de fijo, aunque el segundo
    # dígito también sea "9" -- el largo, no el prefijo, decide qué regla
    # aplica.
    assert es_telefono_valido("099123456") is True


def test_letras_se_rechazan_no_se_descartan():
    assert es_telefono_valido("099123456a") is False


def test_separadores_se_rechazan_no_se_descartan():
    assert es_telefono_valido("099-123-4567") is False
    assert es_telefono_valido("099 123 4567") is False


def test_prefijo_internacional_se_rechaza():
    assert es_telefono_valido("+593991234567") is False
    assert es_telefono_valido("593991234567") is False


def test_digitos_no_ascii_se_rechazan():
    """`str.isdigit()` sola dice True para los dígitos arábigo-índicos, pero
    el `[0-9]` del CHECK de la base (migración `f1a7ident828`) no los acepta.
    Si esta capa los admitiera, la capa 2 los rechazaría en el flush con un
    `IntegrityError` en vez de un `ValueError` limpio en la puerta.

    Se construye con el largo y el prefijo VÁLIDOS a propósito: lo único que
    puede hacer fallar estos casos es la ascii-dad de los dígitos."""
    arabigo_indicos = "٢" * 8  # ٢
    assert ("09" + arabigo_indicos).isdigit() is True  # la trampa
    assert es_telefono_valido("09" + arabigo_indicos) is False

    devanagari = "२" * 7  # २
    assert es_telefono_valido("0" + devanagari + "1") is False


def test_digitos_con_volado_se_rechazan():
    # Otra familia que `str.isdigit()` acepta y `[0-9]` no: los dígitos con
    # volado. `'²'.isdigit()` es True. (Las fracciones como `'½'` no hacen
    # falta acá: `isdigit()` ya las rechaza, solo `isnumeric()` las acepta.)
    assert ("09" + "²" * 8).isdigit() is True  # la trampa
    assert es_telefono_valido("09" + "²" * 8) is False


@pytest.mark.parametrize(
    ("entrada", "esperado"),
    [
        pytest.param("0991234567", "0991234567", id="celular_local_no_cambia"),
        pytest.param("+593991234567", "0991234567", id="celular_593_con_signo_mas"),
        pytest.param("593991234567", "0991234567", id="celular_593_sin_signo_mas"),
        # El mapeo es exclusivo de celulares -- un fijo nunca lleva el
        # troncal "9" que el patrón exige, así que ni con prefijo 593 calza.
        pytest.param("022345678", "022345678", id="fijo_local_no_se_toca"),
        pytest.param("+593223456", "+593223456", id="fijo_con_prefijo_593_no_se_toca"),
        pytest.param(
            "+11234567890", "+11234567890", id="codigo_de_pais_distinto_no_se_toca"
        ),
        # Un dígito de menos en el número nacional: no calza el patrón, así
        # que `_validar_telefono` lo rechaza después por largo incorrecto,
        # no lo normaliza a algo distinto de lo que llegó.
        pytest.param(
            "+59399123456", "+59399123456", id="largo_incorrecto_tras_593_no_se_toca"
        ),
        # `normalizar_telefono` no toca separadores -- ninguna capa del
        # backend los aceptó nunca (`test_separadores_se_rechazan_no_se_
        # descartan`) -- así que un valor con espacios no calza el patrón y
        # se devuelve tal cual, para que la validación posterior lo rechace
        # por el motivo real: contiene caracteres que no son dígitos.
        pytest.param(
            "+593 99 123 4567", "+593 99 123 4567", id="separadores_no_se_descartan"
        ),
    ],
)
def test_normalizar_telefono(entrada, esperado):
    """Issue #855 -- los tres formatos del criterio de aceptación producen
    el mismo valor local; un fijo, otro código de país, un largo incorrecto
    o un valor con separadores se devuelven tal cual llegaron."""
    assert normalizar_telefono(entrada) == esperado


@pytest.mark.parametrize(
    ("a", "b"),
    [
        pytest.param("0993568597", "0993568597", id="mismo_formato_local"),
        pytest.param("0993568597", "+593993568597", id="local_vs_593_con_signo_mas"),
        pytest.param("0993568597", "593993568597", id="local_vs_593_sin_signo_mas"),
        pytest.param("+593993568597", "593993568597", id="593_con_y_sin_signo_mas"),
    ],
)
def test_telefonos_coinciden_reconoce_los_tres_formatos_como_el_mismo_numero(a, b):
    """Issue #860: la comparación cruzada reusa el mapeo de #855, así que los
    tres formatos del criterio de aceptación cuentan como un solo número."""
    assert telefonos_coinciden(a, b) is True


def test_telefonos_coinciden_numeros_distintos_no_coinciden():
    assert telefonos_coinciden("0993568597", "0991234567") is False


@pytest.mark.parametrize(
    ("a", "b"),
    [
        pytest.param(None, "0993568597", id="a_ausente"),
        pytest.param("0993568597", None, id="b_ausente"),
        pytest.param("", "0993568597", id="a_vacio"),
        pytest.param("0993568597", "", id="b_vacio"),
        pytest.param(None, None, id="ambos_ausentes"),
    ],
)
def test_telefonos_coinciden_nunca_coincide_si_falta_alguno(a, b):
    """El teléfono personal es opcional en algunos caminos (issue #860): su
    ausencia nunca se lee como una coincidencia."""
    assert telefonos_coinciden(a, b) is False
