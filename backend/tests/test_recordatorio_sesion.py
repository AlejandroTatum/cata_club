"""Recordatorio in-app de la sesión de mañana (`RECORDATORIO_SESION`, PR F).

Lo que estos tests fijan (y que el docstring del módulo declara como contrato):

  - un alumno con membresía ACTIVA y franja en el día de MAÑANA recibe UNA
    notificación in-app, con la franja nombrada;
  - varias franjas el mismo día son UN solo aviso (la clave de dedup es por
    alumno y día, no por franja);
  - SUSPENDIDA / VENCIDA / INACTIVA y la persona dada de baja no reciben nada;
  - un rerun de la misma noche no duplica: la dedup es por
    `(tipo, persona_id, entidad_relacionada_id=día de la sesión)`;
  - el alumno sin cuenta (representado, invariante B de #1137) recibe el aviso
    en la campana de su representante, con el prefijo "Para <nombre>:" que
    agrega `NotificacionServicio` al leer -- la fila es del ALUMNO, nunca una
    copia a nombre del representante (issue #1227);
  - sin ninguna cuenta alcanzable no se crea la fila (nadie podría leerla) y
    la corrida lo reporta;
  - la tarea está en el `include` del worker y registrada en el beat a las
    21:30 del club;
  - cero correo: el módulo no menciona el servicio de envío y una corrida real
    pasa aunque `enviar_correo` explote.

Datos ficticios.
"""
from contextlib import contextmanager
from datetime import date, time
import inspect

import pytest

import app.infraestructura.tareas.recordatorio_sesion_tareas as tareas
from app.dominio.cedula import cedula_valida
from app.dominio.enums import DiaSemana, EstadoMembresia, TipoNotificacion
from app.dominio.modelos import (
    AlumnoHorario,
    CategoriaHorario,
    CategoriaHorarioDia,
    HorarioEntrenamiento,
    Notificacion,
    Persona,
    Usuario,
)
from app.infraestructura.tareas.celery_app import celery_app
from app.servicios_negocio.notificacion_servicio import NotificacionServicio
from tests.fabricas_pagos import (
    crear_membresia_orm,
    crear_persona_orm,
    crear_tipo_membresia_orm,
)


# Jueves -> el día de la sesión bajo prueba es el VIERNES, un día en el que las
# cinco categorías del club entrenan (Lun-Vie).
HOY = date(2029, 6, 14)
SESION = date(2029, 6, 15)
DIA_DE_LA_SESION = DiaSemana.VIERNES
CLAVE_DE_LA_SESION = 20290615
NOMBRE_TAREA = (
    "app.infraestructura.tareas.recordatorio_sesion_tareas.recordar_sesion_de_manana"
)
MODULO_DE_LA_TAREA = "app.infraestructura.tareas.recordatorio_sesion_tareas"


@pytest.fixture()
def sesion_inyectada(db_session, monkeypatch):
    """La tarea real, sobre la transacción del test: el `SessionLocal` del
    módulo (el del lote y el del `_persistir_lote`) se reemplaza por una
    fábrica que cede `db_session` SIN cerrarla -- el teardown del savepoint
    descarta todo lo escrito, mismo recurso que
    `test_contador_correo_retencion.py`."""

    @contextmanager
    def _factory():
        yield db_session

    monkeypatch.setattr(tareas, "SessionLocal", _factory)
    monkeypatch.setattr(tareas, "hoy_club", lambda: HOY)
    return db_session


# --- Sembrado -----------------------------------------------------------------

def _crear_categoria(db, codigo: str, label: str, hora_inicio: time, hora_fin: time):
    """Categoría propia del test (`horario_entrenamiento.categoria` es una FK al
    catálogo real). `codigo`/`label` son únicos por test porque cada test corre
    dentro de su propia transacción."""
    categoria = CategoriaHorario(
        codigo=codigo, label=label, hora_inicio=hora_inicio, hora_fin=hora_fin,
        dias_permitidos=[CategoriaHorarioDia(dia_semana=DIA_DE_LA_SESION)],
    )
    db.add(categoria)
    db.flush()
    return categoria


