import importlib.util
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.dominio.enums import TipoEscuela
from app.dominio.modelos import (
    AlumnoHorario,
    Asistencia,
    Base,
    Descuento,
    Enfermedades,
    FichaMedica,
    Institucion,
    Persona,
    Sponsor,
    Usuario,
)
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


def test_todas_las_cuentas_del_bulk_nacen_con_el_correo_verificado():
    """Gemelo del test homónimo de `test_seed_dev_base.py` (issue #790).

    El bulk crea alumnos y representantes por lotes; sobre un volumen fresco
    los dejaba a todos sin verificar, y un representante sin verificar no
    puede vincular a nadie -- que es justo lo que el dataset grande existe
    para poder probar."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        cuentas = list(verificacion.execute(select(Usuario)).scalars().all())

    assert cuentas, "el seed no creó ninguna cuenta"
    sin_verificar = sorted(u.correo for u in cuentas if not u.correo_verificado)
    assert sin_verificar == [], (
        f"{len(sin_verificar)} de {len(cuentas)} cuentas sembradas sin verificar: "
        f"{sin_verificar[:5]}"
    )


def test_main_cubre_los_cuatro_tipos_de_escuela():
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        instituciones = list(verificacion.execute(select(Institucion)).scalars().all())

    assert instituciones, "el seed no creó ninguna institución"
    tipos = {i.tipo_escuela for i in instituciones}
    assert tipos == set(TipoEscuela), (
        f"faltan tipos de escuela en el catálogo sembrado: {set(TipoEscuela) - tipos}"
    )


def test_main_siembra_sponsors_con_logo_placeholder():
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        sponsors = list(verificacion.execute(select(Sponsor)).scalars().all())

    assert sponsors, "el seed no creó ningún sponsor"
    assert len({s.logo_public_id for s in sponsors}) == len(sponsors), (
        "logo_public_id repetido entre sponsors sembrados"
    )
    assert all(s.logo_url for s in sponsors)


def test_main_respeta_el_check_xor_de_descuento():
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        descuentos = list(verificacion.execute(select(Descuento)).scalars().all())

    assert descuentos, "el seed no creó ningún descuento"
    invalidos = [
        d for d in descuentos if (d.porcentaje is None) == (d.monto is None)
    ]
    assert not invalidos, (
        f"descuentos que violan el XOR porcentaje/monto: {[d.nombre for d in invalidos]}"
    )


def test_main_las_enfermedades_cuelgan_de_fichas_existentes():
    """Ninguna `Enfermedades` huérfana: todas deben apuntar a una
    `FichaMedica` que el seed sembró, nunca crearse sueltas."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        enfermedades = list(verificacion.execute(select(Enfermedades)).scalars().all())
        ids_ficha = {
            f.id for f in verificacion.execute(select(FichaMedica)).scalars().all()
        }

    assert enfermedades, "el seed no creó ninguna enfermedad"
    huerfanas = [e for e in enfermedades if e.ficha_medica_id not in ids_ficha]
    assert not huerfanas, f"{len(huerfanas)} enfermedades huérfanas"


def test_main_backfill_deja_personas_con_institucion_y_sin_institucion():
    """El caso "sin institución" tiene que seguir existiendo tras el
    backfill: no todas las personas quedan cubiertas a propósito."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        personas = list(verificacion.execute(select(Persona)).scalars().all())

    con_institucion = [p for p in personas if p.institucion_id is not None]
    sin_institucion = [p for p in personas if p.institucion_id is None]

    assert con_institucion, "ninguna persona quedó con institución tras el backfill"
    assert sin_institucion, "ninguna persona quedó sin institución: falta la rama NULL"


def test_main_no_duplica_catalogos_al_correr_dos_veces():
    """El test que más importa: una segunda corrida no debe duplicar ni una
    sola fila de los catálogos nuevos (institución, sponsor, descuento,
    enfermedades)."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    def _conteos():
        with SessionLocal() as verificacion:
            return {
                "institucion": verificacion.execute(select(func.count()).select_from(Institucion)).scalar_one(),
                "sponsor": verificacion.execute(select(func.count()).select_from(Sponsor)).scalar_one(),
                "descuento": verificacion.execute(select(func.count()).select_from(Descuento)).scalar_one(),
                "enfermedades": verificacion.execute(select(func.count()).select_from(Enfermedades)).scalar_one(),
            }

    conteos_primera_corrida = _conteos()
    assert all(v > 0 for v in conteos_primera_corrida.values()), conteos_primera_corrida

    modulo_bulk.main()
    conteos_segunda_corrida = _conteos()

    assert conteos_segunda_corrida == conteos_primera_corrida, (
        f"corrida repetida duplicó filas: {conteos_primera_corrida} -> {conteos_segunda_corrida}"
    )
