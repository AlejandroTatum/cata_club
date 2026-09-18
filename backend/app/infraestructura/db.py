from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker, Session

from app.soporte_transversal.configuracion import settings
from app.dominio.modelos import Base

# Cuánto espera una request por un slot del pool antes de rendirse (issue
# #813). SQLAlchemy no lo declaraba, así que regía su default de 30 s: bajo
# saturación las requests no fallaban, se encolaban invisibles medio minuto
# y recién entonces morían con `TimeoutError` -- una cola de la que nadie se
# entera es peor que un error rápido, porque la lentitud se propaga a
# endpoints que no tienen nada que ver con lo que saturó el pool.
#
# 5 s, el mismo techo que `TIMEOUT_LOCK_FILA_MS` (`bloqueo_fila.py`) le pone
# a la espera por un lock de fila: son la misma clase de recurso -- algo de
# la base por lo que una request espera su turno -- y el criterio de cuánto
# es razonable hacer esperar a un cliente HTTP no cambia porque el recurso
# escaso sea una conexión en vez de una fila. Si el valor cambia, documentar
# acá el porqué del nuevo número.
TIMEOUT_POOL_SEGUNDOS = 5

# Cuánto puede esperar un CONNECT -- TCP + handshake de autenticación -- antes
# de rendirse (issue #1311). Misma clase de techo que `TIMEOUT_POOL_SEGUNDOS`,
# un escalón antes: cuánto puede esperar una request HTTP sobre la base antes
# de fallar fuerte. `pool_timeout` acota la espera por un slot del pool pero NO
# el connect: un Postgres que acepta el TCP y después nunca manda la respuesta
# de startup deja la request reteniendo hilo del threadpool Y slot del pool sin
# límite. El `SET LOCAL statement_timeout` del scrape corre DESPUÉS del connect,
# así que no cubre este caso. Es preexistente para toda ruta que toca la base
# (incluida `/health/ready`); se arregla acá, a nivel engine.
#
# 5 s, el mismo número que `TIMEOUT_POOL_SEGUNDOS`: misma clase de espera,
# mismo techo. `/health/ready` mantiene su 2 s más estricto
# (`TIMEOUT_CONEXION_POSTGRES_SEGUNDOS` en `main.py`) porque una sonda debe ser
# más rápida que una request. Si el valor cambia, documentar acá el porqué.
TIMEOUT_CONEXION_SEGUNDOS = 5


def crear_engine(
    database_url: str, timeout_conexion: int = TIMEOUT_CONEXION_SEGUNDOS
) -> Engine:
    """Arma el engine pooled de la aplicación con los dos techos de espera
    sobre la base: `pool_timeout` (slot del pool) y `connect_timeout` (TCP +
    auth). El segundo es inyectable para que un test pueda acotarlo barato
    contra un socket que acepta y se queda mudo -- ver `tests/test_db.py`."""
    return create_engine(
        database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
        pool_recycle=1800,
        pool_timeout=TIMEOUT_POOL_SEGUNDOS,
        connect_args={"connect_timeout": timeout_conexion},
    )


engine = crear_engine(settings.database_url)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def obtener_sesion() -> Session:
    """Dependencia de FastAPI: entrega una sesión de BD por request y la cierra al final."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def crear_tablas():
    """Solo para desarrollo. En producción se usa Alembic para migraciones."""
    Base.metadata.create_all(bind=engine)
