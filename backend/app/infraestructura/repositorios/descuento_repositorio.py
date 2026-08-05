from typing import List, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dominio.modelos import Descuento


class DescuentoRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, descuento_id: int) -> Optional[Descuento]:
        return self.db.get(Descuento, descuento_id)

    def obtener_por_nombre(self, nombre: str) -> Optional[Descuento]:
        stmt = select(Descuento).where(Descuento.nombre == nombre)
        return self.db.execute(stmt).scalars().first()

    def listar(self, skip: int = 0, limit: Optional[int] = None) -> List[Descuento]:
        """Catálogo completo, INCLUIDOS los inactivos: el listado es del
        administrador, que necesita ver (y poder reactivar) la historia.

        Orden por `id`, SIN cambios (D4): a diferencia de geografía, este
        catálogo tiene un consumidor real (`frontend/src/app/discounts/
        page.tsx`) y reordenarlo sería un cambio de comportamiento visible
        sobre un endpoint ya consumido. `id` ya es un orden TOTAL, así que
        la paginación sobre él ya es determinística sin desempate extra."""
        stmt = select(Descuento).order_by(Descuento.id).offset(skip)
        if limit is not None:          # None = sin tope: preserva a los
            stmt = stmt.limit(limit)   # llamadores actuales, que piden todo
        return list(self.db.execute(stmt).scalars().all())

    def contar(self) -> int:
        stmt = select(func.count()).select_from(Descuento)
        return self.db.execute(stmt).scalar_one()

    def crear(self, descuento: Descuento) -> Descuento:
        self.db.add(descuento)
        self.db.commit()
        self.db.refresh(descuento)
        return descuento

    def guardar_cambios(self, descuento: Descuento) -> Descuento:
        self.db.commit()
        self.db.refresh(descuento)
        return descuento