def _crear_horario(
    db, codigo: str, hora_inicio: time, hora_fin: time,
    dia: DiaSemana = DIA_DE_LA_SESION,
) -> HorarioEntrenamiento:
    horario = HorarioEntrenamiento(
        categoria=codigo, dia_semana=dia,
        hora_inicio=hora_inicio, hora_fin=hora_fin,
    )
    db.add(horario)
    db.flush()
    return horario


def _crear_persona(db, cedula: str, *, representante_id: int | None = None) -> Persona:
    """Un representado LEGADO se siembra como llega de verdad a la base: el
    vínculo se creó siendo MENOR y envejeció en el sitio (el candado de
    relación rechaza el alta cruda de un adulto vinculado). Mismo helper que
    `test_alertas_mora.py`."""
    vinculado = representante_id is not None
    persona = crear_persona_orm(
        db, cedula,
        nombres="Alumno", apellidos="Recordado",
        fecha_nacimiento=date(2015, 1, 1) if vinculado else date(1990, 1, 1),
    )
    if vinculado:
        persona.representante_id = representante_id
        db.flush()
        persona.fecha_nacimiento = date(1990, 1, 1)  # envejece en el sitio
        db.flush()
    return persona


def _crear_usuario(db, persona: Persona, correo: str) -> Usuario:
    usuario = Usuario(correo=correo, contrasenia="hash", persona_id=persona.id)
    db.add(usuario)
    db.flush()
    return usuario


def _dar_membresia(db, persona: Persona, estado: EstadoMembresia = EstadoMembresia.ACTIVA):
    tipo = crear_tipo_membresia_orm(db, categoria="Recordatorio Prueba")
    return crear_membresia_orm(db, persona, tipo, estado)


def _asignar(db, persona: Persona, horario: HorarioEntrenamiento) -> AlumnoHorario:
    asignacion = AlumnoHorario(persona_id=persona.id, horario_id=horario.id)
    db.add(asignacion)
    db.flush()
    return asignacion


def _escenario_minimo(
    db, cedula: str, *,
    correo: str | None = "alumno.recordado@cataclub.test",
    representante_id: int | None = None,
):
    """Alumno con membresía ACTIVA y una franja el día de la sesión.

    `correo=None` deja al alumno SIN cuenta: es el estado real de un
    representado (invariante B de #1137)."""
    _crear_categoria(db, "RECFORM", "Recordatorio Formativo", time(15, 0), time(16, 0))
    horario = _crear_horario(db, "RECFORM", time(15, 0), time(16, 0))
    persona = _crear_persona(db, cedula, representante_id=representante_id)
    if correo is not None:
        _crear_usuario(db, persona, correo)
    _dar_membresia(db, persona)
    _asignar(db, persona, horario)
    return persona


def _recordatorios(db) -> list[Notificacion]:
    return (
        db.query(Notificacion)
        .filter(Notificacion.tipo == TipoNotificacion.RECORDATORIO_SESION)
        .order_by(Notificacion.persona_id)
        .all()
    )


# --- El label que viaja a Postgres -------------------------------------------

def test_el_valor_del_tipo_es_el_label_que_espera_postgres():
    """El valor viaja a la base y a la API tal cual: el label de la migración
    `p1146recses` y el `TipoNotificacion` de Python tienen que decir lo mismo
    (si divergen, el INSERT muere con `invalid input value for enum`)."""
    assert TipoNotificacion.RECORDATORIO_SESION.value == "RECORDATORIO_SESION"


# --- Camino feliz -------------------------------------------------------------

def test_crea_el_recordatorio_del_alumno_con_franja_manana(sesion_inyectada):
    persona = _escenario_minimo(sesion_inyectada, cedula_valida(901))

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 1
    assert resultado["sesion"] == SESION.isoformat()
    assert resultado["dia_semana"] == DIA_DE_LA_SESION.value
    filas = _recordatorios(sesion_inyectada)
    assert len(filas) == 1
    fila = filas[0]
    assert fila.persona_id == persona.id
    assert fila.leida is False
    assert fila.mensaje == "Entrenamiento mañana: Recordatorio Formativo de 15:00 a 16:00."
    # La entidad relacionada ES el día de la sesión (`YYYYMMDD`): es la mitad
    # de la clave de dedup que hace idempotente al rerun.
    assert fila.entidad_relacionada_id == CLAVE_DE_LA_SESION


