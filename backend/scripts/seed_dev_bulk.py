"""Dev-only bulk seed: generates a moderate-volume, realistic dataset to
manually test every flow end-to-end (admin dashboard, members, groups,
payments, attendance, trainer ranking, student portal).

Unlike seed_dev_base.py which runs automatically on container start and
creates the minimum viable dataset, this script must be run manually:

    docker compose exec backend uv run python scripts/seed_dev_bulk.py

It depends on seed_dev_base.py having already run at least once (needs the
ENTRENADOR account, the 11 NivelRanking rows, the 26 HorarioEntrenamiento
schedules, and the 2 TipoMembresia rows it creates). If any of those are
missing, this script prints a warning and skips the dependent section instead
of crashing.

Creates (idempotent -- safe to run multiple times, following the same
`_obtener_o_crear` check-before-insert pattern as seed_dev_base.py):

  - ~16 representante (parent) accounts, each with 1-4 managed children.
  - ~20 self-managed adult student accounts (student IS their own payer).
  - Total students across everyone: ~55-65.
  - Students spread across all 11 real niveles de ranking; a handful left
    unassigned (nivel_ranking_id = None) to exercise "sin grupo" in /groups.
  - Membresias in a mix of estados (ACTIVA / VENCIDA / INACTIVA), across both
    TipoMembresia categories seeded by seed_dev_base.py.
  - Pagos in a mix of estados (APROBADO / PENDIENTE_VALIDACION / RECHAZADO),
    with a ComprobantePago for some approved payments and a voucher attached
    to pending ones, so /payments has a real validation queue.
  - Asistencia across the trainer's first 3 horarios, for the last 4 sessions
    of each, mixing PRESENTE / AUSENTE / ATRASADO / JUSTIFICADO.

Login with (shared password for every bulk account):
  password: alumno123
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

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
    NivelRanking,
    Ranking,
    Asistencia,
    AlumnoHorario,
)
from app.dominio.enums import (
    TipoRol,
    EstadoMembresia,
    EstadoPago,
    TipoPago,
    EstadoAsistencia,
    DiaSemana,
)
from app.seguridad.gestor_auth import GestorAutenticacion

CONTRASENIA_COMPARTIDA = "alumno123"
DEFAULT_SEED_VOUCHER_BASE_URL = "https://placehold.co/600x400.png?text=Cata+Club+Voucher"


def voucher_fixture_url() -> str:
    """Return the environment-approved URL used by dev payment fixtures."""
    return os.environ.get("SEED_VOUCHER_BASE_URL", "").strip() or DEFAULT_SEED_VOUCHER_BASE_URL

# ---------------------------------------------------------------------------
# Rango de cédulas propio para este seed: 0000000001-0000000005 ya están
# tomadas por seed_dev_admin.py / seed_dev_base.py (admin, entrenador, Ana,
# Luis, Maria). Arrancamos en 1000000001 para garantizar cero colisiones,
# incluso si este script corre contra una BD ya sembrada por esos otros dos.
# ---------------------------------------------------------------------------
CEDULA_BASE = 1_000_000_000

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

# Números de nivel reales sembrados por seed_dev_base.py (1..11).
NUMEROS_NIVEL = list(range(1, 12))


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
    return str(CEDULA_BASE + indice)


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
    representante_id: int | None,
) -> tuple[Persona, bool]:
    """Crea (o recupera) Persona + Usuario con rol ALUMNO. Devuelve
    (persona, fue_creada_ahora)."""
    nombre = _nombre_para(indice, femenino)
    apellido = _apellido_para(indice)
    cedula = _cedula_para(indice)
    telefono = _telefono_para(indice)
    correo = _correo_para(nombre, apellido, indice)

    existing_user = db.query(Usuario).filter(Usuario.correo == correo).first()
    if existing_user:
        return existing_user.persona, False

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

    usuario = Usuario(
        correo=correo,
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(CONTRASENIA_COMPARTIDA),
        persona_id=persona.id,
        roles=[rol_alumno],
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
        roles=[rol_representante, rol_alumno],
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


def _asignar_ranking(db, persona: Persona, indice: int, niveles: dict[int, NivelRanking]) -> Ranking | None:
    """Crea (si no existe) la fila de Ranking. Deja sin nivel (nivel_ranking_id
    = None) uno de cada 9 alumnos, para ejercitar "sin grupo" en /groups."""
    existente = db.query(Ranking).filter(Ranking.persona_id == persona.id).first()
    if existente:
        return existente

    sin_grupo = (indice % 9 == 0)
    nivel_id = None
    if not sin_grupo and niveles:
        numero = NUMEROS_NIVEL[indice % len(NUMEROS_NIVEL)]
        nivel = niveles.get(numero)
        nivel_id = nivel.id if nivel else None

    ranking = Ranking(
        persona_id=persona.id,
        nivel_ranking_id=nivel_id,
        esta_en_ranking=True,
        puntaje_acumulado=0,
    )
    db.add(ranking)
    db.flush()
    return ranking


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

        niveles = {
            n.numero_nivel: n
            for n in db.query(NivelRanking).filter(NivelRanking.numero_nivel.in_(NUMEROS_NIVEL)).all()
        }
        if len(niveles) < len(NUMEROS_NIVEL):
            print(
                "[seed] AVISO: no se encontraron los 11 NivelRanking esperados "
                "(corra primero seed_dev_base.py). La asignación de nivel "
                "usará solo los niveles disponibles."
            )

        tipo_infantil = db.query(TipoMembresia).filter(TipoMembresia.categoria == "Mensual Infantil").first()
        tipo_adultos = db.query(TipoMembresia).filter(TipoMembresia.categoria == "Mensual Adultos").first()
        if not tipo_infantil or not tipo_adultos:
            print(
                "[seed] AVISO: no se encontraron los TipoMembresia de "
                "seed_dev_base.py -- las membresías/pagos se omitirán."
            )

        entrenador_usuario = db.query(Usuario).filter(Usuario.correo == "entrenador@cataclub.com").first()
        horarios_entrenador: list[HorarioEntrenamiento] = []
        if entrenador_usuario:
            horarios_entrenador = (
                db.query(HorarioEntrenamiento)
                .filter(HorarioEntrenamiento.entrenador_id == entrenador_usuario.persona_id)
                .order_by(HorarioEntrenamiento.id)
                .limit(3)
                .all()
            )
        if not entrenador_usuario or not horarios_entrenador:
            print(
                "[seed] AVISO: no se encontró el Entrenador o sus horarios "
                "(corra primero seed_dev_base.py). La asistencia se omitirá."
            )

        # ------------------------------------------------------------------
        # 1. Representantes + hijos gestionados
        # ------------------------------------------------------------------
        indice = 0
        representantes_creados = 0
        hijos_creados = 0
        estudiantes: list[tuple[Persona, bool]] = []  # (persona, es_nueva)

        for cantidad_hijos in HIJOS_POR_REPRESENTANTE:
            representante, es_nuevo = _crear_representante(db, indice, rol_representante, rol_alumno)
            if es_nuevo:
                representantes_creados += 1
            indice += 1

            for _ in range(cantidad_hijos):
                edad = 8 + (indice % 9)  # 8..16 años
                hijo, es_nuevo_hijo = _crear_persona_y_usuario(
                    db, rol_alumno, indice, femenino=(indice % 2 == 1),
                    edad_anios=edad, representante_id=representante.id,
                )
                if es_nuevo_hijo:
                    hijos_creados += 1
                if tipo_infantil:
                    _asignar_membresia_y_pago(db, hijo, tipo_infantil, indice)
                estudiantes.append((hijo, es_nuevo_hijo))
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
            indice += 1

        db.flush()

        # ------------------------------------------------------------------
        # 3. Ranking (asignación de nivel, unos pocos sin grupo)
        # ------------------------------------------------------------------
        for i, (persona, _) in enumerate(estudiantes):
            _asignar_ranking(db, persona, i, niveles)
        db.flush()

        # ------------------------------------------------------------------
        # 4. Asistencia histórica (últimas 4 sesiones de los primeros 3
        #    horarios del entrenador), para un subconjunto de alumnos.
        # ------------------------------------------------------------------
        asistencias_creadas = 0
        if entrenador_usuario and horarios_entrenador:
            estudiantes_con_asistencia = [p for p, _ in estudiantes[:24]]
            estados_ciclo = [
                EstadoAsistencia.PRESENTE, EstadoAsistencia.PRESENTE,
                EstadoAsistencia.AUSENTE, EstadoAsistencia.ATRASADO,
                EstadoAsistencia.PRESENTE, EstadoAsistencia.JUSTIFICADO,
            ]
            for horario in horarios_entrenador:
                # Inscribir ANTES de registrar asistencia. Sin esto el seed
                # producía un estado que la propia API no puede generar: la
                # única vía real de alta es `asignar_alumno_a_horario`, y
                # `GET /asistencias/horarios/{id}/alumnos` lee solo
                # `alumno_horario` -- así que el roster de "tomar asistencia"
                # salía vacío de los mismos alumnos que `GET
                # /asistencias/reportes` sí listaba, y las dos pantallas se
                # contradecían.
                for persona in estudiantes_con_asistencia:
                    _obtener_o_crear(
                        db,
                        AlumnoHorario,
                        (AlumnoHorario.persona_id == persona.id)
                        & (AlumnoHorario.horario_id == horario.id),
                        {"persona_id": persona.id, "horario_id": horario.id},
                    )

                fechas = _fechas_recientes(horario.dia_semana, 4)
                for f_idx, fecha in enumerate(fechas):
                    for p_idx, persona in enumerate(estudiantes_con_asistencia):
                        estado = estados_ciclo[(p_idx + f_idx) % len(estados_ciclo)]
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
                        es_justificado = estado == EstadoAsistencia.JUSTIFICADO
                        asistencia = Asistencia(
                            fecha_entrenamiento=fecha,
                            estado=estado,
                            justificativo="Cita médica" if es_justificado else None,
                            estado_justificativo=True if es_justificado else None,
                            persona_id=persona.id,
                            entrenador_id=entrenador_usuario.persona_id,
                            horario_id=horario.id,
                        )
                        db.add(asistencia)
                        asistencias_creadas += 1
        db.flush()

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
        print(f"[seed] Alumnos auto-gestionados creados en esta corrida: {autogestionados_creados}")
        print(f"[seed] Total de estudiantes conocidos (nuevos + ya existentes): {total_estudiantes}")
        print(f"[seed] Registros de asistencia creados: {asistencias_creadas}")
        print(f"[seed] Contraseña compartida para TODAS las cuentas de este seed: {CONTRASENIA_COMPARTIDA}")
        if muestras_correo:
            print(f"[seed] Correos de ejemplo para probar login: {', '.join(muestras_correo)}")
        print("[seed] Entrenador: entrenador@cataclub.com / trainer12345")
        print("[seed] Admin: admin@cataclub.com / admin12345")
    finally:
        db.close()


if __name__ == "__main__":
    main()
