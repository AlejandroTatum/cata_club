from datetime import date
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

    def fechas_inicio_por_personas(self, persona_ids: list[int]) -> dict[int, date]:
        """`persona_id -> fecha_inicio_club` en UNA consulta (sin N+1)."""
        if not persona_ids:
            return {}
        filas = (
            self.db.query(AntecedentesClub.persona_id, AntecedentesClub.fecha_inicio_club)
            .filter(AntecedentesClub.persona_id.in_(persona_ids))
            .all()
        )
        return {persona_id: fecha for persona_id, fecha in filas}

    def crear(self, antecedentes: AntecedentesClub) -> AntecedentesClub:
        """Solo `flush()` (issue #831): el caso de uso comitea una sola vez."""
        self.db.add(antecedentes)
        self.db.flush()
        return antecedentes

    def guardar_cambios(self, antecedentes: AntecedentesClub) -> AntecedentesClub:
        self.db.flush()
        return antecedentes
