"""
Issue #813: `adjuntar_voucher` mantenía la transacción -- y con ella una
conexión del pool -- abierta durante TODA la subida a Cloudinary.

Es una llamada de red de hasta 5 MB (`TAMANO_MAXIMO_VOUCHER_BYTES`) acotada
por `TIMEOUT_CLOUDINARY_TOTAL_SEGUNDOS = 8.0`, en el camino HTTP de un
usuario real. El pool de la aplicación declara `pool_size=10` +
`max_overflow=20` (`app/infraestructura/db.py`) y el backend corre UN solo
proceso de uvicorn sin `--workers` (`backend/Dockerfile:53`), así que 30
subidas concurrentes vaciaban el pool del backend ENTERO -- endpoints que no
tienen nada que ver con vouchers se quedaban esperando un slot.

Por qué este archivo no vive en `test_voucher_pago.py`: aquella suite corre
sobre `client`/`db_session`, cuya sesión está atada a una `Connection`
prestada de un motor `NullPool` bajo aislamiento por savepoint. Ahí no hay
pool que medir ni conexión que devolver. Lo que se prueba acá solo existe
contra el motor REAL de la aplicación, así que se siembra con commits REALES
y se limpia a mano -- mismo criterio (y mismos helpers de forma) que
`test_disponibilidad_pagos_concurrentes.py`.

La disciplina de sincronización es la de
`test_subidas_y_hasheos_no_bloqueantes.py`: el doble de Cloudinary levanta su
`threading.Event` DENTRO, justo antes de bloquear. Cuando el hilo principal
mide, que la subida está en curso es un hecho, no una estimación con
`sleep`.
"""
import threading
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy import inspect as inspeccionar_orm
from sqlalchemy.orm import Session, sessionmaker

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoPago
from app.dominio.excepciones import OperacionInvalida, ServicioNoDisponible
from app.dominio.modelos import Membresia, Pago, Persona, TipoMembresia
from app.infraestructura.db import SessionLocal, TIMEOUT_POOL_SEGUNDOS
from app.infraestructura.db import engine as motor_aplicacion
from app.servicios_negocio.membresia_pago_servicio import PagoServicio
from tests.conftest import TEST_DATABASE_URL
from tests.fabricas_pagos import (
    crear_membresia_orm, crear_pago_orm, crear_persona_orm, crear_tipo_membresia_orm,
)

# Firma binaria real de un JPEG: `es_firma_valida` rechaza cualquier relleno
# antes de llegar a la subida, así que un contenido cualquiera nunca pondría
# en vuelo la llamada que estos tests necesitan medir.
JPEG_VALIDO = b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 100

# Techo de espera de los eventos de sincronización. Generoso para un runner
# cargado, finito para que un cuelgue real falle en segundos en vez de trabar
# la suite.
ESPERA_MAXIMA_SEGUNDOS = 15


def _crear_pago_pendiente_real(sufijo: int) -> tuple[int, int, int, int]:
    """Persona + tipo + membresía + pago PENDIENTE_VALIDACION REALMENTE
    commiteados (visibles a conexiones independientes, que es justo lo que
    estos tests necesitan). Devuelve los ids, nunca los objetos: la sesión
    que los creó se cierra acá."""
    setup = Session(bind=motor_aplicacion)
    try:
        persona = crear_persona_orm(
            setup, cedula_valida(sufijo), telefono=f"0991{sufijo:06d}",
        )
        tipo = crear_tipo_membresia_orm(setup, precio=Decimal("30.00"))
        membresia = crear_membresia_orm(
            setup, persona, tipo, EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
        )
        pago = crear_pago_orm(
            setup, persona, membresia, EstadoPago.PENDIENTE_VALIDACION,
            tipo_pago=TipoPago.TRANSFERENCIA,
        )
        setup.commit()
        return persona.id, membresia.id, tipo.id, pago.id
    finally:
        setup.close()


