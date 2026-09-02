from pydantic import BaseModel, Field, computed_field
from datetime import date, time, datetime
from typing import Optional

from app.dominio.enums import EstadoAsistencia, DiaSemana
from app.dominio.reglas_negocio import LIMITE_CORRECCION_ASISTENCIA_DIAS
from app.presentacion.schemas.base import ResponseBase
from app.presentacion.schemas.validadores import NombrePresentado
from app.soporte_transversal.tiempo import hoy_club


class HorarioCreateDTO(BaseModel):
    """`hora_inicio`/`hora_fin` NO son campos de entrada: el servicio los
    deriva server-side de la fila `categoria_horario` de `categoria` para
    que el contrato nunca pueda desviarse de los horarios fijos de negocio.

    `categoria` es un `str` liso, no el enum `Categoria` (M1): la validación
    real es que exista una fila `categoria_horario` con ese código --
    `AsistenciaServicio._validar_dia_y_derivar_horas` la hace consultando la
    tabla, así que un enum acá solo podría rechazar de más una categoría que
    la tabla sí reconoce.

    Sin `entrenador_id`: el club no asigna entrenadores a horarios -- la
    clase la da el entrenador disponible (issue #13,
    docs/product/concepto-alcance-modelo.md §4)."""
    categoria: str
    dia_semana: DiaSemana


class HorarioUpdateDTO(BaseModel):
    categoria: Optional[str] = None
    dia_semana: Optional[DiaSemana] = None


class HorarioResponseDTO(ResponseBase, HorarioCreateDTO):
    id: int
    hora_inicio: time
    hora_fin: time


class PublicScheduleBlockDTO(ResponseBase, BaseModel):
    """A public landing block without identifiers or staff data."""
    days: list[DiaSemana]
    start_time: str
    end_time: str


class PublicScheduleCategoryDTO(ResponseBase, BaseModel):
    """A public category grouped into its published time blocks.

    `ages` is an optional orientation label ("5 a 10 años", "Selección"),
    not a rule: no age is validated against it. `None` means the category
    publishes no age label, which is a legitimate state."""
    category: str
    ages: str | None = None
    blocks: list[PublicScheduleBlockDTO]


class CategoriaResponseDTO(ResponseBase, BaseModel):
    """Una fila de `categoria_horario`: el frontend la consulta acá en vez
    de espejarla a mano (ver `frontend/src/services/categorias.ts`)."""
    codigo: str
    label: str
    # Etiqueta de edades opcional (ver `CategoriaHorario.edades`): texto de
    # orientación para la cartelera, nunca una validación de edad.
    edades: Optional[str] = None
    hora_inicio: time
    hora_fin: time
    dias: list[DiaSemana]


class CategoriaCreateDTO(BaseModel):
    """Alta atómica (docs/archive/fixes/24-abm-categorias.md, pedido del dueño:
    "quisiera que se cree directo el horario y categoría, no diferentes"):
    una sola operación crea la fila `categoria_horario`, sus
    `categoria_horario_dia` y un `horario_entrenamiento` por cada día
    marcado.

    Sin `codigo`: lo deriva el servidor de `nombre`
    (`AsistenciaServicio._generar_codigo`) para que el admin nunca tipee un
    código con espacios/acentos -- es la FK de
    `horario_entrenamiento.categoria`, así que tiene que ser estable y
    válido como identificador.

    `edades` es opcional: una categoría puede no publicar etiqueta de
    edades. El texto en blanco se guarda como NULL (ver
    `AsistenciaServicio._normalizar_edades`), así que "sin etiqueta" tiene
    una sola representación en la base."""
    nombre: str = Field(min_length=1, max_length=50)
    edades: Optional[str] = Field(default=None, max_length=50)
    hora_inicio: time
    hora_fin: time
    dias: list[DiaSemana] = Field(min_length=1)


class CategoriaUpdateDTO(BaseModel):
    """Edición atómica de nombre/franja/días. `dias`, si viene, REEMPLAZA
    el conjunto completo de días permitidos (no es un delta) --
    `AsistenciaServicio.actualizar_categoria` calcula qué día agregar y
    cuál quitar comparando contra los días actuales, y aplica ambos + el
    re-derive de horas en una sola transacción.

    `edades` se distingue de los demás opcionales: mandarla en `null` NO es
    "no la mandé", es "borrá la etiqueta". Esa diferencia se resuelve con
    `exclude_unset` en `actualizar_categoria` (el campo solo se toca si vino
    en el payload), que es también lo que permite limpiarla."""
    nombre: Optional[str] = Field(default=None, min_length=1, max_length=50)
    edades: Optional[str] = Field(default=None, max_length=50)
    hora_inicio: Optional[time] = None
    hora_fin: Optional[time] = None
    dias: Optional[list[DiaSemana]] = Field(default=None, min_length=1)


