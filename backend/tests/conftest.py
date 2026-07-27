"""
Fixtures compartidas para las pruebas del backend.

La suite corre contra PostgreSQL real (decisión de diseño 1.1/1.2/1.3,
sdd/production-readiness): `TEST_DATABASE_URL` es OBLIGATORIO (ver
`db-test` en docker-compose.yml, o el servicio Postgres de CI en
.github/workflows/ci.yml). El esquema lo crea Alembic real
(`alembic upgrade head`) — nunca `Base.metadata.create_all` — y el
aislamiento por test es vía transacción externa + savepoints. La rama
SQLite transitoria y el allow-list de fallout (`_pendientes_postgres.py`)
se eliminaron en el commit de sunset (PR-06f) una vez reparado el único
archivo que la migración a Postgres expuso.
"""
import sys
import os
from datetime import date as _date_cls
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Deshabilitar rate limiting en tests
os.environ.setdefault("AMBIENTE", "test")

# Contrato de un solo env var (decisión 1.1): tanto esta suite como Alembic
# (vía `settings.database_url`, leído en `alembic/env.py`) apuntan al MISMO
# Postgres. Esto tiene que pasar ANTES de importar cualquier módulo de
# `app.*` de más abajo: `settings` es un singleton (`Settings()`) que lee
# las env vars una sola vez, al importarse
# `app.soporte_transversal.configuracion`.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "").strip()
if not TEST_DATABASE_URL:
    raise RuntimeError(
        "TEST_DATABASE_URL no está definido. La suite requiere Postgres "
        "real -- levantá `db-test` (`docker compose --profile test up -d "
        "db-test`) y corré con, por ejemplo, TEST_DATABASE_URL="
        "postgresql+psycopg://usuario:password@localhost:5436/cataclub_test "
        "(ver docker-compose.yml). Ya no existe una rama SQLite de respaldo."
    )
os.environ["DATABASE_URL"] = TEST_DATABASE_URL

from app.dominio.modelos import Persona, Usuario, Rol
from app.dominio.enums import TipoRol
from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app


def crear_entrenador(db_session, cedula: str = "1710034065") -> int:
    """Crea una persona con rol ENTRENADOR y devuelve su persona_id. Helper
    compartido entre los tests de horario/categoria que necesitan un
    entrenador_id válido (evita duplicar esta fábrica en cada archivo)."""
    persona = Persona(
        nombres="Carlos", apellidos="Ruiz", cedula=cedula,
        fecha_nacimiento=_date_cls(1990, 1, 1), telefono="0991112222",
    )
    db_session.add(persona)
    db_session.flush()
    rol = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")
    usuario = Usuario(
        correo=f"entrenador{cedula}@cataclub.test",
        contrasenia="hash", persona_id=persona.id, roles=[rol],
    )
    db_session.add(usuario)
    db_session.commit()
    return persona.id


# --- Congelamiento de "hoy" para los tests --------------------------------
# Los tests existentes usan `fecha_nacimiento = "2010-05-14"` y asumen que la
# persona es mayor de edad (para NO requerir representante). Esto solo es
# cierto si "today" cae en o después de 2028-05-14. Para que la suite sea
# determinista (no dependa del calendario real del equipo que corre los tests)
# se congela `date.today()` a una fecha posterior a ese umbral.
FECHA_CONGELADA_HOY = _date_cls(2029, 1, 1)


class _FechaCongelada(_date_cls):
    """Subclase de `date` cuyo `today()` devuelve una fecha fija. Sigue
    permitiendo construir `date(...)` normalmente para los tests que
    explicitan fechas (ej. fecha_entrenamiento)."""
    @classmethod
    def today(cls):
        return FECHA_CONGELADA_HOY


@pytest.fixture(autouse=True)
def _congelar_hoy_en_persona_servicio(monkeypatch):
    """Parchea el `date` importado en `persona_servicio` para que los
    tests no dependan del reloj real (ver nota FECHA_CONGELADA_HOY).
    Autouse: aplica a todos los tests sin necesidad de pedirlo explícito."""
    import app.servicios_negocio.persona_servicio as ps
    monkeypatch.setattr(ps, "date", _FechaCongelada)


@pytest.fixture(autouse=True)
def _mock_disparo_celery_comprobante(monkeypatch):
    """Evita que `PagoServicio.validar_pago` llame a `Comprobante.delay(...)`
    durante los tests (no hay broker Redis corriendo en el entorno de test).
    El disparo Celery se prueba aparte en el suite de integración."""
    import app.servicios_negocio.membresia_pago_servicio as mps
    monkeypatch.setattr(mps.PagoServicio, "_disparar_generacion_comprobante_pdf", lambda self, pago_id: None)