def _limpiar_grafo(*, persona_ids: list[int], membresia_ids: list[int], tipo_ids: list[int]) -> None:
    """Los datos de este archivo se commitean de verdad (sin el rollback
    automático de `db_session`), así que se borran a mano -- mismo criterio
    que `test_disponibilidad_pagos_concurrentes.py::_limpiar_grafo`. El
    `lock_timeout` corto evita que la limpieza se cuelgue detrás de un hilo
    filtrado por un test que sí falló, enmascarando el fallo real."""
    limpieza = Session(bind=motor_aplicacion)
    try:
        limpieza.execute(text("SET lock_timeout = '3000ms'"))
        limpieza.query(Pago).filter(Pago.membresia_id.in_(membresia_ids)).delete(
            synchronize_session=False)
        limpieza.query(Membresia).filter(Membresia.id.in_(membresia_ids)).delete(
            synchronize_session=False)
        limpieza.query(Persona).filter(Persona.id.in_(persona_ids)).delete(
            synchronize_session=False)
        limpieza.query(TipoMembresia).filter(TipoMembresia.id.in_(tipo_ids)).delete(
            synchronize_session=False)
        limpieza.commit()
    except Exception:
        limpieza.rollback()
        raise
    finally:
        limpieza.close()


def _adjuntar(sesion, pago_id: int, persona_id: int):
    """Invocación canónica del método bajo prueba, como dueño mayor de edad."""
    return PagoServicio(sesion).adjuntar_voucher(
        pago_id=pago_id,
        persona_id_solicitante=persona_id,
        roles_solicitante=["ALUMNO"],
        contenido=JPEG_VALIDO,
        content_type="image/jpeg",
        nombre_archivo="voucher.jpg",
    )


def _voucher_persistido(pago_id: int) -> str | None:
    lectura = Session(bind=motor_aplicacion)
    try:
        return lectura.get(Pago, pago_id).voucher_url
    finally:
        lectura.close()


# --- El candado central: la red corre SIN conexión tomada -------------------

def test_la_subida_del_voucher_no_retiene_una_conexion_del_pool(monkeypatch):
    """Mientras el doble de Cloudinary está bloqueado -- o sea, mientras en
    producción viajarían los 5 MB -- el pool de la aplicación debe tener
    exactamente las mismas conexiones tomadas que antes de empezar.

    Se mide contra una línea base y no contra `== 0` a propósito: otro test
    de la misma corrida podría dejar una conexión tomada, y este candado
    habla de LA conexión de esta subida, no del estado global del pool."""
    subida_en_curso = threading.Event()
    liberar_subida = threading.Event()

    def _subida_bloqueante(**_kwargs):
        # `set()` DENTRO del doble y justo antes de bloquear: cuando el hilo
        # principal mide, la subida está en vuelo por construcción.
        subida_en_curso.set()
        assert liberar_subida.wait(timeout=ESPERA_MAXIMA_SEGUNDOS), (
            "el hilo principal nunca liberó la subida"
        )
        return "voucher-fake"

    monkeypatch.setattr(
        "app.infraestructura.cloudinary_cliente.subir_voucher_pago", _subida_bloqueante,
    )

    persona_id, membresia_id, tipo_id, pago_id = _crear_pago_pendiente_real(1201)
    resultado: dict = {}

    def _correr():
        sesion = SessionLocal()
        try:
            pago = _adjuntar(sesion, pago_id, persona_id)
            resultado["voucher_url"] = pago.voucher_url
            resultado["expirado"] = inspeccionar_orm(pago).expired
        except BaseException as error:  # noqa: BLE001 -- se re-lanza en el principal
            resultado["error"] = error
        finally:
            sesion.close()

    hilo = threading.Thread(target=_correr, daemon=True)
    try:
        conexiones_base = motor_aplicacion.pool.checkedout()
        hilo.start()
        assert subida_en_curso.wait(timeout=ESPERA_MAXIMA_SEGUNDOS), (
            "la subida nunca arrancó"
        )
        conexiones_durante = motor_aplicacion.pool.checkedout()
        liberar_subida.set()
        hilo.join(timeout=ESPERA_MAXIMA_SEGUNDOS)
        assert not hilo.is_alive(), "la subida no terminó"

        assert "error" not in resultado, resultado.get("error")
        assert conexiones_durante == conexiones_base, (
            f"había {conexiones_durante} conexión(es) tomada(s) durante la subida "
            f"contra {conexiones_base} de base -- la transacción sigue abierta "
            "mientras corre la red contra Cloudinary (#813)"
        )
        # La segunda mitad del contrato: soltar la conexión no puede costar
        # el resultado. El `public_id` determinista queda persistido igual.
        assert resultado["voucher_url"] == f"voucher-pago-{pago_id:08d}"
        assert _voucher_persistido(pago_id) == f"voucher-pago-{pago_id:08d}"
        # Y el objeto devuelto tiene que servirle al DTO de respuesta sin
        # despertar un SELECT sorpresa en el hilo del event loop (#826).
        assert not resultado["expirado"], (
            "`adjuntar_voucher` devolvió un Pago EXPIRADO: serializarlo "
            "dispararía un SELECT fuera del `run_in_threadpool` del router"
        )
        assert motor_aplicacion.pool.checkedout() == conexiones_base
    finally:
        liberar_subida.set()
        hilo.join(timeout=ESPERA_MAXIMA_SEGUNDOS)
        _limpiar_grafo(
            persona_ids=[persona_id], membresia_ids=[membresia_id], tipo_ids=[tipo_id],
        )


