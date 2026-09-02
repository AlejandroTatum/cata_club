"""Regla canónica de normalización de nombres propios (issue #875): límite
de escritura de `Persona.nombres`/`apellidos` y `FichaMedica.contacto_
emergencia`, en ambas capas (`validadores.py` y `@validates` de
`modelos.py`; ver también el dry-run de solo lectura, issue #904). Puro:
NFC + colapso de espacios, capitalización Unicode-aware por token (nunca
`str.title()`), partículas en minúscula salvo como primer token, subtokens
con guion capitalizados aparte. Ambigüedad (sin corrección automática,
valor se preserva tal cual): `apostrofe`, `mayuscula_interior`
(`McArthur`), `caracter_no_valido` (incluye el interpunct catalán `·`),
`inicial` (letra sola que NO es partícula: `y`/`e` no cuentan), `vacio`,
`demasiado_largo`."""
import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

PARTICULAS = frozenset({"de", "del", "la", "las", "los", "y", "e", "da", "do", "das", "dos", "van", "von", "di", "du"})

_LARGO_MAXIMO = 100


@dataclass(frozen=True)
class Clasificacion:
    clase: str  # "sin_cambio" | "cambio_propuesto" | "ambiguo"
    valor_normalizado: str
    motivos: tuple[str, ...]


def _preparar(valor: str) -> str:
    preparado = unicodedata.normalize("NFC", valor).strip()
    return re.sub(r"\s+", " ", preparado)


def _capitalizar_token(token: str) -> str:
    """Cada subtoken con guion se capitaliza aparte (`ana-maría` -> `Ana-María`)."""
    return "-".join((sub[0].upper() + sub[1:].lower()) if sub else sub for sub in token.split("-"))


def _tiene_mayuscula_interior_tras_minuscula(token: str) -> bool:
    """Por subtoken: el guion resetea el chequeo (`Ana-María` no cuenta)."""
    return any(c.isupper() and any(x.islower() for x in sub[:i]) for sub in token.split("-") for i, c in enumerate(sub))


def _caracter_fuera_de_rango(token: str) -> bool:
    """True si hay un carácter que no es letra/marca/guion/apóstrofe."""
    return any(c not in ("-", "'") and unicodedata.category(c)[0] not in ("L", "M") for c in token)


def _token_ambiguo(token: str) -> bool:
    """Igual que los tres primeros motivos de `_motivos_ambiguedad`, pero
    por TOKEN: es lo que decide si `normalizar_nombre_propio` toca ese
    token o lo preserva tal cual escrito."""
    return "'" in token or _tiene_mayuscula_interior_tras_minuscula(token) or _caracter_fuera_de_rango(token)


def normalizar_nombre_propio(valor: str) -> str:
    """Límite de escritura (issue #875): conservadora, idempotente, nunca
    `str.title()`. Por token: uno ambiguo (apóstrofe, mayúscula interior
    tipo `McArthur`, carácter fuera de letras/marcas/guion) se preserva TAL
    CUAL -- nunca se corrige a ciegas. Partícula (`PARTICULAS`) en minúscula
    salvo como primer token. Una inicial (letra sola, no partícula) se pasa
    a mayúscula. El resto se capitaliza por subtoken con guion."""
    preparado = _preparar(valor)
    if not preparado:
        return preparado
    tokens = preparado.split(" ")
    resultado = []
    for i, token in enumerate(tokens):
        es_particula = i > 0 and token.lower() in PARTICULAS
        if _token_ambiguo(token):
            resultado.append(token)
        elif es_particula:
            resultado.append(token.lower())
        elif len(token) == 1:
            resultado.append(token.upper())
        else:
            resultado.append(_capitalizar_token(token))
    return " ".join(resultado)


def _motivos_ambiguedad(preparado: str) -> list[str]:
    motivos: list[str] = []
    if not preparado:
        motivos.append("vacio")
    tokens = preparado.split(" ") if preparado else []
    for i, token in enumerate(tokens):
        if "'" in token:
            motivos.append("apostrofe")
        if _tiene_mayuscula_interior_tras_minuscula(token):
            motivos.append("mayuscula_interior")
        if _caracter_fuera_de_rango(token):
            motivos.append("caracter_no_valido")
        # Una partícula de una letra (`y`, `e`) no es una inicial: se
        # capitaliza/minusculiza como partícula, no queda ambigua.
        es_particula = i > 0 and token.lower() in PARTICULAS
        if len(token) == 1 and not es_particula:
            motivos.append("inicial")
    if len(preparado) > _LARGO_MAXIMO:
        motivos.append("demasiado_largo")
    return list(dict.fromkeys(motivos))  # dedupe preservando el orden


def clasificar(valor: str) -> Clasificacion:
    """`sin_cambio` | `cambio_propuesto` | `ambiguo`. Un valor ambiguo
    NUNCA se corrige: `valor_normalizado` queda intacto."""
    preparado = _preparar(valor)
    motivos = _motivos_ambiguedad(preparado)
    if motivos:
        return Clasificacion(clase="ambiguo", valor_normalizado=valor, motivos=tuple(motivos))

    normalizado = normalizar_nombre_propio(valor)
    clase = "sin_cambio" if normalizado == valor else "cambio_propuesto"
    return Clasificacion(clase=clase, valor_normalizado=normalizado, motivos=())


def nombre_completo(nombres: Optional[str], apellidos: Optional[str]) -> str:
    """ÚNICO lugar donde se arma un nombre completo para PRESENTACIÓN (issue
    #875). Aplica la MISMA regla por-campo que el límite de escritura y
    `NombrePresentado`: cada mitad se normaliza por separado, no la cadena
    unida como una sola unidad -- así una fila canónica (`María`/`De la
    Cruz`) se ve igual venga por campos o por nombre completo. `None` cuenta
    como vacío."""
    return " ".join(p for p in (normalizar_nombre_propio(nombres or ""), normalizar_nombre_propio(apellidos or "")) if p)