@pytest.fixture()
def persona_sin_usuario(db_session):
    """Crea una Persona (sin Usuario asociado) directamente vía ORM, para
    probar el endpoint público POST /auth/registro. Devuelve la persona."""
    from app.dominio.modelos import Persona
    p = Persona(
        nombres="Ana", apellidos="Torres", cedula="1710034065",
        fecha_nacimiento=_date_cls(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


@pytest.fixture(scope="session")
def motor_test():
    """Motor de Postgres para toda la sesión de pytest (decisión 1.1/1.3).
    `NullPool`: cada test abre su propia conexión/transacción explícita;
    poolear entre tests que además corren secuencialmente no aporta nada."""
    engine = create_engine(TEST_DATABASE_URL, poolclass=NullPool)
    yield engine
    engine.dispose()


@pytest.fixture(scope="session", autouse=True)
def esquema_migrado(motor_test):
    """Crea el esquema UNA vez por sesión aplicando las migraciones reales
    de Alembic (decisión 1.2) — nunca `Base.metadata.create_all`, así se
    ejercitan los ENUM nativos, las FKs y cualquier `ALTER TYPE` real, cosas
    que `create_all` jamás corre."""
    with motor_test.connect() as conexion:
        conexion.execute(text("DROP SCHEMA public CASCADE"))
        conexion.execute(text("CREATE SCHEMA public"))
        conexion.commit()
    from alembic.config import Config as AlembicConfig
    from alembic import command as alembic_command
    raiz_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alembic_cfg = AlembicConfig(os.path.join(raiz_backend, "alembic.ini"))
    alembic_command.upgrade(alembic_cfg, "head")


_secuencias_cache: list[str] = []


def _reiniciar_secuencias(conexion) -> None:
    """Resetea cada secuencia a 1 dentro de la transacción externa del test.
    `ALTER SEQUENCE ... RESTART WITH n` es transaccional en Postgres (a
    diferencia de `nextval`/`setval`, que nunca se deshacen) y por lo tanto
    se revierte con el `ROLLBACK` de teardown de `db_session` — verificado
    empíricamente contra Postgres 16 real en
    `backend/scripts/spike_secuencias_postgres.sql`. Esto preserva, sin
    reescribirlos, a los tests existentes que hardcodean ids bajos (ej.
    `"persona_id": 1` en los fixtures `client*` más abajo)."""
    global _secuencias_cache
    if not _secuencias_cache:
        filas = conexion.execute(text(
            "SELECT sequence_name FROM information_schema.sequences "
            "WHERE sequence_schema = 'public'"
        )).fetchall()
        _secuencias_cache = [fila[0] for fila in filas]
    for nombre in _secuencias_cache:
        conexion.execute(text(f'ALTER SEQUENCE "{nombre}" RESTART WITH 1'))


@pytest.fixture()
def db_session(motor_test):
    """Sesión de BD por test: aislamiento por transacción externa +
    savepoints (decisión 1.3) — cada `commit()` de repositorio libera un
    SAVEPOINT en vez de terminar la transacción externa, así que el
    `rollback()` final descarta todo lo escrito por el test."""
    conexion = motor_test.connect()
    transaccion = conexion.begin()
    _reiniciar_secuencias(conexion)
    sesion = Session(bind=conexion, join_transaction_mode="create_savepoint")
    try:
        yield sesion
    finally:
        sesion.close()
        transaccion.rollback()
        conexion.close()


@pytest.fixture()
def client(db_session):
    """Cliente de pruebas con la sesión de BD inyectada y, por defecto,
    autenticado como ADMINISTRADOR + ENTRENADOR (para no tener que generar
    JWT reales en cada test de negocio; la seguridad de JWT/roles se prueba
    aparte en test_permisos.py)."""

    def _override_sesion():
        yield db_session

    def _override_token():
        return {"sub": "admin@cataclub.test", "persona_id": 1, "roles": ["ADMINISTRADOR", "ENTRENADOR"]}

    app.dependency_overrides[obtener_sesion] = _override_sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = _override_token

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture()
def client_sin_permisos(db_session):
    """Cliente autenticado pero SIN rol ADMINISTRADOR, para probar 403."""

    def _override_sesion():
        yield db_session

    def _override_token():
        return {"sub": "alumno@cataclub.test", "persona_id": 1, "roles": ["ALUMNO"]}

    app.dependency_overrides[obtener_sesion] = _override_sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = _override_token

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture()
def client_entrenador(db_session):
    """Cliente autenticado con rol ENTRENADOR únicamente (sin ADMINISTRADOR),
    para probar que el export PDF de asistencia es más estricto que su
    hermano JSON (que sí permite ENTRENADOR)."""

    def _override_sesion():
        yield db_session

    def _override_token():
        return {"sub": "entrenador@cataclub.test", "persona_id": 1, "roles": ["ENTRENADOR"]}

    app.dependency_overrides[obtener_sesion] = _override_sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = _override_token

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


@pytest.fixture()
def client_sin_token(db_session):
    """Cliente SIN autenticar: el override del token se elimina, de modo que
    cualquier endpoint que dependa de `GestorAutenticacion.decodificar_token`
    (vía Depends directo o via `GestorPermisos`) debe responder 401.
    Útil para verificar que endpoints previamente públicos hoy rechazan
    sin credenciales."""

    def _override_sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _override_sesion
    # NO se setea override de decodificar_token: FastAPI usará el real, que
    # al no venir un Bearer en la cabecera lanza 401 (manejado por el
    # OAuth2PasswordBearer de gestor_auth.py).
    app.dependency_overrides.pop(GestorAutenticacion.decodificar_token, None)

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()
