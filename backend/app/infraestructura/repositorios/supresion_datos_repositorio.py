"""Acceso a datos de `SolicitudSupresionDatos` (issue #1062).

Mismo contrato que el resto de los repositorios: solo consultas y escrituras
con `flush()`; el `commit()` es del caso de uso (`SupresionDatosServicio`,
issue #831).
"""
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.dominio.modelos import SolicitudSupresionDatos


class SolicitudSupresionDatosRepositorio:
    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, solicitud_id: int) -> Optional[SolicitudSupresionDatos]:
        return self.db.get(SolicitudSupresionDatos, solicitud_id)

    def listar(self) -> List[SolicitudSupresionDatos]:
        """Nómina admin: la más reciente primero."""
        return list(
            self.db.execute(
                select(SolicitudSupresionDatos)
                .order_by(
                    SolicitudSupresionDatos.fecha_solicitud.desc(),
                    SolicitudSupresionDatos.id.desc(),
                )
            )
            .scalars()
            .all()
        )

    def hay_solicitud_activa(self, persona_id: int) -> bool:
        """`True` si la persona ya tiene una petición RECIBIDA o APROBADA:
        una segunda petición abierta para la misma persona no aporta nada y
        confundiría al administrador sobre cuál ejecutar."""
        return (
            self.db.execute(
                select(SolicitudSupresionDatos.id)
                .where(
                    SolicitudSupresionDatos.persona_id == persona_id,
                    SolicitudSupresionDatos.estado.in_(("RECIBIDA", "APROBADA")),
                )
                .limit(1)
            )
            .scalar()
            is not None
        )

    def crear(self, solicitud: SolicitudSupresionDatos) -> SolicitudSupresionDatos:
        self.db.add(solicitud)
        self.db.flush()
        return solicitud

    def guardar(self, solicitud: SolicitudSupresionDatos) -> SolicitudSupresionDatos:
        self.db.flush()
        return solicitud
