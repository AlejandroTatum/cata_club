"""
Regresión #450/#451: E/S síncrona bloqueante ejecutada DIRECTO en handlers
`async def` del router de pagos, sin `run_in_threadpool` -- issue #311 ya
resolvió la misma clase de bug para `POST /auth/login` (ver su docstring en
`auth_router.py`).

Confirmado por reproducción EN VIVO contra el stack QA real (fuera de este
repo, ver `/tmp/cata-club-payments-go/01-availability/00-veredicto.md`): 3
`POST /membresias/pagos` concurrentes sobre la MISMA membresía colgaron el
proceso backend ENTERO -- incluido `/health`, que no depende de nada -- por
5m32s, sin autorrecuperación, hasta un restart manual. `pg_stat_activity`
mostró el mecanismo: quien gana el `SELECT ... FOR UPDATE` cede el control
del event loop antes de poder hacer `COMMIT` (liberando el lock); quien
pierde ejecuta su propio `FOR UPDATE` bloqueante DIRECTO en la coroutine
(sin threadpool), y ese único hilo del proceso queda atrapado esperando un
lock que nadie más puede liberar -- deadlock real, no una espera lenta.

Por qué esta prueba usa `httpx.AsyncClient` + `ASGITransport` en vez de
`TestClient` (el resto de la suite): `TestClient` envuelve la app async en
un portal síncrono -- cada `client.get(...)` BLOQUEA hasta tener respuesta,
así que dos llamadas de un mismo test nunca avanzan de verdad al mismo
tiempo. Solo dos corutinas reales sobre el MISMO event loop (`asyncio.
gather`) pueden reproducir el síntoma: un solo proceso Uvicorn de un solo
worker sirviendo requests concurrentes sobre un único hilo. Sin
`pytest-asyncio`/`anyio` instalado en el proyecto (ver pyproject.toml), cada
test se declara `def` normal y arranca su propio loop con `asyncio.run(...)`
-- cero dependencias nuevas.

Por qué NO se reusa `client`/`db_session` de conftest.py: esa sesión es
ÚNICA y compartida (aislamiento por savepoint), así que dos "requests"
sobre ella nunca compiten de verdad por un lock de Postgres -- es la MISMA
transacción. El bug es específicamente sobre sesiones independientes; cada
request real abre la suya vía `obtener_sesion` (sin override, mismo motor
que producción, ya apuntado a `TEST_DATABASE_URL` por conftest.py). Los
datos de este archivo se siembran con `SessionLocal`/commit REAL (visible a
esas otras conexiones) y se limpian a mano al final -- mismo criterio que
`test_suspension_reactivacion.py::_limpiar_grafo` /
`test_dos_reactivaciones_concurrentes_de_la_misma_membresia_solo_una_gana`.

Cada test corre su `asyncio.gather` a través de `_ejecutar_con_timeout_duro`
(ver más abajo) para que un cuelgue real haga FALLAR la prueba en segundos,
en vez de trabar la suite para siempre.

Por qué NO alcanza `asyncio.wait_for(..., timeout=N)` acá (hallazgo empírico,
no teórico -- se probó primero y falló): el bug que esta prueba reproduce es
EXACTAMENTE que el hilo del event loop queda atrapado dentro de una llamada
bloqueante SIN ningún punto `await`. `wait_for` cancela reprogramando la
tarea DESDE EL MISMO event loop -- pero si ese event loop está atrapado
dentro de la llamada bloqueante, nunca vuelve a tener el control para
procesar su propio timeout. Confirmado en vivo contra este mismo archivo:
con `asyncio.wait_for(timeout=20)`, el test corrido contra el código SIN
el fix quedó colgado más de 4m43s (verificado con `pg_stat_activity`: una
sesión `active`/`Lock` esperando el `FOR UPDATE`, dos `idle in
transaction`/`ClientRead` -- exactamente la firma del veredicto de la
auditoría), sin que el timeout de 20s cortara nada. `_ejecutar_con_timeout_
duro` corre `asyncio.run(...)` en un hilo `daemon` aparte y espera su
resultado con `Thread.join(timeout=N)` desde el hilo principal: ese
`.join()` usa una primitiva de threading real, independiente del event loop
atrapado, así que el timeout SÍ corta.

`daemon=True` es deliberado (segundo hallazgo empírico, también contra este
mismo archivo): un `ThreadPoolExecutor` normal registra un hook `atexit`
que JOINEA sus hilos antes de permitir que el intérprete cierre -- con un
hilo REALMENTE atrapado en un deadlock de Postgres sin salida, eso cuelga
el cierre del proceso de `pytest` ENTERO al final de la corrida, aunque
cada test individual ya haya fallado y reportado a tiempo. Un
`threading.Thread(daemon=True)` no se joinea al cerrar el intérprete -- el
hilo filtrado simplemente desaparece con el proceso, igual que en
producción el proceso colgado solo se resolvió con un restart manual.
"""
import asyncio
import threading
import time
from decimal import Decimal
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia
from app.dominio.modelos import Membresia, Pago, Persona, TipoMembresia
from app.infraestructura.db import engine as db_engine
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app
from tests.fabricas_pagos import crear_membresia_orm, crear_persona_orm, crear_tipo_membresia_orm

