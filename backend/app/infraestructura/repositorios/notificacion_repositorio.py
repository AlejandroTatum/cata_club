from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.dominio.modelos import Notificacion


class NotificacionRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, notificacion: Notificacion) -> Notificacion:
        self.db.add(notificacion)
        self.db.commit()
        self.db.refresh(notificacion)
        return notificacion

    def listar_por_persona(
        self, persona_id: int, skip: int = 0, limit: Optional[int] = None
    ) -> list[Notificacion]:
        query = (
            self.db.query(Notificacion)
            .filter(Notificacion.persona_id == persona_id)
            .order_by(Notificacion.fecha_creacion.desc(), Notificacion.id.desc())
            .offset(skip)
        )
        if limit is not None:
            query = query.limit(limit)
        return query.all()

    def contar_por_persona(self, persona_id: int) -> int:
        """Total del feed de ESA persona -- mismo filtro que
        `listar_por_persona`, para que el `total` del envelope paginado
        cuente el historial completo y no la página."""
        return (
            self.db.query(func.count(Notificacion.id))
            .filter(Notificacion.persona_id == persona_id)
            .scalar()
        )

    def marcar_leida(self, notificacion: Notificacion) -> Notificacion:
        notificacion.leida = True
        self.db.commit()
        self.db.refresh(notificacion)
        return notificacion
