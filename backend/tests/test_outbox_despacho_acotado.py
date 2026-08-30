"""
Techo por corrida en las tres colas de salida (issue #841).

Las tres despachadoras corren cada minuto (`crontab(minute="*/1")` en
`celery_app.py`) y drenaban la tabla ENTERA en una sola ejecución: un
`while True` sobre `claim_pending()`, que reclama UNA fila por consulta. Con
2000 filas atrasadas eso es 2000 idas y vueltas a Postgres y 2000 commits
dentro de un único tick, sobre un worker de `--concurrency=1`: la corrida se
come el turno del worker y publica de golpe más trabajo del que ese mismo
worker puede entregar antes de que venza el lease de 10 minutos.

Lo que se acota es CUÁNTO reclama una corrida, no cuánto llega a entregarse:
un tick toma como mucho `settings.celery_outbox_lote_maximo` filas y el
siguiente sigue donde quedó. Nada se pierde -- una fila no reclamada sigue
`PENDIENTE` y elegible -- y el vencimiento del lease sigue devolviendo a la
cola lo que el worker nunca entregó.

Lo que este archivo NO afirma: que no queden filas en `ENVIANDO` al terminar
un despacho. `ENVIANDO` es justamente el estado correcto de una fila recién
publicada; la cierra su worker por fila, no la despachadora. Un candado
sobre la ausencia de `ENVIANDO` mediría el reloj del worker, no el techo.

Las tres colas comparten el TECHO (un solo número configurado), pero NO la
semántica ante un broker caído, y este archivo la fija por separado para cada
una: las dos que usan `outbox_despacho.reclamar_y_publicar` dejan escapar el
fallo de `.delay` y abortan el tick; la de inscripciones lo atrapa, lo loguea
y sigue. Unificarlas sería cambiar comportamiento, no compartir código.
"""
from __future__ import annotations

import inspect
from collections import Counter
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import (
    EnrollmentNotificacionOutbox,
    Persona,
    RecuperacionOutbox,
    Usuario,
    VerificacionCorreoOutbox,
)
from app.infraestructura.tareas import (
    enrollment_notificacion_tareas,
    outbox_despacho,
    recuperacion_tareas,
    verificacion_correo_tareas,
)
from app.soporte_transversal.configuracion import Settings, settings
from tests import arnes_outbox as arnes

# El techo por defecto, escrito acá como literal a propósito: es lo que da
# sentido a los casos de 51 y 200 filas. Que ESE sea el default lo comprueba
# `test_el_tope_por_defecto_es_cincuenta` contra `Settings`, y no al revés.
TOPE = 50

# Hash de mentira: sembrar 200 cuentas con `crear_usuario_auth` costaría 200
# hashes reales de contraseña para probar algo que no mira ni una.
_HASH_DE_PRUEBA = "$2b$12$hash.de.prueba.que.nadie.verifica"

_LEASE_MINUTOS = 10


# ─── Siembra ────────────────────────────────────────────────────────────────
def _personas(db_session, cantidad: int, base: int) -> list[Persona]:
    personas = [
        Persona(
            nombres="Cola",
            apellidos=f"Outbox{i}",
            cedula=cedula_valida(base + i),
            fecha_nacimiento=date(1990, 1, 1),
            telefono="0991234567",
        )
        for i in range(cantidad)
    ]
    db_session.add_all(personas)
    db_session.flush()
    return personas


def _usuarios(db_session, cantidad: int, base: int) -> list[Usuario]:
    usuarios = [
        Usuario(
            correo=f"cola{base + i}@outbox.test",
            contrasenia=_HASH_DE_PRUEBA,
            persona_id=persona.id,
        )
        for i, persona in enumerate(_personas(db_session, cantidad, base))
    ]
    db_session.add_all(usuarios)
    db_session.flush()
    return usuarios


def _sembrar_por_usuario(db_session, cantidad: int, modelo) -> None:
    """`recuperacion_outbox` y `verificacion_correo_outbox` tienen un único
    parcial por `usuario_id` mientras la fila está viva, así que cada fila
    pendiente necesita SU cuenta."""
    vence = datetime.now(timezone.utc) + timedelta(hours=24)
    db_session.add_all([
        modelo(usuario_id=usuario.id, expires_at=vence)
        for usuario in _usuarios(db_session, cantidad, 100_000)
    ])
    db_session.commit()


def _sembrar_recuperacion(db_session, cantidad: int) -> None:
    _sembrar_por_usuario(db_session, cantidad, RecuperacionOutbox)


def _sembrar_verificacion(db_session, cantidad: int) -> None:
    _sembrar_por_usuario(db_session, cantidad, VerificacionCorreoOutbox)