# --- Concurrencia: varias subidas no se comen el pool -----------------------

SUBIDAS_CONCURRENTES = 3


def test_tres_subidas_concurrentes_no_agotan_un_pool_de_una_sola_conexion(monkeypatch):
    """La aritmética del issue, en chico y determinista.

    Un motor propio de UNA conexión y sin overflow es la versión mínima del
    pool de producción: si la subida retiene su conexión, `SUBIDAS_
    CONCURRENTES` subidas simultáneas no caben, y las que pierden mueren con
    el `TimeoutError` de `QueuePool` en vez de esperar a su turno. No hace
    falta abrir 30 conexiones para demostrar la propiedad: alcanza con que la
    cantidad de subidas en vuelo supere al tamaño del pool.

    La `Barrier` es lo que hace la prueba honesta: las tres subidas tienen
    que estar en vuelo AL MISMO TIEMPO. Con la conexión retenida ninguna de
    las que pierden llega siquiera a la barrera."""
    barrera = threading.Barrier(SUBIDAS_CONCURRENTES)

    def _subida_sincronizada(**_kwargs):
        # Cada subida espera a las otras dos: solo se destraban si las tres
        # llegaron hasta acá sin quedarse sin conexión en el camino.
        barrera.wait(timeout=ESPERA_MAXIMA_SEGUNDOS)
        return "voucher-fake"

    monkeypatch.setattr(
        "app.infraestructura.cloudinary_cliente.subir_voucher_pago", _subida_sincronizada,
    )

    # `pool_timeout` corto y explícito: si el candado se rompe, las subidas
    # que pierden fallan en 1 s en vez de arrastrar la suite 30 s.
    motor_angosto = create_engine(
        TEST_DATABASE_URL, pool_size=1, max_overflow=0, pool_timeout=1,
    )
    sesion_angosta = sessionmaker(bind=motor_angosto)

    # La siembra va DENTRO del `try` que gobierna la limpieza, y acumulando
    # escenario por escenario: cada `_crear_pago_pendiente_real` COMMITEA de
    # verdad, así que si el segundo o el tercero revientan, el primero ya está
    # en la base. Sembrando afuera esa fila nunca se borraba, sobrevivía a la
    # corrida entera y después chocaba contra `_reiniciar_secuencias`
    # (`conftest.py`), que reinicia las secuencias en 1 para los tests de
    # `db_session` -- el fallo aparecía en un archivo sin ninguna relación con
    # éste. `hilos` y `resultados` arrancan vacíos por el mismo motivo: el
    # `finally` los recorre aunque la siembra no haya llegado a crearlos.
    escenarios: list[tuple[int, int, int, int]] = []
    resultados: list[dict] = []
    hilos: list[threading.Thread] = []

    def _correr(indice: int):
        persona_id, _, _, pago_id = escenarios[indice]
        sesion = sesion_angosta()
        try:
            resultados[indice]["voucher_url"] = _adjuntar(sesion, pago_id, persona_id).voucher_url
        except BaseException as error:  # noqa: BLE001 -- se reporta en el principal
            resultados[indice]["error"] = error
        finally:
            sesion.close()

    try:
        for indice in range(SUBIDAS_CONCURRENTES):
            escenarios.append(_crear_pago_pendiente_real(1210 + indice))
        resultados.extend({} for _ in escenarios)

        hilos = [
            threading.Thread(target=_correr, args=(i,), daemon=True)
            for i in range(SUBIDAS_CONCURRENTES)
        ]
        for hilo in hilos:
            hilo.start()
        for hilo in hilos:
            hilo.join(timeout=ESPERA_MAXIMA_SEGUNDOS * 2)

        vivos = [hilo for hilo in hilos if hilo.is_alive()]
        assert not vivos, f"{len(vivos)} subida(s) nunca terminaron"
        fallidas = [r["error"] for r in resultados if "error" in r]
        assert not fallidas, (
            f"{len(fallidas)} de {SUBIDAS_CONCURRENTES} subidas concurrentes fallaron "
            f"con un pool de 1 conexión: {fallidas} -- cada subida se está "
            "quedando con su conexión mientras habla con Cloudinary (#813)"
        )
        for (_, _, _, pago_id), resultado in zip(escenarios, resultados):
            assert resultado["voucher_url"] == f"voucher-pago-{pago_id:08d}"
    finally:
        barrera.abort()
        for hilo in hilos:
            hilo.join(timeout=ESPERA_MAXIMA_SEGUNDOS)
        motor_angosto.dispose()
        _limpiar_grafo(
            persona_ids=[e[0] for e in escenarios],
            membresia_ids=[e[1] for e in escenarios],
            tipo_ids=[e[2] for e in escenarios],
        )


