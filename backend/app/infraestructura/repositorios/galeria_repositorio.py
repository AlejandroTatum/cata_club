from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import EntradaGaleria


class GaleriaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def listar(self) -> list[EntradaGaleria]:
        return list(self.db.execute(select(EntradaGaleria).order_by(EntradaGaleria.id)).scalars().all())

    def obtener_por_id(self, entrada_id: int) -> EntradaGaleria | None:
        return self.db.get(EntradaGaleria, entrada_id)

    def crear(self, entrada: EntradaGaleria) -> EntradaGaleria:
        self.db.add(entrada)
        self.db.flush()
        return entrada

    def eliminar(self, entrada: EntradaGaleria) -> None:
        self.db.delete(entrada)
        self.db.flush()