# Generoso pero finito: si el bug reaparece (cuelgue real), esto debe hacer
# fallar la prueba en segundos, no colgar la suite para siempre.
TIMEOUT_TOTAL_SEGUNDOS = 20


def _ejecutar_con_timeout_duro(fabrica_corutina, timeout=TIMEOUT_TOTAL_SEGUNDOS):
    """Corre `fabrica_corutina()` con `asyncio.run` en un hilo `daemon`
    aparte y aplica un timeout DURO desde el hilo principal (ver docstring
    del módulo: ni `asyncio.wait_for` ni un `ThreadPoolExecutor` no-daemon
    alcanzan). Si el timeout vence, el hilo bloqueado queda filtrado a
    propósito -- desaparece con el proceso al cerrar, no bloquea el cierre."""
    resultado: dict = {}

    def _correr():
        try:
            resultado["valor"] = asyncio.run(fabrica_corutina())
        except BaseException as error:  # noqa: BLE001 -- se re-lanza en el hilo principal
            resultado["error"] = error

    hilo = threading.Thread(target=_correr, daemon=True)
    hilo.start()
    hilo.join(timeout=timeout)
    if hilo.is_alive():
        raise TimeoutError(
            f"El cuerpo async no terminó en {timeout}s -- el event loop quedó "
            "atrapado (mismo síntoma que el deadlock de proceso reproducido en vivo)."
        )
    if "error" in resultado:
        raise resultado["error"]
    return resultado["valor"]


def _token_admin():
    return {"sub": "admin-concurrencia@cataclub.test", "persona_id": 1, "roles": ["ADMINISTRADOR"]}


def _limpiar_grafo(*, persona_ids: list[int], membresia_ids: list[int], tipo_ids: list[int]) -> None:
    """Esta suite usa `motor_test`/`db_engine` directo con commits REALES
    (sin rollback automático de `db_session`), así que hay que borrar a mano
    -- mismo criterio que `test_suspension_reactivacion.py::_limpiar_grafo`.

    `lock_timeout` corto (issue #451, dogfooding del propio fix que esta
    prueba valida): si un test anterior REALMENTE se colgó (el bug bajo
    prueba sigue presente), su hilo filtrado puede seguir sosteniendo el
    `FOR UPDATE` de esa misma fila -- sin este timeout, la limpieza del
    `finally` colgaría TAMBIÉN, enmascarando el fallo real detrás de un
    cuelgue nuevo en vez de reportarlo."""
    limpieza = Session(bind=db_engine)
    try:
        limpieza.execute(text("SET lock_timeout = '3000ms'"))
        limpieza.query(Pago).filter(Pago.membresia_id.in_(membresia_ids)).delete(synchronize_session=False)
        limpieza.query(Membresia).filter(Membresia.id.in_(membresia_ids)).delete(synchronize_session=False)
        limpieza.query(Persona).filter(Persona.id.in_(persona_ids)).delete(synchronize_session=False)
        limpieza.query(TipoMembresia).filter(TipoMembresia.id.in_(tipo_ids)).delete(synchronize_session=False)
        limpieza.commit()
    except Exception:
        limpieza.rollback()
        raise
    finally:
        limpieza.close()