def test_sin_franja_el_dia_de_la_sesion_no_hay_recordatorio(sesion_inyectada):
    """La franja existe, pero en OTRO día: mañana no entrena y no se le avisa."""
    _crear_categoria(sesion_inyectada, "RECLUN", "Recordatorio Lunes", time(15, 0), time(16, 0))
    horario = _crear_horario(
        sesion_inyectada, "RECLUN", time(15, 0), time(16, 0), dia=DiaSemana.LUNES
    )
    persona = _crear_persona(sesion_inyectada, cedula_valida(902))
    _crear_usuario(sesion_inyectada, persona, "alumno902@cataclub.test")
    _dar_membresia(sesion_inyectada, persona)
    _asignar(sesion_inyectada, persona, horario)

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 0
    assert _recordatorios(sesion_inyectada) == []


@pytest.mark.parametrize(
    "estado",
    [EstadoMembresia.SUSPENDIDA, EstadoMembresia.VENCIDA, EstadoMembresia.INACTIVA],
    ids=["suspendida", "vencida", "inactiva"],
)
def test_membresia_no_vigente_no_recibe_recordatorio(sesion_inyectada, estado):
    """Suspender detiene la deuda y el vencimiento ya corrió a las 02:35: los
    tres estados fuera de ACTIVA no reciben el aviso."""
    _crear_categoria(sesion_inyectada, "RECEST", "Recordatorio Estado", time(15, 0), time(16, 0))
    horario = _crear_horario(sesion_inyectada, "RECEST", time(15, 0), time(16, 0))
    persona = _crear_persona(sesion_inyectada, cedula_valida(903))
    _crear_usuario(sesion_inyectada, persona, "alumno903@cataclub.test")
    _dar_membresia(sesion_inyectada, persona, estado)
    _asignar(sesion_inyectada, persona, horario)

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 0
    assert _recordatorios(sesion_inyectada) == []


def test_persona_dada_de_baja_no_recibe_recordatorio(sesion_inyectada):
    persona = _escenario_minimo(sesion_inyectada, cedula_valida(904))
    persona.activo = False
    sesion_inyectada.flush()

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 0
    assert _recordatorios(sesion_inyectada) == []


def test_varias_franjas_el_mismo_dia_son_un_solo_recordatorio(sesion_inyectada):
    """Un alumno puede estar en varias categorías: tres campanas seguidas por
    el mismo día serían ruido. Un aviso, con las dos franjas adentro."""
    _crear_categoria(sesion_inyectada, "RECA", "Recordatorio A", time(15, 0), time(16, 0))
    _crear_categoria(sesion_inyectada, "RECB", "Recordatorio B", time(18, 0), time(20, 0))
    horario_a = _crear_horario(sesion_inyectada, "RECA", time(15, 0), time(16, 0))
    horario_b = _crear_horario(sesion_inyectada, "RECB", time(18, 0), time(20, 0))
    persona = _crear_persona(sesion_inyectada, cedula_valida(905))
    _crear_usuario(sesion_inyectada, persona, "alumno905@cataclub.test")
    _dar_membresia(sesion_inyectada, persona)
    _asignar(sesion_inyectada, persona, horario_b)
    _asignar(sesion_inyectada, persona, horario_a)

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 1
    filas = _recordatorios(sesion_inyectada)
    assert len(filas) == 1
    # Ordenadas por hora de inicio, no por el orden en que el JOIN las
    # devolvió (se asignó B antes que A a propósito).
    assert filas[0].mensaje == (
        "Entrenamiento mañana: Recordatorio A de 15:00 a 16:00; "
        "Recordatorio B de 18:00 a 20:00."
    )


# --- Dedup --------------------------------------------------------------------

def test_un_rerun_de_la_misma_noche_no_duplica(sesion_inyectada):
    _escenario_minimo(sesion_inyectada, cedula_valida(906))

    primera = tareas.recordar_sesion_de_manana()
    segunda = tareas.recordar_sesion_de_manana()

    assert primera["total_recordatorios"] == 1
    assert segunda["total_recordatorios"] == 0
    assert len(_recordatorios(sesion_inyectada)) == 1


