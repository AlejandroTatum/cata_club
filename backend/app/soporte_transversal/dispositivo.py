"""
Etiqueta legible de un dispositivo, a partir de su user-agent.

Existe para que el historial de sesiones diga "Android · Chrome" en vez de
volcar 180 caracteres de user-agent crudo en la pantalla de perfil.

## Lo que deliberadamente NO hace

No guarda ni deriva IP. Es dato personal, el club maneja cuentas de menores y
de sus representantes, y ningún caso de uso la lee: el dueño de la cuenta
quiere reconocer SU teléfono en la lista, no auditar una red.

No intenta ser una librería de detección. Un user-agent no es una fuente
confiable de nada -- todo navegador basado en Chromium miente diciendo
"Safari", y Edge además dice "Chrome" -- así que esto reconoce lo suficiente
para que alguien identifique su propio equipo, y cuando no puede lo dice.
"""
from typing import Optional

# Ancho de `Sesion.dispositivo`. Un user-agent hostil no debe reventar el
# INSERT ni que la base recorte por su cuenta.
LARGO_MAXIMO = 80

DESCONOCIDO = "Dispositivo desconocido"

# Del más específico al más genérico, y el orden es la regla entera:
#   · Android declara "Linux" en el mismo string, así que si Linux ganara,
#     todo teléfono Android se leería como una laptop.
#   · iPhone y iPad declaran "like Mac OS X", así que macOS tiene que ir
#     después de los dos.
_SISTEMAS: tuple[tuple[str, str], ...] = (
    ("Android", "Android"),
    ("iPhone", "iPhone"),
    ("iPad", "iPad"),
    ("Windows", "Windows"),
    ("Mac OS X", "macOS"),
    ("Macintosh", "macOS"),
    ("Linux", "Linux"),
)

# Mismo criterio, y acá importa todavía más: Edge dice "Chrome" Y dice
# "Safari"; Chrome dice "Safari". Leído al revés, Edge se reportaría como
# Safari y Chrome también.
_NAVEGADORES: tuple[tuple[str, str], ...] = (
    ("Edg/", "Edge"),
    ("OPR/", "Opera"),
    ("Firefox/", "Firefox"),
    ("Chrome/", "Chrome"),
    ("Safari/", "Safari"),
)


def _primera_coincidencia(user_agent: str, tabla: tuple[tuple[str, str], ...]) -> Optional[str]:
    for aguja, nombre in tabla:
        if aguja in user_agent:
            return nombre
    return None


def describir_dispositivo(user_agent: Optional[str]) -> str:
    """
    "Android · Chrome", "Windows", o `DESCONOCIDO` cuando el string no dice
    nada reconocible.

    Nunca devuelve una cadena vacía y nunca supera `LARGO_MAXIMO`: quien
    llama guarda esto en una columna acotada, y una etiqueta vacía en una
    lista de sesiones es peor que decir que no se sabe.
    """
    if not user_agent:
        return DESCONOCIDO

    sistema = _primera_coincidencia(user_agent, _SISTEMAS)
    navegador = _primera_coincidencia(user_agent, _NAVEGADORES)

    if sistema and navegador:
        etiqueta = f"{sistema} · {navegador}"
    else:
        # Una sola rama para los tres casos restantes, y el `or` encadenado
        # los cubre: uno de los dos presente gana, y si faltan ambos cae en
        # DESCONOCIDO. La versión anterior tenía un `elif sistema or navegador`
        # con `... or DESCONOCIDO` adentro, donde ese último operando era
        # inalcanzable por construcción -- código muerto que se lee como una
        # salvaguarda.
        etiqueta = sistema or navegador or DESCONOCIDO

    return etiqueta[:LARGO_MAXIMO]