def _crear_membresia_real(sufijo: int, *, estado: EstadoMembresia = EstadoMembresia.ACTIVA):
    """Datos REALMENTE commiteados (visibles a conexiones independientes) --
    ver el docstring del módulo."""
    setup = Session(bind=db_engine)
    socio = crear_persona_orm(setup, cedula_valida(sufijo), telefono=f"0990{sufijo:06d}")
    tipo = crear_tipo_membresia_orm(setup, precio=Decimal("30.00"))
    membresia = crear_membresia_orm(setup, socio, tipo, estado, monto_aplicado=Decimal("30.00"))
    setup.commit()
    ids = (socio.id, membresia.id, tipo.id)
    setup.close()
    return ids


class _ClienteAsincronoAdmin:
    """Cliente ASGI real, mismo event loop que el test (ver docstring del
    módulo). Solo sobrescribe autenticación -- `obtener_sesion` corre SIN
    override, así cada request abre su propia sesión real."""

    def __enter__(self):
        app.dependency_overrides[GestorAutenticacion.decodificar_token] = _token_admin
        self._transport = ASGITransport(app=app)
        self._client = AsyncClient(transport=self._transport, base_url="http://test")
        return self._client

    def __exit__(self, *exc):
        app.dependency_overrides.pop(GestorAutenticacion.decodificar_token, None)
        return False


def _pago_payload(persona_id: int, membresia_id: int) -> dict:
    return {
        "meses": 1, "tipo_pago": "TRANSFERENCIA",
        "persona_id": persona_id, "membresia_id": membresia_id,
    }


# --- #451: pagos concurrentes sobre la MISMA membresía -----------------------

def test_tres_registros_de_pago_concurrentes_en_la_misma_membresia_no_cuelgan_el_proceso():
    """Reproduce el Escenario 1 de la auditoría en vivo: 3 `POST
    /membresias/pagos` concurrentes sobre la MISMA membresía, con `/health`
    disparado en paralelo. Antes del fix, esto cuelga el proceso entero
    (incluido `/health`) -- el test debe fallar por timeout, no colgarse
    para siempre. Después del fix, exactamente UN pago
    se registra (los otros dos pierden la carrera de `existe_pendiente_
    para_membresia`, que corre DESPUÉS del lock) y `/health` responde rápido
    sin importar la contención de los otros tres requests."""
    async def cuerpo():
        with _ClienteAsincronoAdmin() as cliente:
            payload = _pago_payload(persona_id, membresia_id)

            async def _health_medido():
                inicio = time.monotonic()
                respuesta = await cliente.get("/health")
                return respuesta, time.monotonic() - inicio

            resultados = await asyncio.gather(
                cliente.post("/api/v1/membresias/pagos", json=payload),
                cliente.post("/api/v1/membresias/pagos", json=payload),
                cliente.post("/api/v1/membresias/pagos", json=payload),
                _health_medido(),
            )
            return resultados

    persona_id, membresia_id, tipo_id = _crear_membresia_real(1001)
    try:
        pago_a, pago_b, pago_c, (salud, duracion_salud) = _ejecutar_con_timeout_duro(cuerpo)

        # `/health` no depende de nada: si el proceso quedó atrapado
        # esperando un lock, esto es lo primero que lo delata (ver
        # veredicto: 5m32s de `/health` sin responder).
        assert salud.status_code == 200
        assert duracion_salud < 3.0, (
            f"/health tardó {duracion_salud:.2f}s -- el event loop estuvo "
            "bloqueado por E/S síncrona de otro request"
        )

        codigos = sorted(r.status_code for r in (pago_a, pago_b, pago_c))
        exitosos = [r for r in (pago_a, pago_b, pago_c) if r.status_code == 201]
        # El lock serializa: exactamente uno crea el pago, los otros dos
        # pierden la carrera de "ya existe un pago pendiente" (400) una vez
        # que releen el estado ya escrito por el ganador.
        assert len(exitosos) == 1, f"esperaba exactamente un 201: {codigos}"
        assert codigos.count(400) == 2, f"esperaba dos 400 (pago pendiente duplicado): {codigos}"
    finally:
        _limpiar_grafo(
            persona_ids=[persona_id], membresia_ids=[membresia_id], tipo_ids=[tipo_id],
        )


