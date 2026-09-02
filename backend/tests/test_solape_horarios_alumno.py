"""Issue #731: asignar a un alumno un horario que se pisa con otro suyo debe
AVISAR, nunca bloquear.

Decisión del dueño (2026-08-27): "una persona sí puede pertenecer a varios
horarios, pero sí, lo correcto es avisar nada más". Pertenecer a varias
categorías es una característica real del club, no un defecto -- lo único
que faltaba era que quien asigna se entere del cruce, con el otro horario
NOMBRADO (categoría, día y rango) para decidir en el momento.

El caso de borde es el que manda: 18:00-20:00 y 20:00-21:15 se TOCAN y no se
solapan. Es la disposición más común del club (Competitivo seguido de
Adultos); avisar ahí sería un falso positivo en cada asignación normal.

Mismo patrón NO BLOQUEANTE que INS-6 / `membresia_vencida`: el aviso viaja
en la respuesta del alta, al lado de las asignaciones que SÍ se crearon.
"""
from datetime import date, time

from app.dominio.enums import DiaSemana
from app.dominio.modelos import Persona
from app.servicios_negocio.dtos.asistencia_schemas import (
    AlumnoHorarioCreateDTO, CategoriaCreateDTO,
)
from app.servicios_negocio.asistencia_servicio import AsistenciaServicio


def _crear_alumno(sesion, cedula: str = "1710034065") -> Persona:
    persona = Persona(
        nombres="Ariana", apellidos="Ruiz", cedula=cedula,
        fecha_nacimiento=date(2012, 3, 1), telefono="0991234567",
    )
    sesion.add(persona)
    sesion.flush()
    return persona


def _crear_categoria(servicio, nombre, hora_inicio, hora_fin, dias):
    """Alta atómica de categoría + sus horarios; devuelve los horarios."""
    categoria = servicio.crear_categoria(CategoriaCreateDTO(
        nombre=nombre, hora_inicio=hora_inicio, hora_fin=hora_fin, dias=dias,
    ))
    return servicio.listar_horarios(categoria.codigo)


def _asignar(servicio, persona, horario):
    return servicio.asignar_alumno_a_horario(
        AlumnoHorarioCreateDTO(persona_id=persona.id, horario_id=horario.id)
    )


# --- Solape real: avisa Y asigna igual --------------------------------------
def test_horario_que_se_pisa_avisa_y_no_bloquea(db_session):
    """El caso del issue: Competitivo 18:00-20:00 + un horario 19:00-20:30."""
    servicio = AsistenciaServicio(db_session)
    persona = _crear_alumno(db_session)
    competitivo = _crear_categoria(
        servicio, "Bloque Tarde", time(18, 0), time(20, 0), [DiaSemana.LUNES],
    )
    solapado = _crear_categoria(
        servicio, "Bloque Cruzado", time(19, 0), time(20, 30), [DiaSemana.LUNES],
    )
    _asignar(servicio, persona, competitivo[0])

    respuesta = _asignar(servicio, persona, solapado[0])

    # No bloquea: la asignación se creó.
    assert len(respuesta.asignaciones) == 1
    # Y avisa, nombrando el OTRO horario.
    assert len(respuesta.solapamientos) == 1
    aviso = respuesta.solapamientos[0]
    assert aviso.categoria_label == "Bloque Tarde"
    assert aviso.dia_semana == DiaSemana.LUNES
    assert aviso.hora_inicio == time(18, 0)
    assert aviso.hora_fin == time(20, 0)


def test_avisa_de_cada_horario_que_se_pisa_no_solo_del_primero(db_session):
    """19:00-20:30 pisa a Competitivo (18-20) Y a Adultos (20:00-21:15)... no:
    Adultos SOLO se toca en el borde con Competitivo, pero SÍ se solapa con
    19:00-20:30 (arranca 20:00 < 20:30). Los dos avisos tienen que salir."""
    servicio = AsistenciaServicio(db_session)
    persona = _crear_alumno(db_session)
    competitivo = _crear_categoria(
        servicio, "Bloque Tarde", time(18, 0), time(20, 0), [DiaSemana.LUNES],
    )
    adultos = _crear_categoria(
        servicio, "Bloque Noche", time(20, 0), time(21, 15), [DiaSemana.LUNES],
    )
    solapado = _crear_categoria(
        servicio, "Bloque Cruzado", time(19, 0), time(20, 30), [DiaSemana.LUNES],
    )
    _asignar(servicio, persona, competitivo[0])
    _asignar(servicio, persona, adultos[0])

    respuesta = _asignar(servicio, persona, solapado[0])

    assert len(respuesta.asignaciones) == 1
    etiquetas = [s.categoria_label for s in respuesta.solapamientos]
    assert etiquetas == ["Bloque Tarde", "Bloque Noche"]


