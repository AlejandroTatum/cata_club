from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.enums import EstadoSolicitudCorreccion
from app.dominio.etiquetas import dia_en_castellano
from app.dominio.excepciones import (
    EntidadDuplicada, EntidadNoEncontrada, OperacionInvalida, PermisosInsuficientes,
)
from app.dominio.modelos import SolicitudCorreccionAsistencia as Solicitud
from app.dominio.nombre_propio import nombre_completo
from app.dominio.reglas_negocio import LIMITE_CORRECCION_ASISTENCIA_DIAS
from app.infraestructura.repositorios.asistencia_repositorio import AsistenciaRepositorio
from app.infraestructura.repositorios.solicitud_correccion_repositorio import (
    SolicitudCorreccionRepositorio,
)
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio
from app.servicios_negocio.dtos.asistencia_schemas import (
    AsistenciaCorreccionDTO, SolicitudCorreccionCreateDTO, SolicitudCorreccionResponseDTO,
)
from app.soporte_transversal.tiempo import hoy_club

INDICE_PENDIENTE_UNICA = "uq_solicitud_correccion_pendiente_por_asistencia"


class SolicitudCorreccionServicio:
    """QA4 ENT-25: el entrenador PIDE corregir una lista cerrada; solo el
    administrador resuelve. Aprobar delega en
    `AsistenciaServicio.corregir_asistencia`, el único camino de corrección
    (con su traza), así que esta clase nunca muta una `Asistencia`."""

    def __init__(self, db: Session):
        self.db = db
        self.repo = SolicitudCorreccionRepositorio(db)
        self.asistencias = AsistenciaRepositorio(db)

    # -- entrenador ---------------------------------------------------------
    def crear(
        self, datos: SolicitudCorreccionCreateDTO, roles: list[str], persona_id: int,
    ) -> SolicitudCorreccionResponseDTO:
        if "ENTRENADOR" not in roles:
            raise PermisosInsuficientes("Solo un entrenador puede pedir una corrección.")
        motivo = datos.motivo.strip()
        if not motivo:
            raise OperacionInvalida(
                "Indique el motivo de la corrección.",
                detalle_tecnico=f"motivo en blanco: asistencia_id={datos.asistencia_id}",
            )
        asistencia = self.asistencias.obtener_por_id(datos.asistencia_id)
        if not asistencia:
            raise EntidadNoEncontrada(f"Asistencia con id {datos.asistencia_id} no encontrada")
        if datos.estado_solicitado == asistencia.estado:
            raise OperacionInvalida(
                "Ese alumno ya figura con ese estado: no hay nada que corregir.",
                detalle_tecnico=f"solicitud sin cambio: asistencia_id={asistencia.id}",
            )
        antiguedad_dias = (hoy_club() - asistencia.fecha_entrenamiento).days
        if antiguedad_dias > LIMITE_CORRECCION_ASISTENCIA_DIAS:
            raise OperacionInvalida(
                "No se puede corregir una asistencia de hace más de "
                f"{LIMITE_CORRECCION_ASISTENCIA_DIAS} días.",
                detalle_tecnico=f"asistencia_id={asistencia.id} antiguedad_dias={antiguedad_dias}",
            )
        if self.repo.hay_pendiente(asistencia.id):
            raise EntidadDuplicada(
                "Ya hay una solicitud pendiente para este alumno en esa sesión.",
                detalle_tecnico=f"pendiente duplicada: asistencia_id={asistencia.id}",
            )
        solicitud = Solicitud(
            asistencia_id=asistencia.id,
            solicitado_por_id=persona_id,
            estado_solicitado=datos.estado_solicitado,
            motivo=motivo,
        )
        try:
            self.repo.crear(solicitud)
        except IntegrityError as exc:
            self.db.rollback()
            if not self._es_pendiente_duplicada(exc):
                # Otra restricción: no es un duplicado, no se le miente al
                # usuario. Sube tal cual y el manejador global la responde
                # como conflicto genérico (con traza en el log).
                raise
            raise EntidadDuplicada(
                "Ya hay una solicitud pendiente para este alumno en esa sesión.",
                detalle_tecnico=f"pendiente duplicada (carrera): asistencia_id={asistencia.id}",
            ) from None
        self.db.commit()
        return self._a_dto(solicitud, self.repo.etiquetas_de_categorias())

    # -- entrenador (solo las suyas) y administrador (todas) ----------------
    def listar(
        self, roles: list[str], persona_id: int, *,
        estado: Optional[EstadoSolicitudCorreccion] = None,
        horario_id: Optional[int] = None, fecha: Optional[date] = None,
    ) -> list[SolicitudCorreccionResponseDTO]:
        # Fail-closed: solo el administrador ve todas; el entrenador, solo las
        # suyas, y sin dueño conocido (o con otro rol) no se devuelve nada.
        if "ADMINISTRADOR" in roles:
            dueno_id = None
        elif "ENTRENADOR" in roles and persona_id is not None:
            dueno_id = persona_id
        else:
            raise PermisosInsuficientes("No tiene permiso para ver estas solicitudes.")
        solicitudes = self.repo.listar(
            estado=estado,
            solicitado_por_id=dueno_id,
            horario_id=horario_id,
            fecha=fecha,
        )
        etiquetas = self.repo.etiquetas_de_categorias()
        return [self._a_dto(s, etiquetas) for s in solicitudes]

    # -- administrador ------------------------------------------------------
    def aprobar(
        self, solicitud_id: int, roles: list[str], persona_id: int,
    ) -> SolicitudCorreccionResponseDTO:
        self._exigir_admin(roles)
        solicitud = self._pendiente(solicitud_id)
        asistencia = solicitud.asistencia
        # La resolución se marca ANTES y `corregir_asistencia` comitea ambas
        # cosas juntas: o se aplica la corrección y la solicitud queda
        # aprobada, o no cambia nada (sin cambio, fuera de plazo) y el admin
        # puede rechazarla.
        self._marcar(solicitud, EstadoSolicitudCorreccion.APROBADA, persona_id, None)
        try:
            AsistenciaServicio(self.db).corregir_asistencia(
                asistencia.id,
                AsistenciaCorreccionDTO(
                    estado=solicitud.estado_solicitado,
                    # Se conservan tal cual: la solicitud no los toca.
                    justificativo=asistencia.justificativo,
                    estado_justificativo=asistencia.estado_justificativo,
                    motivo=f"Solicitud del entrenador: {solicitud.motivo}"[:500],
                ),
                roles, persona_id,
            )
        except Exception:
            self.db.rollback()
            raise
        self.db.refresh(solicitud)
        return self._a_dto(solicitud, self.repo.etiquetas_de_categorias())

    def rechazar(
        self, solicitud_id: int, motivo: str, roles: list[str], persona_id: int,
    ) -> SolicitudCorreccionResponseDTO:
        self._exigir_admin(roles)
        motivo = motivo.strip()
        if not motivo:
            raise OperacionInvalida(
                "Indique por qué se rechaza la solicitud.",
                detalle_tecnico=f"rechazo sin motivo: solicitud_id={solicitud_id}",
            )
        solicitud = self._pendiente(solicitud_id)
        self._marcar(solicitud, EstadoSolicitudCorreccion.RECHAZADA, persona_id, motivo)
        self.db.commit()
        self.db.refresh(solicitud)
        return self._a_dto(solicitud, self.repo.etiquetas_de_categorias())

    # -- internos -----------------------------------------------------------
    @staticmethod
    def _es_pendiente_duplicada(exc: IntegrityError) -> bool:
        """Solo la violación del índice único parcial de pendientes."""
        orig = exc.orig
        nombre = getattr(getattr(orig, "diag", None), "constraint_name", None)
        return INDICE_PENDIENTE_UNICA in (nombre or str(orig))

    @staticmethod
    def _exigir_admin(roles: list[str]) -> None:
        if "ADMINISTRADOR" not in roles:
            raise PermisosInsuficientes("Solo un administrador puede resolver una solicitud.")

    def _pendiente(self, solicitud_id: int) -> Solicitud:
        solicitud = self.repo.obtener_por_id(solicitud_id)
        if not solicitud:
            raise EntidadNoEncontrada(f"Solicitud con id {solicitud_id} no encontrada")
        if solicitud.estado != EstadoSolicitudCorreccion.PENDIENTE:
            raise OperacionInvalida(
                "Esa solicitud ya fue resuelta.",
                detalle_tecnico=f"solicitud_id={solicitud_id} estado={solicitud.estado.value}",
            )
        return solicitud

    @staticmethod
    def _marcar(
        solicitud: Solicitud, estado: EstadoSolicitudCorreccion, persona_id: int,
        motivo: Optional[str],
    ) -> None:
        solicitud.estado = estado
        solicitud.resuelto_por_id = persona_id
        solicitud.resuelto_en = datetime.now(timezone.utc)
        solicitud.motivo_resolucion = motivo

    @staticmethod
    def _a_dto(solicitud: Solicitud, etiquetas: dict[str, str]) -> SolicitudCorreccionResponseDTO:
        asistencia = solicitud.asistencia
        horario = asistencia.horario
        categoria = etiquetas.get(horario.categoria, horario.categoria)
        return SolicitudCorreccionResponseDTO(
            id=solicitud.id,
            asistencia_id=asistencia.id,
            persona_id=asistencia.persona_id,
            persona_nombre=nombre_completo(asistencia.persona.nombres, asistencia.persona.apellidos),
            horario_id=asistencia.horario_id,
            fecha=asistencia.fecha_entrenamiento,
            horario_etiqueta=(
                f"{categoria} · {dia_en_castellano(horario.dia_semana).lower()} "
                f"{horario.hora_inicio:%H:%M}"
            ),
            estado_actual=asistencia.estado,
            estado_solicitado=solicitud.estado_solicitado,
            motivo=solicitud.motivo,
            solicitado_por_id=solicitud.solicitado_por_id,
            solicitado_por_nombre=solicitud.solicitado_por_nombre,
            solicitado_en=solicitud.solicitado_en,
            estado=solicitud.estado,
            resuelto_por_id=solicitud.resuelto_por_id,
            resuelto_por_nombre=solicitud.resuelto_por_nombre,
            resuelto_en=solicitud.resuelto_en,
            motivo_resolucion=solicitud.motivo_resolucion,
        )
