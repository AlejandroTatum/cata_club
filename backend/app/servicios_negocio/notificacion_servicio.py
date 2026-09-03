"""
Servicio de notificaciones in-app.

Extraído de `ranking_servicio.py`: las notificaciones son genéricas (avisos
de vencimiento de membresía, pagos aprobados/rechazados, nuevas
inscripciones — ver `alertas_tareas.py` y `TipoNotificacion`), no una
funcionalidad del ranking competitivo. Compartían módulo solo por historia
de implementación; con el ranking eliminado por completo, quedan en su
propio servicio.
"""
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.dominio.modelos import Notificacion
from app.dominio.excepciones import EntidadNoEncontrada, PermisosInsuficientes
from app.infraestructura.repositorios.notificacion_repositorio import NotificacionRepositorio


# Ancho del fragmento decorativo -- un nombre de persona -- que otros
# servicios anteponen a un mensaje de notificación (ej. "Para <nombre>:
# <mensaje>", "Nuevo alumno inscrito: <nombre> ..."). Un nombre no tiene tope
# real: apellidos compuestos, partículas ("de la", "van der"), varios nombres
# de pila pueden superar largamente lo que hace falta para identificar a
# alguien en un aviso (hallazgo en vivo, 2026-08-11: un nombre + apellido
# real empujó un aviso de vinculación a 372 caracteres). Acortarlo ACÁ, en la
# parte que solo identifica, es lo que le deja lugar de sobra al contenido
# que sí importa -- el motivo de un rechazo, el detalle de una alerta -- sin
# depender de que la columna de la base crezca al ritmo de cualquier nombre
# real. Ver `Notificacion.MENSAJE_MAX` (modelos.py) para el último resorte
# que cubre lo que esto no previno.
LIMITE_NOMBRE_EN_NOTIFICACION = 60


def acortar_nombre_para_notificacion(
    nombre: str, limite: int = LIMITE_NOMBRE_EN_NOTIFICACION
) -> str:
    """Acorta un nombre de persona antes de insertarlo en el texto de una
    notificación, preservando el resto del mensaje intacto."""
    if len(nombre) <= limite:
        return nombre
    return nombre[: limite - 1].rstrip() + "…"


class NotificacionServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = NotificacionRepositorio(db)

    def listar_propias(
        self, persona_id: int, skip: int = 0, limit: Optional[int] = None
    ) -> tuple[list[Notificacion], int]:
        items = self.repo.listar_por_persona(persona_id, skip=skip, limit=limit)
        total = self.repo.contar_por_persona(persona_id)
        return items, total

    def _resolver_ids_autorizados(self, persona_id: int) -> list[int]:
        """Persona propia + sus dependientes ACTIVOS -- el mismo alcance que
        ve el feed paginado del representante. Extraído para que
        `listar_para_persona_y_hijos` y `marcar_todas_leidas` (issue #859)
        nunca puedan divergir sobre a quién representa `persona_id`.

        Baja lógica: los dependientes salen de
        `PersonaRepositorio.listar_representados`, que filtra por `activo`, y
        NO de la relación ORM `persona.representados`, que no se puede
        filtrar. Es el mismo criterio operativo que el resto de los listados:
        el feed alimenta el portal del representante, y ahí un dependiente
        dado de baja ya no aparece en ningún lado -- dejar sus notificaciones
        colgadas para siempre sería la única traza de alguien que el sistema
        dice que ya no está.
        """
        from app.dominio.modelos import Persona
        from app.infraestructura.repositorios.persona_repositorio import (
            PersonaRepositorio,
        )
        persona = self.db.get(Persona, persona_id)
        if not persona:
            return []
        hijos_ids = [
            h.id for h in PersonaRepositorio(self.db).listar_representados(persona_id)
        ]
        return [persona_id] + hijos_ids

    def listar_para_persona_y_hijos(
        self, persona_id: int, skip: int = 0, limit: Optional[int] = None
    ) -> tuple[list[Notificacion], int]:
        """Para representantes: incluye notificaciones propias y de sus hijos."""
        todos_ids = self._resolver_ids_autorizados(persona_id)
        if not todos_ids:
            return [], 0
        query = (
            self.db.query(Notificacion)
            .filter(Notificacion.persona_id.in_(todos_ids))
            .order_by(Notificacion.fecha_creacion.desc(), Notificacion.id.desc())
            .offset(skip)
        )
        if limit is not None:
            query = query.limit(limit)
        items = query.all()
        total = (
            self.db.query(func.count(Notificacion.id))
            .filter(Notificacion.persona_id.in_(todos_ids))
            .scalar()
        )
        return items, total

    def marcar_todas_leidas(self, persona_id: int) -> int:
        """Marca como leídas TODAS las notificaciones pendientes que
        `persona_id` está autorizado a ver -- las propias y, si tiene
        dependientes, las de sus dependientes activos (issue #859). El
        alcance se resuelve acá, en el backend, con el mismo criterio que
        `listar_para_persona_y_hijos`: nunca a partir de ids que mande el
        cliente."""
        ids_autorizados = self._resolver_ids_autorizados(persona_id)
        if not ids_autorizados:
            return 0
        actualizadas = self.repo.marcar_todas_leidas(ids_autorizados)
        self.db.commit()
        return actualizadas

    def marcar_leida(self, notificacion_id: int, persona_id: int) -> Notificacion:
        notificacion = self.db.get(Notificacion, notificacion_id)
        if notificacion is None:
            raise EntidadNoEncontrada(f"Notificación con id {notificacion_id} no encontrada")
        if notificacion.persona_id != persona_id:
            raise PermisosInsuficientes("No puede marcar como leída una notificación ajena")
        resultado = self.repo.marcar_leida(notificacion)
        self.db.commit()
        return resultado
