from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import Sponsor


class SponsorRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def listar(self) -> list[Sponsor]:
        return list(self.db.execute(select(Sponsor).order_by(Sponsor.id)).scalars().all())

    def obtener_por_id(self, sponsor_id: int) -> Sponsor | None:
        return self.db.get(Sponsor, sponsor_id)

    def crear(self, sponsor: Sponsor) -> Sponsor:
        self.db.add(sponsor)
        self.db.flush()
        return sponsor

    def eliminar(self, sponsor: Sponsor) -> None:
        self.db.delete(sponsor)
        self.db.flush()
