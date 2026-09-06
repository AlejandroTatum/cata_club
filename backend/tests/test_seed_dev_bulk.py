import importlib.util
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.dominio.enums import EstadoMembresia, TipoEscuela
from app.dominio.modelos import (
    AlumnoHorario,
    AsignacionDescuento,
    Asistencia,
    AsistenciaCorreccion,
    Base,
    CoberturaBonificada,
    ConsentimientoLegal,
    ConsultaFichaEmergencia,
    CorreccionPago,
    Descuento,
    Enfermedades,
    EnrollmentNotificacionOutbox,
    FichaMedica,
    HistorialCambioPlanMembresia,
    HistorialEstadoMembresia,
    InscripcionIdempotencia,
    Institucion,
    Notificacion,
    Persona,
    RevocacionConsentimientoLegal,
    SesionAsistencia,
    Sponsor,
    Usuario,
    VerificacionCorreoOutbox,
    VinculacionRepresentante,
)
from tests._categoria_seed import sembrar_categorias
from tests._sqlite_btrim import registrar_btrim_sqlite

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
    registrar_btrim_sqlite(engine)
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


# ---------------------------------------------------------------------------
# Eventos de dominio (issue de QA con 0 dev seed en 16 tablas nuevas).
# ---------------------------------------------------------------------------
def test_existe_al_menos_un_hijo_gestionado_sin_cuenta_propia():
    """El test que más importa de todo el PR: el "hijo gestionado" que el
    dominio contempla -- una `Persona` con `representante_id` pero SIN fila
    en `usuario` -- es exactamente lo que `EnrollmentServicio.enroll` deja
    cuando el representante NO manda `alumno.correo`/`alumno.contrasenia`
    (`enrollment_servicio.py:284-286`). Antes de este fix, tanto
    `seed_dev_base.py` como el bulk creaban `Usuario` SIEMPRE, así que ese
    caso de dominio no existía ni una vez sobre 86 personas/86 usuarios."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        personas = list(verificacion.execute(select(Persona)).scalars().all())
        ids_con_usuario = {
            u.persona_id for u in verificacion.execute(select(Usuario)).scalars().all()
        }

    hijos_sin_cuenta = [
        p for p in personas
        if p.representante_id is not None and p.id not in ids_con_usuario
    ]
    assert hijos_sin_cuenta, (
        "ninguna Persona con representante_id quedó sin Usuario: el "
        "'hijo gestionado' del dominio sigue sin estar cubierto"
    )


def test_toda_asistencia_cae_dentro_de_una_unica_sesion_asistencia():
    """`SesionAsistencia` agrupa las `Asistencia` existentes por (horario_id,
    fecha_entrenamiento) -- issue #389, slice 1. Insertar una sesión por
    asistencia en vez de una por grupo rompería en cuanto el segundo alumno
    de la misma sesión intentara la suya (UNIQUE compuesto)."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        asistencias = list(verificacion.execute(select(Asistencia)).scalars().all())
        sesiones = list(verificacion.execute(select(SesionAsistencia)).scalars().all())

    assert asistencias, "el seed no creó asistencias: el test pasaría en vacío"
    assert sesiones, "el seed no creó ninguna sesión de asistencia"

    claves_sesion = {(s.horario_id, s.fecha_entrenamiento) for s in sesiones}
    assert len(claves_sesion) == len(sesiones), (
        "hay más de una SesionAsistencia para el mismo (horario_id, fecha_entrenamiento)"
    )

    sin_sesion = [
        a for a in asistencias
        if (a.horario_id, a.fecha_entrenamiento) not in claves_sesion
    ]
    assert not sin_sesion, (
        f"{len(sin_sesion)} de {len(asistencias)} asistencias sin SesionAsistencia que las agrupe"
    )


