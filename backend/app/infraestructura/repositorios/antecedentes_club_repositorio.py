from typing import Optional
from sqlalchemy.orm import Session

from app.dominio.modelos import AntecedentesClub


class AntecedentesClubRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_persona(self, persona_id: int) -> Optional[AntecedentesClub]:
        return (
            self.db.query(AntecedentesClub)
            .filter(AntecedentesClub.persona_id == persona_id)
            .first()
        )

    def crear(self, antecedentes: AntecedentesClub) -> AntecedentesClub:
        """Solo `flush()` (issue #831): el caso de uso comitea una sola vez."""
        self.db.add(antecedentes)
        self.db.flush()
        return antecedentes

    def guardar_cambios(self, antecedentes: AntecedentesClub) -> AntecedentesClub:
        self.db.flush()
        return antecedentes
