from typing import Mapping, Optional, Sequence

from sqlalchemy.orm import Session

from app.dominio.modelos import ConsentimientoLegal, RevocacionConsentimientoLegal
from app.infraestructura.repositorios.consentimiento_legal_repositorio import (
    ConsentimientoLegalRepositorio,
)

DOCUMENTOS_LEGALES = ("TERMINOS", "PRIVACIDAD", "DATOS_MEDICOS", "FETM")
VERSION_LEGAL_VIGENTE = "1.0"
TEXTOS_LEGALES_VIGENTES = {
    "TERMINOS": "Términos de uso vigentes de Cata Club.",
    "PRIVACIDAD": "Aviso de privacidad vigente de Cata Club.",
    "DATOS_MEDICOS": "Consentimiento para el tratamiento de datos médicos y de emergencia.",
    "FETM": "Permiso público de difusión de imagen conforme al documento FETM.",
}


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
        """Caso de uso independiente: registra Y comitea (issue #831, mismo
        criterio que `revocar`). `EnrollmentServicio.enroll` NO llama a este
        método -- usa `_registrar_aceptacion_grupal_nucleo` directo, sin
        commit, porque ahí la aceptación es un paso más de la transacción
        atómica de la inscripción completa (mismo patrón que
        `PersonaServicio._crear_persona_validada`, el núcleo sin commit de
        `registrar_persona`)."""
        registros = self._registrar_aceptacion_grupal_nucleo(
            cuenta_id=cuenta_id,
            documentos=documentos,
            version=version,
            texto_por_documento=texto_por_documento,
            representado_persona_id=representado_persona_id,
        )
        self.db.commit()
        return registros

    def _registrar_aceptacion_grupal_nucleo(
        self,
        *,
        cuenta_id: int,
        documentos: Sequence[str],
        version: str,
        texto_por_documento: Mapping[str, str],
        representado_persona_id: Optional[int] = None,
    ) -> list[ConsentimientoLegal]:
        """Núcleo SIN commit de `registrar_aceptacion_grupal` (issue #831):
        antes existía `commit: bool = True` para esta misma distinción (mismo
        hueco que el `commit` de los repositorios, issue #338); ahora es un
        método propio, no un flag."""
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