# --- El pool falla rápido en vez de encolar 30 s -----------------------------

def test_el_pool_de_la_aplicacion_declara_un_timeout_explicito_y_corto():
    """Segunda mitad del #813: sin `pool_timeout` declarado regía el default
    de SQLAlchemy (30 s), así que bajo saturación las requests no fallaban --
    se quedaban media hora de reloj de usuario esperando un slot, propagando
    la lentitud a endpoints que no tienen nada que ver.

    Se afirma contra la constante nombrada y no contra un literal repetido:
    si el número cambia, cambia en un solo lugar y el porqué vive junto al
    valor, no acá."""
    assert motor_aplicacion.pool.timeout() == TIMEOUT_POOL_SEGUNDOS, (
        "el motor de la aplicación no está usando el `pool_timeout` declarado"
    )
    assert TIMEOUT_POOL_SEGUNDOS < 30, (
        "el default de SQLAlchemy es 30 s; declarar ese mismo número no "
        "arregla nada"
    )


# --- Caminos de fallo -------------------------------------------------------

def test_un_fallo_de_cloudinary_no_deja_fila_a_medias_ni_conexion_tomada(monkeypatch):
    """Cuando la subida revienta, la excepción escapa desde el MEDIO del
    método -- el punto exacto donde antes quedaba una transacción abierta.

    Se mide la conexión ANTES de cerrar la sesión: eso es lo que distingue
    "se liberó porque el flujo la soltó" de "se liberó porque el `finally`
    del test cerró todo"."""
    monkeypatch.setattr(
        "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
        lambda **_kwargs: (_ for _ in ()).throw(ServicioNoDisponible("Cloudinary caído")),
    )

    persona_id, membresia_id, tipo_id, pago_id = _crear_pago_pendiente_real(1220)
    sesion = SessionLocal()
    try:
        conexiones_base = motor_aplicacion.pool.checkedout()
        with pytest.raises(ServicioNoDisponible):
            _adjuntar(sesion, pago_id, persona_id)

        assert motor_aplicacion.pool.checkedout() == conexiones_base, (
            "la conexión seguía tomada cuando la subida falló -- un Cloudinary "
            "lento y caído drenaría el pool entero"
        )
        assert _voucher_persistido(pago_id) is None, (
            "quedó un voucher persistido para una subida que nunca ocurrió"
        )
    finally:
        sesion.close()
        _limpiar_grafo(
            persona_ids=[persona_id], membresia_ids=[membresia_id], tipo_ids=[tipo_id],
        )


