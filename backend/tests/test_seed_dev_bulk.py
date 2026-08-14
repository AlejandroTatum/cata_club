import importlib.util
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.dominio.modelos import AlumnoHorario, Asistencia, Base
from tests._categoria_seed import sembrar_categorias

SEED_SCRIPT = Path(__file__).parents[1] / "scripts" / "seed_dev_bulk.py"
BASE_SEED_SCRIPT = Path(__file__).parents[1] / "scripts" / "seed_dev_base.py"


def _load_seed_module():
    spec = importlib.util.spec_from_file_location("seed_dev_bulk", SEED_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _load_base_seed_module():
    spec = importlib.util.spec_from_file_location("seed_dev_base", BASE_SEED_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _motor_en_memoria(*modulos):
    """Motor SQLite fresco compartido por los módulos de seed recibidos.

    El bulk seed depende de lo que siembra el base (entrenador, horarios,
    tipos de membresía), así que ambos tienen que apuntar a la misma
    sesión — mismo montaje que `test_seed_dev_base._motor_en_memoria`.
    """
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    sembrar_categorias(TestingSessionLocal)

    for modulo in modulos:
        modulo.SessionLocal = TestingSessionLocal
    return TestingSessionLocal


def test_voucher_fixture_url_uses_reachable_default(monkeypatch):
    monkeypatch.delenv("SEED_VOUCHER_BASE_URL", raising=False)

    assert _load_seed_module().voucher_fixture_url() == "https://placehold.co/600x400.png?text=Cata+Club+Voucher"


def test_voucher_fixture_url_uses_configured_url(monkeypatch):
    monkeypatch.setenv("SEED_VOUCHER_BASE_URL", "https://fixtures.example/voucher.png")

    assert _load_seed_module().voucher_fixture_url() == "https://fixtures.example/voucher.png"


def test_voucher_fixture_url_falls_back_when_configuration_is_blank(monkeypatch):
    monkeypatch.setenv("SEED_VOUCHER_BASE_URL", "")

    assert _load_seed_module().voucher_fixture_url() == "https://placehold.co/600x400.png?text=Cata+Club+Voucher"


def test_main_inscribe_a_cada_alumno_en_el_horario_donde_le_registra_asistencia():
    """Toda `Asistencia` debe tener su `AlumnoHorario` que la respalde.

    El seed creaba asistencia sobre los primeros 3 horarios del entrenador sin
    inscribir al alumno, así que producía un estado que la propia API no puede
    generar (`asignar_alumno_a_horario` es el único camino real). El efecto
    visible: `GET /asistencias/horarios/{id}/alumnos` lee solo `alumno_horario`
    y devolvía un roster que no contenía a ninguno de los alumnos que sí
    aparecían en `GET /asistencias/reportes`.
    """
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        asistencias = list(verificacion.execute(select(Asistencia)).scalars().all())
        inscripciones = {
            (a.persona_id, a.horario_id)
            for a in verificacion.execute(select(AlumnoHorario)).scalars().all()
        }

    assert asistencias, "el seed no creó asistencias: el test pasaría en vacío"

    sin_inscripcion = [
        (a.persona_id, a.horario_id)
        for a in asistencias
        if (a.persona_id, a.horario_id) not in inscripciones
    ]
    assert not sin_inscripcion, (
        f"{len(sin_inscripcion)} de {len(asistencias)} asistencias sin AlumnoHorario "
        f"que las respalde: {sorted(set(sin_inscripcion))[:5]}"
    )


def test_main_no_inventa_justificativo_ni_estado_justificativo():
    """`justificativo` / `estado_justificativo` los escribe la app, nunca el seed.

    Decisión del 11 de agosto (docs/product/decisiones-de-negocio-2026-08-11.md,
    sección 2): "Justificado" es una marca sin motivo -- no hay flujo que pida
    ni muestre un motivo. Antes de este fix el seed llenaba ~82 filas con
    "Cita médica" inventada, y eso confundió a un auditor que reportó como
    defecto que las columnas estuvieran vacías cuando en realidad estaban
    llenas de datos falsos del seed. Deben quedar en NULL siempre,
    independientemente del `estado` de la asistencia.
    """
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        asistencias = list(verificacion.execute(select(Asistencia)).scalars().all())

    assert asistencias, "el seed no creó asistencias: el test pasaría en vacío"

    con_justificativo_inventado = [
        a for a in asistencias
        if a.justificativo is not None or a.estado_justificativo is not None
    ]
    assert not con_justificativo_inventado, (
        f"{len(con_justificativo_inventado)} de {len(asistencias)} asistencias con "
        "justificativo/estado_justificativo inventado por el seed"
    )
