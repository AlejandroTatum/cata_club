"""Registra `btrim` como función SQL en un motor SQLite en memoria (issue
#1023).

`ix_usuario_correo_lower` (`app/dominio/modelos.py`) se declara con
`func.btrim`, no `func.trim`: `test_drift_migraciones.py` compara el TEXTO
de esa declaración contra el de la migración `f1023correobtrim`
(`compare_metadata`, sin excepciones), y esa migración escribe `btrim`
literal en su SQL crudo -- con `trim` esa prueba marca drift aunque el
índice sirva exactamente la misma consulta en Postgres.

`btrim` no es una función SQL estándar; SQLite no la trae, a diferencia de
Postgres. `Base.metadata.create_all()` contra un motor SQLite en memoria
(varios tests de seed, que no corren `alembic upgrade`) revienta al crear
`ix_usuario_correo_lower` si nadie la registra. Postgres SÍ implementa
`btrim(x)` como recorte de ambos bordes sin caracteres a remover -- el
mismo comportamiento de `str.strip()` -- así que registrarla como una
función Python de un solo argumento sobre la conexión SQLite basta para
que `Base.metadata.create_all()` funcione."""
from sqlalchemy import event
from sqlalchemy.engine import Engine


def registrar_btrim_sqlite(engine: Engine) -> None:
    """Engancha el registro de `btrim` a cada conexión DBAPI nueva del
    motor. Con `poolclass=StaticPool` (una sola conexión subyacente para
    toda la vida del motor en memoria) esto corre una única vez, en el
    momento en que SQLAlchemy abre esa conexión."""

    @event.listens_for(engine, "connect")
    def _registrar(dbapi_connection, _connection_record):
        # `deterministic=True`: SQLite rechaza una función no marcada como
        # determinística dentro de una expresión de índice ("non-
        # deterministic functions prohibited in index expressions") --
        # `str.strip` sí lo es, siempre devuelve lo mismo para el mismo
        # argumento.
        dbapi_connection.create_function("btrim", 1, str.strip, deterministic=True)
