"""
`es_cedula_valida` como identificador real, no como cadena de 10 dígitos
(issue #228). Los cuatro casos de la reproducción del issue son la base:
un dígito verificador equivocado, una provincia que no existe, un número
que no cierra por ningún lado, y una cédula real de control.
"""
from app.dominio.cedula import digito_verificador_cedula, es_cedula_valida


def test_1712345678_es_invalida_por_digito_verificador():
    # El verificador correcto para "171234567" es 5, no 8.
    assert es_cedula_valida("1712345678") is False


def test_9912345678_es_invalida_porque_la_provincia_99_no_existe():
    assert es_cedula_valida("9912345678") is False


def test_0000000000_es_invalida_aunque_el_verificador_cierre():
    # El módulo 10 de "000000000" da 0, que "coincide" con el décimo dígito
    # -- por eso esta cédula solo se puede rechazar validando la provincia.
    assert digito_verificador_cedula("000000000") == 0
    assert es_cedula_valida("0000000000") is False


def test_1798765432_es_valida():
    assert es_cedula_valida("1798765432") is True


def test_provincia_30_exterior_es_valida_si_el_verificador_cierra():
    base = "300000000"
    verificador = digito_verificador_cedula(base)
    assert es_cedula_valida(base + str(verificador)) is True


def test_largo_distinto_de_diez_es_invalido():
    assert es_cedula_valida("171003406") is False
    assert es_cedula_valida("17100340650") is False


def test_caracteres_no_numericos_son_invalidos():
    assert es_cedula_valida("171003406a") is False
