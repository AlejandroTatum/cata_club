from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import (
    ConsentimientoLegal,
    Persona,
    RevocacionConsentimientoLegal,
    Usuario,
)


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

    def claves_de_cuenta(
        self, cuenta_id: int, version: Optional[str] = None
    ) -> set[tuple[str, Optional[int]]]:
        """Los pares (documento, representado) que la cuenta aceptó, en
        cualquier versión o solo en `version`."""
        consulta = select(
            ConsentimientoLegal.documento, ConsentimientoLegal.representado_persona_id
        ).where(ConsentimientoLegal.cuenta_id == cuenta_id)
        if version is not None:
            consulta = consulta.where(ConsentimientoLegal.version_documento == version)
        return {(documento, representado) for documento, representado in self.db.execute(consulta)}

    def claves_activas_de_cuenta(self, cuenta_id: int) -> set[tuple[str, Optional[int]]]:
        """Pares (documento, representado) que la cuenta aceptó y siguen en
        pie: la última aceptación del par no fue revocada y, si el par es de
        un representado, la cuenta lo representa HOY (`Persona.representante_id`
        contra la persona de la cuenta). Una sola consulta."""
        filas = self.db.execute(
            select(
                ConsentimientoLegal.documento,
                ConsentimientoLegal.representado_persona_id,
                RevocacionConsentimientoLegal.id.is_not(None),
                Persona.representante_id == Usuario.persona_id,
            )
            .select_from(ConsentimientoLegal)
            .join(Usuario, Usuario.id == ConsentimientoLegal.cuenta_id)
            .outerjoin(
                RevocacionConsentimientoLegal,
                RevocacionConsentimientoLegal.consentimiento_id == ConsentimientoLegal.id,
            )
            .outerjoin(Persona, Persona.id == ConsentimientoLegal.representado_persona_id)
            .where(ConsentimientoLegal.cuenta_id == cuenta_id)
            .order_by(ConsentimientoLegal.id)
        )
        ultima = {
            (documento, representado): (revocada, representada_hoy)
            for documento, representado, revocada, representada_hoy in filas
        }
        return {
            clave
            for clave, (revocada, representada_hoy) in ultima.items()
            if not revocada and (clave[1] is None or representada_hoy)
        }

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
