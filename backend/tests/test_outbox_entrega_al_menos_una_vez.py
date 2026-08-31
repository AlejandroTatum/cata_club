"""
Entrega AT-LEAST-ONCE de los correos de acceso, y su auditoría (issue #839).

Qué contrato custodia este archivo
----------------------------------
`entregar_fila` habla con dos sistemas que no comparten transacción: el
proveedor SMTP y Postgres. Entre que `sendmail` vuelve y que `mark_sent()`
se commitea hay una ventana en la que el proceso puede morir, y ninguna
escritura de la base sabe todavía que el correo salió. No existe forma de
cerrarla: no hay commit de dos fases sobre SMTP, y cualquier diseño que
commitee "enviado" ANTES del envío para evitar el duplicado convierte esa
misma ventana en pérdida de correo.

La política del club, elegida a propósito, es **at-least-once**: antes que
perder un enlace de acceso o de recuperación se acepta que una muerte
extrema del worker entregue un duplicado. Estas pruebas afirman el
DUPLICADO como resultado esperado; no fingen prevenirlo.

Lo que sí se exige, y este archivo mide:
  1. Que el duplicado quede ACOTADO. Hasta el issue #839 no lo estaba: el
     broker redelivera el mismo mensaje (`task_acks_late=True` y
     `task_reject_on_worker_lost=True` en `celery_app.py`) y `entregar_fila`
     solo LEE la fila -- el único que incrementa `attempts` es
     `claim_pending` --, así que un worker que muere siempre en el mismo
     punto reenviaba sin techo y nunca llegaba a `AGOTADO`.
  2. Que quede EVIDENCIA DURABLE de que una entrega anterior llegó al paso
     de envío sin registrar su desenlace, para que un duplicado probable se
     pueda diagnosticar en vez de adivinar.

Cómo se inyecta la falla
------------------------
`MuerteDelWorker` hereda de `BaseException`, no de `Exception`: lo que se
simula es un proceso que muere (SIGKILL, OOM), y eso ningún `except
Exception` lo atrapa. Heredar de `Exception` haría que la prueba pasara a
medir el manejo de errores de la entrega -- el camino de `requeue`, que se
cubre aparte -- en vez de la muerte del worker.

El `db_session.rollback()` posterior es parte de la simulación: la
transacción que el worker tenía abierta cuando murió nunca se commitea. Bajo
el aislamiento por transacción externa + savepoints de `conftest.py`, ese
rollback descarta exactamente lo que quedó sin commitear y conserva lo ya
commiteado, que es lo que hace Postgres ante un cliente que desaparece.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from unittest.mock import MagicMock, patch

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import RecuperacionOutbox, Usuario, VerificacionCorreoOutbox
from app.infraestructura.repositorios import outbox_auditoria_entrega as auditoria
from app.infraestructura.repositorios.recuperacion_outbox_repositorio import (
    MAX_ATTEMPTS,
    RecuperacionOutboxRepositorio,
)
from app.infraestructura.repositorios.verificacion_correo_outbox_repositorio import (
    VerificacionCorreoOutboxRepositorio,
)
from app.infraestructura.tareas import recuperacion_tareas, verificacion_correo_tareas
from tests import arnes_outbox as arnes
from tests.fabricas_auth import crear_usuario_auth


LEASE_MINUTOS = 10


class MuerteDelWorker(BaseException):
    """El proceso desaparece. Ver la nota del encabezado sobre `BaseException`."""


@dataclass(frozen=True)
class Cola:
    """Las dos colas con enlace de acceso, descritas por lo único que difiere.

    Las tres colas del club comparten `outbox_despacho`, pero solo estas dos
    mandan un enlace con el que alguien entra a su cuenta. La de
    notificaciones de inscripción queda afuera del issue #839 a propósito: no
    habla SMTP y ya tiene su propia guarda de idempotencia.
    """

    nombre: str
    modulo: Any
    modelo: Any
    repositorio: Any
    procesar: Callable[[int], dict]
    despachar: Callable[[], dict]
    logger: str
    correo: str
    semilla: int


COLAS = [
    Cola(
        nombre="recuperacion",
        modulo=recuperacion_tareas,
        modelo=RecuperacionOutbox,
        repositorio=RecuperacionOutboxRepositorio,
        procesar=recuperacion_tareas.procesar_recuperacion_outbox,
        despachar=recuperacion_tareas.despachar_recuperaciones_pendientes,
        logger="cataclub.tareas.recuperacion",
        correo="recupera@cataclub.test",
        semilla=8390,
    ),
    Cola(
        nombre="verificacion_correo",
        modulo=verificacion_correo_tareas,
        modelo=VerificacionCorreoOutbox,
        repositorio=VerificacionCorreoOutboxRepositorio,
        procesar=verificacion_correo_tareas.procesar_verificacion_correo_outbox,
        despachar=verificacion_correo_tareas.despachar_verificaciones_pendientes,
        logger="cataclub.tareas.verificacion_correo",
        correo="verifica@cataclub.test",
        semilla=8395,
    ),
]


# ─── Arnés ──────────────────────────────────────────────────────────────────
@pytest.fixture(params=COLAS, ids=[c.nombre for c in COLAS])
def cola(request, db_session, monkeypatch) -> Cola:
    """Cada prueba de este archivo corre DOS veces, una por cola.

    Parametrizar en vez de duplicar el archivo no es solo economía: el issue
    #839 pide el MISMO contrato en las dos colas, y dos copias de la misma
    prueba se desincronizan en cuanto alguien arregla una sola.
    """
    elegida: Cola = request.param
    with arnes.sesion_inyectada_en(elegida.modulo, db_session, monkeypatch):
        arnes.celery_en_proceso(elegida.modulo, monkeypatch)
        arnes.configurar_smtp(monkeypatch)
        yield elegida


@pytest.fixture()
def smtp():
    """UN solo mock de SMTP por prueba: los envíos se acumulan a través de
    todas las entregas del caso, que es lo que permite CONTAR duplicados."""
    with patch(
        "app.infraestructura.notificaciones_servicio.smtplib.SMTP", MagicMock()
    ) as smtp_cls:
        yield smtp_cls


def _sembrar(cola: Cola, db_session) -> tuple[Usuario, Any]:
    usuario = crear_usuario_auth(
        db_session, correo=cola.correo, cedula=cedula_valida(cola.semilla)
    )
    fila = cola.modelo(
        usuario_id=usuario.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db_session.add(fila)
    db_session.commit()
    return usuario, fila


def _reclamar(cola: Cola, db_session) -> None:
    """Deja la fila como la deja el despachador: `ENVIANDO`, con lease."""
    cola.repositorio(db_session).claim_pending()
    db_session.commit()


def _releer(cola: Cola, db_session, fila_id):
    db_session.expire_all()
    return db_session.get(cola.modelo, fila_id)


def _matar_antes_de_marcar_enviada(cola: Cola, monkeypatch) -> Callable[[], None]:
    """El worker muere DESPUÉS de que `sendmail` volvió y ANTES del commit que
    registraría el envío: la ventana exacta que describe el issue #839.

    Devuelve el interruptor que revive al worker siguiente. Se hace así y no
    con `monkeypatch.undo()` porque `undo()` desharía también la sesión
    inyectada y el SMTP falso del arnés, y la prueba quedaría midiendo otra
    cosa sin decirlo.
    """
    real = cola.repositorio.mark_sent
    vivo = {"muere": True}

    def _quiza_morir(self, evento):
        if vivo["muere"]:
            raise MuerteDelWorker("el worker murió antes de commitear mark_sent")
        return real(self, evento)

    monkeypatch.setattr(cola.repositorio, "mark_sent", _quiza_morir)
    return lambda: vivo.__setitem__("muere", False)


def _matar_antes_de_enviar(cola: Cola, monkeypatch) -> Callable[[], None]:
    """El worker muere DESPUÉS del marcador de intento y ANTES de `sendmail`:
    la ventana que ABRE el marcador previo al envío, y que no puede perder
    correo."""
    real = cola.modulo.ServicioNotificaciones
    vivo = {"muere": True}

    class _ServicioQueMuere(real):
        def __init__(self, *args, **kwargs):
            if vivo["muere"]:
                raise MuerteDelWorker("el worker murió antes de sendmail")
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(cola.modulo, "ServicioNotificaciones", _ServicioQueMuere)
    return lambda: vivo.__setitem__("muere", False)


def _procesar_muriendo(cola: Cola, db_session, fila_id) -> None:
    with pytest.raises(MuerteDelWorker):
        cola.procesar(fila_id)
    db_session.rollback()


# ─── 1. El camino sano no cambia ────────────────────────────────────────────
def test_una_entrega_sin_incidentes_manda_un_solo_correo(cola, db_session, smtp):
    """Ancla del resto: sin falla inyectada la cola sigue entregando UNA vez y
    cerrando la fila, con el intento de entrega ya resuelto en la auditoría."""
    usuario, fila = _sembrar(cola, db_session)

    resultado = cola.despachar()

    assert resultado["reclamadas"] == 1
    assert len(arnes.envios(smtp)) == 1
    assert arnes.envios(smtp)[0].args[1] == usuario.correo
    guardada = _releer(cola, db_session, fila.id)
    assert guardada.status == "ENVIADO" and guardada.sent_at is not None
    assert guardada.entregas_intentadas == 1
    assert guardada.entrega_iniciada_at is not None
    assert guardada.entrega_resuelta_at >= guardada.entrega_iniciada_at


# ─── 2. Muerte entre el envío y el commit ───────────────────────────────────
def test_la_muerte_entre_el_envio_y_el_commit_deja_la_fila_sin_cerrar(
    cola, db_session, smtp, monkeypatch
):
    """El correo YA salió y la base no lo sabe. La fila queda `ENVIANDO`, que
    es lo que la vuelve reclamable -- y lo que hace inevitable el duplicado."""
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    _matar_antes_de_marcar_enviada(cola, monkeypatch)

    _procesar_muriendo(cola, db_session, fila.id)

    assert len(arnes.envios(smtp)) == 1
    guardada = _releer(cola, db_session, fila.id)
    assert guardada.status == "ENVIANDO"
    assert guardada.sent_at is None


# ─── 3. El reproceso entrega de nuevo: at-least-once, afirmado ──────────────
def test_la_redelivery_del_broker_entrega_de_nuevo_y_eso_es_lo_esperado(
    cola, db_session, smtp, monkeypatch
):
    """AT-LEAST-ONCE, sin eufemismos: el broker redelivera el mismo mensaje
    (`task_acks_late`) y el segundo envío OCURRE. El contrato del club
    prefiere ese duplicado antes que perder el enlace."""
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    revivir = _matar_antes_de_marcar_enviada(cola, monkeypatch)
    _procesar_muriendo(cola, db_session, fila.id)

    revivir()
    cola.procesar(fila.id)

    assert len(arnes.envios(smtp)) == 2, "at-least-once: el duplicado es el contrato"
    guardada = _releer(cola, db_session, fila.id)
    assert guardada.status == "ENVIADO"


def test_el_vencimiento_del_lease_tambien_reentrega(
    cola, db_session, smtp, monkeypatch
):
    """La segunda fuente de duplicado, independiente del broker: la fila quedó
    `ENVIANDO` y a los 10 minutos `claim_pending` la vuelve a tomar."""
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    revivir = _matar_antes_de_marcar_enviada(cola, monkeypatch)
    _procesar_muriendo(cola, db_session, fila.id)

    vencida = _releer(cola, db_session, fila.id)
    vencida.claimed_at = datetime.now(timezone.utc) - timedelta(
        minutes=LEASE_MINUTOS * 2
    )
    db_session.commit()

    revivir()
    assert cola.despachar()["reclamadas"] == 1

    assert len(arnes.envios(smtp)) == 2
    guardada = _releer(cola, db_session, fila.id)
    assert guardada.status == "ENVIADO"
    assert guardada.attempts == 2, "el reclamo por lease vencido sí gasta un intento"


# ─── 4. La evidencia durable del duplicado probable ─────────────────────────
def test_la_entrega_interrumpida_deja_evidencia_durable_antes_de_enviar(
    cola, db_session, smtp, monkeypatch
):
    """El marcador se commitea ANTES de `sendmail`. Por eso sobrevive a la
    muerte del worker, que es lo único que lo vuelve útil: un rastro escrito
    después del envío se pierde en la misma ventana que viene a documentar."""
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    _matar_antes_de_marcar_enviada(cola, monkeypatch)

    _procesar_muriendo(cola, db_session, fila.id)

    guardada = _releer(cola, db_session, fila.id)
    assert guardada.entregas_intentadas == 1
    assert guardada.entrega_iniciada_at is not None
    assert guardada.entrega_resuelta_at is None, (
        "la entrega llegó al envío y nunca registró su desenlace"
    )
    assert auditoria.entrega_previa_sin_resolver(guardada)


def test_la_segunda_entrega_registra_el_duplicado_probable(
    cola, db_session, smtp, monkeypatch
):
    """Lo que un operador tiene que poder ver cuando un usuario dice que le
    llegaron dos correos: qué fila, de qué usuario, y desde cuándo había una
    entrega iniciada sin desenlace."""
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    revivir = _matar_antes_de_marcar_enviada(cola, monkeypatch)
    _procesar_muriendo(cola, db_session, fila.id)

    revivir()
    with arnes.logs_recogidos(cola.logger) as registros:
        cola.procesar(fila.id)

    avisos = [r.getMessage() for r in registros if "duplicado" in r.getMessage().lower()]
    assert len(avisos) == 1, f"se esperaba un aviso de duplicado probable, hubo {avisos}"
    assert str(fila.id) in avisos[0]

    guardada = _releer(cola, db_session, fila.id)
    assert guardada.entregas_intentadas == 2
    assert guardada.entrega_resuelta_at >= guardada.entrega_iniciada_at
    assert not auditoria.entrega_previa_sin_resolver(guardada)


# ─── 5. Muerte ANTES del envío: se recupera sin duplicar ────────────────────
def test_morir_antes_de_enviar_no_duplica_y_entrega_una_sola_vez(
    cola, db_session, smtp, monkeypatch
):
    """La otra mitad de la ventana. Acá no hubo correo, así que la
    recuperación tiene que terminar en UN envío: ni cero (correo perdido) ni
    dos (un duplicado que lo inventaría el arreglo)."""
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    revivir = _matar_antes_de_enviar(cola, monkeypatch)

    _procesar_muriendo(cola, db_session, fila.id)
    assert arnes.envios(smtp) == []

    revivir()
    cola.procesar(fila.id)

    assert len(arnes.envios(smtp)) == 1
    guardada = _releer(cola, db_session, fila.id)
    assert guardada.status == "ENVIADO"


# ─── 6. Entre el marcador y el envío: el correo no se pierde ────────────────
def test_el_marcador_previo_al_envio_no_puede_perder_el_correo(
    cola, db_session, smtp, monkeypatch
):
    """El riesgo que introduce commitear ANTES de enviar: que ese commit se
    lea como "ya se mandó" y la fila se cierre sin correo. No se cierra. El
    marcador NO toca `status` ni `sent_at`; la fila sigue `ENVIANDO`, sigue
    siendo del worker que la reclamó, y el reintento la entrega igual."""
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    revivir = _matar_antes_de_enviar(cola, monkeypatch)

    _procesar_muriendo(cola, db_session, fila.id)

    interrumpida = _releer(cola, db_session, fila.id)
    assert interrumpida.entregas_intentadas == 1, "el intento quedó contado"
    assert interrumpida.status == "ENVIANDO", "el marcador no cierra la fila"
    assert interrumpida.sent_at is None, "el marcador no la da por enviada"
    assert interrumpida.claimed_at is not None, "el lease sigue siendo del reclamante"

    revivir()
    cola.procesar(fila.id)

    assert len(arnes.envios(smtp)) == 1, "el correo se entregó, no se perdió"


# ─── 7. Un fallo de SMTP sigue reintentándose como siempre ──────────────────
def test_un_fallo_de_smtp_sigue_volviendo_a_pendiente_con_backoff(
    cola, db_session, smtp
):
    """El marcador previo al envío no puede convertir un fallo en un éxito.
    `requeue` sigue mandando la fila a `PENDIENTE`, y el intento queda
    RESUELTO: un fallo conocido no es un duplicado probable."""
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    smtp.side_effect = OSError("conexión rechazada")

    cola.procesar(fila.id)

    guardada = _releer(cola, db_session, fila.id)
    assert guardada.status == "PENDIENTE"
    assert guardada.claimed_at is None
    assert guardada.last_error_redacted == "ServicioNoDisponible: delivery failed"
    assert guardada.entregas_intentadas == 1
    assert not auditoria.entrega_previa_sin_resolver(guardada), (
        "un fallo con desenlace registrado no es un duplicado probable"
    )


# ─── 8. El techo: la redelivery del broker ya no reenvía para siempre ───────
def test_la_redelivery_repetida_termina_y_no_reenvia_sin_techo(
    cola, db_session, smtp, monkeypatch
):
    """El defecto del issue #839. Un worker que muere SIEMPRE en el mismo
    punto hacía que el broker redeliverara el mismo mensaje indefinidamente,
    y `entregar_fila` solo LEE la fila: `attempts` nunca subía, así que
    `AGOTADO` era inalcanzable y el reenvío no tenía techo.

    El bucle de abajo es deliberadamente más largo que cualquier techo
    razonable: si el reenvío no terminara, gastaría las 40 vueltas enviando.
    """
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    _matar_antes_de_marcar_enviada(cola, monkeypatch)

    vueltas = 0
    for _ in range(40):
        if _releer(cola, db_session, fila.id).status != "ENVIANDO":
            break
        vueltas += 1
        try:
            cola.procesar(fila.id)
        except MuerteDelWorker:
            db_session.rollback()
    else:  # pragma: no cover - solo corre si el bucle NO termina
        pytest.fail("la redelivery del broker no terminó en 40 vueltas")

    assert len(arnes.envios(smtp)) == auditoria.MAX_ENTREGAS_INICIADAS
    assert vueltas == auditoria.MAX_ENTREGAS_INICIADAS + 1, (
        "la vuelta que topa el techo no envía: devuelve la fila al outbox"
    )
    guardada = _releer(cola, db_session, fila.id)
    assert guardada.status == "PENDIENTE"
    assert guardada.claimed_at is None
    assert guardada.last_error_redacted == "TopeDeEntregasAlcanzado: delivery failed"

    # Lo que el runbook depende de que sea cierto. `requeue` resuelve el
    # marcador, así que la fila que MÁS duplicó es justo la que desaparece de
    # la consulta de ventana abierta. Se la busca por estas dos señales, y
    # `docs/operations/entrega-de-correo.md` dice explícitamente que la
    # primera consulta no la devuelve.
    assert not auditoria.entrega_previa_sin_resolver(guardada), (
        "topar el techo BORRA la firma de la ventana; el runbook avisa de esto"
    )
    assert guardada.entregas_intentadas > guardada.attempts, (
        "la señal que sí queda: más pasos por SMTP que reclamos del outbox"
    )


def test_el_techo_de_entregas_deja_lugar_al_camino_sano():
    """El techo NO puede morder el camino normal. Cada uno de los
    `MAX_ATTEMPTS` intentos llega al paso de envío como mucho una vez, así que
    un techo por debajo de `MAX_ATTEMPTS` bloquearía entregas legítimas."""
    assert auditoria.MAX_ENTREGAS_INICIADAS > MAX_ATTEMPTS


# ─── 9. Lease y reclamo intactos ────────────────────────────────────────────
def test_el_reclamo_conserva_su_semantica_de_lease(cola, db_session):
    """La auditoría se suma al reclamo; no lo cambia. Una fila con lease
    vigente sigue sin ser reclamable, y una con lease vencido sí."""
    _, fila = _sembrar(cola, db_session)
    repo = cola.repositorio(db_session)

    primera = repo.claim_pending(lease_minutes=LEASE_MINUTOS)
    db_session.commit()
    assert primera.id == fila.id and primera.status == "ENVIANDO"
    assert primera.attempts == 1
    assert repo.claim_pending(lease_minutes=LEASE_MINUTOS) is None

    primera.claimed_at = datetime.now(timezone.utc) - timedelta(
        minutes=LEASE_MINUTOS * 2
    )
    db_session.commit()

    segunda = repo.claim_pending(lease_minutes=LEASE_MINUTOS)
    assert segunda is not None and segunda.attempts == 2


# ─── 10. Los dos contadores miden cosas distintas ───────────────────────────
def test_los_dos_contadores_no_se_pisan(cola, db_session, smtp, monkeypatch):
    """`attempts` gobierna el backoff y `AGOTADO`; `entregas_intentadas`
    cuenta cuántas veces se llegó al paso de envío. Reusar `attempts` para lo
    segundo habría movido el backoff que ya custodian
    `test_recuperacion_outbox.py` y `test_verificacion_correo_outbox.py`."""
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    _matar_antes_de_marcar_enviada(cola, monkeypatch)

    _procesar_muriendo(cola, db_session, fila.id)
    tras_la_muerte = _releer(cola, db_session, fila.id)
    assert tras_la_muerte.attempts == 1, "la redelivery no gasta intentos del outbox"
    assert tras_la_muerte.entregas_intentadas == 1

    _procesar_muriendo(cola, db_session, fila.id)
    tras_la_redelivery = _releer(cola, db_session, fila.id)
    assert tras_la_redelivery.attempts == 1
    assert tras_la_redelivery.entregas_intentadas == 2, (
        "el paso de envío sí se cuenta, que es lo que acota el duplicado"
    )


# ─── 11. Todo desenlace terminal resuelve su marcador ───────────────────────
def test_la_fila_que_vence_con_una_entrega_abierta_no_queda_como_ventana(
    cola, db_session, smtp, monkeypatch
):
    """Hay un tercer desenlace terminal, aparte de `mark_sent` y de `requeue`:
    la fila despierta con la solicitud ya vencida (o sin usuario) y se cierra
    en `AGOTADO` ahí mismo. Nadie va a reintentarla nunca más.

    Ese camino tiene que resolver el marcador igual que los otros dos. Si no
    lo hiciera, una fila que inició una entrega, perdió su worker y venció
    antes de la redelivery quedaría para siempre con `entrega_iniciada_at`
    posterior a `entrega_resuelta_at` -- y la consulta de duplicado probable
    de `docs/operations/entrega-de-correo.md` la devolvería como una ventana
    abierta que ya nunca se va a cerrar. Un falso positivo permanente sobre
    una fila muerta le cuesta al operador justo cuando está buscando la viva.
    """
    _, fila = _sembrar(cola, db_session)
    _reclamar(cola, db_session)
    _matar_antes_de_marcar_enviada(cola, monkeypatch)
    _procesar_muriendo(cola, db_session, fila.id)

    abierta = _releer(cola, db_session, fila.id)
    assert auditoria.entrega_previa_sin_resolver(abierta), (
        "el caso arranca con una entrega iniciada y sin desenlace"
    )
    abierta.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db_session.commit()

    resultado = cola.procesar(fila.id)

    assert resultado["agotado"] is True
    guardada = _releer(cola, db_session, fila.id)
    assert guardada.status == "AGOTADO"
    assert len(arnes.envios(smtp)) == 1, "la fila vencida no vuelve a enviar"
    assert guardada.entrega_iniciada_at is not None, "el rastro de la entrega queda"
    assert guardada.entrega_resuelta_at is not None
    assert not auditoria.entrega_previa_sin_resolver(guardada), (
        "un desenlace terminal no puede seguir leyéndose como ventana abierta"
    )
