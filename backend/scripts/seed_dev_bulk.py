"""Dev-only bulk seed: generates a moderate-volume, realistic dataset to
manually test every flow end-to-end (admin dashboard, members, groups,
payments, attendance, student portal).

Unlike seed_dev_base.py which runs automatically on container start and
creates the minimum viable dataset, this script must be run manually:

    docker compose exec backend uv run python scripts/seed_dev_bulk.py

It depends on seed_dev_base.py having already run at least once (needs the
ENTRENADOR account, the 26 HorarioEntrenamiento schedules, and the 2
TipoMembresia rows it creates). If any of those are missing, this script
prints a warning and skips the dependent section instead of crashing.

Creates (idempotent -- safe to run multiple times, following the same
`_obtener_o_crear` check-before-insert pattern as seed_dev_base.py):

  - ~16 representante (parent) accounts, each with 1-4 managed children.
  - ~20 self-managed adult student accounts (student IS their own payer).
  - Total students across everyone: ~55-65.
  - Membresias in a mix of estados (ACTIVA / VENCIDA / INACTIVA), across both
    TipoMembresia categories seeded by seed_dev_base.py.
  - Pagos in a mix of estados (APROBADO / PENDIENTE_VALIDACION / RECHAZADO),
    with a ComprobantePago for some approved payments and a voucher attached
    to pending ones, so /payments has a real validation queue.
  - Asistencia across the trainer's first 3 horarios, for the last 4 sessions
    of each, mixing PRESENTE / AUSENTE / ATRASADO / JUSTIFICADO.
  - Domain events across 16 tables that had zero rows in QA before this
    section existed: discount assignments and their bonified coverage,
    membership status/plan history, payment corrections, legal consents
    (with and without a represented minor) and their revocations,
    representative-link events, one attendance session per (horario, fecha)
    grouping existing Asistencia, attendance corrections, emergency-card
    lookups, in-app notifications, enrollment idempotency, and the email
    verification / enrollment-notification outbox queues. Crucially, some
    managed children are created WITHOUT their own `Usuario` row (the
    "managed child" the domain already models but that never appeared in any
    seeded database).

Login with (shared password for every bulk account):
  password: alumno123
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.infraestructura.db import SessionLocal
from app.dominio.modelos import (
    Persona,
    Usuario,
    Rol,
    Membresia,
    TipoMembresia,
    Pago,
    ComprobantePago,
    HorarioEntrenamiento,
    Asistencia,
    AlumnoHorario,
    FichaMedica,
    Institucion,
    Sponsor,
    Descuento,
    Enfermedades,
    AsignacionDescuento,
    CoberturaBonificada,
    HistorialEstadoMembresia,
    HistorialCambioPlanMembresia,
    CorreccionPago,
    ConsentimientoLegal,
    RevocacionConsentimientoLegal,
    VinculacionRepresentante,
    SesionAsistencia,
    AsistenciaCorreccion,
    ConsultaFichaEmergencia,
    Notificacion,
    InscripcionIdempotencia,
    VerificacionCorreoOutbox,
    EnrollmentNotificacionOutbox,
)
from app.dominio.enums import (
    TipoRol,
    EstadoMembresia,
    EstadoPago,
    TipoPago,
    EstadoAsistencia,
    DiaSemana,
    TipoSangre,
    TipoEscuela,
    TipoNotificacion,
    EfectoCoberturaCorreccion,
)
from app.seguridad.gestor_auth import GestorAutenticacion
from app.dominio.cedula import cedula_valida
from app.soporte_transversal.configuracion import settings
from app.servicios_negocio.consentimiento_legal_servicio import (
    DOCUMENTOS_LEGALES,
    VERSION_LEGAL_VIGENTE,
    TEXTOS_LEGALES_VIGENTES,
)
from scripts.seed_guard import SeedNoPermitidoError, validar_seed_permitido

CONTRASENIA_COMPARTIDA = "alumno123"
DEFAULT_SEED_VOUCHER_BASE_URL = "https://placehold.co/600x400.png?text=Cata+Club+Voucher"
DEFAULT_SEED_SPONSOR_LOGO_URL = "https://placehold.co/300x150.png?text=Cata+Club+Sponsor"

# Duplicados a propósito, mismo criterio que `CEDULA_SECUENCIA_BASE` de abajo:
# este script no importa `seed_dev_base.py` (son módulos cargados por
# separado en los tests, vía `importlib`), así que referencia las cuentas que
# ese script siembra por su correo literal en vez de acoplarse a sus
# constantes internas.
ADMIN_CORREO = "admin@cataclub.com"
TRAINER_CORREO = "entrenador@cataclub.com"


def voucher_fixture_url() -> str:
    """Return the environment-approved URL used by dev payment fixtures."""
    return os.environ.get("SEED_VOUCHER_BASE_URL", "").strip() or DEFAULT_SEED_VOUCHER_BASE_URL


def sponsor_logo_fixture_url() -> str:
    """Return the environment-approved URL used by dev sponsor logo fixtures.

    En producción el logo lo genera Cloudinary; un `logo_public_id`
    inventado que apunte ahí rompería cualquier endpoint que intente
    resolverlo, así que este seed nunca inventa uno -- ver
    `SPONSORS_SEED` más abajo, donde el `logo_public_id` lleva el prefijo
    `seed/` para dejar explícito que es un fixture, no un asset real."""
    return os.environ.get("SEED_SPONSOR_LOGO_BASE_URL", "").strip() or DEFAULT_SEED_SPONSOR_LOGO_URL

# ---------------------------------------------------------------------------
# Rango de secuencia propio para este seed: `cedula_valida` acepta cualquier
# entero, así que un offset alcanza para garantizar cero colisiones con
# seed_dev_base.py (que usa secuencia 1-14 para admin/entrenador/alumnos/
# representantes), incluso si este script corre contra una BD ya sembrada
# por ese otro.
# ---------------------------------------------------------------------------
CEDULA_SECUENCIA_BASE = 1_000

DIA_A_WEEKDAY = {
    DiaSemana.LUNES: 0,
    DiaSemana.MARTES: 1,
    DiaSemana.MIERCOLES: 2,
    DiaSemana.JUEVES: 3,
    DiaSemana.VIERNES: 4,
    DiaSemana.SABADO: 5,
    DiaSemana.DOMINGO: 6,
}

NOMBRES_FEMENINOS = [
    "Valentina", "Camila", "Isabella", "Emily", "Sofia", "Ariana", "Domenica",
    "Nayeli", "Melany", "Anahi", "Britany", "Scarlett", "Genesis", "Dayana",
    "Alison", "Nicole", "Jazmin", "Katherine", "Mishell", "Yamileth",
]
NOMBRES_MASCULINOS = [
    "Mateo", "Sebastian", "Emilio", "Dylan", "Joaquin", "Alexander", "Ismael",
    "Santiago", "Bryan", "Kevin", "Anthony", "Jefferson", "Erick",
    "Cristopher", "Josue", "Adrian", "Leonel", "Jhon", "Jostin", "Steven",
]
APELLIDOS = [
    "Vera", "Chavez", "Zambrano", "Moreira", "Loor", "Cedeno", "Intriago",
    "Delgado", "Bravo", "Alcivar", "Mendoza", "Velez", "Macias", "Ponce",
    "Rivadeneira", "Salazar", "Andrade", "Vinces", "Pilay", "Solorzano",
    "Quimis", "Sabando", "Sornoza", "Zamora",
]

# Cuántos hijos gestiona cada representante (16 representantes -> 39 hijos).
HIJOS_POR_REPRESENTANTE = [3, 2, 4, 1, 3, 2, 4, 1, 2, 3, 2, 4, 1, 3, 2, 2]

# Alumnos adultos auto-gestionados (sin representante): son su propio
# responsable de pago, matching la regla de dominio ya documentada en el
# frontend (members/page.tsx).
CANTIDAD_AUTOGESTIONADOS = 20

# ---------------------------------------------------------------------------
# Catálogos (issue de QA con 0 dev seed): institución educativa, sponsor y
# descuento.
# ---------------------------------------------------------------------------
INSTITUCIONES_SEED = [
    {"nombre": "Unidad Educativa Particular Bilingüe San Andrés", "tipo_escuela": TipoEscuela.PARTICULAR},
    {"nombre": "Escuela Fiscal Eloy Alfaro", "tipo_escuela": TipoEscuela.FISCAL},
    {"nombre": "Unidad Educativa Fiscomisional La Dolorosa", "tipo_escuela": TipoEscuela.FISCOMISIONAL},
    {"nombre": "Colegio Municipal Sucre", "tipo_escuela": TipoEscuela.MUNICIPAL},
]

# `logo_public_id` con prefijo `seed/`: deja explícito que es un fixture y
# nunca colisiona con un asset real subido por el admin vía Cloudinary.
SPONSORS_SEED = [
    {"nombre": "Deportivo Litoral", "logo_public_id": "seed/sponsor-logo-deportivo-litoral"},
    {"nombre": "Nutrideportes", "logo_public_id": "seed/sponsor-logo-nutrideportes"},
    {"nombre": "Ferretería Manabí", "logo_public_id": "seed/sponsor-logo-ferreteria-manabi"},
]

# Prefijo "Seed - " para no chocar jamás con los nombres que crean en
# runtime `discounts.live.spec.ts` (prefijo "QA descuento ") ni
# `payments.live.spec.ts` -- ambos corren contra el mismo stack de QA que
# este seed. `descuento.nombre` es UNIQUE.
DESCUENTOS_SEED = [
    {"nombre": "Seed - Beca deportiva", "porcentaje": Decimal("15.00")},
    {"nombre": "Seed - Descuento hermanos", "porcentaje": Decimal("10.00")},
    {"nombre": "Seed - Bono fundacional", "monto": Decimal("5.00")},
]

ENFERMEDADES_SEED = ["Asma", "Rinitis alérgica", "Diabetes tipo 1", "Epilepsia"]


def _obtener_o_crear(db, modelo, filtro, defaults):
    """Return existing row or create a new one (idempotent helper, same
    pattern as seed_dev_base.py)."""
    obj = db.query(modelo).filter(filtro).first()
    if obj:
        return obj, False
    obj = modelo(**defaults)
    db.add(obj)
    db.flush()
    return obj, True


def _nombre_para(indice: int, femenino: bool) -> str:
    lista = NOMBRES_FEMENINOS if femenino else NOMBRES_MASCULINOS
    return lista[indice % len(lista)]


def _apellido_para(indice: int) -> str:
    primero = APELLIDOS[indice % len(APELLIDOS)]
    segundo = APELLIDOS[(indice * 5 + 3) % len(APELLIDOS)]
    return f"{primero} {segundo}"


def _cedula_para(indice: int) -> str:
    return cedula_valida(CEDULA_SECUENCIA_BASE + indice)


def _telefono_para(indice: int) -> str:
    return f"09{indice:08d}"


def _correo_para(nombre: str, apellido: str, indice: int) -> str:
    apellido_simple = apellido.split(" ")[0].lower()
    return f"{nombre.lower()}{apellido_simple}{indice}@cataclub.com"


def _fechas_recientes(dia_semana: DiaSemana, cantidad: int) -> list[date]:
    """Últimas `cantidad` fechas (estrictamente pasadas) que caen en el
    día de la semana indicado, contando hacia atrás desde ayer."""
    objetivo = DIA_A_WEEKDAY[dia_semana]
    fechas: list[date] = []
    cursor = date.today() - timedelta(days=1)
    while len(fechas) < cantidad:
        if cursor.weekday() == objetivo:
            fechas.append(cursor)
        cursor -= timedelta(days=1)
    return fechas


def _fecha_nacimiento_hace(edad_anios: int) -> date:
    """Cumpleaños de hoy hace `edad_anios` años. Cae hacia el 28 de febrero
    si hoy es 29 de febrero y el año resultante no es bisiesto."""
    hoy = date.today()
    try:
        return hoy.replace(year=hoy.year - edad_anios)
    except ValueError:
        return hoy.replace(year=hoy.year - edad_anios, day=28)


def _crear_persona_y_usuario(
    db, rol_alumno, indice: int, femenino: bool, edad_anios: int,
    representante_id: int | None, crear_usuario: bool = True,
) -> tuple[Persona, bool]:
    """Crea (o recupera) Persona + Usuario con rol ALUMNO. Devuelve
    (persona, fue_creada_ahora).

    `crear_usuario=False` produce el "hijo gestionado" que el dominio
    contempla pero que ninguna base de QA tenía todavía: una `Persona` con
    `representante_id` y SIN fila en `usuario` -- exactamente lo que
    `EnrollmentServicio.enroll` deja cuando el representante NO manda
    `alumno.correo`/`alumno.contrasenia` (issue de QA con 0 hijos sin cuenta
    sobre 86 personas). Un hijo así nunca inicia sesión por su cuenta; sus
    consentimientos legales y su historial quedan bajo la cuenta de su
    representante, igual que en el flujo real."""
    nombre = _nombre_para(indice, femenino)
    apellido = _apellido_para(indice)
    cedula = _cedula_para(indice)
    telefono = _telefono_para(indice)
    correo = _correo_para(nombre, apellido, indice)

    if crear_usuario:
        existing_user = db.query(Usuario).filter(Usuario.correo == correo).first()
        if existing_user:
            return existing_user.persona, False
    else:
        existing_persona = db.query(Persona).filter(Persona.cedula == cedula).first()
        if existing_persona:
            return existing_persona, False

    fecha_nacimiento = _fecha_nacimiento_hace(edad_anios)

    persona, _ = _obtener_o_crear(
        db,
        Persona,
        Persona.cedula == cedula,
        {
            "nombres": nombre,
            "apellidos": apellido,
            "cedula": cedula,
            "fecha_nacimiento": fecha_nacimiento,
            "telefono": telefono,
            "representante_id": representante_id,
        },
    )

    if not crear_usuario:
        return persona, True

    usuario = Usuario(
        correo=correo,
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(CONTRASENIA_COMPARTIDA),
        persona_id=persona.id,
        roles=[rol_alumno],
        # Cuenta creada por el club, no autoinscripta: el razonamiento completo
        # está en el docstring de `seed_dev_base.py` (issue #790).
        correo_verificado=True,
    )
    db.add(usuario)
    db.flush()
    return persona, True


def _crear_representante(
    db,
    indice: int,
    rol_representante: Rol,
    rol_alumno: Rol,
) -> tuple[Persona, bool]:
    """Crea (o recupera) un representante con roles REPRESENTANTE + ALUMNO,
    replicando la asignación del enrollment service real."""
    nombre = _nombre_para(indice, femenino=(indice % 2 == 0))
    apellido = _apellido_para(indice)
    cedula = _cedula_para(indice)
    telefono = _telefono_para(indice)
    correo = _correo_para(nombre, apellido, indice)

    existing_user = db.query(Usuario).filter(Usuario.correo == correo).first()
    if existing_user:
        return existing_user.persona, False

    fecha_nacimiento = _fecha_nacimiento_hace(38)

    persona, _ = _obtener_o_crear(
        db,
        Persona,
        Persona.cedula == cedula,
        {
            "nombres": nombre,
            "apellidos": apellido,
            "cedula": cedula,
            "fecha_nacimiento": fecha_nacimiento,
            "telefono": telefono,
        },
    )

    usuario = Usuario(
        correo=correo,
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(CONTRASENIA_COMPARTIDA),
        persona_id=persona.id,
        # Issue #762: un solo rol activo por cuenta.
        roles=[rol_representante],
        # Verificada por la misma razón que el resto del seed: la crea el
        # club. Sin esto, un representante sembrado no puede vincular a nadie
        # -- que es justamente el flujo que el dataset grande existe para
        # poder probar. Ver el docstring de `seed_dev_base.py`.
        correo_verificado=True,
    )
    db.add(usuario)
    db.flush()
    return persona, True


def _asignar_membresia_y_pago(
    db, persona: Persona, tipo_membresia: TipoMembresia, indice: int,
) -> None:
    """Crea, si no existe todavía, una Membresia + un Pago para esta persona.
    Idempotente por chequeo de existencia previa (una membresía por alumno,
    como en seed_dev_base.py)."""
    existente = db.query(Membresia).filter(Membresia.persona_id == persona.id).first()
    if existente:
        return

    hoy = date.today()
    ahora = datetime.now(timezone.utc)
    patron = indice % 4  # 0=ACTIVA+APROBADO, 1=VENCIDA+APROBADO(expirado),
    # 2=INACTIVA+PENDIENTE_VALIDACION, 3=INACTIVA+RECHAZADO

    if patron == 0:
        estado_membresia = EstadoMembresia.ACTIVA
    elif patron == 1:
        estado_membresia = EstadoMembresia.VENCIDA
    else:
        estado_membresia = EstadoMembresia.INACTIVA

    # fecha_activacion: para VENCIDA refleja cuándo se aprobó realmente el
    # pago que la activó (coherente con el Pago histórico creado abajo). Para
    # ACTIVA/INACTIVA se deja "ahora" como placeholder -- mismo criterio que
    # MembresiaServicio.crear_membresia usa para membresías aún no aprobadas.
    fecha_activacion = ahora - timedelta(days=45) if patron == 1 else ahora

    membresia = Membresia(
        estado=estado_membresia,
        monto_aplicado=tipo_membresia.precio,
        fecha_activacion=fecha_activacion,
        persona_id=persona.id,
        tipo_membresia_id=tipo_membresia.id,
    )
    db.add(membresia)
    db.flush()

    tipo_pago = TipoPago.TRANSFERENCIA if indice % 2 == 0 else TipoPago.EFECTIVO

    if patron == 0:
        pago = Pago(
            monto=tipo_membresia.precio,
            estado_pago=EstadoPago.APROBADO,
            tipo_pago=tipo_pago,
            fecha_validacion=ahora,
            fecha_inicio=hoy.replace(day=1),
            fecha_fin=hoy + timedelta(days=20),
            persona_id=persona.id,
            membresia_id=membresia.id,
        )
        db.add(pago)
        db.flush()
        if indice % 2 == 0:
            db.add(ComprobantePago(
                archivo_url=voucher_fixture_url(),
                formato_archivo="application/pdf",
                pago_id=pago.id,
            ))
    elif patron == 1:
        fecha_fin_vencida = hoy - timedelta(days=15)
        db.add(Pago(
            monto=tipo_membresia.precio,
            estado_pago=EstadoPago.APROBADO,
            tipo_pago=tipo_pago,
            fecha_validacion=ahora - timedelta(days=45),
            fecha_inicio=fecha_fin_vencida - timedelta(days=30),
            fecha_fin=fecha_fin_vencida,
            persona_id=persona.id,
            membresia_id=membresia.id,
        ))
    elif patron == 2:
        db.add(Pago(
            monto=tipo_membresia.precio,
            estado_pago=EstadoPago.PENDIENTE_VALIDACION,
            tipo_pago=TipoPago.TRANSFERENCIA,
            fecha_inicio=hoy.replace(day=1),
            fecha_fin=hoy + timedelta(days=20),
            persona_id=persona.id,
            membresia_id=membresia.id,
            voucher_url=voucher_fixture_url(),
            voucher_formato="image/jpeg",
            voucher_fecha_carga=ahora,
        ))
    else:
        db.add(Pago(
            monto=tipo_membresia.precio,
            estado_pago=EstadoPago.RECHAZADO,
            tipo_pago=TipoPago.TRANSFERENCIA,
            motivo_rechazo="Voucher ilegible; se solicitó reenviar comprobante",
            fecha_validacion=ahora,
            fecha_inicio=hoy.replace(day=1),
            fecha_fin=hoy + timedelta(days=20),
            persona_id=persona.id,
            membresia_id=membresia.id,
            voucher_url=voucher_fixture_url(),
            voucher_formato="image/jpeg",
            voucher_fecha_carga=ahora - timedelta(days=2),
        ))
    db.flush()


def _sembrar_instituciones(db) -> list[Institucion]:
    """Catálogo de instituciones, cubriendo los cuatro valores de
    `TipoEscuela`. Idempotente por `nombre`."""
    instituciones: list[Institucion] = []
    for datos in INSTITUCIONES_SEED:
        institucion, _ = _obtener_o_crear(
            db, Institucion, Institucion.nombre == datos["nombre"], dict(datos),
        )
        instituciones.append(institucion)
    db.flush()
    return instituciones


def _sembrar_sponsors(db) -> None:
    """Idempotente por `logo_public_id` (UNIQUE)."""
    for datos in SPONSORS_SEED:
        _obtener_o_crear(
            db, Sponsor, Sponsor.logo_public_id == datos["logo_public_id"],
            {
                "nombre": datos["nombre"],
                "logo_url": sponsor_logo_fixture_url(),
                "logo_public_id": datos["logo_public_id"],
            },
        )
    db.flush()


def _sembrar_descuentos(db) -> list[Descuento]:
    """Idempotente por `nombre` (UNIQUE). Respeta el CHECK XOR
    porcentaje/monto pasando explícitamente el que no aplica como `None`.
    Devuelve el catálogo sembrado, para que `AsignacionDescuento` tenga de
    dónde elegir sin volver a consultar la tabla."""
    descuentos: list[Descuento] = []
    for datos in DESCUENTOS_SEED:
        descuento, _ = _obtener_o_crear(
            db, Descuento, Descuento.nombre == datos["nombre"],
            {
                "nombre": datos["nombre"],
                "porcentaje": datos.get("porcentaje"),
                "monto": datos.get("monto"),
            },
        )
        descuentos.append(descuento)
    db.flush()
    return descuentos


def _sembrar_enfermedades(db) -> int:
    """Cuelga condiciones médicas de fichas médicas YA EXISTENTES, siempre
    vía `ficha.enfermedades.append(...)` -- nunca crea `Enfermedades`
    sueltas, porque la relación es `cascade="all, delete-orphan"` desde
    `FichaMedica.enfermedades`. Idempotente: no repite un nombre ya colgado
    de la misma ficha."""
    creadas = 0
    fichas = db.query(FichaMedica).order_by(FichaMedica.id).all()
    for f_idx, ficha in enumerate(fichas):
        if f_idx % 2 != 0:
            # Variedad: no todas las fichas cargadas tienen una condición
            # registrada -- el caso "sin enfermedades" también es real.
            continue
        nombre = ENFERMEDADES_SEED[f_idx % len(ENFERMEDADES_SEED)]
        if any(e.nombre_enfermedad == nombre for e in ficha.enfermedades):
            continue
        ficha.enfermedades.append(Enfermedades(nombre_enfermedad=nombre))
        creadas += 1
    db.flush()
    return creadas


def _asignar_institucion(db, instituciones: list[Institucion]) -> int:
    """Backfill (UPDATE, nunca INSERT) de `institucion_id` sobre las
    `Persona` existentes. Deja deliberadamente una de cada tres sin el
    campo: el caso "sin institución" también tiene que existir en QA.
    Idempotente porque solo toca personas cuyo campo sigue en NULL -- una
    segunda corrida no reasigna ni pisa nada."""
    actualizadas = 0
    personas = db.query(Persona).order_by(Persona.id).all()
    for idx, persona in enumerate(personas):
        if idx % 3 == 2:
            continue
        if persona.institucion_id is None and instituciones:
            persona.institucion_id = instituciones[idx % len(instituciones)].id
            actualizadas += 1
    db.flush()
    return actualizadas


# ---------------------------------------------------------------------------
# Eventos de dominio (issue de QA con 0 dev seed): a diferencia de los
# catálogos de arriba, estos modelos tienen invariantes que un INSERT mal
# hecho viola en silencio (CHECK, EXCLUDE, UNIQUE parciales) -- ver el
# docstring de cada función para el invariante puntual que respeta.
# ---------------------------------------------------------------------------
def _sembrar_historial_estado_membresia(db, admin_persona: Optional[Persona]) -> int:
    """Ciclo ACTIVA -> SUSPENDIDA (-> ACTIVA para la mitad) sobre membresías
    ACTIVA ya sembradas (issue #400). Nunca escribe una transición hacia
    VENCIDA: esa la genera el batch de vencimientos con un UPDATE directo que
    no deja historial (`vencimientos_tareas.py`), y duplicarla acá inventaría
    una fila que el sistema real jamás produce. Siempre con actor y motivo,
    igual que el único camino de escritura real
    (`MembresiaPagoServicio`)."""
    if admin_persona is None:
        return 0
    creadas = 0
    ahora = datetime.now(timezone.utc)
    # Pool ESTABLE (ordenado por id, sin filtrar por estado): filtrar por
    # `estado == ACTIVA` directo en la consulta corría la ventana en la
    # segunda corrida -- procesar una membresía cambia su estado, libera un
    # cupo del `.limit(6)` original, y una membresía nunca antes considerada
    # lo ocupaba, así que la segunda corrida creaba historial de nuevo. Con
    # el pool fijo por id, la membresía ya procesada sigue OCUPANDO su lugar
    # (el chequeo `ya_tiene` la salta sin liberar cupo para otra).
    pool = db.query(Membresia).order_by(Membresia.id).all()
    procesadas = 0
    for membresia in pool:
        if procesadas >= 6:
            break
        ya_tiene = (
            db.query(HistorialEstadoMembresia)
            .filter(HistorialEstadoMembresia.membresia_id == membresia.id)
            .first()
        )
        if ya_tiene:
            procesadas += 1
            continue
        if membresia.estado != EstadoMembresia.ACTIVA:
            continue
        db.add(HistorialEstadoMembresia(
            membresia_id=membresia.id,
            estado_anterior=EstadoMembresia.ACTIVA,
            estado_nuevo=EstadoMembresia.SUSPENDIDA,
            fecha_efectiva=ahora - timedelta(days=5),
            actor_persona_id=admin_persona.id,
            motivo="Suspensión temporal por ausencia prolongada (seed)",
        ))
        if procesadas % 2 == 0:
            # Mitad del pool queda SUSPENDIDA de verdad, para que QA tenga el
            # estado visible en /members y no solo en el historial.
            membresia.estado = EstadoMembresia.SUSPENDIDA
        else:
            # La otra mitad completa el ciclo y vuelve a ACTIVA.
            db.add(HistorialEstadoMembresia(
                membresia_id=membresia.id,
                estado_anterior=EstadoMembresia.SUSPENDIDA,
                estado_nuevo=EstadoMembresia.ACTIVA,
                fecha_efectiva=ahora,
                actor_persona_id=admin_persona.id,
                motivo="Reactivación tras regularizar la ausencia (seed)",
            ))
        procesadas += 1
        creadas += 1
    db.flush()
    return creadas


def _sembrar_historial_cambio_plan(
    db, tipo_infantil: Optional[TipoMembresia], tipo_adultos: Optional[TipoMembresia],
    admin_persona: Optional[Persona],
) -> int:
    """Cambio prospectivo de plan sobre una `Membresia` YA existente (issue
    #400, criterio 1) -- nunca dado de baja + alta, mismo criterio que
    `MembresiaServicio.cambiar_plan`. `actor_persona_id` siempre un admin: no
    existe un camino del sistema que cambie el plan por su cuenta."""
    if admin_persona is None or tipo_infantil is None or tipo_adultos is None:
        return 0
    creadas = 0
    # Mismo criterio (y mismo bug evitado) que `_sembrar_historial_estado_
    # membresia`: filtrar por `tipo_membresia_id == tipo_infantil.id` directo
    # en la consulta corre la ventana en la segunda corrida, porque procesar
    # una membresía la muta a `tipo_adultos` y libera un cupo que una
    # membresía nunca antes considerada terminaba ocupando.
    pool = db.query(Membresia).order_by(Membresia.id).all()
    procesadas = 0
    for membresia in pool:
        if procesadas >= 3:
            break
        ya_tiene = (
            db.query(HistorialCambioPlanMembresia)
            .filter(HistorialCambioPlanMembresia.membresia_id == membresia.id)
            .first()
        )
        if ya_tiene:
            procesadas += 1
            continue
        if membresia.tipo_membresia_id != tipo_infantil.id:
            continue
        db.add(HistorialCambioPlanMembresia(
            membresia_id=membresia.id,
            tipo_membresia_id_anterior=tipo_infantil.id,
            tipo_membresia_id_nuevo=tipo_adultos.id,
            actor_persona_id=admin_persona.id,
        ))
        # Espejo del criterio de `HistorialEstadoMembresia`: la fila auditable
        # es nueva, pero la `Membresia` SÍ muta al plan nuevo.
        membresia.tipo_membresia_id = tipo_adultos.id
        procesadas += 1
        creadas += 1
    db.flush()
    return creadas


def _sembrar_asignaciones_descuento(
    db, estudiantes: list[tuple[Persona, bool]], descuentos: list[Descuento],
    admin_persona: Optional[Persona],
) -> list[AsignacionDescuento]:
    """Beneficios personales vigentes (issue #398) para un subconjunto de
    estudiantes, más UNA asignación ya retirada (cubre el CHECK
    `ck_asignacion_retiro_completo`: actor y fecha de retiro siempre juntos).
    Idempotente por persona: el índice único parcial de la base solo admite
    una VIGENTE por persona, así que no reasigna a quien ya tiene una."""
    if admin_persona is None or not descuentos:
        return []
    asignaciones: list[AsignacionDescuento] = []
    ahora = datetime.now(timezone.utc)

    for idx, (persona, _) in enumerate(estudiantes):
        if idx % 10 != 0:
            continue
        existente = db.query(AsignacionDescuento).filter(
            AsignacionDescuento.persona_id == persona.id
        ).first()
        if existente:
            asignaciones.append(existente)
            continue
        asignacion = AsignacionDescuento(
            persona_id=persona.id,
            descuento_id=descuentos[idx % len(descuentos)].id,
            asignado_por_persona_id=admin_persona.id,
            asignado_en=ahora,
        )
        db.add(asignacion)
        db.flush()
        asignaciones.append(asignacion)

    # Un beneficio YA retirado, en una persona fuera del muestreo de arriba
    # (índice fijo 1, nunca múltiplo de 10) -- cubre la rama "retirado" del
    # CHECK sin competir con el índice único parcial de "vigente".
    if len(estudiantes) > 1:
        persona_retirada, _ = estudiantes[1]
        ya_tiene = db.query(AsignacionDescuento).filter(
            AsignacionDescuento.persona_id == persona_retirada.id
        ).first()
        if ya_tiene:
            asignaciones.append(ya_tiene)
        else:
            retirada = AsignacionDescuento(
                persona_id=persona_retirada.id,
                descuento_id=descuentos[0].id,
                asignado_por_persona_id=admin_persona.id,
                asignado_en=ahora - timedelta(days=60),
                retirado_por_persona_id=admin_persona.id,
                retirado_en=ahora - timedelta(days=10),
            )
            db.add(retirada)
            db.flush()
            asignaciones.append(retirada)

    db.flush()
    return asignaciones


def _sembrar_cobertura_bonificada(db, asignaciones: list[AsignacionDescuento]) -> int:
    """Cobertura otorgada por un beneficio 100% personal (issue #400, slice
    4d) -- NUNCA crea un `Pago`. Solo una por membresía (idempotencia por
    `membresia_id`), lo que además respeta por construcción el
    `ExcludeConstraint` anti-solape: con un único período por membresía no
    hay con qué solaparse."""
    creadas = 0
    hoy = date.today()
    for asignacion in asignaciones:
        if asignacion.retirado_en is not None:
            continue  # un beneficio retirado ya no cubre ningún período nuevo.
        membresia = db.query(Membresia).filter(
            Membresia.persona_id == asignacion.persona_id
        ).first()
        if membresia is None:
            continue
        ya_tiene = db.query(CoberturaBonificada).filter(
            CoberturaBonificada.membresia_id == membresia.id
        ).first()
        if ya_tiene:
            continue
        tipo = db.query(TipoMembresia).filter(
            TipoMembresia.id == membresia.tipo_membresia_id
        ).first()
        descuento = db.query(Descuento).filter(Descuento.id == asignacion.descuento_id).first()
        if tipo is None or descuento is None:
            continue
        if descuento.porcentaje is not None:
            valor = (tipo.precio * descuento.porcentaje / Decimal("100")).quantize(Decimal("0.01"))
            porcentaje = descuento.porcentaje
        else:
            valor = descuento.monto
            porcentaje = None
        persona = db.query(Persona).filter(Persona.id == asignacion.persona_id).first()
        # Autoservicio del propio pagador o su representante -- NUNCA un
        # administrador actuando "por" ellos (docstring del modelo).
        otorgante_id = persona.representante_id if persona and persona.representante_id else asignacion.persona_id
        db.add(CoberturaBonificada(
            membresia_id=membresia.id,
            persona_id=asignacion.persona_id,
            asignacion_descuento_id=asignacion.id,
            tarifa_mensual_aplicada=tipo.precio,
            meses_comprados=1,
            descuento_valor_aplicado=valor,
            descuento_porcentaje_aplicado=porcentaje,
            fecha_inicio=hoy.replace(day=1),
            fecha_fin=hoy + timedelta(days=27),
            otorgada_por_persona_id=otorgante_id,
        ))
        creadas += 1
    db.flush()
    return creadas


def _sembrar_correccion_pago(db, admin_persona: Optional[Persona]) -> int:
    """Corrección financiera auditable (issue #400, slice 5b) sobre `Pago`
    YA APROBADO. Muta el `Pago` (conserva su `id`, nunca crea uno nuevo) y dos
    campos SIEMPRE cambian juntos (monto + fecha_fin), lo que respeta el
    CHECK `ck_correccion_pago_algun_campo_cambia` sin necesidad de tocar los
    campos nullable del snapshot pre-#400."""
    if admin_persona is None:
        return 0
    creadas = 0
    pagos = (
        db.query(Pago)
        .filter(Pago.estado_pago == EstadoPago.APROBADO)
        .order_by(Pago.id)
        .limit(4)
        .all()
    )
    for pago in pagos:
        ya_tiene = db.query(CorreccionPago).filter(CorreccionPago.pago_id == pago.id).first()
        if ya_tiene:
            continue
        monto_anterior = pago.monto
        monto_nuevo = monto_anterior - Decimal("5.00")
        fecha_fin_anterior = pago.fecha_fin
        fecha_fin_nuevo = fecha_fin_anterior + timedelta(days=5)
        db.add(CorreccionPago(
            pago_id=pago.id,
            monto_anterior=monto_anterior,
            monto_nuevo=monto_nuevo,
            fecha_inicio_anterior=pago.fecha_inicio,
            fecha_inicio_nuevo=pago.fecha_inicio,
            fecha_fin_anterior=fecha_fin_anterior,
            fecha_fin_nuevo=fecha_fin_nuevo,
            efecto_cobertura=EfectoCoberturaCorreccion.AMPLIADA,
            motivo="Ajuste administrativo de tarifa mal calculada (seed)",
            actor_persona_id=admin_persona.id,
        ))
        pago.monto = monto_nuevo
        pago.fecha_fin = fecha_fin_nuevo
        creadas += 1
    db.flush()
    return creadas


def _sembrar_consentimientos_legales(
    db,
    pares_representante_hijo: list[tuple[Persona, Persona]],
    autogestionados: list[Persona],
) -> tuple[int, list[ConsentimientoLegal]]:
    """Cubre las DOS formas del UNIQUE compuesto de `consentimiento_legal`
    (issue INS legal): con `representado_persona_id` (aceptación en nombre de
    un hijo -- el `cuenta_id` es el del REPRESENTANTE, nunca el del hijo,
    tenga o no `Usuario` propio) y sin él (autoinscripción/alta directa).
    INMUTABLE: solo crea la primera vez, nunca actualiza -- el listener
    `before_update` del modelo lanza `ValueError` ante cualquier intento."""
    creadas = 0
    registros: list[ConsentimientoLegal] = []

    for representante, hijo in pares_representante_hijo:
        cuenta = representante.usuario
        if cuenta is None:
            continue
        for documento in DOCUMENTOS_LEGALES:
            existente = db.query(ConsentimientoLegal).filter(
                (ConsentimientoLegal.cuenta_id == cuenta.id)
                & (ConsentimientoLegal.documento == documento)
                & (ConsentimientoLegal.version_documento == VERSION_LEGAL_VIGENTE)
                & (ConsentimientoLegal.representado_persona_id == hijo.id)
            ).first()
            if existente:
                registros.append(existente)
                continue
            registro = ConsentimientoLegal(
                cuenta_id=cuenta.id,
                representado_persona_id=hijo.id,
                documento=documento,
                version_documento=VERSION_LEGAL_VIGENTE,
                texto_aceptado=TEXTOS_LEGALES_VIGENTES[documento],
            )
            db.add(registro)
            db.flush()
            registros.append(registro)
            creadas += 1

    for adulto in autogestionados:
        cuenta = adulto.usuario
        if cuenta is None:
            continue
        for documento in DOCUMENTOS_LEGALES:
            existente = db.query(ConsentimientoLegal).filter(
                (ConsentimientoLegal.cuenta_id == cuenta.id)
                & (ConsentimientoLegal.documento == documento)
                & (ConsentimientoLegal.version_documento == VERSION_LEGAL_VIGENTE)
                & (ConsentimientoLegal.representado_persona_id.is_(None))
            ).first()
            if existente:
                registros.append(existente)
                continue
            registro = ConsentimientoLegal(
                cuenta_id=cuenta.id,
                representado_persona_id=None,
                documento=documento,
                version_documento=VERSION_LEGAL_VIGENTE,
                texto_aceptado=TEXTOS_LEGALES_VIGENTES[documento],
            )
            db.add(registro)
            db.flush()
            registros.append(registro)
            creadas += 1

    db.flush()
    return creadas, registros


def _sembrar_revocaciones_consentimiento(
    db, registros: list[ConsentimientoLegal],
) -> int:
    """Retiro prospectivo (nunca edita el snapshot aceptado). Revoca a lo
    sumo UN documento por cuenta distinta -- `consentimiento_id` es UNIQUE en
    `revocacion_consentimiento_legal`.

    La SELECCIÓN de qué cuentas revocar tiene que ser estable entre
    corridas, separada de si esa cuenta YA tiene revocación: cortar el bucle
    con `creadas >= 2` (contando solo lo nuevo) hacía que la segunda corrida,
    al encontrar las dos cuentas de la primera ya revocadas, seguía buscando
    ADELANTE hasta topar con dos cuentas nunca antes vistas y las revocaba
    también -- duplicando de a dos revocaciones en cada corrida."""
    creadas = 0
    cuentas_seleccionadas: set[int] = set()
    for registro in registros:
        if registro.cuenta_id not in cuentas_seleccionadas and len(cuentas_seleccionadas) >= 2:
            break
        if registro.cuenta_id in cuentas_seleccionadas:
            continue
        cuentas_seleccionadas.add(registro.cuenta_id)
        existente = db.query(RevocacionConsentimientoLegal).filter(
            RevocacionConsentimientoLegal.consentimiento_id == registro.id
        ).first()
        if existente:
            continue
        db.add(RevocacionConsentimientoLegal(
            consentimiento_id=registro.id,
            cuenta_id=registro.cuenta_id,
            motivo="Retiro de consentimiento a pedido del titular (seed)",
        ))
        creadas += 1
    db.flush()
    return creadas


def _sembrar_vinculaciones_representante(
    db, pares_representante_hijo: list[tuple[Persona, Persona]],
) -> int:
    """Log de eventos append-only (INS-2): cubre las dos ramas de
    `representante_anterior_id` -- con valor (cambio de representante) y NULL
    (el representado no tenía uno antes). Nunca muta `Persona.
    representante_id`: esta tabla es la traza histórica, no el estado
    actual."""
    if len(pares_representante_hijo) < 2:
        return 0
    creadas = 0
    rep_a, hijo_a = pares_representante_hijo[0]
    rep_b, _hijo_b = pares_representante_hijo[1]

    ya_existe = db.query(VinculacionRepresentante).filter(
        VinculacionRepresentante.persona_id == hijo_a.id
    ).first()
    if not ya_existe:
        db.add(VinculacionRepresentante(
            persona_id=hijo_a.id,
            representante_anterior_id=rep_a.id,
            representante_nuevo_id=rep_b.id,
        ))
        creadas += 1

    if len(pares_representante_hijo) >= 3:
        rep_c, hijo_c = pares_representante_hijo[2]
        ya_existe_huerfano = db.query(VinculacionRepresentante).filter(
            VinculacionRepresentante.persona_id == hijo_c.id
        ).first()
        if not ya_existe_huerfano:
            db.add(VinculacionRepresentante(
                persona_id=hijo_c.id,
                representante_anterior_id=None,
                representante_nuevo_id=rep_c.id,
            ))
            creadas += 1

    db.flush()
    return creadas


def _sembrar_sesiones_asistencia(db, cerrada_por_persona: Optional[Persona]) -> int:
    """Agrupa las `Asistencia` YA existentes por (horario_id,
    fecha_entrenamiento) y crea EXACTAMENTE una `SesionAsistencia` por grupo
    (issue #389, slice 1). Insertar una por asistencia rompería en cuanto el
    segundo alumno de la misma sesión intentara la suya: el UNIQUE compuesto
    de la tabla solo admite una fila por sesión."""
    if cerrada_por_persona is None:
        return 0
    creadas = 0
    grupos = (
        db.query(Asistencia.horario_id, Asistencia.fecha_entrenamiento)
        .distinct()
        .all()
    )
    for horario_id, fecha in grupos:
        existente = db.query(SesionAsistencia).filter(
            (SesionAsistencia.horario_id == horario_id)
            & (SesionAsistencia.fecha_entrenamiento == fecha)
        ).first()
        if existente:
            continue
        db.add(SesionAsistencia(
            horario_id=horario_id,
            fecha_entrenamiento=fecha,
            cerrada_por_id=cerrada_por_persona.id,
        ))
        creadas += 1
    db.flush()
    return creadas


def _sembrar_correcciones_asistencia(db, corregido_por_persona: Optional[Persona]) -> int:
    """Traza append-only de corrección (issue #389, slice 2): guarda el valor
    ANTERIOR y muta la `Asistencia` al valor nuevo -- el valor nuevo nunca se
    duplica en esta tabla, ya vive en la fila mutada."""
    if corregido_por_persona is None:
        return 0
    creadas = 0
    # Mismo criterio (y mismo bug evitado) que `_sembrar_historial_estado_
    # membresia`: filtrar por `estado == AUSENTE` directo en la consulta
    # corre la ventana en la segunda corrida, porque procesar una asistencia
    # la muta a PRESENTE y libera un cupo que una asistencia nunca antes
    # considerada terminaba ocupando.
    pool = db.query(Asistencia).order_by(Asistencia.id).all()
    procesadas = 0
    for asistencia in pool:
        if procesadas >= 3:
            break
        ya_tiene = db.query(AsistenciaCorreccion).filter(
            AsistenciaCorreccion.asistencia_id == asistencia.id
        ).first()
        if ya_tiene:
            procesadas += 1
            continue
        if asistencia.estado != EstadoAsistencia.AUSENTE:
            continue
        db.add(AsistenciaCorreccion(
            asistencia_id=asistencia.id,
            corregido_por_id=corregido_por_persona.id,
            motivo="El alumno sí asistió; error de tipeo al tomar lista (seed)",
            estado_anterior=asistencia.estado,
            justificativo_anterior=asistencia.justificativo,
            estado_justificativo_anterior=asistencia.estado_justificativo,
        ))
        asistencia.estado = EstadoAsistencia.PRESENTE
        procesadas += 1
        creadas += 1
    db.flush()
    return creadas


def _sembrar_consultas_ficha_emergencia(db, consultante_persona: Optional[Persona]) -> int:
    """Registro OBSERVACIONAL (issue #360): quién consultó la ficha de
    emergencia de quién, nunca una compuerta de acceso."""
    if consultante_persona is None:
        return 0
    creadas = 0
    fichas = db.query(FichaMedica).order_by(FichaMedica.id).limit(5).all()
    for ficha in fichas:
        existente = db.query(ConsultaFichaEmergencia).filter(
            (ConsultaFichaEmergencia.alumno_persona_id == ficha.persona_id)
            & (ConsultaFichaEmergencia.consultante_persona_id == consultante_persona.id)
        ).first()
        if existente:
            continue
        db.add(ConsultaFichaEmergencia(
            alumno_persona_id=ficha.persona_id,
            consultante_persona_id=consultante_persona.id,
        ))
        creadas += 1
    db.flush()
    return creadas


def _sembrar_notificaciones(db, estudiantes: list[tuple[Persona, bool]]) -> int:
    """Notificación in-app genérica. Siempre vía el constructor del modelo
    (nunca `bulk_insert`/Core): `Notificacion.mensaje` se recorta con
    `@validates`, que solo corre en asignación de atributo Python."""
    if not estudiantes:
        return 0
    creadas = 0
    tipos_ciclo = [
        TipoNotificacion.PAGO_APROBADO,
        TipoNotificacion.PAGO_RECHAZADO,
        TipoNotificacion.NUEVA_INSCRIPCION,
        TipoNotificacion.MIEMBRESIA_VENCIMIENTO_PROXIMO,
    ]
    for idx, (persona, _) in enumerate(estudiantes[:5]):
        tipo = tipos_ciclo[idx % len(tipos_ciclo)]
        existente = db.query(Notificacion).filter(
            (Notificacion.persona_id == persona.id) & (Notificacion.tipo == tipo)
        ).first()
        if existente:
            continue
        db.add(Notificacion(
            tipo=tipo,
            mensaje=f"Notificación de ejemplo ({tipo.value}) generada por el seed.",
            persona_id=persona.id,
        ))
        creadas += 1
    db.flush()
    return creadas


def _sembrar_inscripcion_idempotencia(db, estudiantes: list[tuple[Persona, bool]]) -> int:
    """Una fila por intento de inscripción pública. TTL de 24h, mismo
    criterio que el mecanismo real (`InscripcionIdempotencia.vence_en`)."""
    if not estudiantes:
        return 0
    creadas = 0
    ahora = datetime.now(timezone.utc)
    for idx, (persona, _) in enumerate(estudiantes[:3]):
        key = f"seed-inscripcion-{persona.cedula}"
        existente = db.query(InscripcionIdempotencia).filter(
            InscripcionIdempotencia.idempotency_key == key
        ).first()
        if existente:
            continue
        estado = "PENDIENTE" if idx == 0 else "COMPLETADA"
        db.add(InscripcionIdempotencia(
            idempotency_key=key,
            request_fingerprint=f"seed-fingerprint-{persona.cedula}",
            estado=estado,
            persona_id=persona.id if estado == "COMPLETADA" else None,
            completed_at=ahora if estado == "COMPLETADA" else None,
            vence_en=ahora + timedelta(hours=24),
        ))
        creadas += 1
    db.flush()
    return creadas


def _sembrar_verificacion_correo_outbox(db, cuentas: list[Usuario]) -> int:
    """Cola durable de verificación de correo. A diferencia de
    `EnrollmentNotificacionOutbox`, esta SÍ lleva `expires_at` (NOT NULL)."""
    creadas = 0
    ahora = datetime.now(timezone.utc)
    for usuario in cuentas:
        existente = db.query(VerificacionCorreoOutbox).filter(
            VerificacionCorreoOutbox.usuario_id == usuario.id
        ).first()
        if existente:
            continue
        db.add(VerificacionCorreoOutbox(
            usuario_id=usuario.id,
            status="ENVIADO",
            sent_at=ahora,
            expires_at=ahora + timedelta(hours=24),
        ))
        creadas += 1
    db.flush()
    return creadas


def _sembrar_enrollment_notificacion_outbox(
    db, admin_persona: Optional[Persona], estudiantes: list[tuple[Persona, bool]],
) -> int:
    """A diferencia de `RecuperacionOutbox`/`VerificacionCorreoOutbox`, esta
    cola NO lleva `expires_at` -- nunca intentar setearla acá. Idempotente
    por el UNIQUE compuesto `(admin_persona_id, alumno_persona_id)`."""
    if admin_persona is None or not estudiantes:
        return 0
    creadas = 0
    for persona, _ in estudiantes[:3]:
        existente = db.query(EnrollmentNotificacionOutbox).filter(
            (EnrollmentNotificacionOutbox.admin_persona_id == admin_persona.id)
            & (EnrollmentNotificacionOutbox.alumno_persona_id == persona.id)
        ).first()
        if existente:
            continue
        db.add(EnrollmentNotificacionOutbox(
            admin_persona_id=admin_persona.id,
            alumno_persona_id=persona.id,
            mensaje=f"Nueva inscripción registrada para {persona.nombres} (seed).",
            status="ENVIADO",
        ))
        creadas += 1
    db.flush()
    return creadas


def main() -> None:
    db = SessionLocal()
    try:
        # ------------------------------------------------------------------
        # 0. Dependencias sembradas por seed_dev_base.py
        # ------------------------------------------------------------------
        rol_alumno, _ = _obtener_o_crear(
            db, Rol, Rol.tipo_rol == TipoRol.ALUMNO,
            {"tipo_rol": TipoRol.ALUMNO, "descripcion": "Alumno"},
        )
        rol_representante, _ = _obtener_o_crear(
            db, Rol, Rol.tipo_rol == TipoRol.REPRESENTANTE,
            {"tipo_rol": TipoRol.REPRESENTANTE, "descripcion": "Representante"},
        )

        tipo_infantil = db.query(TipoMembresia).filter(TipoMembresia.categoria == "Mensual Infantil").first()
        tipo_adultos = db.query(TipoMembresia).filter(TipoMembresia.categoria == "Mensual Adultos").first()
        if not tipo_infantil or not tipo_adultos:
            print(
                "[seed] AVISO: no se encontraron los TipoMembresia de "
                "seed_dev_base.py -- las membresías/pagos se omitirán."
            )

        admin_usuario = db.query(Usuario).filter(Usuario.correo == ADMIN_CORREO).first()
        admin_persona = admin_usuario.persona if admin_usuario else None
        trainer_usuario = db.query(Usuario).filter(Usuario.correo == TRAINER_CORREO).first()
        trainer_persona = trainer_usuario.persona if trainer_usuario else None
        if admin_persona is None or trainer_persona is None:
            print(
                "[seed] AVISO: no se encontró el admin/entrenador de "
                "seed_dev_base.py -- los eventos de dominio que requieren un "
                "actor (historiales, correcciones, notificaciones de outbox) "
                "se omitirán."
            )

        # ------------------------------------------------------------------
        # 0.5. Catálogos sin dependencia de eventos de dominio: institución
        #      educativa, sponsor, descuento. Ninguno de los tres depende de
        #      los estudiantes que este script crea más abajo, así que se
        #      siembran antes.
        # ------------------------------------------------------------------
        instituciones_seed = _sembrar_instituciones(db)
        _sembrar_sponsors(db)
        descuentos_seed = _sembrar_descuentos(db)

        # Sin relación entrenador–horario (issue #13): la asistencia se
        # siembra sobre los horarios del club, sin titular.
        #
        # Agrupados POR CATEGORÍA y no `.limit(3)` por id: la inscripción es
        # atómica por categoría desde el issue #181 -- un alumno está en TODOS
        # los días de su categoría o en ninguno. Tomar los tres primeros
        # horarios sembraba justo el estado que esa regla prohíbe (Formativo
        # con lunes/martes/miércoles y sin jueves/viernes), y la API ya no
        # puede producirlo, así que el entorno de QA mostraba un caso
        # imposible en producción.
        horarios_por_categoria: dict[str, list[HorarioEntrenamiento]] = {}
        for horario in db.query(HorarioEntrenamiento).order_by(HorarioEntrenamiento.id).all():
            horarios_por_categoria.setdefault(horario.categoria, []).append(horario)

        # Orden estable: el seed debe producir la misma base en cada corrida.
        categorias_con_horario = sorted(horarios_por_categoria)
        if not categorias_con_horario:
            print(
                "[seed] AVISO: no se encontraron horarios "
                "(corra primero seed_dev_base.py). La asistencia se omitirá."
            )

        # ------------------------------------------------------------------
        # 1. Representantes + hijos gestionados
        # ------------------------------------------------------------------
        indice = 0
        representantes_creados = 0
        hijos_creados = 0
        hijos_sin_cuenta_creados = 0
        estudiantes: list[tuple[Persona, bool]] = []  # (persona, es_nueva)
        pares_representante_hijo: list[tuple[Persona, Persona]] = []
        autogestionados: list[Persona] = []

        for rep_idx, cantidad_hijos in enumerate(HIJOS_POR_REPRESENTANTE):
            representante, es_nuevo = _crear_representante(db, indice, rol_representante, rol_alumno)
            if es_nuevo:
                representantes_creados += 1
            indice += 1

            for hijo_pos in range(cantidad_hijos):
                edad = 8 + (indice % 9)  # 8..16 años
                # El primer hijo de cada representante de índice par queda
                # SIN cuenta propia: el "hijo gestionado" que el dominio
                # contempla (menor sin login, todo pasa por su representante)
                # pero que ninguna base de QA tenía -- la única ruta real que
                # lo produce es `EnrollmentServicio.enroll` cuando el
                # representante no manda credenciales del menor
                # (`enrollment_servicio.py:284-286`), y el bulk anterior
                # creaba `Usuario` siempre, así que el caso nunca ocurría.
                crear_usuario = not (hijo_pos == 0 and rep_idx % 2 == 0)
                hijo, es_nuevo_hijo = _crear_persona_y_usuario(
                    db, rol_alumno, indice, femenino=(indice % 2 == 1),
                    edad_anios=edad, representante_id=representante.id,
                    crear_usuario=crear_usuario,
                )
                if es_nuevo_hijo:
                    hijos_creados += 1
                    if not crear_usuario:
                        hijos_sin_cuenta_creados += 1
                if tipo_infantil:
                    _asignar_membresia_y_pago(db, hijo, tipo_infantil, indice)
                estudiantes.append((hijo, es_nuevo_hijo))
                pares_representante_hijo.append((representante, hijo))
                indice += 1

        # ------------------------------------------------------------------
        # 2. Alumnos adultos auto-gestionados
        # ------------------------------------------------------------------
        autogestionados_creados = 0
        for _ in range(CANTIDAD_AUTOGESTIONADOS):
            edad = 19 + (indice % 20)  # 19..38 años
            adulto, es_nuevo = _crear_persona_y_usuario(
                db, rol_alumno, indice, femenino=(indice % 2 == 0),
                edad_anios=edad, representante_id=None,
            )
            if es_nuevo:
                autogestionados_creados += 1
            if tipo_adultos:
                _asignar_membresia_y_pago(db, adulto, tipo_adultos, indice)
            estudiantes.append((adulto, es_nuevo))
            autogestionados.append(adulto)
            indice += 1

        db.flush()

        # ------------------------------------------------------------------
        # 2.5. Fichas médicas (issue #362 QA seed coverage). Antes este seed
        #      no creaba NINGUNA fila en ficha_medica, así que `/members`
        #      siempre mostraba el fallback degradado ("sin datos de
        #      emergencia" en todos o en ninguno, según el bug). La mitad de
        #      los estudiantes (índice par) queda con ficha médica cargada,
        #      la otra mitad sin -- así el hueco tiene casos reales de ambos
        #      lados para revisar en QA.
        # ------------------------------------------------------------------
        fichas_creadas = 0
        for f_idx, (persona, _) in enumerate(estudiantes):
            if f_idx % 2 != 0:
                continue
            _, es_nueva_ficha = _obtener_o_crear(
                db, FichaMedica, FichaMedica.persona_id == persona.id,
                {"persona_id": persona.id, "tipo_sangre": TipoSangre.O_POSITIVO},
            )
            if es_nueva_ficha:
                fichas_creadas += 1
        db.flush()

        enfermedades_creadas = _sembrar_enfermedades(db)

        # ------------------------------------------------------------------
        # 3. Inscripción por categoría + asistencia histórica.
        #
        #    Cada alumno entra a UNA categoría y queda inscrito en TODOS sus
        #    días (regla atómica del issue #181). Las categorías se reparten
        #    round-robin para que ninguna quede sin roster: Competitivo
        #    quedaba vacío con el reparto anterior, y el panel del entrenador
        #    anunciaba "0 estudiantes inscritos" sobre su sesión en curso.
        # ------------------------------------------------------------------
        asistencias_creadas = 0
        inscripciones_creadas = 0
        if categorias_con_horario:
            estados_ciclo = [
                EstadoAsistencia.PRESENTE, EstadoAsistencia.PRESENTE,
                EstadoAsistencia.AUSENTE, EstadoAsistencia.ATRASADO,
                EstadoAsistencia.PRESENTE, EstadoAsistencia.JUSTIFICADO,
            ]
            # La asistencia histórica cubre a los primeros 24, como antes: el
            # resto queda inscrito y sin historial, que es el caso real de un
            # alumno recién matriculado.
            con_historial = {p.id for p, _ in estudiantes[:24]}

            for e_idx, (persona, _) in enumerate(estudiantes):
                categoria = categorias_con_horario[e_idx % len(categorias_con_horario)]
                horarios_del_alumno = horarios_por_categoria[categoria]

                # Inscribir ANTES de registrar asistencia. Sin esto el seed
                # producía un estado que la propia API no puede generar: la
                # única vía real de alta es `asignar_alumno_a_horario`, y
                # `GET /asistencias/horarios/{id}/alumnos` lee solo
                # `alumno_horario` -- así que el roster de "tomar asistencia"
                # salía vacío de los mismos alumnos que `GET
                # /asistencias/reportes` sí listaba, y las dos pantallas se
                # contradecían.
                for horario in horarios_del_alumno:
                    _, es_nueva = _obtener_o_crear(
                        db,
                        AlumnoHorario,
                        (AlumnoHorario.persona_id == persona.id)
                        & (AlumnoHorario.horario_id == horario.id),
                        {"persona_id": persona.id, "horario_id": horario.id},
                    )
                    if es_nueva:
                        inscripciones_creadas += 1

                if persona.id not in con_historial:
                    continue

                for horario in horarios_del_alumno:
                    fechas = _fechas_recientes(horario.dia_semana, 4)
                    for f_idx, fecha in enumerate(fechas):
                        estado = estados_ciclo[(e_idx + f_idx) % len(estados_ciclo)]
                        existe = (
                            db.query(Asistencia)
                            .filter(
                                (Asistencia.persona_id == persona.id)
                                & (Asistencia.horario_id == horario.id)
                                & (Asistencia.fecha_entrenamiento == fecha)
                            )
                            .first()
                        )
                        if existe:
                            continue
                        # `justificativo` / `estado_justificativo` quedan sin
                        # tocar a propósito: la app nunca los escribe ni los
                        # muestra ("Justificado" es una marca sin motivo,
                        # decisión de negocio del 11 de agosto -- ver ASI-2).
                        # Llenarlos acá era el propio seed inventando una
                        # "Cita médica" que ningún entrenador tipeó, y
                        # confundió a un auditor que reportó como defecto que
                        # estas columnas estuvieran vacías.
                        asistencia = Asistencia(
                            fecha_entrenamiento=fecha,
                            estado=estado,
                            persona_id=persona.id,
                            horario_id=horario.id,
                        )
                        db.add(asistencia)
                        asistencias_creadas += 1
        db.flush()

        # ------------------------------------------------------------------
        # 4. Backfill de institución sobre TODAS las personas existentes
        #    (UPDATE, no INSERT) -- issue de QA con las 86 personas del
        #    stack en NULL en el campo.
        # ------------------------------------------------------------------
        personas_actualizadas = _asignar_institucion(db, instituciones_seed)

        # ------------------------------------------------------------------
        # 5. Eventos de dominio (issue de QA con 0 dev seed en 16 tablas):
        #    invariantes delicados (CHECK, EXCLUDE, UNIQUE parciales) que un
        #    INSERT mal hecho viola en silencio -- ver el docstring de cada
        #    función para el detalle. `rol_multiple_detectado` queda
        #    deliberadamente fuera: no tiene productor en runtime y sembrarla
        #    le mete datos falsos a `scripts/remediar_rol_multiple.py`.
        # ------------------------------------------------------------------
        historial_estado_creado = _sembrar_historial_estado_membresia(db, admin_persona)
        historial_plan_creado = _sembrar_historial_cambio_plan(
            db, tipo_infantil, tipo_adultos, admin_persona,
        )
        asignaciones_descuento = _sembrar_asignaciones_descuento(
            db, estudiantes, descuentos_seed, admin_persona,
        )
        coberturas_creadas = _sembrar_cobertura_bonificada(db, asignaciones_descuento)
        correcciones_pago_creadas = _sembrar_correccion_pago(db, admin_persona)
        consentimientos_creados, consentimientos_registrados = _sembrar_consentimientos_legales(
            db, pares_representante_hijo, autogestionados,
        )
        revocaciones_creadas = _sembrar_revocaciones_consentimiento(
            db, consentimientos_registrados,
        )
        vinculaciones_creadas = _sembrar_vinculaciones_representante(
            db, pares_representante_hijo,
        )
        sesiones_asistencia_creadas = _sembrar_sesiones_asistencia(db, trainer_persona)
        correcciones_asistencia_creadas = _sembrar_correcciones_asistencia(db, trainer_persona)
        consultas_ficha_emergencia_creadas = _sembrar_consultas_ficha_emergencia(db, trainer_persona)
        notificaciones_creadas = _sembrar_notificaciones(db, estudiantes)
        inscripciones_idempotencia_creadas = _sembrar_inscripcion_idempotencia(db, estudiantes)

        cuentas_alumno_muestra: list[Usuario] = []
        for persona, _ in estudiantes:
            usuario = db.query(Usuario).filter(Usuario.persona_id == persona.id).first()
            if usuario:
                cuentas_alumno_muestra.append(usuario)
            if len(cuentas_alumno_muestra) >= 3:
                break
        verificacion_outbox_creadas = _sembrar_verificacion_correo_outbox(db, cuentas_alumno_muestra)
        enrollment_outbox_creadas = _sembrar_enrollment_notificacion_outbox(
            db, admin_persona, estudiantes,
        )

        db.commit()

        # ------------------------------------------------------------------
        # Resumen
        # ------------------------------------------------------------------
        total_estudiantes = len(estudiantes)
        muestras_correo = []
        if estudiantes:
            for p, _ in [estudiantes[0], estudiantes[len(estudiantes) // 2], estudiantes[-1]]:
                usuario = db.query(Usuario).filter(Usuario.persona_id == p.id).first()
                if usuario:
                    muestras_correo.append(usuario.correo)

        print("[seed] --- Bulk dev seed completado ---")
        print(f"[seed] Representantes creados en esta corrida: {representantes_creados} (de {len(HIJOS_POR_REPRESENTANTE)} configurados)")
        print(f"[seed] Hijos gestionados creados en esta corrida: {hijos_creados}")
        print(f"[seed]   De los cuales SIN cuenta propia (hijo gestionado): {hijos_sin_cuenta_creados}")
        print(f"[seed] Alumnos auto-gestionados creados en esta corrida: {autogestionados_creados}")
        print(f"[seed] Total de estudiantes conocidos (nuevos + ya existentes): {total_estudiantes}")
        print(f"[seed] Fichas médicas creadas en esta corrida: {fichas_creadas}")
        print(f"[seed] Enfermedades registradas en esta corrida: {enfermedades_creadas}")
        print(f"[seed] Inscripciones a horarios creadas: {inscripciones_creadas}")
        print(f"[seed] Registros de asistencia creados: {asistencias_creadas}")
        print(f"[seed] Instituciones sembradas: {len(instituciones_seed)}")
        print(f"[seed] Personas con institución backfilleadas en esta corrida: {personas_actualizadas}")
        print(
            f"[seed] Historial estado membresía: {historial_estado_creado}, "
            f"historial cambio de plan: {historial_plan_creado}"
        )
        print(
            f"[seed] Asignaciones de descuento (con las ya existentes): "
            f"{len(asignaciones_descuento)}, coberturas bonificadas: {coberturas_creadas}"
        )
        print(f"[seed] Correcciones de pago creadas: {correcciones_pago_creadas}")
        print(
            f"[seed] Consentimientos legales creados: {consentimientos_creados}, "
            f"revocaciones: {revocaciones_creadas}"
        )
        print(f"[seed] Vinculaciones de representante creadas: {vinculaciones_creadas}")
        print(
            f"[seed] Sesiones de asistencia creadas: {sesiones_asistencia_creadas}, "
            f"correcciones de asistencia: {correcciones_asistencia_creadas}"
        )
        print(f"[seed] Consultas a ficha de emergencia creadas: {consultas_ficha_emergencia_creadas}")
        print(f"[seed] Notificaciones creadas: {notificaciones_creadas}")
        print(f"[seed] Inscripciones de idempotencia creadas: {inscripciones_idempotencia_creadas}")
        print(
            f"[seed] Outbox de verificación de correo: {verificacion_outbox_creadas}, "
            f"outbox de notificación de inscripción: {enrollment_outbox_creadas}"
        )
        print(f"[seed] Contraseña compartida para TODAS las cuentas de este seed: {CONTRASENIA_COMPARTIDA}")
        if muestras_correo:
            print(f"[seed] Correos de ejemplo para probar login: {', '.join(muestras_correo)}")
        print("[seed] Entrenador: entrenador@cataclub.com / trainer12345")
        print("[seed] Admin: admin@cataclub.com / admin12345")
    finally:
        db.close()


def ejecutar_como_script() -> None:
    """Guard ANTES de sembrar; `main()` queda sin guard para los tests."""
    try:
        validar_seed_permitido(settings.ambiente, settings.database_url)
    except SeedNoPermitidoError as exc:
        print(f"Seed denegado: {exc}", file=sys.stderr)
        sys.exit(1)
    main()


if __name__ == "__main__":
    ejecutar_como_script()
