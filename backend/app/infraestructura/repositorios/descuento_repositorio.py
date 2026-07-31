from typing import List, Optional

from sqlalchemy import select
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

    def listar(self) -> List[Descuento]:
        """Catálogo completo, INCLUIDOS los inactivos: el listado es del
        administrador, que necesita ver (y poder reactivar) la historia."""
        stmt = select(Descuento).order_by(Descuento.id)
        return list(self.db.execute(stmt).scalars().all())

    def crear(self, descuento: Descuento) -> Descuento:
        self.db.add(descuento)
        self.db.commit()
        self.db.refresh(descuento)
        return descuento

    def guardar_cambios(self, descuento: Descuento) -> Descuento:
        self.db.commit()
        self.db.refresh(descuento)
        return descuento
