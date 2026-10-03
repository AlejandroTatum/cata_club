"""
Nombres de persona válidos para fixtures que pasan por el DTO.

El DTO de persona solo admite letras, espacio, `'`, `-` y `.` en nombres y
apellidos (`_validar_caracteres_de_nombre`), así que un apellido armado con
la cédula o con un índice (`f"Alumno{i}"`) recibe 422. `nombre_unico` mapea
cada dígito a una letra: es determinista e inyectivo, de modo que los tests
que dependen de la unicidad la conservan.
"""

_LETRA_POR_DIGITO = str.maketrans("0123456789", "ABCDEFGHIJ")


def nombre_unico(texto, prefijo: str = "") -> str:
    """`prefijo` + `texto` con cada dígito reemplazado por una letra (A-J)."""
    return f"{prefijo}{texto}".translate(_LETRA_POR_DIGITO)