# --- Borde que se toca: NO avisa (el test que más importa) -------------------
def test_horarios_que_solo_se_tocan_en_el_borde_no_avisan(db_session):
    """18:00-20:00 seguido de 20:00-21:15 es la disposición NORMAL del club.
    La comparación es estricta (`inicio < fin` de los dos lados), así que el
    borde compartido no cuenta como solape -- avisar acá sería molestar en
    cada asignación legítima."""
    servicio = AsistenciaServicio(db_session)
    persona = _crear_alumno(db_session)
    competitivo = _crear_categoria(
        servicio, "Bloque Tarde", time(18, 0), time(20, 0), [DiaSemana.LUNES],
    )
    adultos = _crear_categoria(
        servicio, "Bloque Noche", time(20, 0), time(21, 15), [DiaSemana.LUNES],
    )
    _asignar(servicio, persona, competitivo[0])

    respuesta = _asignar(servicio, persona, adultos[0])

    assert len(respuesta.asignaciones) == 1
    assert respuesta.solapamientos == []


def test_borde_que_se_toca_al_reves_tampoco_avisa(db_session):
    """El mismo borde asignando en el orden inverso: primero Adultos
    (20:00-21:15), después Competitivo (18:00-20:00). El chequeo no puede
    depender de cuál se asignó antes."""
    servicio = AsistenciaServicio(db_session)
    persona = _crear_alumno(db_session)
    competitivo = _crear_categoria(
        servicio, "Bloque Tarde", time(18, 0), time(20, 0), [DiaSemana.LUNES],
    )
    adultos = _crear_categoria(
        servicio, "Bloque Noche", time(20, 0), time(21, 15), [DiaSemana.LUNES],
    )
    _asignar(servicio, persona, adultos[0])

    respuesta = _asignar(servicio, persona, competitivo[0])

    assert len(respuesta.asignaciones) == 1
    assert respuesta.solapamientos == []


# --- Mismo rango, otro día: NO avisa ----------------------------------------
def test_mismo_rango_en_otro_dia_no_avisa(db_session):
    """Dos horarios idénticos en días distintos no se cruzan nunca."""
    servicio = AsistenciaServicio(db_session)
    persona = _crear_alumno(db_session)
    lunes = _crear_categoria(
        servicio, "Bloque Lunes", time(18, 0), time(20, 0), [DiaSemana.LUNES],
    )
    martes = _crear_categoria(
        servicio, "Bloque Martes", time(18, 0), time(20, 0), [DiaSemana.MARTES],
    )
    _asignar(servicio, persona, lunes[0])

    respuesta = _asignar(servicio, persona, martes[0])

    assert len(respuesta.asignaciones) == 1
    assert respuesta.solapamientos == []


def test_una_categoria_de_varios_dias_avisa_solo_del_dia_que_se_pisa(db_session):
    """La inscripción es por categoría entera (todos sus días), así que el
    chequeo corre día por día: Lunes se pisa, Martes no, y solo sale el
    aviso del Lunes."""
    servicio = AsistenciaServicio(db_session)
    persona = _crear_alumno(db_session)
    competitivo = _crear_categoria(
        servicio, "Bloque Tarde", time(18, 0), time(20, 0), [DiaSemana.LUNES],
    )
    solapado = _crear_categoria(
        servicio, "Bloque Cruzado", time(19, 0), time(20, 30),
        [DiaSemana.LUNES, DiaSemana.MARTES],
    )
    _asignar(servicio, persona, competitivo[0])

    respuesta = _asignar(servicio, persona, solapado[0])

    assert len(respuesta.asignaciones) == 2  # Lunes y Martes se crean igual
    assert [s.dia_semana for s in respuesta.solapamientos] == [DiaSemana.LUNES]


# --- Nunca bloquea ----------------------------------------------------------
def test_el_alumno_queda_realmente_asignado_a_los_dos_horarios(db_session):
    """El aviso no puede tener efecto colateral: después de avisar, el alumno
    figura en AMBOS horarios."""
    servicio = AsistenciaServicio(db_session)
    persona = _crear_alumno(db_session)
    competitivo = _crear_categoria(
        servicio, "Bloque Tarde", time(18, 0), time(20, 0), [DiaSemana.LUNES],
    )
    solapado = _crear_categoria(
        servicio, "Bloque Cruzado", time(19, 0), time(20, 30), [DiaSemana.LUNES],
    )
    _asignar(servicio, persona, competitivo[0])
    _asignar(servicio, persona, solapado[0])

    horarios = servicio.listar_horarios_por_alumno(persona.id)
    ids = {h.horario_id for h in horarios}
    assert {competitivo[0].id, solapado[0].id} <= ids
