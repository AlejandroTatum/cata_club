from typing import Optional

from sqlalchemy.orm import Session

from app.dominio.modelos import Asistencia, HorarioEntrenamiento, AlumnoHorario
from app.dominio.enums import TipoRol, Categoria
from app.dominio.categoria_metadata import CATEGORIA_METADATA
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.asistencia_repositorio import (
    AsistenciaRepositorio, HorarioRepositorio, AlumnoHorarioRepositorio
)
from app.presentacion.schemas.asistencia_schemas import (
    AsistenciaCreateDTO, HorarioCreateDTO, HorarioUpdateDTO,
    AlumnoHorarioCreateDTO, AlumnoHorarioDetalleDTO
)
from app.servicios_negocio.persona_servicio import _calcular_edad


class AsistenciaServicio:
    def __init__(self, db: Session):
        self.repo = AsistenciaRepositorio(db)
        self.repo_horario = HorarioRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        self.repo_alumno_horario = AlumnoHorarioRepositorio(db)

    def _validar_entrenador(self, persona_id: int) -> None:
        """Un entrenador (titular o sustituto) debe ser una Persona con un
        Usuario que tenga el rol ENTRENADOR. Evita asignar por error a
        cualquier persona (ej. un alumno) como responsable de una sesión."""
        persona = self.repo_persona.obtener_por_id(persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Entrenador con id {persona_id} no encontrado")
        tiene_rol_entrenador = bool(
            persona.usuario and any(rol.tipo_rol == TipoRol.ENTRENADOR for rol in persona.usuario.roles)
        )
        if not tiene_rol_entrenador:
            raise OperacionInvalida(
                f"La persona con id {persona_id} no tiene el rol ENTRENADOR asignado"
            )

    def _validar_dia_y_derivar_horas(self, horario: HorarioEntrenamiento) -> None:
        """`hora_inicio`/`hora_fin` nunca los envía el cliente: siempre se
        derivan de `CATEGORIA_METADATA[categoria]`. `dia_semana` debe estar
        en el conjunto de días permitido por esa categoría (ej. Competitivo
        admite Sábado, las otras 4 solo Lun-Vie)."""
        info = CATEGORIA_METADATA[horario.categoria]
        if horario.dia_semana not in info.dias:
            raise OperacionInvalida(
                f"El día {horario.dia_semana.value} no está permitido para "
                f"la categoría {horario.categoria.value}"
            )
        horario.hora_inicio = info.hora_inicio
        horario.hora_fin = info.hora_fin

    def crear_horario(self, datos: HorarioCreateDTO) -> HorarioEntrenamiento:
        self._validar_entrenador(datos.entrenador_id)
        horario = HorarioEntrenamiento(**datos.model_dump())
        self._validar_dia_y_derivar_horas(horario)
        return self.repo_horario.crear(horario)

    def listar_horarios(self, categoria: Optional[Categoria] = None) -> list[HorarioEntrenamiento]:
        return self.repo_horario.listar(categoria)

    def actualizar_horario(self, horario_id: int, datos: HorarioUpdateDTO) -> HorarioEntrenamiento:
        horario = self.repo_horario.obtener_por_id(horario_id)
        if not horario:
            raise EntidadNoEncontrada(f"Horario con id {horario_id} no encontrado")
        update_data = datos.model_dump(exclude_unset=True)
        if not update_data:
            raise OperacionInvalida("No se proporcionaron campos para actualizar")
        if "entrenador_id" in update_data:
            self._validar_entrenador(update_data["entrenador_id"])
        for key, value in update_data.items():
            setattr(horario, key, value)
        if "categoria" in update_data or "dia_semana" in update_data:
            self._validar_dia_y_derivar_horas(horario)
        return self.repo_horario.actualizar(horario)

    def eliminar_horario(self, horario_id: int) -> None:
        horario = self.repo_horario.obtener_por_id(horario_id)
        if not horario:
            raise EntidadNoEncontrada(f"Horario con id {horario_id} no encontrado")
        self.repo_horario.eliminar(horario)

    def registrar_asistencia(self, datos: AsistenciaCreateDTO) -> Asistencia:
        """entrenador_id se recibe explícito en cada registro (no se copia
        automáticamente del horario) para permitir sustituciones: por defecto
        el frontend puede pre-llenarlo con el titular del horario, pero el
        usuario que registra puede cambiarlo si ese día dictó otro entrenador.

        Upsert por (persona_id, horario_id, fecha_entrenamiento): re-tomar
        asistencia para una sesión ya registrada (ej. reabrir el wizard
        "Tomar asistencia") actualiza el registro existente en vez de crear
        uno duplicado -- no hay constraint único en BD, así que la
        deduplicación se hace explícitamente aquí."""
        if not self.repo_persona.obtener_por_id(datos.persona_id):
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        if not self.repo_horario.obtener_por_id(datos.horario_id):
            raise EntidadNoEncontrada(f"Horario con id {datos.horario_id} no encontrado")
        self._validar_entrenador(datos.entrenador_id)

        # LIFE-1: antes de esta línea el upsert de más abajo era ciego a si
        # el alumno está realmente inscrito en el horario -- se podía
        # registrar/editar asistencia para cualquier (persona, horario) sin
        # que exista un `AlumnoHorario`. Va ANTES del `if existente:` porque
        # una actualización es tan afirmación de pertenencia como una
        # creación: si desasignaron al alumno después de que ya existía la
        # fila, reeditarla no debe convertirse en un bypass de la regla que
        # sí aplica el alta.
        if not self.repo_alumno_horario.obtener_por_persona_y_horario(
            datos.persona_id, datos.horario_id
        ):
            raise OperacionInvalida(
                f"La persona {datos.persona_id} no está inscrita en el horario {datos.horario_id}"
            )

        existente = self.repo.buscar_por_persona_horario_fecha(
            datos.persona_id, datos.horario_id, datos.fecha_entrenamiento
        )
        if existente:
            existente.estado = datos.estado
            existente.entrenador_id = datos.entrenador_id
            existente.justificativo = datos.justificativo
            existente.estado_justificativo = datos.estado_justificativo
            return self.repo.actualizar(existente)

        return self.repo.crear(Asistencia(**datos.model_dump()))

    def historial_por_persona(self, persona_id: int) -> list[Asistencia]:
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")
        return self.repo.listar_por_persona(persona_id)

    def generar_reporte(
        self, horario_id=None, persona_id=None, fecha_inicio=None, fecha_fin=None
    ) -> list[Asistencia]:
        """E02-RF005: reporte de asistencia por horario, periodo o alumno.
        No existía ningún endpoint de reporte -- solo el historial fijo por
        persona de arriba. Los tres filtros son opcionales y combinables."""
        return self.repo.listar_reporte(
            horario_id=horario_id, persona_id=persona_id,
            fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
        )

    # --- Asignación directa Alumno ↔ Horario ---------------------------------
    def asignar_alumno_a_horario(self, datos: AlumnoHorarioCreateDTO) -> AlumnoHorario:
        """Asigna un alumno a un horario específico de forma directa."""
        if not self.repo_persona.obtener_por_id(datos.persona_id):
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        if not self.repo_horario.obtener_por_id(datos.horario_id):
            raise EntidadNoEncontrada(f"Horario con id {datos.horario_id} no encontrado")

        existente = self.repo_alumno_horario.obtener_por_persona_y_horario(
            datos.persona_id, datos.horario_id
        )
        if existente:
            raise OperacionInvalida(
                f"El alumno {datos.persona_id} ya está asignado al horario {datos.horario_id}"
            )

        alumno_horario = AlumnoHorario(
            persona_id=datos.persona_id,
            horario_id=datos.horario_id,
        )
        return self.repo_alumno_horario.crear(alumno_horario)

    def desasignar_alumno_de_horario(
        self, persona_id: int, horario_id: int
    ) -> None:
        """Elimina la asignación directa de un alumno a un horario."""
        asignacion = self.repo_alumno_horario.obtener_por_persona_y_horario(
            persona_id, horario_id
        )
        if not asignacion:
            raise EntidadNoEncontrada(
                f"No existe asignación del alumno {persona_id} al horario {horario_id}"
            )
        self.repo_alumno_horario.eliminar(asignacion)

    def listar_alumnos_por_horario(self, horario_id: int) -> list[AlumnoHorarioDetalleDTO]:
        """Lista todos los alumnos asignados a un horario específico."""
        if not self.repo_horario.obtener_por_id(horario_id):
            raise EntidadNoEncontrada(f"Horario con id {horario_id} no encontrado")

        asignaciones = self.repo_alumno_horario.listar_por_horario(horario_id)
        return [
            AlumnoHorarioDetalleDTO(
                id=a.id,
                persona_id=a.persona_id,
                persona_nombre_completo=f"{a.persona.nombres} {a.persona.apellidos}",
                edad=_calcular_edad(a.persona.fecha_nacimiento),
                horario_id=a.horario_id,
                horario_dia=a.horario.dia_semana,
                horario_hora_inicio=a.horario.hora_inicio,
                horario_hora_fin=a.horario.hora_fin,
                fecha_asignacion=a.fecha_asignacion,
            )
            for a in asignaciones
        ]

    def listar_horarios_por_alumno(self, persona_id: int) -> list[AlumnoHorarioDetalleDTO]:
        """Lista todos los horarios asignados a un alumno específico."""
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")

        asignaciones = self.repo_alumno_horario.listar_por_persona(persona_id)
        return [
            AlumnoHorarioDetalleDTO(
                id=a.id,
                persona_id=a.persona_id,
                persona_nombre_completo=f"{a.persona.nombres} {a.persona.apellidos}",
                edad=_calcular_edad(a.persona.fecha_nacimiento),
                horario_id=a.horario_id,
                horario_dia=a.horario.dia_semana,
                horario_hora_inicio=a.horario.hora_inicio,
                horario_hora_fin=a.horario.hora_fin,
                fecha_asignacion=a.fecha_asignacion,
            )
            for a in asignaciones
        ]
