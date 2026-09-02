"""Tests de la regla canónica de normalización de nombres propios (issue
#875). Puro, sin base de datos: cubre NFC, espacios, partículas, acentos,
guiones, apóstrofes y ambigüedades (`clasificar`), más el comportamiento
conservador de `normalizar_nombre_propio` en el límite de escritura."""
import unicodedata

import pytest

from app.dominio.nombre_propio import clasificar, nombre_completo, normalizar_nombre_propio

_NFD_JUAN_PEREZ = unicodedata.normalize("NFD", "juan  pérez")


@pytest.mark.parametrize("valor, esperado", [
    ("MARÍA josé DE LA CRUZ", "María José de la Cruz"),
    (_NFD_JUAN_PEREZ, "Juan Pérez"),
    ("de la torre", "De la Torre"),
    ("ana-maría", "Ana-María"),
])
def test_cambio_propuesto_normaliza_y_clasifica(valor, esperado):
    assert normalizar_nombre_propio(valor) == esperado
    resultado = clasificar(valor)
    assert resultado.clase == "cambio_propuesto"
    assert resultado.valor_normalizado == esperado
    assert resultado.motivos == ()


@pytest.mark.parametrize("valor_canonico", ["María José de la Cruz", "Juan Pérez", "De la Torre", "Ana-María", "Ñandú"])
def test_valor_canonico_es_sin_cambio_e_idempotente(valor_canonico):
    resultado = clasificar(valor_canonico)
    assert resultado.clase == "sin_cambio"
    assert resultado.valor_normalizado == valor_canonico
    assert normalizar_nombre_propio(valor_canonico) == valor_canonico


@pytest.mark.parametrize("valor, motivo", [
    ("d'angelo", "apostrofe"),
    ("McArthur", "mayuscula_interior"),
    ("juan_pérez", "caracter_no_valido"),
    ("J", "inicial"),
    ("", "vacio"),
    ("a" * 101, "demasiado_largo"),
    ("Col·lo", "caracter_no_valido"),  # interpunct catalán, categoría Po
])
def test_clasifica_como_ambiguo_con_motivo_y_valor_intacto(valor, motivo):
    resultado = clasificar(valor)
    assert resultado.clase == "ambiguo"
    assert motivo in resultado.motivos
    assert resultado.valor_normalizado == valor


# --- Límite de escritura: normalizar_nombre_propio conservadora ------------


@pytest.mark.parametrize("valor, esperado", [
    ("faby ESPINOZA", "Faby Espinoza"),
    ("ana-maría", "Ana-María"),
    ("McArthur", "McArthur"),  # preservado tal cual: mayúscula interior
    ("O'Brien", "O'Brien"),  # preservado tal cual: apóstrofe
    ("o'brien", "o'brien"),  # preservado tal cual, sin corregir el caso
    ("j", "J"),  # inicial (no partícula): a mayúscula
    ("juan y pedro", "Juan y Pedro"),  # "y" es partícula, no una inicial
    ("l·l", "l·l"),  # interpunct catalán: preservado, carácter fuera de rango
    ("ÑANDÚ", "Ñandú"),
    ("peña", "Peña"),
    ("", ""),
    ("  ", ""),
    (unicodedata.normalize("NFD", "José"), "José"),  # NFD de entrada -> NFC
])
def test_normalizar_nombre_propio_es_conservadora(valor, esperado):
    assert normalizar_nombre_propio(valor) == esperado
    assert normalizar_nombre_propio(esperado) == esperado  # idempotente


# --- Límite de lectura: nombre_completo, fallback de presentación ----------


@pytest.mark.parametrize("nombres, apellidos, esperado", [
    ("faby", "ESPINOZA", "Faby Espinoza"),  # legacy: casing crudo pre-#875
    (None, "ESPINOZA", "Espinoza"),  # None de un lado
    ("faby", None, "Faby"),
    (None, None, ""),
    ("", "", ""),
    ("maría", "DE LA CRUZ", "María De la Cruz"),  # cada mitad, por separado
    ("Faby", "Espinoza", "Faby Espinoza"),  # ya canónico: idempotente
    ("María", "De la Cruz", "María De la Cruz"),  # concuerda con NombrePresentado
])
def test_nombre_completo_normaliza_cada_campo_por_separado(nombres, apellidos, esperado):
    assert nombre_completo(nombres, apellidos) == esperado


def test_nombre_completo_es_idempotente_sobre_su_propia_salida():
    resultado = nombre_completo("faby", "ESPINOZA")
    nombre, apellido = resultado.split(" ", 1)
    assert nombre_completo(nombre, apellido) == resultado
