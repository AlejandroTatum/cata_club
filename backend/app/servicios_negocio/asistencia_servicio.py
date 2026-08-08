from typing import Optional

from sqlalchemy.orm import Session

from app.dominio.modelos import Asistencia, HorarioEntrenamiento, AlumnoHorario
from app.dominio.enums import Categoria
from app.dominio.etiquetas import categoria_en_castellano, dia_en_castellano
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida
from app.infraestructura.repositorios.categoria_repositorio import CategoriaRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.asistencia_repositorio import (
    AsistenciaRepositorio, HorarioRepositorio, AlumnoHorarioRepositorio
)
from app.presentacion.schemas.asistencia_schemas import (
    AsistenciaCreateDTO, CategoriaResponseDTO, HorarioCreateDTO, HorarioUpdateDTO,
    AlumnoHorarioCreateDTO, AlumnoHorarioDetalleDTO
)
from app.servicios_negocio.persona_servicio import _calcular_edad


class AsistenciaServicio:
    def __init__(self, db: Session):
        self.repo = AsistenciaRepositorio(db)
        self.repo_horario = HorarioRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        self.repo_alumno_horario = AlumnoHorarioRepositorio(db)
        self.repo_categoria = CategoriaRepositorio(db)

    def _validar_dia_y_derivar_horas(self, horario: HorarioEntrenamiento) -> None:
        """`hora_inicio`/`hora_fin` nunca los envía el cliente: siempre se
        derivan de la fila `categoria_horario` de `horario.categoria`.
        `dia_semana` debe estar en el conjunto de días permitido por esa
        categoría (ej. Competitivo admite Sábado, las otras 4 solo Lun-Vie)."""
        categoria = self.repo_categoria.obtener_por_codigo(horario.categoria)
        if categoria is None:
            raise EntidadNoEncontrada(f"Categoria {horario.categoria} no encontrada")
        dias_permitidos = {d.dia_semana for d in categoria.dias_permitidos}
        if horario.dia_semana not in dias_permitidos:
            raise OperacionInvalida(
                f"El día {dia_en_castellano(horario.dia_semana)} no está permitido "
                f"para la categoría {categoria_en_castellano(horario.categoria)}.",
                detalle_tecnico=(
                    f"dia_semana={horario.dia_semana.value} "
                    f"fuera de los días de categoria={horario.categoria}"
                ),
            )
        horario.hora_inicio = categoria.hora_inicio
        horario.hora_fin = categoria.hora_fin

    @staticmethod
    def _codigo_de(categoria: Categoria | str) -> str:
        """Normaliza `Categoria.ALGO` (o el string que ya sea) al `str` liso
        que espera la columna FK -- ver el comentario en
        `HorarioEntrenamiento.categoria` sobre por qué ya no es un enum."""
        return Categoria(categoria).value

    def crear_horario(self, datos: HorarioCreateDTO) -> HorarioEntrenamiento:
        horario = HorarioEntrenamiento(**datos.model_dump())
        horario.categoria = self._codigo_de(horario.categoria)
        self._validar_dia_y_derivar_horas(horario)
        return self.repo_horario.crear(horario)

    def listar_horarios(self, categoria: Optional[Categoria] = None) -> list[HorarioEntrenamiento]:
        return self.repo_horario.listar(self._codigo_de(categoria) if categoria else None)

    def listar_categorias(self) -> list[CategoriaResponseDTO]:
        return [
            CategoriaResponseDTO(
                codigo=c.codigo, label=c.label,
                hora_inicio=c.hora_inicio, hora_fin=c.hora_fin,
                dias=[d.dia_semana for d in c.dias_permitidos],
            )
            for c in self.repo_categoria.listar()
        ]

    def actualizar_horario(self, horario_id: int, datos: HorarioUpdateDTO) -> HorarioEntrenamiento:
        horario = self.repo_horario.obtener_por_id(horario_id)
        if not horario:
            raise EntidadNoEncontrada(f"Horario con id {horario_id} no encontrado")
        update_data = datos.model_dump(exclude_unset=True)
        if not update_data:
            raise OperacionInvalida("No se proporcionaron campos para actualizar")
        for key, value in update_data.items():
            if key == "categoria":
                value = self._codigo_de(value)
            setattr(horario, key, value)
        # Sin `entrenador_id` (issue #13), categoria y dia_semana son los
        # únicos campos actualizables y ambos re-derivan las horas: se
        # valida/deriva siempre.
        self._validar_dia_y_derivar_horas(horario)
        return self.repo_horario.actualizar(horario)

    def eliminar_horario(self, horario_id: int) -> None:
        horario = self.repo_horario.obtener_por_id(horario_id)
        if not horario:
            raise EntidadNoEncontrada(f"Horario con id {horario_id} no encontrado")
        self.repo_horario.eliminar(horario)

    def registrar_asistencia(self, datos: AsistenciaCreateDTO) -> Asistencia:
        """No se registra quién dictó la sesión: cualquier entrenador opera
        cualquier horario y el dato no tiene consumidor (issue #13,
        docs/concepto-alcance-modelo.md §4).

        Upsert por (persona_id, horario_id, fecha_entrenamiento): re-tomar
        asistencia para una sesión ya registrada (ej. reabrir el wizard
        "Tomar asistencia") actualiza el registro existente en vez de crear
        uno duplicado -- no hay constraint único en BD, así que la
        deduplicación se hace explícitamente aquí."""
        # La persona se ata a un nombre en vez de descartarse: el mensaje de
        # más abajo la nombra, y esta consulta ya se estaba haciendo.
        persona = self.repo_persona.obtener_por_id(datos.persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        if not self.repo_horario.obtener_por_id(datos.horario_id):
            raise EntidadNoEncontrada(f"Horario con id {datos.horario_id} no encontrado")

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
                f"{persona.nombres} {persona.apellidos} no está en la lista de "
                "alumnos de ese horario.",
                detalle_tecnico=(
                    f"sin AlumnoHorario para persona_id={datos.persona_id} "
                    f"horario_id={datos.horario_id}"
                ),
            )

        existente = self.repo.buscar_por_persona_horario_fecha(
            datos.persona_id, datos.horario_id, datos.fecha_entrenamiento
        )
        if existente:
            existente.estado = datos.estado
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
    def asignar_alumno_a_horario(self, datos: AlumnoHorarioCreateDTO) -> AlumnoHorarioDetalleDTO:
        """Asigna un alumno a un horario específico de forma directa."""
        # Igual que en `registrar_asistencia`: el nombre ya está a mano.
        persona = self.repo_persona.obtener_por_id(datos.persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        if not self.repo_horario.obtener_por_id(datos.horario_id):
            raise EntidadNoEncontrada(f"Horario con id {datos.horario_id} no encontrado")

        existente = self.repo_alumno_horario.obtener_por_persona_y_horario(
            datos.persona_id, datos.horario_id
        )
        if existente:
            raise OperacionInvalida(
                f"{persona.nombres} {persona.apellidos} ya figura en ese horario.",
                detalle_tecnico=(
                    f"AlumnoHorario ya existe para persona_id={datos.persona_id} "
                    f"horario_id={datos.horario_id}"
                ),
            )

        alumno_horario = AlumnoHorario(
            persona_id=datos.persona_id,
            horario_id=datos.horario_id,
        )
        # Devuelve el DTO de la asignación recién creada. Antes el router
        # relistaba el horario entero y tomaba `[-1]`: con el roster ordenado
        # por apellidos eso ni siquiera garantizaba devolver al recién
        # asignado, y con el listado paginado (issue #7) directamente dejó de
        # tener sentido pedir una página para encontrar UNA fila conocida.
        return self._a_detalle_dto(self.repo_alumno_horario.crear(alumno_horario))

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

    @staticmethod
    def _a_detalle_dto(a: AlumnoHorario) -> AlumnoHorarioDetalleDTO:
        """Proyección compartida AlumnoHorario -> DTO de detalle (la usan el
        alta, el roster del horario y los horarios del alumno)."""
        return AlumnoHorarioDetalleDTO(
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

    def listar_alumnos_por_horario(
        self, horario_id: int, skip: int = 0, limit: Optional[int] = None
    ) -> tuple[list[AlumnoHorarioDetalleDTO], int]:
        """Página de alumnos asignados a un horario, más el total de alumnos
        activos de ese horario (paginado, issue #7)."""
        if not self.repo_horario.obtener_por_id(horario_id):
            raise EntidadNoEncontrada(f"Horario con id {horario_id} no encontrado")

        asignaciones = self.repo_alumno_horario.listar_por_horario(
            horario_id, skip=skip, limit=limit
        )
        total = self.repo_alumno_horario.contar_por_horario(horario_id)
        return [self._a_detalle_dto(a) for a in asignaciones], total

    def listar_horarios_por_alumno(self, persona_id: int) -> list[AlumnoHorarioDetalleDTO]:
        """Lista todos los horarios asignados a un alumno específico."""
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")

        asignaciones = self.repo_alumno_horario.listar_por_persona(persona_id)
        return [self._a_detalle_dto(a) for a in asignaciones]