def test_pagos_concurrentes_en_membresias_distintas_no_se_demoran():
    """Control/aislamiento del disparador (mismo criterio que el Escenario 5
    de la auditoría: '05-trafico-mixto'): tráfico concurrente sobre filas
    DISTINTAS no debe experimentar ningún retraso ni 409 -- la contención es
    específica de la MISMA fila, no de la concurrencia en general."""
    async def cuerpo():
        with _ClienteAsincronoAdmin() as cliente:
            inicio = time.monotonic()
            resultados = await asyncio.gather(
                cliente.post("/api/v1/membresias/pagos", json=_pago_payload(p1, m1)),
                cliente.post("/api/v1/membresias/pagos", json=_pago_payload(p2, m2)),
                cliente.post("/api/v1/membresias/pagos", json=_pago_payload(p3, m3)),
            )
            return resultados, time.monotonic() - inicio

    p1, m1, t1 = _crear_membresia_real(1011)
    p2, m2, t2 = _crear_membresia_real(1012)
    p3, m3, t3 = _crear_membresia_real(1013)
    try:
        resultados, duracion = _ejecutar_con_timeout_duro(cuerpo)
        assert [r.status_code for r in resultados] == [201, 201, 201]
        assert duracion < 3.0, f"filas SIN contención tardaron {duracion:.2f}s -- no debería haber espera"
    finally:
        _limpiar_grafo(
            persona_ids=[p1, p2, p3], membresia_ids=[m1, m2, m3], tipo_ids=[t1, t2, t3],
        )


def test_lock_timeout_real_devuelve_409_en_vez_de_colgar_para_siempre():
    """Triangulación de la Parte B (`lock_timeout` en `obtener_por_id_con_
    bloqueo`): un hilo real mantiene el `FOR UPDATE` tomado por MÁS tiempo
    que el timeout configurado; quien pierde la carrera debe recibir 409
    dentro de ese margen -- no colgar indefinidamente ni explotar con 500."""
    membresia_id_box: list[int] = []
    liberar = threading.Event()
    listo = threading.Event()

    def _mantener_lock():
        sesion = Session(bind=db_engine)
        try:
            sesion.get(Membresia, membresia_id_box[0], with_for_update=True)
            listo.set()
            # Mantiene el lock más allá del `lock_timeout` configurado (5s).
            liberar.wait(timeout=15)
        finally:
            sesion.rollback()
            sesion.close()

    async def cuerpo():
        with _ClienteAsincronoAdmin() as cliente:
            inicio = time.monotonic()
            respuesta = await cliente.post(
                "/api/v1/membresias/pagos", json=_pago_payload(persona_id, membresia_id),
            )
            return respuesta, time.monotonic() - inicio

    persona_id, membresia_id, tipo_id = _crear_membresia_real(1021)
    membresia_id_box.append(membresia_id)
    hilo = threading.Thread(target=_mantener_lock)
    hilo.start()
    try:
        assert listo.wait(timeout=5), "el hilo auxiliar no tomó el lock a tiempo"
        respuesta, duracion = _ejecutar_con_timeout_duro(cuerpo)
        assert respuesta.status_code == 409, respuesta.text
        # Debe rendirse cerca del timeout configurado (5s), no antes (sin
        # esperar de verdad) ni mucho después (timeout no está aplicando).
        assert 4.0 <= duracion <= 12.0, f"tardó {duracion:.2f}s en devolver 409"
    finally:
        liberar.set()
        hilo.join(timeout=15)
        _limpiar_grafo(
            persona_ids=[persona_id], membresia_ids=[membresia_id], tipo_ids=[tipo_id],
        )


# --- #450: subida de voucher lenta ------------------------------------------

