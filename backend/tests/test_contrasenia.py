"""
`validar_contrasenia` (issue #1017, ADR-5): el piso de 8 caracteres nunca fue
el defecto -- lo era la ausencia total de lista negra en el backend, mientras
el frontend (`identity-validation.ts:500`) ya rechazaba las mismas ~150
contraseñas comunes antes de enviar el formulario. `POST /enrollment/`
aceptaba "12345678" mientras el wizard ya la refusaba: una regla que solo
vive en el navegador no es una regla (issue #228, el mismo maxim que abrió
`dominio/cedula.py`).

El piso NO se mueve (decisión del dueño, 2026-09-03): sigue en 8. Fix 3 es
puramente portar la lista negra, no endurecer el largo.
"""
import pytest

from app.dominio.contrasenia import (
    CONTRASENIAS_COMUNES,
    LONGITUD_MAXIMA_CONTRASENIA_BYTES,
    LONGITUD_MINIMA_CONTRASENIA,
    validar_contrasenia,
)


def test_longitud_minima_sigue_siendo_ocho():
    # Fija la decisión del dueño: el piso NO se mueve a 12 (esa era la
    # "fix 3b", descartada por completo, no diferida).
    assert LONGITUD_MINIMA_CONTRASENIA == 8


def test_contrasenia_comun_es_rechazada_aunque_cumpla_el_piso():
    # "12345678" tiene 8 caracteres exactos -- cumple el piso de largo y
    # aun así está en la lista negra, igual que el frontend ya la rechaza.
    with pytest.raises(ValueError) as error:
        validar_contrasenia("12345678")
    assert "usada" in str(error.value)


def test_contrasenia_de_ocho_no_comun_es_aceptada():
    # No debe lanzar: cumple el piso y no está en la lista negra.
    validar_contrasenia("miclavefuerte1")


def test_contrasenia_corta_es_rechazada_aunque_no_sea_comun():
    with pytest.raises(ValueError) as error:
        validar_contrasenia("abc123")
    assert "8 caracteres" in str(error.value)


def test_comparacion_de_lista_negra_es_insensible_a_mayusculas():
    # El frontend compara `.trim().toLowerCase()`; el backend tiene que
    # coincidir o la misma contraseña pasaría acá y se rechazaría allá.
    with pytest.raises(ValueError):
        validar_contrasenia("PASSWORD123")


def test_comparacion_de_lista_negra_ignora_espacios_al_borde():
    with pytest.raises(ValueError):
        validar_contrasenia("  12345678  ")


def test_lista_negra_no_esta_vacia_y_esta_en_minusculas():
    assert len(CONTRASENIAS_COMUNES) > 50
    assert all(valor == valor.lower() for valor in CONTRASENIAS_COMUNES)


# --- issue #1043: tope de bytes que bcrypt realmente hashea -----------------


def test_tope_maximo_sigue_siendo_72_bytes():
    # Fija el límite del algoritmo (bcrypt), no una decisión de composición
    # -- no reabre #230.
    assert LONGITUD_MAXIMA_CONTRASENIA_BYTES == 72


def test_contrasenia_de_72_bytes_ascii_es_aceptada():
    # Exactamente en el borde: no debe lanzar.
    validar_contrasenia("a" * 72)


def test_contrasenia_de_73_bytes_ascii_es_rechazada():
    with pytest.raises(ValueError) as error:
        validar_contrasenia("a" * 73)
    assert "72 bytes" in str(error.value)


def test_mensaje_de_tope_no_promete_caracteres():
    # "72 caracteres" sería mentira para quien use tildes o emoji -- el
    # límite que el mensaje declara tiene que ser en bytes, nunca en
    # caracteres (puede mencionar la palabra al aclarar la diferencia).
    with pytest.raises(ValueError) as error:
        validar_contrasenia("a" * 73)
    assert "72 caracteres" not in str(error.value)
    assert "72 bytes" in str(error.value)


def test_contrasenia_con_emoji_se_mide_en_bytes_no_en_caracteres():
    # Cada emoji ocupa 4 bytes UTF-8: 18 emoji = 72 bytes (el borde exacto),
    # 19 = 76 bytes (ya lo supera). Si se midiera `len()` (caracteres), 19
    # emoji pasaría sin problema -- y es justo el caso que sorprende.
    contrasenia_en_el_borde = "😀" * 18
    assert len(contrasenia_en_el_borde) == 18
    assert len(contrasenia_en_el_borde.encode("utf-8")) == 72
    validar_contrasenia(contrasenia_en_el_borde)

    contrasenia_que_excede = "😀" * 19
    with pytest.raises(ValueError) as error:
        validar_contrasenia(contrasenia_que_excede)
    assert "72 bytes" in str(error.value)