def test_una_corrida_posterior_avisa_de_la_sesion_de_su_propio_manana(
    sesion_inyectada, monkeypatch
):
    """Triangulación de la clave: la dedup es por día de SESIÓN, no "una vez y
    nunca más". La corrida del día siguiente avisa de la sesión siguiente."""
    _crear_categoria(sesion_inyectada, "RECDOS", "Recordatorio Dos", time(15, 0), time(16, 0))
    horario_viernes = _crear_horario(sesion_inyectada, "RECDOS", time(15, 0), time(16, 0))
    # La corrida "del viernes" (hoy = SESION) tiene por mañana el sábado: se
    # siembra una franja del sábado para que esa corrida tenga algo que avisar.
    horario_sabado = HorarioEntrenamiento(
        categoria="RECDOS", dia_semana=DiaSemana.SABADO,
        hora_inicio=time(10, 0), hora_fin=time(11, 0),
    )
    sesion_inyectada.add(horario_sabado)
    sesion_inyectada.flush()
    persona = _crear_persona(sesion_inyectada, cedula_valida(907))
    _crear_usuario(sesion_inyectada, persona, "alumno907@cataclub.test")
    _dar_membresia(sesion_inyectada, persona)
    _asignar(sesion_inyectada, persona, horario_viernes)
    _asignar(sesion_inyectada, persona, horario_sabado)

    tareas.recordar_sesion_de_manana()
    monkeypatch.setattr(tareas, "hoy_club", lambda: SESION)
    segunda = tareas.recordar_sesion_de_manana()

    assert segunda["total_recordatorios"] == 1
    filas = _recordatorios(sesion_inyectada)
    assert len(filas) == 2
    assert {fila.entidad_relacionada_id for fila in filas} == {20290615, 20290616}


def test_el_aviso_no_tiene_ventana_de_recuperacion(sesion_inyectada, monkeypatch):
    """A diferencia de vencimiento/mora, una corrida posterior NO recupera el
    aviso perdido: avisa de SU propio mañana. Si Beat se saltó la noche del
    jueves, el viernes no aparece el recordatorio del viernes."""
    _escenario_minimo(sesion_inyectada, cedula_valida(908))

    monkeypatch.setattr(tareas, "hoy_club", lambda: SESION)
    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 0
    assert _recordatorios(sesion_inyectada) == []


# --- Destinatario -------------------------------------------------------------

def test_dependiente_sin_cuenta_recibe_el_aviso_en_la_campana_del_representante(
    sesion_inyectada,
):
    """Invariante B de #1137: un representado no tiene cuenta propia. La fila
    es del ALUMNO (issue #1227) y el feed del representante la incluye con el
    prefijo "Para <nombre>:"."""
    representante = _crear_persona(sesion_inyectada, cedula_valida(909))
    _crear_usuario(sesion_inyectada, representante, "representante909@cataclub.test")
    dependiente = _escenario_minimo(
        sesion_inyectada, cedula_valida(910), correo=None,
        representante_id=representante.id,
    )

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 1
    filas = _recordatorios(sesion_inyectada)
    assert [fila.persona_id for fila in filas] == [dependiente.id]

    items, total = NotificacionServicio(sesion_inyectada).listar_para_persona_y_hijos(
        representante.id
    )
    assert total == 1
    assert items[0].tipo == TipoNotificacion.RECORDATORIO_SESION
    assert items[0].mensaje.startswith("Para Alumno Recordado: ")
    assert "Entrenamiento mañana" in items[0].mensaje


def test_dos_representados_del_mismo_representante_reciben_uno_cada_uno(
    sesion_inyectada,
):
    """La clave de dedup es por ALUMNO: dos hijos que entrenan el mismo día no
    se pisan la fila entre sí, y el representante ve el aviso de cada uno."""
    representante = _crear_persona(sesion_inyectada, cedula_valida(911))
    _crear_usuario(sesion_inyectada, representante, "representante911@cataclub.test")
    _crear_categoria(sesion_inyectada, "RECDEP", "Recordatorio Dep", time(15, 0), time(16, 0))
    horario = _crear_horario(sesion_inyectada, "RECDEP", time(15, 0), time(16, 0))
    hijos = []
    for cedula in (cedula_valida(912), cedula_valida(913)):
        hijo = _crear_persona(sesion_inyectada, cedula, representante_id=representante.id)
        _dar_membresia(sesion_inyectada, hijo)
        _asignar(sesion_inyectada, hijo, horario)
        hijos.append(hijo)

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 2
    assert [fila.persona_id for fila in _recordatorios(sesion_inyectada)] == [
        hijo.id for hijo in hijos
    ]
    _, total = NotificacionServicio(sesion_inyectada).listar_para_persona_y_hijos(
        representante.id
    )
    assert total == 2


