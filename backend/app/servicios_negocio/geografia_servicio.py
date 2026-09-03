from typing import Optional, List

from sqlalchemy.orm import Session

from app.dominio.modelos import Pais, Provincia, Canton
from app.dominio.excepciones import EntidadNoEncontrada
from app.infraestructura.repositorios.geografia_repositorio import (
    PaisRepositorio, ProvinciaRepositorio, CantonRepositorio,
)
from app.servicios_negocio.dtos.geografia_schemas import (
    PaisCreateDTO, ProvinciaCreateDTO, CantonCreateDTO,
)


class PaisServicio:
    """Reglas de negocio de Pais. Lanza excepciones de dominio; no conoce
    FastAPI ni HTTPException (mismo patrón que PersonaServicio)."""

    def __init__(self, db: Session):
        self.db = db
        self.repo = PaisRepositorio(db)

    def crear_pais(self, datos: PaisCreateDTO) -> Pais:
        resultado = self.repo.crear(Pais(**datos.model_dump()))
        self.db.commit()
        return resultado

    def listar_paises(self, skip: int = 0, limit: Optional[int] = None) -> List[Pais]:
        return self.repo.listar(skip=skip, limit=limit)

    def contar_paises(self) -> int:
        return self.repo.contar()

    def obtener_pais(self, pais_id: int) -> Pais:
        pais = self.repo.obtener_por_id(pais_id)
        if not pais:
            raise EntidadNoEncontrada(f"País con id {pais_id} no encontrado")
        return pais


class ProvinciaServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ProvinciaRepositorio(db)
        self.repo_pais = PaisRepositorio(db)

    def crear_provincia(self, datos: ProvinciaCreateDTO) -> Provincia:
        if not self.repo_pais.obtener_por_id(datos.pais_id):
            raise EntidadNoEncontrada(f"País con id {datos.pais_id} no encontrado")
        resultado = self.repo.crear(Provincia(**datos.model_dump()))
        self.db.commit()
        return resultado

    def listar_provincias(
        self, pais_id: Optional[int] = None,
        skip: int = 0, limit: Optional[int] = None,
    ) -> List[Provincia]:
        return self.repo.listar(pais_id=pais_id, skip=skip, limit=limit)

    def contar_provincias(self, pais_id: Optional[int] = None) -> int:
        return self.repo.contar(pais_id=pais_id)

    def obtener_provincia(self, provincia_id: int) -> Provincia:
        provincia = self.repo.obtener_por_id(provincia_id)
        if not provincia:
            raise EntidadNoEncontrada(f"Provincia con id {provincia_id} no encontrada")
        return provincia


class CantonServicio:
    def __init__(self, db: Session):
        self.db = db
        self.repo = CantonRepositorio(db)
        self.repo_provincia = ProvinciaRepositorio(db)

    def crear_canton(self, datos: CantonCreateDTO) -> Canton:
        if not self.repo_provincia.obtener_por_id(datos.provincia_id):
            raise EntidadNoEncontrada(
                f"Provincia con id {datos.provincia_id} no encontrada"
            )
        resultado = self.repo.crear(Canton(**datos.model_dump()))
        self.db.commit()
        return resultado

    def listar_cantones(
        self, provincia_id: Optional[int] = None,
        skip: int = 0, limit: Optional[int] = None,
    ) -> List[Canton]:
        return self.repo.listar(provincia_id=provincia_id, skip=skip, limit=limit)

    def contar_cantones(self, provincia_id: Optional[int] = None) -> int:
        return self.repo.contar(provincia_id=provincia_id)

    def obtener_canton(self, canton_id: int) -> Canton:
        canton = self.repo.obtener_por_id(canton_id)
        if not canton:
            raise EntidadNoEncontrada(f"Cantón con id {canton_id} no encontrado")
        return canton