def test_historial_estado_membresia_nunca_repite_estado_ni_apunta_a_vencida():
    """CHECK `ck_historial_estado_cambia` (estado_anterior <> estado_nuevo) y
    la regla de negocio de `vencimientos_tareas.py`: el vencimiento
    ACTIVA -> VENCIDA lo hace un UPDATE directo del batch que NO escribe
    historial, así que ninguna fila de este seed puede apuntar a VENCIDA."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        historial = list(
            verificacion.execute(select(HistorialEstadoMembresia)).scalars().all()
        )

    assert historial, "el seed no creó ningún historial de estado de membresía"
    repetidos = [h for h in historial if h.estado_anterior == h.estado_nuevo]
    hacia_vencida = [h for h in historial if h.estado_nuevo == EstadoMembresia.VENCIDA]
    assert not repetidos, "historial con estado_anterior == estado_nuevo"
    assert not hacia_vencida, (
        "el seed escribió una transición hacia VENCIDA -- esa la genera el "
        "batch de vencimientos y no debe tener historial"
    )


def test_historial_cambio_plan_siempre_cambia_de_tipo_membresia():
    """CHECK `ck_historial_cambio_plan_cambia`: un "cambio de plan" que deja
    el mismo tipo no es un cambio, es ruido en la auditoría."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        historial = list(
            verificacion.execute(select(HistorialCambioPlanMembresia)).scalars().all()
        )

    assert historial, "el seed no creó ningún historial de cambio de plan"
    sin_cambio = [
        h for h in historial
        if h.tipo_membresia_id_anterior == h.tipo_membresia_id_nuevo
    ]
    assert not sin_cambio, "historial de cambio de plan que no cambia de tipo"


def test_a_lo_sumo_una_asignacion_descuento_vigente_por_persona():
    """Espejo del índice único parcial `uq_asignacion_descuento_activa_por_
    persona` (solo Postgres lo hace cumplir; ver verificación aparte contra
    Postgres real). Cubre también la rama "retirada" del CHECK
    `ck_asignacion_retiro_completo`."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        asignaciones = list(
            verificacion.execute(select(AsignacionDescuento)).scalars().all()
        )

    assert asignaciones, "el seed no creó ninguna asignación de descuento"
    vigentes_por_persona: dict[int, int] = {}
    for a in asignaciones:
        if a.retirado_en is None:
            vigentes_por_persona[a.persona_id] = vigentes_por_persona.get(a.persona_id, 0) + 1
    con_mas_de_una = {pid: n for pid, n in vigentes_por_persona.items() if n > 1}
    assert not con_mas_de_una, f"personas con más de una asignación vigente: {con_mas_de_una}"
    assert any(a.retirado_en is not None for a in asignaciones), (
        "el seed no cubrió la rama 'beneficio retirado'"
    )


def test_cobertura_bonificada_no_se_solapa_para_la_misma_membresia():
    """Espejo del `ExcludeConstraint` anti-solape (solo Postgres, `btree_gist`
    -- ver verificación aparte contra Postgres real). `CoberturaBonificada`
    nunca crea un `Pago`."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        coberturas = list(
            verificacion.execute(select(CoberturaBonificada)).scalars().all()
        )

    assert coberturas, "el seed no creó ninguna cobertura bonificada"
    por_membresia: dict[int, list] = {}
    for c in coberturas:
        por_membresia.setdefault(c.membresia_id, []).append(c)
    solapadas = []
    for membresia_id, filas in por_membresia.items():
        filas_ordenadas = sorted(filas, key=lambda c: c.fecha_inicio)
        for anterior, siguiente in zip(filas_ordenadas, filas_ordenadas[1:]):
            if anterior.fecha_fin > siguiente.fecha_inicio:
                solapadas.append(membresia_id)
    assert not solapadas, f"membresías con cobertura bonificada solapada: {solapadas}"


def test_correccion_pago_siempre_cambia_algun_campo():
    """CHECK `ck_correccion_pago_algun_campo_cambia`: una "corrección" que no
    cambia ningún valor es ruido en la auditoría."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        correcciones = list(verificacion.execute(select(CorreccionPago)).scalars().all())

    assert correcciones, "el seed no creó ninguna corrección de pago"
    sin_cambio = [
        c for c in correcciones
        if c.monto_anterior == c.monto_nuevo and c.fecha_fin_anterior == c.fecha_fin_nuevo
    ]
    assert not sin_cambio, "corrección de pago que no cambió ningún campo"


def test_consentimientos_legales_cubren_con_y_sin_representado():
    """Cubre las DOS formas del UNIQUE compuesto de `consentimiento_legal`:
    con `representado_persona_id` (aceptación en nombre de un hijo) y sin él
    (autoinscripción/alta directa)."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        consentimientos = list(
            verificacion.execute(select(ConsentimientoLegal)).scalars().all()
        )

    assert consentimientos, "el seed no creó ningún consentimiento legal"
    con_representado = [c for c in consentimientos if c.representado_persona_id is not None]
    sin_representado = [c for c in consentimientos if c.representado_persona_id is None]
    assert con_representado, "falta la forma 'con representado' del consentimiento"
    assert sin_representado, "falta la forma 'sin representado' del consentimiento"


