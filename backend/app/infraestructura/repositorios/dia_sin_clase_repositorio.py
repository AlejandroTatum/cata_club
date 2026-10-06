from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import DiaSinClase


class DiaSinClaseRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def listar(self, desde: date | None = None, hasta: date | None = None) -> list[DiaSinClase]:
        """Días cuyo rango toca `[desde, hasta]` (extremos opcionales)."""
        stmt = select(DiaSinClase).order_by(DiaSinClase.fecha_inicio, DiaSinClase.id)
        if desde is not None:
            stmt = stmt.where(DiaSinClase.fecha_fin >= desde)
        if hasta is not None:
            stmt = stmt.where(DiaSinClase.fecha_inicio <= hasta)
        return list(self.db.execute(stmt).scalars().all())

    def obtener_por_id(self, dia_id: int) -> DiaSinClase | None:
        return self.db.get(DiaSinClase, dia_id)

    def crear(self, dia: DiaSinClase) -> DiaSinClase:
        self.db.add(dia)
        self.db.flush()
        return dia

    def eliminar(self, dia: DiaSinClase) -> None:
        self.db.delete(dia)
        self.db.flush()
