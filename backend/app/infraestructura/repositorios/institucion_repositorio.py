from typing import List, Optional
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dominio.modelos import Institucion


class InstitucionRepositorio:
    """Acceso a datos de Institución educativa."""

    def __init__(self, db: Session):
        self.db = db

    def listar(self, skip: int = 0, limit: Optional[int] = None) -> List[Institucion]:
        # Alfabético con id de desempate: `nombre` NO es UNIQUE, y sin orden
        # TOTAL `OFFSET/LIMIT` puede repetir o saltear filas entre páginas.
        stmt = select(Institucion).order_by(Institucion.nombre.asc(), Institucion.id.asc()).offset(skip)
        if limit is not None:          # None = sin tope: preserva a los
            stmt = stmt.limit(limit)   # llamadores actuales, que piden todo
        return list(self.db.scalars(stmt).all())

    def contar(self) -> int:
        stmt = select(func.count()).select_from(Institucion)
        return self.db.execute(stmt).scalar_one()

    def obtener_por_id(self, institucion_id: int) -> Optional[Institucion]:
        return self.db.get(Institucion, institucion_id)

    def crear(self, institucion: Institucion) -> Institucion:
        self.db.add(institucion)
        self.db.commit()
        self.db.refresh(institucion)
        return institucion
