"""Sesión de solo lectura compartida por las auditorías de identidad
(issues #902, #904). Abre la conexión en modo `READ ONLY` de Postgres,
que rechaza cualquier escritura con un error del propio servidor -- la
garantía la da la base, no la disciplina del código que la usa."""
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session


def abrir_sesion_solo_lectura(engine: Engine) -> Session:
    """`Session` sobre una conexión `postgresql_readonly=True`."""
    conexion = engine.connect().execution_options(postgresql_readonly=True)
    return Session(bind=conexion)
