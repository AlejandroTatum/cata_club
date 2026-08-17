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

    def crear(self, antecedentes: AntecedentesClub, *, commit: bool = True) -> AntecedentesClub:
        """`commit=False`: ver `PersonaRepositorio.crear` (issue #338)."""
        self.db.add(antecedentes)
        if commit:
            self.db.commit()
            self.db.refresh(antecedentes)
        else:
            self.db.flush()
        return antecedentes

    def guardar_cambios(self, antecedentes: AntecedentesClub) -> AntecedentesClub:
        self.db.commit()
        self.db.refresh(antecedentes)
        return antecedentes
