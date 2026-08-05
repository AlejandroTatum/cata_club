from typing import Optional, List
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dominio.modelos import Pais, Provincia, Canton


class PaisRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, pais_id: int) -> Optional[Pais]:
        return self.db.get(Pais, pais_id)

    def listar(self, skip: int = 0, limit: Optional[int] = None) -> List[Pais]:
        # Alfabético porque el catálogo alimenta un selector de ubicación. El
        # id desempata: `nombre` NO es UNIQUE, y sin orden TOTAL `OFFSET/LIMIT`
        # puede repetir o saltear filas entre páginas.
        stmt = select(Pais).order_by(Pais.nombre.asc(), Pais.id.asc()).offset(skip)
        if limit is not None:          # None = sin tope: preserva a los
            stmt = stmt.limit(limit)   # llamadores actuales, que piden todo
        return list(self.db.scalars(stmt).all())

    def contar(self) -> int:
        stmt = select(func.count()).select_from(Pais)
        return self.db.execute(stmt).scalar_one()

    def crear(self, pais: Pais) -> Pais:
        self.db.add(pais)
        self.db.commit()
        self.db.refresh(pais)
        return pais


class ProvinciaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, provincia_id: int) -> Optional[Provincia]:
        return self.db.get(Provincia, provincia_id)

    def listar(
        self, pais_id: Optional[int] = None,
        skip: int = 0, limit: Optional[int] = None,
    ) -> List[Provincia]:
        stmt = select(Provincia)
        if pais_id is not None:
            stmt = stmt.where(Provincia.pais_id == pais_id)
        # Alfabético con id de desempate: `nombre` NO es UNIQUE, y sin orden
        # TOTAL `OFFSET/LIMIT` puede repetir o saltear filas entre páginas.
        stmt = stmt.order_by(Provincia.nombre.asc(), Provincia.id.asc()).offset(skip)
        if limit is not None:          # None = sin tope: preserva a los
            stmt = stmt.limit(limit)   # llamadores actuales, que piden todo
        return list(self.db.scalars(stmt).all())

    def contar(self, pais_id: Optional[int] = None) -> int:
        """Mismo filtro que `listar`, sin skip/limit: el `total` del envelope
        cuenta el conjunto completo, no la página."""
        stmt = select(func.count()).select_from(Provincia)
        if pais_id is not None:
            stmt = stmt.where(Provincia.pais_id == pais_id)
        return self.db.execute(stmt).scalar_one()

    def crear(self, provincia: Provincia) -> Provincia:
        self.db.add(provincia)
        self.db.commit()
        self.db.refresh(provincia)
        return provincia


class CantonRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, canton_id: int) -> Optional[Canton]:
        return self.db.get(Canton, canton_id)

    def listar(
        self, provincia_id: Optional[int] = None,
        skip: int = 0, limit: Optional[int] = None,
    ) -> List[Canton]:
        stmt = select(Canton)
        if provincia_id is not None:
            stmt = stmt.where(Canton.provincia_id == provincia_id)
        # Alfabético con id de desempate: `nombre` NO es UNIQUE, y sin orden
        # TOTAL `OFFSET/LIMIT` puede repetir o saltear filas entre páginas.
        stmt = stmt.order_by(Canton.nombre.asc(), Canton.id.asc()).offset(skip)
        if limit is not None:          # None = sin tope: preserva a los
            stmt = stmt.limit(limit)   # llamadores actuales, que piden todo
        return list(self.db.scalars(stmt).all())

    def contar(self, provincia_id: Optional[int] = None) -> int:
        """Mismo filtro que `listar`, sin skip/limit: el `total` del envelope
        cuenta el conjunto completo, no la página."""
        stmt = select(func.count()).select_from(Canton)
        if provincia_id is not None:
            stmt = stmt.where(Canton.provincia_id == provincia_id)
        return self.db.execute(stmt).scalar_one()

    def crear(self, canton: Canton) -> Canton:
        self.db.add(canton)
        self.db.commit()
        self.db.refresh(canton)
        return canton
