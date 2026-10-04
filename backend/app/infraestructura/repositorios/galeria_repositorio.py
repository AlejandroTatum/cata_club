from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.dominio.modelos import EntradaGaleria


class GaleriaRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def listar(self, *, solo_visibles: bool = False) -> list[EntradaGaleria]:
        consulta = select(EntradaGaleria).order_by(EntradaGaleria.orden, EntradaGaleria.id)
        if solo_visibles:
            consulta = consulta.where(EntradaGaleria.visible.is_(True))
        return list(self.db.execute(consulta).scalars().all())

    def siguiente_orden(self) -> int:
        maximo = self.db.execute(select(func.max(EntradaGaleria.orden))).scalar()
        return 0 if maximo is None else maximo + 1

    def obtener_por_id(self, entrada_id: int) -> EntradaGaleria | None:
        return self.db.get(EntradaGaleria, entrada_id)

    def crear(self, entrada: EntradaGaleria) -> EntradaGaleria:
        self.db.add(entrada)
        self.db.flush()
        return entrada

    def eliminar(self, entrada: EntradaGaleria) -> None:
        self.db.delete(entrada)
        self.db.flush()
