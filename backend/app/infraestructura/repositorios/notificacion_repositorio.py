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

    def listar_por_persona(self, persona_id: int) -> list[Notificacion]:
        return (
            self.db.query(Notificacion)
            .filter(Notificacion.persona_id == persona_id)
            .order_by(Notificacion.fecha_creacion.desc())
            .all()
        )

    def marcar_leida(self, notificacion: Notificacion) -> Notificacion:
        notificacion.leida = True
        self.db.commit()
        self.db.refresh(notificacion)
        return notificacion