def _sembrar_inscripciones(db_session, cantidad: int) -> None:
    """Un único admin y `cantidad` alumnos: el único de la tabla es
    (admin, alumno), así que lo que tiene que variar es el alumno."""
    if cantidad == 0:
        return
    admin, *alumnos = _personas(db_session, cantidad + 1, 200_000)
    db_session.add_all([
        EnrollmentNotificacionOutbox(
            admin_persona_id=admin.id,
            alumno_persona_id=alumno.id,
            mensaje=f"Nuevo alumno inscrito: Outbox{i}.",
        )
        for i, alumno in enumerate(alumnos)
    ])
    db_session.commit()


# ─── Las tres colas, descritas una vez ──────────────────────────────────────
@dataclass(frozen=True)
class Cola:
    nombre: str
    modulo: Any
    modelo: Any
    tarea_por_fila: Any
    despachar: Callable[[], dict]
    sembrar: Callable[..., None]


COLA_RECUPERACION = Cola(
    "recuperacion",
    recuperacion_tareas,
    RecuperacionOutbox,
    recuperacion_tareas.procesar_recuperacion_outbox,
    recuperacion_tareas.despachar_recuperaciones_pendientes,
    _sembrar_recuperacion,
)
COLA_VERIFICACION = Cola(
    "verificacion_correo",
    verificacion_correo_tareas,
    VerificacionCorreoOutbox,
    verificacion_correo_tareas.procesar_verificacion_correo_outbox,
    verificacion_correo_tareas.despachar_verificaciones_pendientes,
    _sembrar_verificacion,
)
COLA_INSCRIPCIONES = Cola(
    "inscripciones",
    enrollment_notificacion_tareas,
    EnrollmentNotificacionOutbox,
    enrollment_notificacion_tareas.entregar_inscripcion_notificacion,
    enrollment_notificacion_tareas.despachar_inscripcion_notificaciones,
    _sembrar_inscripciones,
)

COLAS = [COLA_RECUPERACION, COLA_VERIFICACION, COLA_INSCRIPCIONES]
COLAS_DEL_HELPER = [COLA_RECUPERACION, COLA_VERIFICACION]

_por_cola = pytest.mark.parametrize("cola", COLAS, ids=lambda cola: cola.nombre)


@pytest.fixture()
def preparar(db_session, monkeypatch):
    """Ata una cola a la sesión del test y sustituye SU publicación.

    Se reemplaza `.delay` de la tarea por fila y no se activa el modo eager:
    lo que este archivo mide es cuántas filas reclama y publica UNA corrida,
    y entregarlas de verdad metería el SMTP en el medio de esa cuenta.
    """
    pila = ExitStack()

    def _preparar(cola: Cola, publicar: Callable[[int], Any] | None = None) -> list[int]:
        publicadas: list[int] = []
        pila.enter_context(arnes.sesion_inyectada_en(cola.modulo, db_session, monkeypatch))
        monkeypatch.setattr(cola.tarea_por_fila, "delay", publicar or publicadas.append)
        return publicadas

    with pila:
        yield _preparar


def _esperado(reclamadas: int, tope: int = TOPE) -> dict:
    return {
        "reclamadas": reclamadas,
        "tope": tope,
        "tope_alcanzado": reclamadas >= tope,
    }


# ─── El techo ───────────────────────────────────────────────────────────────
def test_el_tope_por_defecto_es_cincuenta():
    """El default vive en `Settings`, no en un literal repartido por los tres
    módulos de tareas. Se lee del campo y no de `settings` ya construido para
    que un `.env` local no pueda hacer pasar este candado por casualidad."""
    assert Settings.model_fields["celery_outbox_lote_maximo"].default == TOPE


@_por_cola
@pytest.mark.parametrize(
    "pendientes,reclamadas",
    [(0, 0), (1, 1), (TOPE, TOPE), (TOPE + 1, TOPE), (200, TOPE)],
    ids=["cero", "una", "justo_el_tope", "una_de_mas", "doscientas"],
)
def test_una_corrida_reclama_como_mucho_el_tope(
    cola, pendientes, reclamadas, db_session, preparar
):
    """El caso de 200 es el que describe el issue: una sola corrida se llevaba
    las 200 filas, 200 consultas y 200 commits en un tick de 60 segundos."""
    publicadas = preparar(cola)
    cola.sembrar(db_session, pendientes)

    resultado = cola.despachar()

    assert resultado == _esperado(reclamadas)
    assert len(publicadas) == reclamadas


@_por_cola
def test_lo_que_no_entro_en_el_lote_queda_intacto_y_elegible(cola, db_session, preparar):
    """Con una fila por encima del tope, esa fila tiene que quedar como si el
    tick no hubiera existido: `PENDIENTE`, sin intento gastado y sin lease."""
    preparar(cola)
    cola.sembrar(db_session, TOPE + 1)

    cola.despachar()

    db_session.expire_all()
    sobrantes = db_session.query(cola.modelo).filter(
        cola.modelo.status == "PENDIENTE"
    ).all()
    assert len(sobrantes) == 1
    assert sobrantes[0].attempts == 0
    assert sobrantes[0].claimed_at is None