class AsistenciaCreateDTO(BaseModel):
    fecha_entrenamiento: date
    estado: EstadoAsistencia
    justificativo: Optional[str] = None
    estado_justificativo: Optional[bool] = None
    persona_id: int
    horario_id: int


class AsistenciaResponseDTO(ResponseBase, BaseModel):
    id: int
    fecha_entrenamiento: date
    fecha_registro: datetime
    estado: EstadoAsistencia
    justificativo: Optional[str] = None
    estado_justificativo: Optional[bool] = None
    persona_id: int
    # Nombre de la persona (issue #358): reemplaza el rodeo por
    # `GET /personas/{id}` que el BFF hacía solo para pintar este nombre en
    # "revisar listas" -- ese endpoint exponía cédula/teléfono/fecha de
    # nacimiento de cualquier persona con ids secuenciales. Mismo patrón que
    # `registrado_por_nombre` (#263): se resuelve acá, nunca en el frontend.
    persona_nombre_completo: NombrePresentado
    horario_id: int
    # Quién tomó la lista (#263): `registrado_por_id` es la FK a persona del
    # autor (nullable: las filas históricas no tienen autor conocido) y
    # `registrado_por_nombre` el nombre ya resuelto (join a Persona) para que
    # el frontend nunca muestre un nombre sacado del navegador.
    registrado_por_id: Optional[int] = None
    registrado_por_nombre: Optional[str] = None

    # Issue #663: computado, no persistido -- mismo criterio que
    # `AsistenciaServicio.corregir_asistencia` (`antiguedad_dias >
    # LIMITE_CORRECCION_ASISTENCIA_DIAS` rechaza, así que el límite exacto
    # de 30 días todavía es `correctable=True`). El admin history/report ve
    # esto ANTES de intentar corregir, en vez de enterarse recién con un 400
    # de `PATCH /asistencias/{id}/corregir`. `hoy_club()` se resuelve en
    # request-time (no al importar el módulo), igual que en el servicio.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def correctable(self) -> bool:
        antiguedad_dias = (hoy_club() - self.fecha_entrenamiento).days
        return antiguedad_dias <= LIMITE_CORRECCION_ASISTENCIA_DIAS


# --- Issue #389, slice 2: corrección transaccional de una Asistencia -------
class AsistenciaCorreccionDTO(BaseModel):
    """Los tres campos mutables de `Asistencia` (`estado`, `justificativo`,
    `estado_justificativo`) se corrigen SIEMPRE juntos, como una unidad --
    igual que la toma original -- nunca campo por campo. `motivo` es
    obligatorio: una corrección sin motivo es exactamente lo que este
    operativo existe para impedir."""
    estado: EstadoAsistencia
    justificativo: Optional[str] = None
    estado_justificativo: Optional[bool] = None
    motivo: str = Field(min_length=1, max_length=500)


class AsistenciaCorreccionResponseDTO(ResponseBase, BaseModel):
    """Confirma la corrección con la fila de `Asistencia` ya actualizada
    MÁS la traza que quedó grabada -- el admin necesita ver que la
    corrección se registró, no solo el valor nuevo."""
    asistencia: AsistenciaResponseDTO
    corregido_por_id: int
    corregido_por_nombre: str
    corregido_en: datetime
    motivo: str
    estado_anterior: EstadoAsistencia
    justificativo_anterior: Optional[str] = None
    estado_justificativo_anterior: Optional[bool] = None


class AsistenciaCorreccionEntryDTO(ResponseBase, BaseModel):
    """Una fila del HISTORIAL de correcciones (issue #389, slice 4a) --
    `GET /asistencias/{id}/correcciones`. A diferencia de
    `AsistenciaCorreccionResponseDTO`, deliberadamente NO anida la
    `Asistencia` completa: quien pide el historial ya tiene la fila actual
    (viene de la pantalla que la muestra), así que repetirla N veces por N
    entradas sería puro desperdicio."""
    id: int
    corregido_por_id: int
    corregido_por_nombre: str
    corregido_en: datetime
    motivo: str
    estado_anterior: EstadoAsistencia
    justificativo_anterior: Optional[str] = None
    estado_justificativo_anterior: Optional[bool] = None


