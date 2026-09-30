"""Persistencia de reportes sensibles (#1401)."""
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.dominio.modelos import ReporteError


class ReporteErrorRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def crear(self, reporte: ReporteError) -> ReporteError:
        self.db.add(reporte)
        self.db.flush()
        return reporte

    def listar(self, skip: int, limit: int) -> list[ReporteError]:
        return list(self.db.scalars(select(ReporteError).order_by(
            ReporteError.fecha_creacion.desc(), ReporteError.id.desc()
        ).offset(skip).limit(limit)))

    def obtener(self, reporte_id: int) -> ReporteError | None:
        return self.db.get(ReporteError, reporte_id)

    def purgar_anteriores(self, fecha: datetime) -> int:
        return self.db.execute(delete(ReporteError).where(ReporteError.fecha_creacion < fecha)).rowcount

    def borrar_por_persona(self, persona_id: int) -> int:
        return self.db.execute(delete(ReporteError).where(ReporteError.persona_id == persona_id)).rowcount
