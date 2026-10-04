from datetime import date
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.dominio.enums import EstadoSolicitudCorreccion
from app.dominio.modelos import SolicitudCorreccionAsistencia as Solicitud
from app.dominio.modelos import Asistencia, CategoriaHorario


class SolicitudCorreccionRepositorio:
    """Persistencia de `SolicitudCorreccionAsistencia` (QA4 ENT-25). Solo
    `flush()`: el caso de uso comitea una vez."""

    def __init__(self, db: Session):
        self.db = db

    def obtener_por_id(self, solicitud_id: int) -> Optional[Solicitud]:
        return self.db.get(Solicitud, solicitud_id)

    def hay_pendiente(self, asistencia_id: int) -> bool:
        stmt = select(Solicitud.id).where(
            Solicitud.asistencia_id == asistencia_id,
            Solicitud.estado == EstadoSolicitudCorreccion.PENDIENTE,
        )
        return self.db.execute(stmt).first() is not None

    def crear(self, solicitud: Solicitud) -> Solicitud:
        """`IntegrityError` si otra solicitud pendiente de la misma fila ganó
        la carrera (índice único parcial): lo traduce el servicio."""
        self.db.add(solicitud)
        self.db.flush()
        return solicitud

    def listar(
        self,
        *,
        estado: Optional[EstadoSolicitudCorreccion] = None,
        solicitado_por_id: Optional[int] = None,
        horario_id: Optional[int] = None,
        fecha: Optional[date] = None,
    ) -> list[Solicitud]:
        """Más viejas primero (la bandeja se atiende en orden de llegada)."""
        stmt = (
            select(Solicitud)
            .join(Asistencia, Solicitud.asistencia_id == Asistencia.id)
            .options(
                joinedload(Solicitud.solicitado_por),
                joinedload(Solicitud.resuelto_por),
                joinedload(Solicitud.asistencia).joinedload(Asistencia.persona),
                joinedload(Solicitud.asistencia).joinedload(Asistencia.horario),
            )
            .order_by(Solicitud.solicitado_en.asc(), Solicitud.id.asc())
        )
        if estado is not None:
            stmt = stmt.where(Solicitud.estado == estado)
        if solicitado_por_id is not None:
            stmt = stmt.where(Solicitud.solicitado_por_id == solicitado_por_id)
        if horario_id is not None:
            stmt = stmt.where(Asistencia.horario_id == horario_id)
        if fecha is not None:
            stmt = stmt.where(Asistencia.fecha_entrenamiento == fecha)
        return list(self.db.execute(stmt).scalars().unique().all())

    def etiquetas_de_categorias(self) -> dict[str, str]:
        """`codigo -> label` del catálogo: pocas filas, una consulta."""
        filas = self.db.execute(select(CategoriaHorario.codigo, CategoriaHorario.label)).all()
        return {codigo: label for codigo, label in filas}
