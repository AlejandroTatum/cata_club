from sqlalchemy import create_engine
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

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    pool_recycle=1800,
    pool_timeout=TIMEOUT_POOL_SEGUNDOS,
)
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
