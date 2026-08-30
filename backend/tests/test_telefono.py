"""
`es_telefono_valido`: solo Ecuador, sin números extranjeros (PR 4b, issue
#228). Celular = 10 dígitos empezando en 09; fijo = 9 dígitos empezando en
0. Cualquier carácter que no sea dígito se rechaza, nunca se descarta en
silencio.
"""
from app.dominio.telefono import es_telefono_valido


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
