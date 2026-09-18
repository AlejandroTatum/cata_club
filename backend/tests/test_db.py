"""
Contrato del engine pooled de la aplicación (`app/infraestructura/db.py`):
el connect también está acotado (issue #1311, W3).

`pool_timeout` ya acotaba la espera por un slot del pool, pero NO el
handshake de conexión. Un Postgres que acepta el TCP y después nunca manda la
respuesta de startup deja la request colgada reteniendo hilo del threadpool Y
slot del pool sin límite -- el `SET LOCAL statement_timeout` del scrape corre
DESPUÉS del connect, así que no cubre ese caso. El arreglo es
`connect_args={"connect_timeout": ...}`, inyectable vía `crear_engine`, y se
prueba acá contra un socket local que acepta y se queda mudo (el kernel
completa el handshake TCP; psycopg espera la respuesta de Postgres).
"""
import socket
import threading
import time

import pytest
from sqlalchemy.exc import OperationalError

from app.infraestructura.db import (
    TIMEOUT_CONEXION_SEGUNDOS,
    TIMEOUT_POOL_SEGUNDOS,
    crear_engine,
)


def test_el_engine_acota_el_connect_contra_un_postgres_que_acepta_tcp_y_no_responde():
    """El caso W3: un servidor que acepta el TCP pero nunca responde deja el
    connect colgado. Con `connect_timeout` debe fallar con `OperationalError`
    dentro del techo, en vez de esperar para siempre.

    El doble es un socket local: `listen(1)` + un hilo que hace `accept()` y
    después no lee ni escribe. El kernel completa el handshake TCP igual, así
    que psycopg llega a mandar su startup y se queda esperando una respuesta
    que nunca llega -- exactamente el escenario del hallazgo. Se usa
    `timeout_conexion=2` para que el test no tarde el default de 5 s.

    La cota inferior (1.0 s) descarta que el fallo venga de un rechazo
    instantáneo (conexión rechazada, DNS) en vez del timeout; la superior
    (15 s) prueba que está acotado."""
    servidor = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    servidor.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    servidor.bind(("127.0.0.1", 0))
    servidor.listen(1)
    puerto = servidor.getsockname()[1]

    conexiones_aceptadas: list[socket.socket] = []
    liberar = threading.Event()

    def _aceptar_y_callar():
        try:
            conexion_cliente, _ = servidor.accept()
        except OSError:
            return  # el teardown cerró el servidor antes de que llegara el connect
        conexiones_aceptadas.append(conexion_cliente)
        # No lee ni escribe: mantiene el socket vivo hasta el teardown.
        liberar.wait(timeout=30)

    hilo = threading.Thread(target=_aceptar_y_callar, daemon=True)
    hilo.start()

    url = f"postgresql+psycopg://usuario:password@127.0.0.1:{puerto}/no_existe"
    engine = crear_engine(url, timeout_conexion=2)
    try:
        inicio = time.monotonic()
        with pytest.raises(OperationalError):
            engine.connect()
        transcurrido = time.monotonic() - inicio
    finally:
        engine.dispose()
        liberar.set()
        servidor.close()
        for conexion in conexiones_aceptadas:
            conexion.close()

    assert 1.0 <= transcurrido <= 15


def test_el_techo_de_conexion_es_el_mismo_que_el_del_pool():
    """Invariante documentado en `db.py`: `pool_timeout` y `connect_timeout`
    son la misma clase de espera (algo de la base por lo que una request
    aguarda su turno) y comparten techo de 5 s. Si uno cambia, el otro tiene
    que cambiar con él -- esta línea lo bloquea."""
    assert TIMEOUT_CONEXION_SEGUNDOS == TIMEOUT_POOL_SEGUNDOS
