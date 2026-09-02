"""Regla PROPUESTA de normalización de `Persona.nombres`/`apellidos`
(issue #904, ver #875). Puro: NFC + colapso de espacios, capitalización
Unicode-aware por token (nunca `str.title()`), partículas en minúscula
salvo como primer token, subtokens con guion capitalizados aparte.
Ambigüedad (sin corrección automática): `apostrofe`, `mayuscula_interior`
(`McArthur`), `caracter_no_valido`, `inicial`, `vacio`, `demasiado_largo`."""
import re
import unicodedata
from dataclasses import dataclass

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


def normalizar_nombre_propio(valor: str) -> str:
    """Transformación mecánica; no decide ambigüedad (ver `clasificar`)."""
    preparado = _preparar(valor)
    if not preparado:
        return preparado
    tokens = preparado.split(" ")
    resultado = [t.lower() if i > 0 and t.lower() in PARTICULAS else _capitalizar_token(t) for i, t in enumerate(tokens)]
    return " ".join(resultado)


def _tiene_mayuscula_interior_tras_minuscula(token: str) -> bool:
    """Por subtoken: el guion resetea el chequeo (`Ana-María` no cuenta)."""
    return any(c.isupper() and any(x.islower() for x in sub[:i]) for sub in token.split("-") for i, c in enumerate(sub))


def _caracter_fuera_de_rango(token: str) -> bool:
    """True si hay un carácter que no es letra/marca/guion/apóstrofe."""
    return any(c not in ("-", "'") and unicodedata.category(c)[0] not in ("L", "M") for c in token)


def _motivos_ambiguedad(preparado: str) -> list[str]:
    motivos: list[str] = []
    if not preparado:
        motivos.append("vacio")
    for token in preparado.split(" ") if preparado else []:
        if "'" in token:
            motivos.append("apostrofe")
        if _tiene_mayuscula_interior_tras_minuscula(token):
            motivos.append("mayuscula_interior")
        if _caracter_fuera_de_rango(token):
            motivos.append("caracter_no_valido")
        if len(token) == 1:
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