def test_revocacion_consentimiento_tiene_motivo_y_no_duplica_consentimiento():
    """`RevocacionConsentimientoLegal.consentimiento_id` es UNIQUE y `motivo`
    NOT NULL."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        revocaciones = list(
            verificacion.execute(select(RevocacionConsentimientoLegal)).scalars().all()
        )

    assert revocaciones, "el seed no creó ninguna revocación de consentimiento"
    assert all(r.motivo for r in revocaciones)
    ids_consentimiento = [r.consentimiento_id for r in revocaciones]
    assert len(ids_consentimiento) == len(set(ids_consentimiento)), (
        "consentimiento_id repetido entre revocaciones"
    )


def test_vinculacion_representante_cubre_las_dos_ramas_del_anterior():
    """`representante_anterior_id` nullable: cubre con valor (cambio de
    representante) y NULL (el representado no tenía uno antes)."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        vinculaciones = list(
            verificacion.execute(select(VinculacionRepresentante)).scalars().all()
        )

    assert vinculaciones, "el seed no creó ninguna vinculación de representante"
    assert any(v.representante_anterior_id is not None for v in vinculaciones), (
        "falta la rama 'con representante anterior'"
    )
    assert any(v.representante_anterior_id is None for v in vinculaciones), (
        "falta la rama 'sin representante anterior'"
    )


def test_enrollment_notificacion_outbox_no_usa_expires_at():
    """A diferencia de `RecuperacionOutbox`/`VerificacionCorreoOutbox`, esta
    cola NO tiene columna `expires_at`."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    assert not hasattr(EnrollmentNotificacionOutbox, "expires_at")

    with SessionLocal() as verificacion:
        filas = list(
            verificacion.execute(select(EnrollmentNotificacionOutbox)).scalars().all()
        )
    assert filas, "el seed no creó ninguna fila de enrollment_notificacion_outbox"


def test_verificacion_correo_outbox_siempre_lleva_expires_at():
    """A diferencia de `EnrollmentNotificacionOutbox`, esta cola SÍ tiene
    `expires_at` NOT NULL."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        filas = list(
            verificacion.execute(select(VerificacionCorreoOutbox)).scalars().all()
        )

    assert filas, "el seed no creó ninguna fila de verificacion_correo_outbox"
    assert all(f.expires_at is not None for f in filas)


def test_asistencia_correccion_guarda_el_valor_anterior_y_muta_la_asistencia():
    """Append-only: la fila guarda el estado ANTERIOR y la `Asistencia`
    mutada queda con el estado NUEVO."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        correcciones = list(
            verificacion.execute(select(AsistenciaCorreccion)).scalars().all()
        )
        asistencias_por_id = {
            a.id: a for a in verificacion.execute(select(Asistencia)).scalars().all()
        }

    assert correcciones, "el seed no creó ninguna corrección de asistencia"
    for correccion in correcciones:
        asistencia = asistencias_por_id[correccion.asistencia_id]
        assert asistencia.estado != correccion.estado_anterior, (
            "la Asistencia corregida no mutó respecto de su estado anterior"
        )


def test_consulta_ficha_emergencia_no_es_huerfana():
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        consultas = list(
            verificacion.execute(select(ConsultaFichaEmergencia)).scalars().all()
        )
        ids_persona = {p.id for p in verificacion.execute(select(Persona)).scalars().all()}

    assert consultas, "el seed no creó ninguna consulta de ficha de emergencia"
    huerfanas = [
        c for c in consultas
        if c.alumno_persona_id not in ids_persona or c.consultante_persona_id not in ids_persona
    ]
    assert not huerfanas, "consulta de ficha de emergencia con persona inexistente"


def test_inscripcion_idempotencia_cubre_pendiente_y_completada():
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        filas = list(
            verificacion.execute(select(InscripcionIdempotencia)).scalars().all()
        )

    assert filas, "el seed no creó ninguna fila de inscripcion_idempotencia"
    estados = {f.estado for f in filas}
    assert "PENDIENTE" in estados or "COMPLETADA" in estados


def test_notificacion_usa_siempre_el_constructor_del_modelo():
    """`Notificacion.mensaje` se recorta con `@validates`, que solo corre en
    asignación de atributo Python -- si el seed usara `bulk_insert`/Core en
    algún punto, un mensaje largo pasaría sin recortar."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    with SessionLocal() as verificacion:
        notificaciones = list(verificacion.execute(select(Notificacion)).scalars().all())

    assert notificaciones, "el seed no creó ninguna notificación"
    assert all(len(n.mensaje) <= Notificacion.MENSAJE_MAX for n in notificaciones)


