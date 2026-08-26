"""
Diagnóstico NO SENSIBLE de la configuración del proveedor del chatbot de FAQ
(gateway OpenCode Zen, issue #645).

Este módulo NO decide si el chatbot funciona: eso solo lo prueba una consulta
real contra el gateway. Decide algo más chico y verificable localmente: si el
operador entregó `OPENCODE_API_KEY` y si lo que entregó puede llegar a ser una
credencial. Tres estados, deliberadamente distintos:

  - AUSENTE: no hay valor. `docker-compose.yml` declara
    `OPENCODE_API_KEY: ${OPENCODE_API_KEY:-}`, así que vacío es lo que ve un
    despliegue que no habilitó la función. NO es un error: `ChatbotServicio`
    degrada a su FAQ local (`_respuesta_local`) y la app arranca igual --
    por eso `opencode_api_key` está en `_CAMPOS_EXCLUIDOS_A_PROPOSITO` del
    fail-fast de producción.
  - INCOMPLETA: hay un valor que NINGUNA credencial puede tener. Siempre es
    un error del operador, nunca una decisión: se ve igual que "configurado"
    en `docker compose config`, pero el gateway lo va a rechazar y el usuario
    solo va a ver la respuesta de respaldo, sin que nadie sepa por qué.
  - CONFIGURADA: hay un valor plausible. "Plausible" no es "válido": la
    validez la dice el proveedor, no este módulo.

Regla de oro: NADA de lo que devuelve este módulo contiene el valor ni un
fragmento del valor. Ni el motivo, ni las líneas de reporte, ni la huella.
La huella es un digest de una vía (SHA-256 truncado) que sirve para UNA sola
pregunta operativa -- "¿el contenedor tiene otra clave que la de antes?" --
que es exactamente lo que hay que poder responder tras una rotación sin
imprimir ningún secreto.
"""
import hashlib
from dataclasses import dataclass
from enum import Enum

from app.soporte_transversal.configuracion import settings

# Nombre de la variable tal como la escribe el operador en su `.env`. Se usa en
# los mensajes: es la única cadena "de configuración" que el diagnóstico puede
# mostrar, porque es pública (está en `.env.example` y en `docker-compose.yml`).
VARIABLE_CLAVE = "OPENCODE_API_KEY"

# Largo de la huella en caracteres hexadecimales. 12 (48 bits) alcanza de sobra
# para distinguir dos claves entre sí -- que es todo lo que se le pide -- y
# nunca se usa como identidad ni como control de acceso, así que una colisión
# no tiene consecuencia de seguridad. No se emite el digest completo para que
# nadie lo confunda con un identificador estable del secreto.
LARGO_HUELLA = 12

_COMILLAS = ('"', "'")


class EstadoProveedor(str, Enum):
    AUSENTE = "ausente"
    INCOMPLETA = "incompleta"
    CONFIGURADA = "configurada"


@dataclass(frozen=True)
class DiagnosticoProveedor:
    """Resultado del diagnóstico. Los tres campos son públicos por diseño: se
    imprimen tal cual en el smoke check y ninguno deriva del valor salvo la
    huella, que es de una sola vía."""

    estado: EstadoProveedor
    motivo: str
    huella: str

    @property
    def es_utilizable(self) -> bool:
        """El backend tiene algo que mandarle al gateway. No afirma que el
        gateway lo vaya a aceptar."""
        return self.estado is EstadoProveedor.CONFIGURADA

    @property
    def es_un_error_de_configuracion(self) -> bool:
        """Solo INCOMPLETA. AUSENTE es una opción legítima del despliegue, y
        colapsar las dos convertiría "el club no habilitó el chatbot" en una
        falla de operación que nadie puede arreglar."""
        return self.estado is EstadoProveedor.INCOMPLETA

    def lineas(self) -> list[str]:
        """Reporte listo para imprimir. La huella solo aparece cuando existe:
        una huella de la cadena vacía sería la MISMA constante en todos los
        despliegues sin clave, y parecería una configuración real."""
        lineas = [
            f"variable : {VARIABLE_CLAVE}",
            f"estado   : {self.estado.value}",
        ]
        if self.huella:
            lineas.append(f"huella   : sha256:{self.huella}")
        lineas.append(f"detalle  : {self.motivo}")
        return lineas


