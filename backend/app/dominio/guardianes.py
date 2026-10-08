"""Quiénes son los guardianes de una persona (issue #1666).

Una sola definición para los avisos: el representante principal
(`Persona.representante`) y, si lo hay, el segundo guardián vigente
(`Persona.co_representante_vinculo`). Decisión del dueño: AMBOS reciben las
notificaciones y los correos del menor. Son funciones puras sobre relaciones
ya cargadas -- los llamadores de lote las precargan con `joinedload` para no
agregar un `SELECT` por familia."""
from app.dominio.modelos import Persona


def guardianes_de(persona: Persona) -> list[Persona]:
    """`[principal, segundo?]`; vacío si la persona no tiene representante."""
    if not persona.representante_id:
        return []
    guardianes = [persona.representante]
    vinculo = persona.co_representante_vinculo
    if vinculo is not None:
        guardianes.append(vinculo.co_representante)
    return guardianes


def destinatarios_de_aviso(persona: Persona) -> list[Persona]:
    """Cuentas que pueden leer un aviso de `persona`: ella misma si tiene
    cuenta; si no, cada guardián que tenga cuenta (puede ser ninguno)."""
    if persona.usuario is not None:
        return [persona]
    return [g for g in guardianes_de(persona) if g.usuario is not None]
