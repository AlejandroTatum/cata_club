from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import ConsentimientoLegal, RevocacionConsentimientoLegal


class ConsentimientoLegalRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener(self, consentimiento_id: int) -> Optional[ConsentimientoLegal]:
        return self.db.get(ConsentimientoLegal, consentimiento_id)

    def obtener_por_clave(
        self, cuenta_id: int, documento: str, version: str, representado_persona_id: Optional[int]
    ) -> Optional[ConsentimientoLegal]:
        return self.db.scalar(
            select(ConsentimientoLegal).where(
                ConsentimientoLegal.cuenta_id == cuenta_id,
                ConsentimientoLegal.documento == documento,
                ConsentimientoLegal.version_documento == version,
                ConsentimientoLegal.representado_persona_id == representado_persona_id,
            )
        )

    def guardar(self, registro: ConsentimientoLegal) -> ConsentimientoLegal:
        self.db.add(registro)
        self.db.flush()
        return registro

    def guardar_revocacion(self, evento: RevocacionConsentimientoLegal) -> RevocacionConsentimientoLegal:
        self.db.add(evento)
        self.db.flush()
        return evento

    def obtener_revocacion(self, consentimiento_id: int) -> Optional[RevocacionConsentimientoLegal]:
        return self.db.scalar(
            select(RevocacionConsentimientoLegal).where(
                RevocacionConsentimientoLegal.consentimiento_id == consentimiento_id
            )
        )