# --- Asignación directa Alumno ↔ Horario ------------------------------------
class AlumnoHorarioCreateDTO(BaseModel):
    persona_id: int
    horario_id: int


class AlumnoHorarioResponseDTO(ResponseBase, BaseModel):
    id: int
    persona_id: int
    horario_id: int
    fecha_asignacion: datetime


class UltimaListaDTO(ResponseBase, BaseModel):
    """Una sesión (horario + fecha) con al menos una Asistencia registrada,
    con sus cuatro conteos. Esta tarjeta sigue sin autor a propósito: es un
    resumen de conteos, no un detalle (ver decisiones-de-negocio-2026-08-11.md
    §8) -- `Asistencia` SÍ guarda quién tomó la lista desde #263
    (`registrado_por_id`), expuesto en el historial. Usada por el panel del
    entrenador para "las últimas listas del club"."""
    horario_id: int
    fecha_entrenamiento: date
    dia_semana: DiaSemana
    hora_inicio: time
    hora_fin: time
    presentes: int
    tardanzas: int
    justificados: int
    ausentes: int
    total: int


class AlumnoHorarioDetalleDTO(ResponseBase, BaseModel):
    """DTO con información de persona y horario para listados."""
    id: int
    persona_id: int
    persona_nombre_completo: NombrePresentado
    edad: int
    horario_id: int
    horario_dia: DiaSemana
    horario_hora_inicio: time
    horario_hora_fin: time
    fecha_asignacion: datetime


class SolapeHorarioDTO(ResponseBase, BaseModel):
    """Un horario que el alumno YA tenía y que se pisa con uno de los que se
    le acaban de asignar (issue #731).

    Lleva `categoria_label` -- no solo el `codigo` -- porque este DTO existe
    para NOMBRAR el horario en conflicto: un aviso que solo dijera "se
    superpone" obliga al admin a ir a buscar con cuál. El label sale de
    `categoria_horario`, la misma tabla que ya alimenta los mensajes de
    error de `crear_horario`, así que no es una etiqueta nueva que el
    frontend tenga que mantener espejada.

    `hora_inicio`/`hora_fin` son las del horario VIEJO. El rango nuevo no
    viaja acá: es el de la categoría que el admin acaba de elegir, que ya
    tiene a la vista en la tarjeta desde la que asignó."""
    horario_id: int
    categoria: str
    categoria_label: str
    dia_semana: DiaSemana
    hora_inicio: time
    hora_fin: time


class AsignacionAlumnoHorarioResponseDTO(ResponseBase, BaseModel):
    """Respuesta de `POST /asignar-alumno`.

    INS-6 (decisión de negocio #4, 2026-08-11): la cuota vencida NO bloquea
    la asignación -- se asigna igual, y esta respuesta lleva el aviso NO
    BLOQUEANTE que el admin ve. Deliberadamente un DTO propio y no un campo
    agregado a `AlumnoHorarioDetalleDTO`: ese DTO también lo usan
    `listar_alumnos_por_horario`/`listar_horarios_por_alumno` (listados de
    roster), y sumarle ahí una consulta de membresía por fila sería un N+1
    en endpoints que este fix no toca. El dato es plano (booleano + días) a
    propósito: la oración en castellano ("Ariana tiene la cuota vencida
    hace 14 días") la arma el frontend, que ya conoce el nombre del alumno.

    Issue #731 suma `solapamientos` con el MISMO criterio: un alumno puede
    pertenecer a varias categorías a la vez (decisión del dueño, 2026-08-27:
    "una persona sí puede pertenecer a varios horarios, pero sí, lo correcto
    es avisar nada más"), así que un cruce de horarios tampoco bloquea --
    viaja como aviso al lado de las asignaciones ya creadas. Vacía cuando no
    hay ningún cruce."""
    asignaciones: list[AlumnoHorarioDetalleDTO]
    membresia_vencida: bool
    dias_vencida: Optional[int] = None
    solapamientos: list[SolapeHorarioDTO] = Field(default_factory=list)
