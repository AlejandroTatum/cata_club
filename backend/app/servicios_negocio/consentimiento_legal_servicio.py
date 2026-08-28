from typing import Mapping, Optional, Sequence

from sqlalchemy.orm import Session

from app.dominio.modelos import ConsentimientoLegal, RevocacionConsentimientoLegal
from app.infraestructura.repositorios.consentimiento_legal_repositorio import (
    ConsentimientoLegalRepositorio,
)

DOCUMENTOS_LEGALES = frozenset(("TERMINOS", "PRIVACIDAD", "DATOS_MEDICOS", "FETM"))


class ConsentimientoLegalServicio:
    """Contrato transaccional para aceptar y retirar consentimientos legales."""

    def __init__(self, db: Session):
        self.repo = ConsentimientoLegalRepositorio(db)
        self.db = db

    def registrar_aceptacion_grupal(
        self,
        *,
        cuenta_id: int,
        documentos: Sequence[str],
        version: str,
        texto_por_documento: Mapping[str, str],
        representado_persona_id: Optional[int] = None,
    ) -> list[ConsentimientoLegal]:
        documentos = tuple(documentos)
        if not documentos or any(documento not in DOCUMENTOS_LEGALES for documento in documentos):
            raise ValueError("documento legal no reconocido")
        if len(set(documentos)) != len(documentos) or not version:
            raise ValueError("documentos/version inválidos")
        if any(not texto_por_documento.get(documento) for documento in documentos):
            raise ValueError("cada documento requiere el texto aceptado")

        registros = []
        for documento in documentos:
            existente = self.repo.obtener_por_clave(
                cuenta_id, documento, version, representado_persona_id
            )
            if existente is not None:
                registros.append(existente)
                continue
            registros.append(self.repo.guardar(ConsentimientoLegal(
                cuenta_id=cuenta_id,
                representado_persona_id=representado_persona_id,
                documento=documento,
                version_documento=version,
                texto_aceptado=texto_por_documento[documento],
            )))
        self.db.commit()
        return registros

    def revocar(self, consentimiento_id: int, *, cuenta_id: int, motivo: str) -> RevocacionConsentimientoLegal:
        registro = self.repo.obtener(consentimiento_id)
        if registro is None or registro.cuenta_id != cuenta_id:
            raise ValueError("consentimiento no encontrado")
        existente = self.repo.obtener_revocacion(consentimiento_id)
        if existente is not None:
            return existente
        if not motivo.strip():
            raise ValueError("el motivo de revocación es obligatorio")
        evento = self.repo.guardar_revocacion(RevocacionConsentimientoLegal(
            consentimiento_id=consentimiento_id, cuenta_id=cuenta_id, motivo=motivo,
        ))
        self.db.commit()
        return evento

    def esta_vigente(self, consentimiento_id: int) -> bool:
        return (
            self.repo.obtener(consentimiento_id) is not None
            and self.repo.obtener_revocacion(consentimiento_id) is None
        )