def huella_no_reversible(clave: str) -> str:
    """SHA-256 del valor completo, truncado. Del valor COMPLETO, nunca de un
    prefijo: un prefijo del secreto es el secreto."""
    return hashlib.sha256(clave.encode("utf-8")).hexdigest()[:LARGO_HUELLA]


def _motivo_de_incompleta(clave: str) -> str | None:
    """Devuelve por qué el valor no puede ser una credencial, o `None` si no
    encuentra nada objetable. Cada regla describe una forma concreta en que un
    `.env` se rompe en silencio -- ninguna es una heurística sobre el formato
    de la clave, porque el formato lo decide el proveedor y este repositorio
    nunca vio una clave real.

    NO hay regla de largo mínimo a propósito: cualquier número sería un techo
    inventado sobre cero muestras.
    """
    if clave != clave.strip():
        return (
            f"{VARIABLE_CLAVE} tiene espacios al principio o al final; se "
            "envían tal cual al proveedor y este los rechaza. Quitá los "
            "espacios sobrantes de la línea del .env."
        )
    if len(clave) >= 2 and clave[0] in _COMILLAS and clave[-1] == clave[0]:
        return (
            f"{VARIABLE_CLAVE} quedó envuelta en comillas; Compose interpola "
            "el valor con las comillas incluidas y el proveedor las recibe "
            "como parte de la credencial. Escribí la línea sin comillas."
        )
    if clave.startswith("<") and clave.endswith(">"):
        return (
            f"{VARIABLE_CLAVE} todavía tiene el placeholder de los archivos "
            "de ejemplo del repositorio; reemplazalo por la clave real que "
            "entrega el propietario fuera de banda."
        )
    if any(caracter.isspace() for caracter in clave):
        return (
            f"{VARIABLE_CLAVE} contiene espacios en el medio; suele ser un "
            "comentario pegado en la misma línea del .env, que Compose "
            "interpola como parte del valor. Dejá la línea con la clave sola."
        )
    return None


def diagnosticar(clave: str | None) -> DiagnosticoProveedor:
    if clave is None or not clave.strip():
        return DiagnosticoProveedor(
            estado=EstadoProveedor.AUSENTE,
            motivo=(
                f"{VARIABLE_CLAVE} no está definida o está vacía. El chatbot "
                "responde desde su FAQ local y el resto de la app no se ve "
                "afectado; es la configuración esperada de un despliegue que "
                "no habilitó el asistente externo."
            ),
            huella="",
        )

    motivo_incompleta = _motivo_de_incompleta(clave)
    if motivo_incompleta is not None:
        # Sin huella: una huella acá invitaría a comparar dos valores rotos
        # entre sí, cuando lo único accionable es corregir la línea del .env.
        return DiagnosticoProveedor(
            estado=EstadoProveedor.INCOMPLETA,
            motivo=motivo_incompleta,
            huella="",
        )

    return DiagnosticoProveedor(
        estado=EstadoProveedor.CONFIGURADA,
        motivo=(
            f"{VARIABLE_CLAVE} llegó al proceso con un valor plausible. Que "
            "el proveedor la acepte solo lo confirma una consulta real al "
            "chatbot; esta comprobación no gasta tokens ni contacta la red."
        ),
        huella=huella_no_reversible(clave),
    )


def diagnosticar_configuracion_actual() -> DiagnosticoProveedor:
    """Diagnostica EXACTAMENTE el valor que `ChatbotServicio` le pasa a
    `openai.OpenAI(api_key=...)`. Se lee de `settings`, no de `os.environ`:
    `Settings` ya resolvió `.env` y el entorno, y una relectura directa de
    `os.environ` no ve el `.env` (ver el comentario de `chatbot_servicio.py`
    sobre por qué la clave se pasa explícita al cliente)."""
    return diagnosticar(settings.opencode_api_key)