@_por_cola
def test_ticks_repetidos_terminan_drenando_el_atraso(cola, db_session, preparar):
    """Acotar no es descartar: cuatro corridas se llevan las 200 filas, cada
    una a una fila distinta, y la quinta no encuentra nada."""
    publicadas = preparar(cola)
    cola.sembrar(db_session, 200)

    reclamadas = [cola.despachar()["reclamadas"] for _ in range(5)]

    assert reclamadas == [TOPE, TOPE, TOPE, TOPE, 0]
    assert len(publicadas) == 200
    assert len(set(publicadas)) == 200


@_por_cola
def test_el_tope_sale_de_la_configuracion(cola, db_session, preparar, monkeypatch):
    """Un solo número configurable manda sobre las tres colas."""
    monkeypatch.setattr(settings, "celery_outbox_lote_maximo", 3)
    preparar(cola)
    cola.sembrar(db_session, 5)

    assert cola.despachar() == _esperado(3, tope=3)


@_por_cola
def test_el_vencimiento_del_lease_sigue_devolviendo_la_fila(
    cola, db_session, preparar, monkeypatch
):
    """El techo no toca el lease. Una fila publicada que el worker nunca
    entregó vuelve a ser reclamable a los 10 minutos, y esa reclamación
    consume cupo del lote como cualquier otra."""
    monkeypatch.setattr(settings, "celery_outbox_lote_maximo", 2)
    preparar(cola)
    cola.sembrar(db_session, 3)

    assert cola.despachar()["reclamadas"] == 2

    vencido = datetime.now(timezone.utc) - timedelta(minutes=_LEASE_MINUTOS + 1)
    db_session.query(cola.modelo).filter(cola.modelo.status == "ENVIANDO").update(
        {cola.modelo.claimed_at: vencido}, synchronize_session=False
    )
    db_session.commit()

    assert cola.despachar()["reclamadas"] == 2

    db_session.expire_all()
    intentos = Counter(fila.attempts for fila in db_session.query(cola.modelo).all())
    # Las dos del primer lote volvieron a reclamarse (2 intentos); la tercera
    # sigue esperando su turno, todavía sin gastar ninguno.
    assert intentos == Counter({2: 2, 0: 1})


# ─── Broker caído: cada cola conserva SU semántica ──────────────────────────
@pytest.mark.parametrize("cola", COLAS_DEL_HELPER, ids=lambda cola: cola.nombre)
def test_el_helper_sigue_abortando_el_tick_si_el_broker_falla(cola, db_session, preparar):
    """Semántica ACTUAL de `reclamar_y_publicar`, preservada: el fallo de
    `.delay` no se atrapa y corta la corrida en la primera fila. Acotar el
    lote no puede convertir eso en un barrido que gaste un intento por fila
    sin entregar ninguna."""
    llamadas: list[int] = []

    def _broker_caido(evento_id: int):
        llamadas.append(evento_id)
        raise RuntimeError("broker caido")

    preparar(cola, publicar=_broker_caido)
    cola.sembrar(db_session, 10)

    with pytest.raises(RuntimeError, match="broker caido"):
        cola.despachar()

    assert len(llamadas) == 1


def test_inscripciones_sigue_tragando_el_fallo_del_broker_pero_ya_no_barre_la_tabla(
    db_session, preparar
):
    """Semántica ACTUAL de la cola de inscripciones, preservada: atrapa el
    fallo de `.delay`, lo loguea y CONTINÚA. Lo que cambia es hasta dónde: el
    barrido que gastaba un intento por cada fila de la tabla ahora se detiene
    en el tope, así que un broker caído quema como mucho un lote."""
    cola = COLA_INSCRIPCIONES

    def _broker_caido(evento_id: int):
        raise RuntimeError("broker caido")

    preparar(cola, publicar=_broker_caido)
    cola.sembrar(db_session, TOPE + 10)

    with arnes.logs_recogidos("cataclub.tareas.enrollment_notificacion") as registros:
        resultado = cola.despachar()

    assert resultado == _esperado(TOPE)
    assert len(registros) == TOPE

    db_session.expire_all()
    intentos = Counter(
        fila.attempts for fila in db_session.query(EnrollmentNotificacionOutbox).all()
    )
    assert intentos == Counter({1: TOPE, 0: 10})


# ─── Candado estructural ────────────────────────────────────────────────────
def test_ningun_despachador_conserva_un_bucle_sin_techo():
    """`while True` sobre `claim_pending()` es exactamente la forma que este
    issue retira. El candado mira el TEXTO porque el bucle acotado y el
    ilimitado producen el mismo resultado con la tabla vacía: sin filas, los
    dos devuelven cero y ningún test de comportamiento los distingue."""
    con_bucle = [
        modulo.__name__
        for modulo in (outbox_despacho, enrollment_notificacion_tareas)
        if "while True" in inspect.getsource(modulo)
    ]
    assert not con_bucle, f"despacho sin techo en: {con_bucle}"
