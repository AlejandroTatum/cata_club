"""
Fixtures compartidas para las pruebas del backend.
Usa SQLite en memoria (no requiere PostgreSQL) para validar que el modelo de
dominio, los repositorios, los servicios de negocio y los routers funcionan
de punta a punta.
"""
import sys
import os
from datetime import date as _date_cls
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Deshabilitar rate limiting en tests
os.environ.setdefault("AMBIENTE", "test")

from app.dominio.modelos import Base, Persona, Usuario, Rol
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


@pytest.fixture()
def db_session():
    """Motor SQLite en memoria, tablas frescas por cada test."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


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
    """Cliente autenticado con rol ENTRENADOR únicamente (sin ADMINISTRADOR).
    Útil para probar gates que son intencionalmente más estrechos que el
    JSON hermano (ej. exportación PDF de asistencia, que excluye ENTRENADOR)."""

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