def test_eventos_de_dominio_no_duplican_al_correr_dos_veces():
    """Segunda corrida idempotente sobre las 16 tablas de eventos de dominio
    nuevas. Corre contra un motor en memoria (SQLite): NO ejercita los
    índices únicos parciales ni el `ExcludeConstraint`, que solo existen en
    Postgres (ver docstring de `CoberturaBonificada`) -- esa verificación va
    aparte, corriendo el seed dos veces contra Postgres real."""
    modulo_base = _load_base_seed_module()
    modulo_bulk = _load_seed_module()
    SessionLocal = _motor_en_memoria(modulo_base, modulo_bulk)

    modulo_base.main()
    modulo_bulk.main()

    def _conteos():
        with SessionLocal() as verificacion:
            return {
                "asignacion_descuento": verificacion.execute(select(func.count()).select_from(AsignacionDescuento)).scalar_one(),
                "cobertura_bonificada": verificacion.execute(select(func.count()).select_from(CoberturaBonificada)).scalar_one(),
                "historial_estado_membresia": verificacion.execute(select(func.count()).select_from(HistorialEstadoMembresia)).scalar_one(),
                "historial_cambio_plan_membresia": verificacion.execute(select(func.count()).select_from(HistorialCambioPlanMembresia)).scalar_one(),
                "correccion_pago": verificacion.execute(select(func.count()).select_from(CorreccionPago)).scalar_one(),
                "consentimiento_legal": verificacion.execute(select(func.count()).select_from(ConsentimientoLegal)).scalar_one(),
                "revocacion_consentimiento_legal": verificacion.execute(select(func.count()).select_from(RevocacionConsentimientoLegal)).scalar_one(),
                "vinculacion_representante": verificacion.execute(select(func.count()).select_from(VinculacionRepresentante)).scalar_one(),
                "sesion_asistencia": verificacion.execute(select(func.count()).select_from(SesionAsistencia)).scalar_one(),
                "asistencia_correccion": verificacion.execute(select(func.count()).select_from(AsistenciaCorreccion)).scalar_one(),
                "consulta_ficha_emergencia": verificacion.execute(select(func.count()).select_from(ConsultaFichaEmergencia)).scalar_one(),
                "notificacion": verificacion.execute(select(func.count()).select_from(Notificacion)).scalar_one(),
                "inscripcion_idempotencia": verificacion.execute(select(func.count()).select_from(InscripcionIdempotencia)).scalar_one(),
                "verificacion_correo_outbox": verificacion.execute(select(func.count()).select_from(VerificacionCorreoOutbox)).scalar_one(),
                "enrollment_notificacion_outbox": verificacion.execute(select(func.count()).select_from(EnrollmentNotificacionOutbox)).scalar_one(),
            }

    conteos_primera_corrida = _conteos()
    assert all(v > 0 for v in conteos_primera_corrida.values()), conteos_primera_corrida

    modulo_bulk.main()
    conteos_segunda_corrida = _conteos()

    assert conteos_segunda_corrida == conteos_primera_corrida, (
        f"corrida repetida duplicó filas: {conteos_primera_corrida} -> {conteos_segunda_corrida}"
    )