def test_sin_cuenta_alcanzable_no_se_crea_la_fila_y_la_corrida_lo_reporta(
    sesion_inyectada,
):
    """Ni cuenta propia ni representante con cuenta: nadie podría leer esa
    campana nunca. No se inventa la fila; la corrida lo cuenta para que el
    hueco sea visible."""
    persona = _escenario_minimo(sesion_inyectada, cedula_valida(914), correo=None)

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 0
    assert resultado["total_sin_cuenta_alcanzable"] == 1
    assert resultado["sin_cuenta_alcanzable"] == [persona.id]
    assert _recordatorios(sesion_inyectada) == []


def test_el_snapshot_de_la_corrida_nombra_la_franja(sesion_inyectada):
    persona = _escenario_minimo(sesion_inyectada, cedula_valida(915))

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["recordatorios"] == [{
        "persona_id": persona.id,
        "sesion": SESION.isoformat(),
        "dia_semana": DIA_DE_LA_SESION.value,
        "franjas": ["Recordatorio Formativo de 15:00 a 16:00"],
    }]


# --- Registro (worker + beat) y cero correo -----------------------------------

def test_la_tarea_esta_registrada_en_el_worker_y_en_el_beat():
    """Sin el `include`, el worker no importa el módulo y la tarea del beat
    queda como nombre huérfano; sin la entrada del beat, nadie la dispara."""
    assert MODULO_DE_LA_TAREA in celery_app.conf.include
    assert NOMBRE_TAREA in celery_app.tasks


def test_el_beat_la_corre_a_las_21_30_del_club():
    entrada = celery_app.conf.beat_schedule["recordar-sesion-de-manana-diaria"]

    assert entrada["task"] == NOMBRE_TAREA
    # 21:30 hora del club: después de la última franja del día (ADULTOS
    # 20:00-21:15) y casi 17 h antes de la franja más temprana de mañana
    # (FORMATIVO, 15:00).
    assert set(entrada["schedule"].hour) == {21}
    assert set(entrada["schedule"].minute) == {30}


def test_el_modulo_no_menciona_el_servicio_de_correo(sesion_inyectada, monkeypatch):
    """Candado de la decisión de producto (cero correo en esta ronda).

    Dos capas, como el resto de los candados de este repo: una estructural (el
    módulo no importa el servicio de envío en NINGÚN sitio, ni siquiera dentro
    de una función -- se camina el AST, no el texto, para que un comentario o
    un docstring que lo nombre al explicar la decisión no vuelva la guardia
    vacua) y una viva (una corrida real con `enviar_correo` envenenado termina
    igual de bien, así que ni un camino indirecto podría estar enviando)."""
    import ast

    importados = set()
    for nodo in ast.walk(ast.parse(inspect.getsource(tareas))):
        if isinstance(nodo, ast.Import):
            importados.update(alias.name for alias in nodo.names)
        elif isinstance(nodo, ast.ImportFrom):
            importados.add(nodo.module or "")
    assert not [
        modulo for modulo in importados if modulo.endswith("notificaciones_servicio")
    ], "El recordatorio de sesión es bell-only: no importa el servicio de correo"

    from app.infraestructura import notificaciones_servicio as modulo_correo

    def _prohibido(*args, **kwargs):  # pragma: no cover - solo debe fallar
        raise AssertionError("El recordatorio de sesión es bell-only: nada de correo")

    monkeypatch.setattr(modulo_correo.ServicioNotificaciones, "enviar_correo", _prohibido)
    _escenario_minimo(sesion_inyectada, cedula_valida(916))

    resultado = tareas.recordar_sesion_de_manana()

    assert resultado["total_recordatorios"] == 1
    assert len(_recordatorios(sesion_inyectada)) == 1
