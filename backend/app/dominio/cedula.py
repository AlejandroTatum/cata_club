"""
Validación (y generación determinística) de la cédula ecuatoriana.

La estructura del dígito verificador es una regla de negocio -- no una
utilidad de test -- aunque hoy (PR 4a, sdd/identidad) solo la usen fixtures
y seed de desarrollo. El PR 4b la cablea en los DTOs de `Persona` para
rechazar cédulas inválidas en la entrada real: si ya está acá, ese PR solo
la importa, no la reescribe. Vive en `dominio` en vez de duplicarse entre
`tests/` y `scripts/` (que sí pueden importar de acá, a diferencia de
`tests/` -> `scripts/` o viceversa) porque dos copias del mismo algoritmo
es exactamente el defecto que este carril de identidad existe para borrar.

Algoritmo (módulo 10):
  - 10 dígitos. Los dos primeros son la provincia: `01`-`24`, o `30` para
    personas registradas en el exterior. `es_cedula_valida` NO valida este
    rango -- valida sólo el dígito verificador (eso es, literalmente, lo
    único que el PR 4b va a exigir en el DTO).
  - El décimo dígito es el verificador: coeficientes `2,1,2,1,2,1,2,1,2`
    sobre los primeros nueve; a cada producto mayor que 9 se le resta 9; se
    suman; el verificador es lo que falta para cerrar a la decena superior
    (`0` si la suma ya es múltiplo de 10).
  - NO se aplica la regla "tercer dígito menor que 6": no es parte de la
    validación real y rechazaría personas existentes.
"""

_COEFICIENTES = (2, 1, 2, 1, 2, 1, 2, 1, 2)


def digito_verificador_cedula(nueve_digitos: str) -> int:
    """Dígito verificador (módulo 10) para los primeros nueve dígitos de una
    cédula ecuatoriana."""
    total = 0
    for digito, coef in zip(nueve_digitos, _COEFICIENTES):
        producto = int(digito) * coef
        if producto > 9:
            producto -= 9
        total += producto
    residuo = total % 10
    return 0 if residuo == 0 else 10 - residuo


def es_cedula_valida(cedula: str) -> bool:
    """True si `cedula` son 10 dígitos y el décimo cierra el módulo 10 de
    los primeros nueve. No valida la provincia -- ver el docstring del
    módulo."""
    if len(cedula) != 10 or not cedula.isdigit():
        return False
    return digito_verificador_cedula(cedula[:9]) == int(cedula[9])


def cedula_valida(secuencia: int) -> str:
    """Cédula ecuatoriana válida y estable para `secuencia`, para fixtures y
    seed de desarrollo. Provincia fija en `"17"` (Pichincha) por
    determinismo, no porque el dominio restrinja a esa provincia -- acepta
    cualquiera de `01`-`24` o `30` (ver docstring del módulo). La misma
    `secuencia` siempre produce la misma cédula."""
    base = f"17{secuencia % 10_000_000:07d}"
    return base + str(digito_verificador_cedula(base))