def test_subida_de_voucher_lenta_no_bloquea_el_proceso():
    """Mismo patrón que #451 pero para `subir_voucher` -> `adjuntar_voucher`
    -> Cloudinary (issue #450). Cloudinary no está disponible en el entorno
    de test (ver `_cloudinary_credenciales_de_prueba` en conftest.py), así
    que se mockea `subir_voucher_pago` con una subida artificialmente LENTA
    (1.5s, bloqueante de verdad vía `time.sleep`) -- eso es lo que reproduce
    el síntoma: una llamada síncrona que tarda, ejecutada directo en la
    coroutine.

    Mide PARALELISMO AGREGADO (dos subidas lentas + `/health`, las tres
    lanzadas juntas) en vez de intentar cronometrar "¿arrancó ya el
    bloqueo?" (hallazgo empírico: DOS versiones previas de este test, con
    `asyncio.gather` simple o con sincronización explícita vía `threading.
    Event`/`asyncio.to_thread`, dieron FALSO NEGATIVO incluso SIN el fix.
    Motivo, confirmado corriendo ambas contra el código sin arreglar: en un
    ÚNICO event loop, cualquier coordinación del lado del test para "esperar
    a que el bloqueo haya arrancado antes de medir" queda ATRAPADA por el
    mismo bloqueo que se quiere medir -- exactamente la propiedad que hace
    al bug grave en producción hace que sea imposible de cronometrar con
    precisión desde DENTRO del mismo loop). La métrica que SÍ es robusta a
    esto es agregada: sin `run_in_threadpool`, cada subida ocupa el event
    loop entero de punta a punta y las tres corren de facto en SERIE (total
    ~= 2 x 1.5s + `/health` esperando su turno detrás de ambas); con el fix,
    las dos subidas corren en paralelo real en threads del threadpool y
    `/health` responde casi de inmediato sin importar la contención."""
    def _upload_lento(**kwargs):
        time.sleep(1.5)
        return "voucher-fake-lento"

    async def cuerpo():
        with _ClienteAsincronoAdmin() as cliente:
            pago_a = await cliente.post("/api/v1/membresias/pagos", json=_pago_payload(persona_a, membresia_a))
            pago_b = await cliente.post("/api/v1/membresias/pagos", json=_pago_payload(persona_b, membresia_b))
            assert pago_a.status_code == 201, pago_a.text
            assert pago_b.status_code == 201, pago_b.text
            pago_id_a, pago_id_b = pago_a.json()["id"], pago_b.json()["id"]

            async def _subir_voucher(pago_id: int):
                archivos = {"archivo": ("voucher.jpg", b"\xff\xd8\xff\xe0" + b"0" * 20, "image/jpeg")}
                return await cliente.post(f"/api/v1/membresias/pagos/{pago_id}/voucher", files=archivos)

            async def _health_medido():
                inicio = time.monotonic()
                respuesta = await cliente.get("/health")
                return respuesta, time.monotonic() - inicio

            with patch(
                "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
                side_effect=_upload_lento,
            ):
                inicio = time.monotonic()
                voucher_a, voucher_b, (salud, duracion_salud) = await asyncio.gather(
                    _subir_voucher(pago_id_a), _subir_voucher(pago_id_b), _health_medido(),
                )
                duracion_total = time.monotonic() - inicio
            return voucher_a, voucher_b, salud, duracion_salud, duracion_total

    persona_a, membresia_a, tipo_a = _crear_membresia_real(1031)
    persona_b, membresia_b, tipo_b = _crear_membresia_real(1032)
    try:
        voucher_a, voucher_b, salud, duracion_salud, duracion_total = _ejecutar_con_timeout_duro(cuerpo)
        assert voucher_a.status_code == 201, voucher_a.text
        assert voucher_b.status_code == 201, voucher_b.text
        assert salud.status_code == 200
        # Dos subidas de 1.5s en PARALELO real: el total debe rondar 1.5s,
        # no 3s (que delataría que corrieron en serie por el event loop
        # bloqueado).
        assert duracion_total < 2.3, (
            f"dos subidas concurrentes de 1.5s tardaron {duracion_total:.2f}s en total "
            "-- ¿corrieron en serie por el event loop bloqueado?"
        )
        assert duracion_salud < 1.0, (
            f"/health tardó {duracion_salud:.2f}s mientras las subidas estaban en curso -- "
            "el event loop estuvo bloqueado por E/S síncrona de otro request"
        )
    finally:
        _limpiar_grafo(
            persona_ids=[persona_a, persona_b],
            membresia_ids=[membresia_a, membresia_b],
            tipo_ids=[tipo_a, tipo_b],
        )