def test_un_pago_validado_durante_la_subida_no_recibe_el_voucher(monkeypatch):
    """El costado nuevo de soltar la transacción: entre la lectura y la
    escritura hay ahora una ventana de hasta 8 s (el techo de Cloudinary) en
    la que un administrador puede resolver el pago.

    Escribir igual dejaría un voucher adjunto a un pago ya validado, que es
    exactamente lo que el chequeo de estado #3 existe para impedir. La
    respuesta es la misma que ya da ese chequeo -- `OperacionInvalida`, 400,
    mismo mensaje -- porque el estado del pago es el mismo; lo único que
    cambió es CUÁNDO se lo mira."""
    persona_id, membresia_id, tipo_id, pago_id = _crear_pago_pendiente_real(1230)

    def _aprobar_durante_la_subida(**_kwargs):
        intruso = Session(bind=motor_aplicacion)
        try:
            intruso.get(Pago, pago_id).estado_pago = EstadoPago.APROBADO
            intruso.commit()
        finally:
            intruso.close()
        return "voucher-fake"

    monkeypatch.setattr(
        "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
        _aprobar_durante_la_subida,
    )

    sesion = SessionLocal()
    try:
        with pytest.raises(OperacionInvalida) as error:
            _adjuntar(sesion, pago_id, persona_id)
        assert "pendiente" in str(error.value).lower()
        assert _voucher_persistido(pago_id) is None
    finally:
        sesion.close()
        _limpiar_grafo(
            persona_ids=[persona_id], membresia_ids=[membresia_id], tipo_ids=[tipo_id],
        )


def test_un_pago_borrado_durante_la_subida_no_explota_con_un_500(monkeypatch):
    """El otro borde de la misma ventana: si la fila desaparece mientras
    Cloudinary responde, la reescritura tiene que dar el 404 que el método ya
    documenta -- no un `ObjectDeletedError` crudo (500) al despertar un ORM
    expirado."""
    from app.dominio.excepciones import EntidadNoEncontrada

    persona_id, membresia_id, tipo_id, pago_id = _crear_pago_pendiente_real(1240)

    def _borrar_durante_la_subida(**_kwargs):
        intruso = Session(bind=motor_aplicacion)
        try:
            intruso.query(Pago).filter(Pago.id == pago_id).delete(synchronize_session=False)
            intruso.commit()
        finally:
            intruso.close()
        return "voucher-fake"

    monkeypatch.setattr(
        "app.infraestructura.cloudinary_cliente.subir_voucher_pago",
        _borrar_durante_la_subida,
    )

    sesion = SessionLocal()
    try:
        with pytest.raises(EntidadNoEncontrada):
            _adjuntar(sesion, pago_id, persona_id)
    finally:
        sesion.close()
        _limpiar_grafo(
            persona_ids=[persona_id], membresia_ids=[membresia_id], tipo_ids=[tipo_id],
        )
