import re
import unicodedata
from datetime import time
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.dominio.modelos import (
    Asistencia, AsistenciaCorreccion, HorarioEntrenamiento, AlumnoHorario, CategoriaHorario,
    CategoriaHorarioDia,
)
from app.dominio.enums import DiaSemana, EstadoAsistencia, EstadoMembresia, EstadoPago
from app.dominio.etiquetas import dia_en_castellano
from app.dominio.excepciones import EntidadNoEncontrada, OperacionInvalida, PermisosInsuficientes
from app.dominio.reglas_negocio import LIMITE_CORRECCION_ASISTENCIA_DIAS
from app.infraestructura.repositorios.categoria_repositorio import CategoriaRepositorio
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio
from app.infraestructura.repositorios.asistencia_repositorio import (
    AsistenciaRepositorio, HorarioRepositorio, AlumnoHorarioRepositorio,
    SesionAsistenciaRepositorio,
)
from app.presentacion.schemas.asistencia_schemas import (
    AsistenciaCreateDTO, AsistenciaCorreccionDTO, CategoriaCreateDTO, CategoriaResponseDTO,
    CategoriaUpdateDTO, HorarioCreateDTO, HorarioUpdateDTO,
    AlumnoHorarioCreateDTO, AlumnoHorarioDetalleDTO, AsignacionAlumnoHorarioResponseDTO,
    SolapeHorarioDTO, UltimaListaDTO,
)
from app.servicios_negocio.persona_servicio import _calcular_edad
from app.soporte_transversal.tiempo import hoy_club

_CODIGO_MAX_LEN = 20

# `LIMITE_CORRECCION_ASISTENCIA_DIAS` ahora vive en `app.dominio.reglas_negocio`
# (issue #663): `AsistenciaResponseDTO` (presentación) también necesita este
# número para computar `correctable`, y `servicios_negocio` no puede
# importar de `presentacion` (rompería el sentido de las capas) ni
# `presentacion` de acá (ciclo: este módulo ya importa DTOs de
# `presentacion.schemas.asistencia_schemas`). Importado arriba junto al
# resto de `app.dominio`; `asistencia_servicio.LIMITE_CORRECCION_ASISTENCIA_DIAS`
# sigue funcionando para cualquier código que ya lo referencie así.

# `date.weekday()` (Python, Lunes=0..Domingo=6) -> `DiaSemana`. Usado por
# `registrar_asistencia` para exigir que `fecha_entrenamiento` caiga
# realmente en el `dia_semana` del horario (issue #308): sin esto, un
# `fecha_entrenamiento` cualquiera pasaba con cualquier horario y el
# historial acumulaba filas donde la fecha y el día de semana se
# contradecían -- la invariante depende del backend porque el cliente es
# quien la rompía.
_WEEKDAY_A_DIA_SEMANA = {
    0: DiaSemana.LUNES,
    1: DiaSemana.MARTES,
    2: DiaSemana.MIERCOLES,
    3: DiaSemana.JUEVES,
    4: DiaSemana.VIERNES,
    5: DiaSemana.SABADO,
    6: DiaSemana.DOMINGO,
}


def _sluggificar_nombre(nombre: str) -> str:
    """`"Preinfantil A"` -> `"PREINFANTIL_A"`. Sin acentos/ñ (normaliza NFKD
    y descarta los diacríticos), sin espacios ni símbolos (cualquier corrida
    de caracteres no alfanuméricos se colapsa a un solo `_`). Deriva el
    código de categoria del nombre para que el admin nunca tipee un código
    con espacios que rompería la FK de `horario_entrenamiento.categoria`
    (ver `AsistenciaServicio._generar_codigo`)."""
    sin_acentos = "".join(
        c for c in unicodedata.normalize("NFKD", nombre) if not unicodedata.combining(c)
    )
    slug = re.sub(r"[^A-Za-z0-9]+", "_", sin_acentos.strip()).strip("_").upper()
    return slug[:_CODIGO_MAX_LEN] or "CATEGORIA"


