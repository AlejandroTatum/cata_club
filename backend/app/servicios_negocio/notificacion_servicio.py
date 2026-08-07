"""
Servicio de notificaciones in-app.

Extraído de `ranking_servicio.py`: las notificaciones son genéricas (avisos
de vencimiento de membresía, pagos aprobados/rechazados, nuevas
inscripciones — ver `alertas_tareas.py` y `TipoNotificacion`), no una
funcionalidad del ranking competitivo. Compartían módulo solo por historia
de implementación; con el ranking eliminado por completo, quedan en su
propio servicio.
"""
from sqlalchemy.orm import Session

from app.dominio.modelos import Notificacion
from app.dominio.excepciones import EntidadNoEncontrada, PermisosInsuficientes
from app.infraestructura.repositorios.notificacion_repositorio import NotificacionRepositorio


class NotificacionServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = NotificacionRepositorio(db)

    def listar_propias(self, persona_id: int) -> list[Notificacion]:
        return self.repo.listar_por_persona(persona_id)

    def listar_para_persona_y_hijos(self, persona_id: int) -> list[Notificacion]:
        """Para representantes: incluye notificaciones propias y de sus hijos.

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
        todos_ids = [persona_id] + hijos_ids
        return (
            self.db.query(Notificacion)
            .filter(Notificacion.persona_id.in_(todos_ids))
            .order_by(Notificacion.fecha_creacion.desc())
            .all()
        )

    def marcar_leida(self, notificacion_id: int, persona_id: int) -> Notificacion:
        notificacion = self.db.get(Notificacion, notificacion_id)
        if notificacion is None:
            raise EntidadNoEncontrada(f"Notificación con id {notificacion_id} no encontrada")
        if notificacion.persona_id != persona_id:
            raise PermisosInsuficientes("No puede marcar como leída una notificación ajena")
        return self.repo.marcar_leida(notificacion)
