"""Retiro del vínculo del segundo guardián (issue #1666), sin commit.

Vive aparte de `CoRepresentanteServicio` porque lo necesitan flujos que no
pueden importarlo (arrastra `AuthServicio`): reasignar o independizar al
representante principal y suprimir a una persona. Siempre con evidencia en
`CoRepresentanteEvento`: retirar un guardián nunca es silencioso."""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.dominio.modelos import CoRepresentante, CoRepresentanteEvento
from app.infraestructura.repositorios.co_representante_repositorio import CoRepresentanteRepositorio


def retirar_vinculo(
    db: Session, vinculo: CoRepresentante, *, actor_persona_id: int, origen: str,
    anular_enlace_pendiente: bool = True,
) -> None:
    """Borra `vinculo`, cancela la invitación pendiente que lo creó y deja los
    eventos `INVITACION_CANCELADA` (si había) y `BAJA`. No hace commit.

    Si la cuenta invitada nunca aceptó y no le quedan otras invitaciones vivas,
    sube su `version_contrasenia` para que el enlace ya enviado deje de servir
    (el token lleva esa versión: es de un solo uso)."""
    from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio

    repo = CoRepresentanteRepositorio(db)
    ahora = datetime.now(timezone.utc)
    persona_id, co_id = vinculo.persona_id, vinculo.co_representante_id
    pendientes = repo.listar_pendientes_de_cuenta(co_id)
    for invitacion in pendientes:
        if invitacion.persona_id == persona_id:
            repo.cancelar_pendiente(invitacion, ahora)
            repo.registrar_evento(CoRepresentanteEvento(
                persona_id=persona_id, co_representante_id=co_id, actor_persona_id=actor_persona_id,
                operacion="INVITACION_CANCELADA", origen=origen, invitacion_id=invitacion.id,
            ))
    repo.eliminar(vinculo)
    repo.registrar_evento(CoRepresentanteEvento(
        persona_id=persona_id, co_representante_id=co_id, actor_persona_id=actor_persona_id,
        operacion="BAJA", origen=origen,
    ))
    if anular_enlace_pendiente and pendientes and all(i.persona_id == persona_id for i in pendientes):
        cuenta = UsuarioRepositorio(db).obtener_por_persona_id(co_id)
        if cuenta is not None and not cuenta.correo_verificado:
            cuenta.version_contrasenia += 1


def retirar_del_menor(
    db: Session, persona_id: int, *, actor_persona_id: int, origen: str,
    solo_si_es: Optional[int] = None,
) -> bool:
    """Retira el segundo guardián de `persona_id`; con `solo_si_es`, solo si es
    esa persona (p. ej. el nuevo principal). Devuelve si retiró algo."""
    repo = CoRepresentanteRepositorio(db)
    vinculo = repo.obtener_por_persona(persona_id)
    if vinculo is None or (solo_si_es is not None and vinculo.co_representante_id != solo_si_es):
        return False
    retirar_vinculo(db, vinculo, actor_persona_id=actor_persona_id, origen=origen)
    return True


def retirar_de_co_representante(
    db: Session, co_representante_id: int, *, actor_persona_id: int, origen: str,
) -> int:
    """Retira todos los vínculos en los que `co_representante_id` es el segundo
    guardián (supresión de sus datos)."""
    vinculos = CoRepresentanteRepositorio(db).listar_de_co_representante(co_representante_id)
    for vinculo in vinculos:
        retirar_vinculo(db, vinculo, actor_persona_id=actor_persona_id, origen=origen)
    return len(vinculos)