class AsistenciaServicio:
    def __init__(self, db: Session):
        self.repo = AsistenciaRepositorio(db)
        self.repo_horario = HorarioRepositorio(db)
        self.repo_persona = PersonaRepositorio(db)
        self.repo_alumno_horario = AlumnoHorarioRepositorio(db)
        self.repo_categoria = CategoriaRepositorio(db)
        self.repo_membresia = MembresiaRepositorio(db)
        self.repo_sesion = SesionAsistenciaRepositorio(db)

    def _validar_dia_y_derivar_horas(self, horario: HorarioEntrenamiento) -> CategoriaHorario:
        """`hora_inicio`/`hora_fin` nunca los envía el cliente: siempre se
        derivan de la fila `categoria_horario` de `horario.categoria`.
        `dia_semana` debe estar en el conjunto de días permitido por esa
        categoría (ej. Competitivo admite Sábado, las otras 4 solo Lun-Vie).

        Devuelve la fila `CategoriaHorario` ya resuelta -- `crear_horario` la
        reusa para su propio mensaje de error (`categoria.label`) en vez de
        volver a consultarla (M1: ya no existe un traductor de enum a label,
        la tabla es la única fuente)."""
        categoria = self.repo_categoria.obtener_por_codigo(horario.categoria)
        if categoria is None:
            raise EntidadNoEncontrada(f"Categoria {horario.categoria} no encontrada")
        dias_permitidos = {d.dia_semana for d in categoria.dias_permitidos}
        if horario.dia_semana not in dias_permitidos:
            raise OperacionInvalida(
                f"El día {dia_en_castellano(horario.dia_semana)} no está permitido "
                f"para la categoría {categoria.label}.",
                detalle_tecnico=(
                    f"dia_semana={horario.dia_semana.value} "
                    f"fuera de los días de categoria={horario.categoria}"
                ),
            )
        horario.hora_inicio = categoria.hora_inicio
        horario.hora_fin = categoria.hora_fin
        return categoria

    def crear_horario(self, datos: HorarioCreateDTO) -> HorarioEntrenamiento:
        horario = HorarioEntrenamiento(**datos.model_dump())
        categoria = self._validar_dia_y_derivar_horas(horario)
        # INS-3 (decisión de negocio #5, 2026-08-11): una sola fila por
        # (categoria, dia_semana) -- es invariante, no advertencia. Las horas
        # se derivan de la categoria (arriba), así que dos filas Formativo-
        # Lunes serían idénticas, y un alumno asignado después quedaría
        # enrolado en AMBAS (rompe la inscripción atómica del issue #181).
        # Este chequeo va ANTES del `UniqueConstraint` de la base
        # (`uq_horario_categoria_dia`) para devolver un mensaje legible en
        # vez de un `IntegrityError` crudo.
        if self.repo_horario.existe_categoria_dia(horario.categoria, horario.dia_semana):
            raise OperacionInvalida(
                f"La categoría {categoria.label} ya "
                f"tiene un horario el día {dia_en_castellano(horario.dia_semana)}.",
                detalle_tecnico=(
                    f"uq_horario_categoria_dia: categoria={horario.categoria} "
                    f"dia_semana={horario.dia_semana.value}"
                ),
            )
        return self.repo_horario.crear(horario)

    def listar_horarios(self, categoria: Optional[str] = None) -> list[HorarioEntrenamiento]:
        return self.repo_horario.listar(categoria)

    def listar_categorias(self) -> list[CategoriaResponseDTO]:
        return [self._a_categoria_dto(c) for c in self.repo_categoria.listar()]

    @staticmethod
    def _a_categoria_dto(c: CategoriaHorario) -> CategoriaResponseDTO:
        return CategoriaResponseDTO(
            codigo=c.codigo, label=c.label,
            hora_inicio=c.hora_inicio, hora_fin=c.hora_fin,
            dias=[d.dia_semana for d in c.dias_permitidos],
        )

    def _generar_codigo(self, nombre: str) -> str:
        """Deriva un `codigo` único a partir de `nombre`. Estable: se llama
        UNA vez, al crear -- nunca al renombrar (`codigo` es la FK de
        `horario_entrenamiento.categoria`, así que cambiarlo en un rename
        rompería todos sus horarios). Colisión de slug (dos nombres
        distintos que normalizan igual, ej. "Preinfantil" y "PREINFANTIL!")
        se resuelve con un sufijo numérico -- el propio `label`, ya único
        en la base, es la garantía real de que dos categorías no se
        confunden; el código solo necesita ser un identificador válido."""
        base = _sluggificar_nombre(nombre)
        codigo = base
        sufijo = 2
        while self.repo_categoria.existe_codigo(codigo):
            marca = f"_{sufijo}"
            codigo = base[: _CODIGO_MAX_LEN - len(marca)] + marca
            sufijo += 1
        return codigo

    def crear_categoria(self, datos: CategoriaCreateDTO) -> CategoriaResponseDTO:
        """Alta atómica (docs/archive/fixes/24-abm-categorias.md, pedido del dueño):
        una sola operación crea la categoria, sus días permitidos y un
        `horario_entrenamiento` por cada día marcado."""
        nombre = datos.nombre.strip()
        if not nombre:
            raise OperacionInvalida("El nombre de la categoría no puede estar vacío.")
        if self.repo_categoria.existe_label(nombre):
            raise OperacionInvalida(f'Ya existe una categoría llamada "{nombre}".')
        if datos.hora_inicio >= datos.hora_fin:
            raise OperacionInvalida("La hora de inicio debe ser anterior a la hora de fin.")

        # Dedupe si el mismo día viene repetido en el payload -- no debería
        # pasar desde el formulario (casillas = un Set), pero un llamado
        # directo a la API sí podría mandarlo dos veces.
        dias = list(dict.fromkeys(datos.dias))

        codigo = self._generar_codigo(nombre)
        categoria = CategoriaHorario(
            codigo=codigo, label=nombre,
            hora_inicio=datos.hora_inicio, hora_fin=datos.hora_fin,
        )
        categoria.dias_permitidos = [CategoriaHorarioDia(dia_semana=d) for d in dias]
        horarios = [
            HorarioEntrenamiento(
                categoria=codigo, dia_semana=d,
                hora_inicio=datos.hora_inicio, hora_fin=datos.hora_fin,
            )
            for d in dias
        ]
        categoria = self.repo_categoria.crear_con_horarios(categoria, horarios)
        return self._a_categoria_dto(categoria)

    def actualizar_categoria(self, codigo: str, datos: CategoriaUpdateDTO) -> CategoriaResponseDTO:
        """Edición atómica de nombre/franja/días -- ver
        docs/archive/fixes/24-abm-categorias.md para las cuatro decisiones que
        gobiernan este método:

        1. Cambiar la franja RE-DERIVA las horas de los horarios que
           quedan (nunca quedan desincronizados de la categoria).
        2. Quitar un día con asistencias registradas está PROHIBIDO: se
           aborta la edición ENTERA (ningún día se toca) antes de escribir
           nada -- no se borra historial.
        3. Agregar un día a una categoria con alumnos ya inscriptos los
           backfillea automáticamente en el día nuevo -- la inscripción
           sigue siendo atómica por categoria (un alumno en todos los días
           o en ninguno).
        4. `codigo` nunca cambia acá (ver `_generar_codigo`)."""
        categoria = self.repo_categoria.obtener_por_codigo(codigo)
        if categoria is None:
            raise EntidadNoEncontrada(f"Categoria {codigo} no encontrada")

        update_data = datos.model_dump(exclude_unset=True)
        if not update_data:
            raise OperacionInvalida("No se proporcionaron campos para actualizar")

        nueva_hora_inicio = datos.hora_inicio if datos.hora_inicio is not None else categoria.hora_inicio
        nueva_hora_fin = datos.hora_fin if datos.hora_fin is not None else categoria.hora_fin
        if nueva_hora_inicio >= nueva_hora_fin:
            raise OperacionInvalida("La hora de inicio debe ser anterior a la hora de fin.")

        if datos.nombre is not None:
            nombre = datos.nombre.strip()
            if not nombre:
                raise OperacionInvalida("El nombre de la categoría no puede estar vacío.")
            if nombre != categoria.label and self.repo_categoria.existe_label(nombre, excluir_codigo=codigo):
                raise OperacionInvalida(f'Ya existe una categoría llamada "{nombre}".')
        else:
            nombre = categoria.label

        dias_actuales = {d.dia_semana for d in categoria.dias_permitidos}
        dias_nuevos = set(datos.dias) if datos.dias is not None else dias_actuales
        if not dias_nuevos:
            raise OperacionInvalida("Una categoría necesita al menos un día.")

        dias_a_agregar = dias_nuevos - dias_actuales
        dias_a_quitar = dias_actuales - dias_nuevos

        horarios_actuales = self.repo_horario.listar(codigo)

        # No se borra historial (decisión #2 de arriba): si CUALQUIER día a
        # quitar ya tiene asistencias, se aborta TODA la edición antes de
        # escribir nada -- ni el nombre, ni la franja, ni los otros días.
        horarios_a_borrar = [h for h in horarios_actuales if h.dia_semana in dias_a_quitar]
        bloqueados = [h for h in horarios_a_borrar if self.repo_horario.tiene_asistencias(h.id)]
        if bloqueados:
            dias_bloqueados = ", ".join(
                dia_en_castellano(h.dia_semana) for h in bloqueados
            )
            raise OperacionInvalida(
                f"No se puede quitar el día {dias_bloqueados} de {categoria.label}: "
                "ya tiene asistencias registradas. El historial no se borra.",
                detalle_tecnico=(
                    f"categoria={codigo} horario_ids_bloqueados="
                    f"{[h.id for h in bloqueados]}"
                ),
            )

        # Decisión #3: backfillear a los alumnos ya inscriptos en la
        # categoria dentro de cada día nuevo -- se calcula ANTES de crear
        # los horarios nuevos (para no incluirse a sí mismos).
        personas_inscriptas = self.repo_alumno_horario.listar_personas_de_horarios(
            [h.id for h in horarios_actuales]
        )
        horarios_nuevos = [
            HorarioEntrenamiento(
                categoria=codigo, dia_semana=d,
                hora_inicio=nueva_hora_inicio, hora_fin=nueva_hora_fin,
            )
            for d in dias_a_agregar
        ]
        alumno_horario_nuevos = [
            AlumnoHorario(persona_id=persona_id, horario=h)
            for h in horarios_nuevos
            for persona_id in personas_inscriptas
        ]

        # Decisión #1: los horarios que QUEDAN también re-derivan su hora
        # de la categoria -- nunca quedan con una franja vieja.
        horarios_restantes = [h for h in horarios_actuales if h.dia_semana not in dias_a_quitar]
        for h in horarios_restantes:
            h.hora_inicio = nueva_hora_inicio
            h.hora_fin = nueva_hora_fin

        alumno_horario_a_borrar = [
            a
            for h in horarios_a_borrar
            for a in self.repo_alumno_horario.listar_por_horario_sin_filtro(h.id)
        ]

        categoria.label = nombre
        categoria.hora_inicio = nueva_hora_inicio
        categoria.hora_fin = nueva_hora_fin
        categoria.dias_permitidos = [
            d for d in categoria.dias_permitidos if d.dia_semana not in dias_a_quitar
        ] + [CategoriaHorarioDia(dia_semana=d) for d in dias_a_agregar]

        categoria = self.repo_categoria.guardar_edicion(
            categoria=categoria,
            horarios_nuevos=horarios_nuevos,
            alumno_horario_nuevos=alumno_horario_nuevos,
            horarios_a_borrar=horarios_a_borrar,
            alumno_horario_a_borrar=alumno_horario_a_borrar,
        )
        return self._a_categoria_dto(categoria)

    def eliminar_categoria(self, codigo: str) -> None:
        """Baja de la categoria entera -- solo si NINGUNO de sus horarios
        tiene asistencias registradas (mismo criterio que quitar un día
        individual, decisión #2 de `actualizar_categoria`: no se borra
        historial). Todo o nada: si un día bloquea, ninguno se toca."""
        categoria = self.repo_categoria.obtener_por_codigo(codigo)
        if categoria is None:
            raise EntidadNoEncontrada(f"Categoria {codigo} no encontrada")

        horarios = self.repo_horario.listar(codigo)
        bloqueados = [h for h in horarios if self.repo_horario.tiene_asistencias(h.id)]
        if bloqueados:
            dias_bloqueados = ", ".join(dia_en_castellano(h.dia_semana) for h in bloqueados)
            raise OperacionInvalida(
                f'No se puede eliminar la categoría "{categoria.label}": el día '
                f"{dias_bloqueados} tiene asistencias registradas. El historial no se borra.",
                detalle_tecnico=(
                    f"categoria={codigo} horario_ids_bloqueados="
                    f"{[h.id for h in bloqueados]}"
                ),
            )

        alumno_horario_a_borrar = [
            a
            for h in horarios
            for a in self.repo_alumno_horario.listar_por_horario_sin_filtro(h.id)
        ]
        self.repo_categoria.eliminar_con_horarios(categoria, horarios, alumno_horario_a_borrar)

    def actualizar_horario(self, horario_id: int, datos: HorarioUpdateDTO) -> HorarioEntrenamiento:
        horario = self.repo_horario.obtener_por_id(horario_id)
        if not horario:
            raise EntidadNoEncontrada(f"Horario con id {horario_id} no encontrado")
        update_data = datos.model_dump(exclude_unset=True)
        if not update_data:
            raise OperacionInvalida("No se proporcionaron campos para actualizar")
        for key, value in update_data.items():
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
        # Dropping this one día from the categoria's schedule unassigns
        # students from exactly this row -- narrow by design, unlike
        # `desasignar_alumno_de_horario`'s categoria-wide fan-out, which
        # answers a different question (unenroll a student from the whole
        # categoria). A horario with attendance history still blocks deletion
        # (`repo_horario.eliminar` below) -- that data is never auto-cleaned.
        self.repo_alumno_horario.eliminar_por_horario(horario_id)
        self.repo_horario.eliminar(horario)

    def registrar_asistencia(
        self, datos: AsistenciaCreateDTO, roles_solicitante: list[str], persona_id_solicitante: int
    ) -> Asistencia:
        """No se registra quién dictó la sesión: cualquier entrenador opera
        cualquier horario y el dato no tiene consumidor (issue #13,
        docs/product/concepto-alcance-modelo.md §4).

        Matiz (#263): SÍ se registra quién TOMÓ la lista, en
        `registrado_por_id` -- la identidad viene del TOKEN
        (`persona_id_solicitante`), nunca del DTO. Se setea siempre en esta
        rama de CREACIÓN: no hay rama de actualización que pueda pisarlo
        (ver más abajo, issue #389 -- re-registrar a alguien que ya tiene
        fila se rechaza en vez de actualizar).

        Cierre atómico de sesión (issue #389, slice 1 de la cadena): la
        primera `Asistencia` creada con éxito para un (horario_id,
        fecha_entrenamiento) cierra esa sesión (`SesionAsistencia`, ver su
        docstring en `app/dominio/modelos.py`). Una vez cerrada, NADIE
        vuelve a registrar ahí a un alumno que ya tiene fila -- ni un
        ADMINISTRADOR: se rechaza con `OperacionInvalida` (400). Esto
        reemplaza por completo el mecanismo previo de "corrección" del
        issue #262 (rol ADMINISTRADOR + tope de 30 días), que dejaba una
        puerta abierta a re-tomar la lista entera desde el mismo wizard. Esa
        puerta queda cerrada en este slice; una puerta de corrección
        explícita, con traza de quién/cuándo/motivo/valor anterior, es un
        slice posterior de esta misma cadena -- no existe todavía.

        El cierre NO bloquea que un alumno que aún no tiene fila en esa
        sesión se registre por primera vez (ej. un lote parcialmente
        fallido que se reintenta solo para los alumnos que faltaron): lo
        que se cierra es RE-registrar a quien ya tiene fila, no la sesión
        completa como conjunto de altas posibles."""
        # La persona se ata a un nombre en vez de descartarse: el mensaje de
        # más abajo la nombra, y esta consulta ya se estaba haciendo.
        persona = self.repo_persona.obtener_por_id(datos.persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        horario = self.repo_horario.obtener_por_id(datos.horario_id)
        if not horario:
            raise EntidadNoEncontrada(f"Horario con id {datos.horario_id} no encontrado")

        # Issue #308: `fecha_entrenamiento` debe caer en el `dia_semana` real
        # del horario. Invariante de dominio, no una validación de forma --
        # sin esto el cliente podía (y lo hizo) mandar la fecha de HOY para
        # un horario de otro día, y el historial quedaba con filas donde
        # fecha y día de semana se contradicen. Se valida ACÁ, antes de la
        # pertenencia del alumno, porque es una propiedad del par
        # (fecha, horario) en sí, no de quién se está anotando.
        dia_de_la_fecha = _WEEKDAY_A_DIA_SEMANA[datos.fecha_entrenamiento.weekday()]
        if dia_de_la_fecha != horario.dia_semana:
            raise OperacionInvalida(
                f"La fecha {datos.fecha_entrenamiento.isoformat()} es "
                f"{dia_en_castellano(dia_de_la_fecha)}, pero el horario es de "
                f"{dia_en_castellano(horario.dia_semana)}.",
                detalle_tecnico=(
                    f"fecha_entrenamiento={datos.fecha_entrenamiento.isoformat()} "
                    f"({dia_de_la_fecha.value}) horario_id={horario.id} "
                    f"horario.dia_semana={horario.dia_semana.value}"
                ),
            )

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
            # Cierre permanente (issue #389): esta persona ya tiene fila en
            # esta sesión, así que la lista para ella ya quedó cerrada.
            # Nadie -- ni un ADMINISTRADOR -- vuelve a tomarla desde acá; ver
            # el docstring de la función para el reemplazo del mecanismo
            # previo de "corrección" (issue #262, rol + 30 días).
            raise OperacionInvalida(
                f"La asistencia de {persona.nombres} {persona.apellidos} para el "
                f"{datos.fecha_entrenamiento.isoformat()} ya fue registrada. Esa "
                "lista quedó cerrada de forma permanente y no puede volver a "
                "tomarse.",
                detalle_tecnico=(
                    f"sesion ya cerrada: horario_id={datos.horario_id} "
                    f"fecha_entrenamiento={datos.fecha_entrenamiento.isoformat()} "
                    f"persona_id={datos.persona_id}"
                ),
            )

        # Primer registro exitoso de esta persona en la sesión: si es
        # también la primera Asistencia de TODA la sesión
        # (horario_id, fecha_entrenamiento), esto la cierra. Get-or-create:
        # si otra persona ya cerró esta misma sesión antes, devuelve esa
        # fila sin tocarla -- el cierre lo gana quien llega primero, no
        # quien llama último. Se agrega/flushea en la MISMA sesión de BD que
        # la `Asistencia` de abajo; el `commit()` de `self.repo.crear` los
        # confirma juntos.
        self.repo_sesion.obtener_o_crear_cerrada(
            datos.horario_id, datos.fecha_entrenamiento, persona_id_solicitante,
        )
        try:
            return self.repo.crear(
                Asistencia(**datos.model_dump(), registrado_por_id=persona_id_solicitante)
            )
        except IntegrityError:
            # Carrera real (no solo teórica): dos requests para la MISMA
            # persona pueden pasar ambas el `if existente` de arriba antes
            # de que cualquiera commitee -- el chequeo de más arriba es
            # check-then-act, no atómico. `uq_asistencia_persona_horario_fecha`
            # (migración de este mismo slice) es quien realmente lo impide;
            # acá solo traducimos su violación al mismo rechazo legible que
            # ya usa el camino no-concurrente.
            self.repo.db.rollback()
            raise OperacionInvalida(
                f"La asistencia de {persona.nombres} {persona.apellidos} para el "
                f"{datos.fecha_entrenamiento.isoformat()} ya fue registrada. Esa "
                "lista quedó cerrada de forma permanente y no puede volver a "
                "tomarse.",
                detalle_tecnico=(
                    f"choque de unique en insercion concurrente: horario_id="
                    f"{datos.horario_id} fecha_entrenamiento="
                    f"{datos.fecha_entrenamiento.isoformat()} persona_id="
                    f"{datos.persona_id}"
                ),
            ) from None

    def corregir_asistencia(
        self, asistencia_id: int, datos: AsistenciaCorreccionDTO,
        roles_solicitante: list[str], persona_id_solicitante: int,
    ) -> AsistenciaCorreccion:
        """Corrige UNA `Asistencia` ya cerrada (issue #389, slice 2): el
        reemplazo explícito, con traza obligatoria, del mecanismo previo de
        "corrección" (issue #262) que el slice 1 eliminó del camino de
        `registrar_asistencia`. No reabre la sesión ni permite un segundo
        alta -- sigue existiendo UNA sola fila de `Asistencia`; lo que
        cambia es su VALOR, con quién/cuándo/motivo/valor-anterior
        grabados aparte, para siempre.

        `PermisosInsuficientes` si el rol no trae ADMINISTRADOR: defensa en
        profundidad junto al `GestorPermisos(["ADMINISTRADOR"])` del router
        -- la excepción de dominio es la fuente de verdad, no la sola
        dependencia (`app/dominio/excepciones.py`).

        `OperacionInvalida` si pasaron más de
        `LIMITE_CORRECCION_ASISTENCIA_DIAS`: mismo tope que el mecanismo
        eliminado, recreado porque el criterio de negocio no cambió.

        El snapshot "anterior" se toma del estado ACTUAL de `asistencia`
        antes de mutarla. Los tres campos mutables se pisan juntos, como
        una unidad -- igual que la toma original -- nunca campo por
        campo."""
        if "ADMINISTRADOR" not in roles_solicitante:
            raise PermisosInsuficientes(
                "Solo un administrador puede corregir una asistencia ya registrada.",
            )

        asistencia = self.repo.obtener_por_id(asistencia_id)
        if not asistencia:
            raise EntidadNoEncontrada(f"Asistencia con id {asistencia_id} no encontrada")

        antiguedad_dias = (hoy_club() - asistencia.fecha_entrenamiento).days
        if antiguedad_dias > LIMITE_CORRECCION_ASISTENCIA_DIAS:
            raise OperacionInvalida(
                "No se puede corregir una asistencia de hace más de "
                f"{LIMITE_CORRECCION_ASISTENCIA_DIAS} días.",
                detalle_tecnico=f"asistencia_id={asistencia_id} antiguedad_dias={antiguedad_dias}",
            )

        correccion = AsistenciaCorreccion(
            asistencia_id=asistencia.id,
            corregido_por_id=persona_id_solicitante,
            motivo=datos.motivo,
            estado_anterior=asistencia.estado,
            justificativo_anterior=asistencia.justificativo,
            estado_justificativo_anterior=asistencia.estado_justificativo,
        )

        asistencia.estado = datos.estado
        asistencia.justificativo = datos.justificativo
        asistencia.estado_justificativo = datos.estado_justificativo

        _, correccion = self.repo.guardar_correccion(asistencia, correccion)
        return correccion

    def listar_correcciones(self, asistencia_id: int) -> list[AsistenciaCorreccion]:
        """Historial de correcciones de UNA `Asistencia` (issue #389, slice
        4a). Busca la `Asistencia` primero para poder devolver 404 ante un
        id inexistente -- delegar directo al repo dejaría pasar cualquier id,
        existente o no, con una lista vacía indistinguible de "sin
        correcciones todavía"."""
        if not self.repo.obtener_por_id(asistencia_id):
            raise EntidadNoEncontrada(f"Asistencia con id {asistencia_id} no encontrada")
        return self.repo.listar_correcciones_por_asistencia(asistencia_id)

    def historial_por_persona(
        self, persona_id: int, skip: int = 0, limit: Optional[int] = None
    ) -> tuple[list[Asistencia], int]:
        """Historial paginado de una persona, más el total de su historial
        completo (paginado, issue #7 / TRA-6)."""
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")
        items = self.repo.listar_por_persona(persona_id, skip=skip, limit=limit)
        total = self.repo.contar_por_persona(persona_id)
        return items, total

    def generar_reporte(
        self, horario_id=None, persona_id=None, fecha_inicio=None, fecha_fin=None,
        skip: int = 0, limit: Optional[int] = None,
    ) -> list[Asistencia]:
        """E02-RF005: reporte de asistencia por horario, periodo o alumno.
        Los tres filtros son opcionales y combinables. `skip`/`limit` quedan
        opcionales a propósito: el export a PDF (`reporte_asistencia_pdf`)
        llama a este mismo método SIN ellos -- un único documento descargado
        de una vez, no un listado que se recorra en pantalla (issue #7 /
        TRA-6) -- mientras que el endpoint JSON del reporte sí los pasa."""
        return self.repo.listar_reporte(
            horario_id=horario_id, persona_id=persona_id,
            fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
            skip=skip, limit=limit,
        )

    def contar_reporte(
        self, horario_id=None, persona_id=None, fecha_inicio=None, fecha_fin=None
    ) -> int:
        """Total del reporte FILTRADO -- para el `total` del envelope
        paginado del endpoint JSON."""
        return self.repo.contar_reporte(
            horario_id=horario_id, persona_id=persona_id,
            fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
        )

    def _info_membresia_vencida(self, persona_id: int) -> tuple[bool, Optional[int]]:
        """INS-6 (decisión de negocio #4, 2026-08-11): la cuota vencida NO
        bloquea la asignación -- esto solo calcula, UNA vez por llamada, el
        aviso no bloqueante que ve el admin.

        Se mira la membresía MÁS RECIENTE de la persona (por
        `fecha_activacion`), sin filtrar por la categoria del horario: a lo
        sumo una membresía puede estar ACTIVA por persona a la vez
        (`uq_membresia_activa_por_persona`), así que la más reciente es la
        vigente hoy. No existe en el modelo una relación entre
        `TipoMembresia.categoria` (etiqueta comercial libre, ej. "Mensual
        Infantil") y `HorarioEntrenamiento.categoria` (código técnico, ej.
        "FORMATIVO") -- ese mapeo solo vive, ad hoc, en el seed de
        desarrollo (`scripts/seed_dev_bulk.py`), no en el dominio.

        Alcance deliberado: solo VENCIDA dispara el aviso. INACTIVA (nunca
        pagó / aún no se le aprobó un primer pago) es un estado distinto que
        la decisión de negocio #4 no menciona -- "cuota vencida" describe
        una membresía que SE ACTIVÓ y luego expiró, no una que nunca
        arrancó. No se trata como vencida acá.
        """
        membresias = self.repo_membresia.listar_por_persona(persona_id)
        if not membresias:
            return False, None
        ultima = max(membresias, key=lambda m: m.fecha_activacion)
        if ultima.estado != EstadoMembresia.VENCIDA:
            return False, None

        pagos_aprobados = [p for p in ultima.pagos if p.estado_pago == EstadoPago.APROBADO]
        if not pagos_aprobados:
            return True, None
        ultimo_vencimiento = max(p.fecha_fin for p in pagos_aprobados)
        dias_vencida = (hoy_club() - ultimo_vencimiento).days
        return True, max(dias_vencida, 0)

    @staticmethod
    def _se_solapan(inicio_a: time, fin_a: time, inicio_b: time, fin_b: time) -> bool:
        """¿Dos rangos horarios del MISMO día se pisan? (issue #731)

        Se solapan cuando cada uno arranca ANTES de que termine el otro. Las
        dos comparaciones son ESTRICTAS a propósito: 18:00-20:00 y
        20:00-21:15 comparten el instante 20:00 -- se tocan, no se pisan --
        y esa es la disposición más común del club (Competitivo seguido de
        Adultos). Con `<=` cada asignación legítima de Adultos dispararía un
        aviso, que es exactamente el falso positivo que haría que el admin
        deje de leer los avisos.
        """
        return inicio_a < fin_b and inicio_b < fin_a

    def _detectar_solapamientos(
        self,
        nuevos: list[HorarioEntrenamiento],
        previos: list[AlumnoHorario],
    ) -> list[SolapeHorarioDTO]:
        """Los horarios que el alumno YA tenía y que se pisan con alguno de
        los que se le están asignando (issue #731).

        NO bloquea: solo describe. El alumno se asigna igual -- pertenecer a
        varias categorías es una característica del club, no un error
        (decisión del dueño, 2026-08-27). Mismo espíritu que
        `_info_membresia_vencida`.

        Se compara día por día porque la inscripción es por categoría
        ENTERA (todos sus días), así que un alta puede cruzarse el Lunes y
        no el Martes. Los labels salen de un único `listar()` del catálogo
        de categorías -- un puñado de filas, no una consulta por horario.
        """
        if not previos:
            return []

        labels = {c.codigo: c.label for c in self.repo_categoria.listar()}
        orden_dias = {dia: i for i, dia in enumerate(DiaSemana)}

        vistos: set[int] = set()
        solapes: list[SolapeHorarioDTO] = []
        for nuevo in nuevos:
            for previo in previos:
                viejo = previo.horario
                if viejo.dia_semana != nuevo.dia_semana or viejo.id in vistos:
                    continue
                if not self._se_solapan(
                    viejo.hora_inicio, viejo.hora_fin,
                    nuevo.hora_inicio, nuevo.hora_fin,
                ):
                    continue
                vistos.add(viejo.id)
                solapes.append(SolapeHorarioDTO(
                    horario_id=viejo.id,
                    categoria=viejo.categoria,
                    # Si la categoria desapareciera del catálogo el aviso
                    # sigue saliendo con el codigo crudo: perder el aviso
                    # entero por no tener la etiqueta linda sería peor.
                    categoria_label=labels.get(viejo.categoria, viejo.categoria),
                    dia_semana=viejo.dia_semana,
                    hora_inicio=viejo.hora_inicio,
                    hora_fin=viejo.hora_fin,
                ))

        # Orden estable (día de la semana, hora de inicio) para que el aviso
        # se lea como se lee un horario y no dependa del orden del SELECT.
        solapes.sort(key=lambda s: (orden_dias[s.dia_semana], s.hora_inicio, s.horario_id))
        return solapes

    def listar_ultimas_listas(self, limit: int = 5) -> list[UltimaListaDTO]:
        """Las últimas `limit` listas del club (horario + fecha), más
        recientes primero, sin autor -- ver §8 de
        decisiones-de-negocio-2026-08-11.md. Alimenta el panel del
        entrenador."""
        sesiones = self.repo.listar_ultimas_sesiones(limit)
        resultado = []
        for s in sesiones:
            conteos = s["conteos"]
            presentes = conteos.get(EstadoAsistencia.PRESENTE, 0)
            tardanzas = conteos.get(EstadoAsistencia.ATRASADO, 0)
            justificados = conteos.get(EstadoAsistencia.JUSTIFICADO, 0)
            ausentes = conteos.get(EstadoAsistencia.AUSENTE, 0)
            resultado.append(UltimaListaDTO(
                horario_id=s["horario_id"],
                fecha_entrenamiento=s["fecha_entrenamiento"],
                dia_semana=s["dia_semana"],
                hora_inicio=s["hora_inicio"],
                hora_fin=s["hora_fin"],
                presentes=presentes,
                tardanzas=tardanzas,
                justificados=justificados,
                ausentes=ausentes,
                total=presentes + tardanzas + justificados + ausentes,
            ))
        return resultado

    # --- Asignación directa Alumno ↔ Categoria (todos sus horarios) --------
    def asignar_alumno_a_horario(
        self, datos: AlumnoHorarioCreateDTO
    ) -> AsignacionAlumnoHorarioResponseDTO:
        """Enrolls a student into the WHOLE training categoria, not just the
        single `horario_id` in the request. The club enrolls by full month —
        never by a loose weekday — so `horario_id` only anchors which
        categoria is meant; every one of that categoria's current horario
        rows (e.g. Lunes-Sábado for COMPETITIVO, Lunes-Viernes for the other
        four) lands in one atomic transaction, or none of them do."""
        # Igual que en `registrar_asistencia`: el nombre ya está a mano.
        persona = self.repo_persona.obtener_por_id(datos.persona_id)
        if not persona:
            raise EntidadNoEncontrada(f"Persona con id {datos.persona_id} no encontrada")
        horario = self.repo_horario.obtener_por_id(datos.horario_id)
        if not horario:
            raise EntidadNoEncontrada(f"Horario con id {datos.horario_id} no encontrado")

        horarios_de_la_categoria = self.repo_horario.listar(horario.categoria)
        # Una sola lectura de las asignaciones previas: sus ids filtran lo que
        # falta crear, y las filas completas (con `horario` ya cargado por el
        # joinedload del repo) alimentan el aviso de solape del issue #731.
        asignaciones_previas = self.repo_alumno_horario.listar_por_persona(datos.persona_id)
        ya_asignados = {a.horario_id for a in asignaciones_previas}
        pendientes = [h for h in horarios_de_la_categoria if h.id not in ya_asignados]
        if not pendientes:
            raise OperacionInvalida(
                f"{persona.nombres} {persona.apellidos} ya figura en esa categoría.",
                detalle_tecnico=(
                    f"persona_id={datos.persona_id} ya tiene AlumnoHorario para "
                    f"cada horario de categoria={horario.categoria}"
                ),
            )

        # El solape se calcula ANTES de crear, contra las asignaciones que el
        # alumno ya tenía: después del alta, `pendientes` también estaría en
        # esa lista y cada horario nuevo se reportaría solapado consigo mismo.
        solapamientos = self._detectar_solapamientos(pendientes, asignaciones_previas)

        # Devuelve los DTOs de las asignaciones recién creadas. Antes el
        # router relistaba el horario entero y tomaba `[-1]`: con el roster
        # ordenado por apellidos eso ni siquiera garantizaba devolver al
        # recién asignado, y con el listado paginado (issue #7) directamente
        # dejó de tener sentido pedir una página para encontrar UNA fila
        # conocida.
        nuevas = self.repo_alumno_horario.crear_muchos([
            AlumnoHorario(persona_id=datos.persona_id, horario_id=h.id)
            for h in pendientes
        ])
        membresia_vencida, dias_vencida = self._info_membresia_vencida(datos.persona_id)
        return AsignacionAlumnoHorarioResponseDTO(
            asignaciones=[self._a_detalle_dto(a) for a in nuevas],
            membresia_vencida=membresia_vencida,
            dias_vencida=dias_vencida,
            solapamientos=solapamientos,
        )

    def desasignar_alumno_de_horario(
        self, persona_id: int, horario_id: int
    ) -> None:
        """Mirror of `asignar_alumno_a_horario`: unassigns the student from
        every horario of the categoria `horario_id` belongs to, in one
        atomic transaction. There is no operation that leaves a student
        enrolled in only part of a categoria."""
        horario = self.repo_horario.obtener_por_id(horario_id)
        if not horario:
            raise EntidadNoEncontrada(f"Horario con id {horario_id} no encontrado")

        ids_de_la_categoria = {h.id for h in self.repo_horario.listar(horario.categoria)}
        asignaciones = [
            a for a in self.repo_alumno_horario.listar_por_persona(persona_id)
            if a.horario_id in ids_de_la_categoria
        ]
        if not asignaciones:
            raise EntidadNoEncontrada(
                f"No existe asignación del alumno {persona_id} a esa categoría"
            )
        self.repo_alumno_horario.eliminar_muchos(asignaciones)

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

    def listar_roster_de_todos_los_horarios(self) -> list[AlumnoHorarioDetalleDTO]:
        """TRA-7: roster completo (todos los horarios) en una sola consulta,
        para el conteo "N inscriptos" de /groups. Deliberadamente SIN
        paginar: el volumen de filas ya viajaba completo hoy, repartido en 26
        respuestas (una por horario); esto consolida esas 26 consultas en
        una sola sin cambiar cuántas filas cruzan la red."""
        asignaciones = self.repo_alumno_horario.listar_activos_de_todos_los_horarios()
        return [self._a_detalle_dto(a) for a in asignaciones]

    def listar_horarios_por_alumno(self, persona_id: int) -> list[AlumnoHorarioDetalleDTO]:
        """Lista todos los horarios asignados a un alumno específico."""
        if not self.repo_persona.obtener_por_id(persona_id):
            raise EntidadNoEncontrada(f"Persona con id {persona_id} no encontrada")

        asignaciones = self.repo_alumno_horario.listar_por_persona(persona_id)
        return [self._a_detalle_dto(a) for a in asignaciones]
