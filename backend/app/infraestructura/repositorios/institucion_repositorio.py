from typing import List, Optional
from sqlalchemy.orm import Session

from app.dominio.modelos import Institucion


class InstitucionRepositorio:
    """Acceso a datos de Institución educativa."""

    def __init__(self, db: Session):
        self.db = db

    def listar(self) -> List[Institucion]:
        return self.db.query(Institucion).order_by(Institucion.nombre).all()

    def obtener_por_id(self, institucion_id: int) -> Optional[Institucion]:
        return self.db.get(Institucion, institucion_id)

    def crear(self, institucion: Institucion) -> Institucion:
        self.db.add(institucion)
        self.db.commit()
        self.db.refresh(institucion)
        return institucion
