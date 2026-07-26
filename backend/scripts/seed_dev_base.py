"""Dev-only bootstrap: creates the minimum viable dataset for local testing.

Combines the former seed_dev_admin.py + seed_dev_trainer.py into a single
idempotent script that runs automatically on every container start (when
AMBIENTE=development). Safe to re-run — uses check-before-insert everywhere.

Creates:
  - 1 Admin account         (admin@cataclub.com / admin12345)
  - 1 Trainer account       (entrenador@cataclub.com / trainer12345)
  - 26 weekly schedules     (5 categories; Competitivo also runs Saturday)
  - 11 ranking levels       (1A .. 10)
  - 2 membership types      (Mensual Infantil, Mensual Adultos)
  - 2 representantes (padres/tutores): Laura con 2 hijos, Carlos con 1
  - 4 self-managed students (sin representante): Ana, Luis y Maria menores
    de edad (caso "el portal bloquea el pago"), Pedro mayor de edad (caso
    "el alumno paga por si mismo")

Login credentials:
  Admin:      admin@cataclub.com       / admin12345
  Trainer:    entrenador@cataclub.com   / trainer12345
  Representante 1: (auto-generated email) / shared_password
  Representante 2: (auto-generated email) / shared_password

For a larger dataset, run the bulk seed manually:
    docker compose exec backend uv run python scripts/seed_dev_bulk.py
"""

import os
import sys
from datetime import date, time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.infraestructura.db import SessionLocal
from datetime import datetime, timezone

from app.infraestructura.db import SessionLocal
from app.dominio.modelos import (
    Persona,
    Usuario,
    Rol,
    HorarioEntrenamiento,
    NivelRanking,
    TipoMembresia,
    Membresia,
    Pago,
    Ranking,
    AlumnoHorario,
)
from app.dominio.enums import (
    TipoRol,
    DiaSemana,
    Categoria,
    TipoModalidad,
    EstadoMembresia,
    EstadoPago,
    TipoPago,
)
from app.dominio.categoria_metadata import CATEGORIA_METADATA, dias_permitidos as dias_para
from app.seguridad.gestor_auth import GestorAutenticacion


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------
ADMIN_CEDULA = "0000000001"
ADMIN_CORREO = "admin@cataclub.com"
ADMIN_CONTRASENIA = "admin12345"

TRAINER_CEDULA = "0000000002"
TRAINER_CORREO = "entrenador@cataclub.com"
TRAINER_CONTRASENIA = "trainer12345"

# ---------------------------------------------------------------------------
# Horarios (5 categorías fijas de negocio; días permitidos varían por
# categoría -- Competitivo corre Lun-Sáb, las otras 4 solo Lun-Vie -- ver
# `app.dominio.categoria_metadata.CATEGORIA_METADATA`, única fuente de
# verdad para hora_inicio/hora_fin/días. 4 categorías x 5 días + Competitivo
# x 6 días (agrega Sábado) = 26 horarios en total).
# ---------------------------------------------------------------------------
HORARIOS = [
    (categoria, info.hora_inicio, info.hora_fin)
    for categoria, info in CATEGORIA_METADATA.items()
]

# ---------------------------------------------------------------------------
# NivelRanking (1 = best ... 11 = lowest)
# ---------------------------------------------------------------------------
NIVELES = [
    (1, "1A"),
    (2, "1B"),
    (3, "2"),
    (4, "3"),
    (5, "4"),
    (6, "5"),
    (7, "6"),
    (8, "7"),
    (9, "8"),
    (10, "9"),
    (11, "10"),
]

# ---------------------------------------------------------------------------
# TipoMembresia
# ---------------------------------------------------------------------------
MEMBRESIAS_TIPO = [
    {
        "categoria": "Mensual Infantil",
        "franja_horaria": "15:00-18:00",
        "precio": 25.00,
        "modalidad": TipoModalidad.MENSUAL,
    },
    {
        "categoria": "Mensual Adultos",
        "franja_horaria": "20:00-21:00",
        "precio": 40.00,
        "modalidad": TipoModalidad.MENSUAL,
    },
]

# ---------------------------------------------------------------------------
# Self-managed students (no representante)
#
# `edad_anios` es explícito y por alumno (antes todos compartían un
# `date(2010, 3, 10)` hardcodeado): la mayoría de edad decide a qué pantalla
# llega el portal del alumno, así que la diferencia entre menor y adulto
# tiene que verse en los datos y no quedar implícita en una constante.
#   - Menores (< 18): el portal los manda al muro "avisa a tu representante"
#     y nunca pueden registrar un pago.
#   - Adultos (>= 18) sin representante: llegan al formulario de pago real.
# ---------------------------------------------------------------------------
ALUMNOS = [
    {
        "nombres": "Ana",
        "apellidos": "Garcia",
        "cedula": "0000000003",
        "correo": "ana@cataclub.com",
        "contrasenia": "alumno123",
        "telefono": "0971111111",
        "edad_anios": 16,
        "nivel_ranking_id": 2,
        "membresia_categoria": "Mensual Infantil",
    },
    {
        "nombres": "Luis",
        "apellidos": "Lopez",
        "cedula": "0000000004",
        "correo": "luis@cataclub.com",
        "contrasenia": "alumno123",
        "telefono": "0972222222",
        "edad_anios": 16,
        "nivel_ranking_id": 1,
        "membresia_categoria": "Mensual Infantil",
    },
    {
        "nombres": "Maria",
        "apellidos": "Torres",
        "cedula": "0000000005",
        "correo": "maria@cataclub.com",
        "contrasenia": "alumno123",
        "telefono": "0973333333",
        "edad_anios": 16,
        "nivel_ranking_id": 6,
        "membresia_categoria": "Mensual Adultos",
    },
    {
        # Único alumno mayor de edad y auto-gestionado: es su propio
        # responsable de pago, así que el portal le muestra el formulario de
        # pago de verdad en vez del bloqueo por minoría de edad.
        "nombres": "Pedro",
        "apellidos": "Salgado",
        "cedula": "0000000006",
        "correo": "pedro@cataclub.com",
        "contrasenia": "alumno123",
        "telefono": "0974444444",
        "edad_anios": 27,
        "nivel_ranking_id": 5,
        "membresia_categoria": "Mensual Adultos",
    },
]

# ---------------------------------------------------------------------------
# Representantes (padres/tutores) con una LISTA de hijos.
#
# Antes cada representante declaraba un único `"hijo"`, así que la familia
# con varios dependientes no existía en ningún lado y el selector de perfil
# del portal del representante — que solo aparece a partir de 2 perfiles —
# no se podía probar. Laura tiene 2 hijos con edad, nivel y categoría de
# membresía distintos (para que el selector muestre datos realmente
# diferentes) y Carlos se queda con 1 para no perder el caso de un único
# representado.
# ---------------------------------------------------------------------------
REPRESENTANTES = [
    {
        "representante": {
            "nombres": "Laura",
            "apellidos": "Vera",
            "cedula": "0000000010",
            "correo": "laura@cataclub.com",
            "telefono": "0981000010",
        },
        "hijos": [
            {
                "nombres": "Sofia",
                "apellidos": "Vera",
                "cedula": "0000000011",
                "correo": "sofia@cataclub.com",
                "telefono": "0981000011",
                "edad_anios": 10,
                "nivel_ranking_id": 4,
                "membresia_categoria": "Mensual Infantil",
            },
            {
                "nombres": "Martin",
                "apellidos": "Vera",
                "cedula": "0000000014",
                "correo": "martin@cataclub.com",
                "telefono": "0981000014",
                "edad_anios": 16,
                "nivel_ranking_id": 7,
                "membresia_categoria": "Mensual Adultos",
            },
        ],
    },
    {
        "representante": {
            "nombres": "Carlos",
            "apellidos": "Mendoza",
            "cedula": "0000000012",
            "correo": "carlos@cataclub.com",
            "telefono": "0981000012",
        },
        "hijos": [
            {
                "nombres": "Diego",
                "apellidos": "Mendoza",
                "cedula": "0000000013",
                "correo": "diego@cataclub.com",
                "telefono": "0981000013",
                "edad_anios": 12,
                "nivel_ranking_id": 3,
                "membresia_categoria": "Mensual Infantil",
            },
        ],
    },
]


def _obtener_o_crear(db, modelo, filtro, defaults):
    """Return existing row or create a new one."""
    obj = db.query(modelo).filter(filtro).first()
    if obj:
        return obj, False
    obj = modelo(**defaults)
    db.add(obj)
    db.flush()
    return obj, True


def _fecha_nacimiento_hace(edad_anios: int) -> date:
    """Birthday today minus `edad_anios` years."""
    hoy = date.today()
    try:
        return hoy.replace(year=hoy.year - edad_anios)
    except ValueError:
        return hoy.replace(year=hoy.year - edad_anios, day=28)


def main() -> None:
    db = SessionLocal()
    try:
        # ==================================================================
        # 1. Admin
        # ==================================================================
        admin_user = db.query(Usuario).filter(Usuario.correo == ADMIN_CORREO).first()
        if admin_user:
            print(f"[seed] {ADMIN_CORREO} ya existe (usuario id={admin_user.id}) — nada que hacer.")
        else:
            admin_persona, _ = _obtener_o_crear(
                db, Persona, Persona.cedula == ADMIN_CEDULA,
                {
                    "nombres": "Admin",
                    "apellidos": "Dev",
                    "cedula": ADMIN_CEDULA,
                    "fecha_nacimiento": date(1990, 1, 1),
                    "telefono": "0999999999",
                },
            )

            rol_admin, _ = _obtener_o_crear(
                db, Rol, Rol.tipo_rol == TipoRol.ADMINISTRADOR,
                {"tipo_rol": TipoRol.ADMINISTRADOR, "descripcion": "Administrador"},
            )

            admin_usuario = Usuario(
                correo=ADMIN_CORREO,
                contrasenia=GestorAutenticacion.obtener_hash_contrasenia(ADMIN_CONTRASENIA),
                persona_id=admin_persona.id,
                roles=[rol_admin],
            )
            db.add(admin_usuario)
            db.flush()
            print(f"[seed] Admin creado: {ADMIN_CORREO} / {ADMIN_CONTRASENIA}")

        # ==================================================================
        # 2. Entrenador
        # ==================================================================
        existing_trainer = db.query(Usuario).filter(Usuario.correo == TRAINER_CORREO).first()
        if existing_trainer:
            print(f"[seed] {TRAINER_CORREO} ya existe (usuario id={existing_trainer.id}) — saltando.")
        else:
            trainer_persona, _ = _obtener_o_crear(
                db, Persona, Persona.cedula == TRAINER_CEDULA,
                {
                    "nombres": "Carlos",
                    "apellidos": "Mendoza",
                    "cedula": TRAINER_CEDULA,
                    "fecha_nacimiento": date(1985, 6, 15),
                    "telefono": "0988888888",
                },
            )

            rol_entrenador, _ = _obtener_o_crear(
                db, Rol, Rol.tipo_rol == TipoRol.ENTRENADOR,
                {"tipo_rol": TipoRol.ENTRENADOR, "descripcion": "Entrenador"},
            )

            trainer_usuario = Usuario(
                correo=TRAINER_CORREO,
                contrasenia=GestorAutenticacion.obtener_hash_contrasenia(TRAINER_CONTRASENIA),
                persona_id=trainer_persona.id,
                roles=[rol_entrenador],
            )
            db.add(trainer_usuario)
            db.flush()
            print(f"[seed] Entrenador creado: {TRAINER_CORREO} / {TRAINER_CONTRASENIA}")

        # ==================================================================
        # 3. Horarios (5 categorías; Competitivo corre Lun-Sáb = 26 filas)
        # ==================================================================
        trainer_persona_id = db.query(Usuario).filter(Usuario.correo == TRAINER_CORREO).first().persona_id
        horario_count = 0
        for categoria, h_inicio, h_fin in HORARIOS:
            for dia in dias_para(categoria):
                _, created = _obtener_o_crear(
                    db, HorarioEntrenamiento,
                    (
                        (HorarioEntrenamiento.entrenador_id == trainer_persona_id)
                        & (HorarioEntrenamiento.dia_semana == dia)
                        & (HorarioEntrenamiento.hora_inicio == h_inicio)
                    ),
                    {
                        "categoria": categoria,
                        "dia_semana": dia,
                        "hora_inicio": h_inicio,
                        "hora_fin": h_fin,
                        "entrenador_id": trainer_persona_id,
                    },
                )
                if created:
                    horario_count += 1
        print(f"[seed] Horarios creados: {horario_count} (de 26 posibles)")

        # ==================================================================
        # 4. NivelRanking (1 = best ... 11 = lowest)
        # ==================================================================
        nivel_count = 0
        for numero, nombre in NIVELES:
            _, created = _obtener_o_crear(
                db, NivelRanking,
                NivelRanking.numero_nivel == numero,
                {"numero_nivel": numero, "nombre": nombre},
            )
            if created:
                nivel_count += 1
        print(f"[seed] Niveles de ranking creados: {nivel_count} (de 11 posibles)")

        # ==================================================================
        # 5. TipoMembresia
        # ==================================================================
        tipos_membresia = {}
        for tm_data in MEMBRESIAS_TIPO:
            tm, created = _obtener_o_crear(
                db, TipoMembresia,
                TipoMembresia.categoria == tm_data["categoria"],
                tm_data,
            )
            tipos_membresia[tm_data["categoria"]] = tm
            if created:
                print(f"[seed] TipoMembresia creado: {tm_data['categoria']}")

        # ==================================================================
        # 6. Representantes + hijos
        # ==================================================================
        rol_alumno, _ = _obtener_o_crear(
            db, Rol, Rol.tipo_rol == TipoRol.ALUMNO,
            {"tipo_rol": TipoRol.ALUMNO, "descripcion": "Alumno"},
        )
        rol_representante, _ = _obtener_o_crear(
            db, Rol, Rol.tipo_rol == TipoRol.REPRESENTANTE,
            {"tipo_rol": TipoRol.REPRESENTANTE, "descripcion": "Representante"},
        )

        now = datetime.now(timezone.utc)

        representantes_creados = 0
        hijos_creados = 0

        for rep_data in REPRESENTANTES:
            rep = rep_data["representante"]
            # Representante persona: necesita los roles REPRESENTANTE (para que
            # `GestorPermisos(["REPRESENTANTE"])` y el frontend la reconozcan
            # como tal) y ALUMNO (mismo criterio que el flujo real de
            # autoinscripción, enrollment_servicio.py). El seed antes lo
            # omitía y dejaba la cuenta sin rol utilizable (-> /unauthorized
            # al loguearse).
            existing_rep_user = db.query(Usuario).filter(Usuario.correo == rep["correo"]).first()
            if existing_rep_user:
                # No basta con saltar: la asignación de roles se añadió al seed
                # DESPUÉS de que las BD de desarrollo ya estuvieran sembradas,
                # así que las cuentas creadas antes quedaron con `roles = []`
                # de forma permanente (`/auth/me` devuelve una lista vacía, el
                # frontend la mapea a "unsupported" y el login aterriza en
                # /unauthorized). Rellenar los roles que falten hace que
                # reejecutar el seed repare esas cuentas, sin duplicar los que
                # ya estén.
                faltantes = [
                    rol for rol in (rol_representante, rol_alumno)
                    if rol.tipo_rol not in {r.tipo_rol for r in existing_rep_user.roles}
                ]
                if faltantes:
                    existing_rep_user.roles.extend(faltantes)
                    nombres_faltantes = ", ".join(rol.tipo_rol.value for rol in faltantes)
                    print(
                        f"[seed] Representante {rep['correo']} ya existe — "
                        f"roles faltantes asignados: {nombres_faltantes}."
                    )
                else:
                    print(f"[seed] Representante {rep['correo']} ya existe — saltando.")
                rep_persona = existing_rep_user.persona
            else:
                rep_persona, _ = _obtener_o_crear(
                    db, Persona, Persona.cedula == rep["cedula"],
                    {
                        "nombres": rep["nombres"],
                        "apellidos": rep["apellidos"],
                        "cedula": rep["cedula"],
                        "fecha_nacimiento": _fecha_nacimiento_hace(38),
                        "telefono": rep["telefono"],
                    },
                )
                rep_usuario = Usuario(
                    correo=rep["correo"],
                    contrasenia=GestorAutenticacion.obtener_hash_contrasenia("alumno123"),
                    persona_id=rep_persona.id,
                    roles=[rol_representante, rol_alumno],
                )
                db.add(rep_usuario)
                representantes_creados += 1

            # Hijos (rol ALUMNO, enlazados al representante). Un representante
            # puede tener varios: cada uno se comprueba por separado, así que
            # añadir un hermano nuevo a la lista lo crea también en las BD que
            # ya tenían sembrados a los demás.
            for hijo in rep_data["hijos"]:
                existing_hijo_user = db.query(Usuario).filter(Usuario.correo == hijo["correo"]).first()
                if existing_hijo_user:
                    print(f"[seed] Hijo {hijo['correo']} ya existe — saltando.")
                    continue

                hijo_persona, _ = _obtener_o_crear(
                    db, Persona, Persona.cedula == hijo["cedula"],
                    {
                        "nombres": hijo["nombres"],
                        "apellidos": hijo["apellidos"],
                        "cedula": hijo["cedula"],
                        "fecha_nacimiento": _fecha_nacimiento_hace(hijo["edad_anios"]),
                        "telefono": hijo["telefono"],
                        "representante_id": rep_persona.id,
                    },
                )
                hijo_usuario = Usuario(
                    correo=hijo["correo"],
                    contrasenia=GestorAutenticacion.obtener_hash_contrasenia("alumno123"),
                    persona_id=hijo_persona.id,
                    roles=[rol_alumno],
                )
                db.add(hijo_usuario)

                # Membresia + Pago for the child
                tm = tipos_membresia.get(hijo["membresia_categoria"])
                if tm:
                    membresia = Membresia(
                        estado=EstadoMembresia.ACTIVA,
                        monto_aplicado=tm.precio,
                        fecha_activacion=now,
                        persona_id=hijo_persona.id,
                        tipo_membresia_id=tm.id,
                    )
                    db.add(membresia)
                    db.flush()

                    db.add(Pago(
                        monto=tm.precio,
                        estado_pago=EstadoPago.APROBADO,
                        tipo_pago=TipoPago.TRANSFERENCIA,
                        fecha_validacion=now,
                        fecha_inicio=date.today().replace(day=1),
                        fecha_fin=date.today().replace(day=28),
                        persona_id=hijo_persona.id,
                        membresia_id=membresia.id,
                    ))

                ranking = Ranking(
                    persona_id=hijo_persona.id,
                    nivel_ranking_id=hijo["nivel_ranking_id"],
                    esta_en_ranking=True,
                    puntaje_acumulado=0,
                )
                db.add(ranking)
                hijos_creados += 1

        print(f"[seed] Representantes creados: {representantes_creados}, Hijos creados: {hijos_creados}")

        # ==================================================================
        # 7. Self-managed students (Ana, Luis, Maria menores; Pedro adulto)
        # ==================================================================
        for alu in ALUMNOS:
            existing_user = db.query(Usuario).filter(Usuario.correo == alu["correo"]).first()
            if existing_user:
                print(f"[seed] Alumno {alu['correo']} ya existe — saltando.")
                continue

            alu_persona, _ = _obtener_o_crear(
                db, Persona, Persona.cedula == alu["cedula"],
                {
                    "nombres": alu["nombres"],
                    "apellidos": alu["apellidos"],
                    "cedula": alu["cedula"],
                    "fecha_nacimiento": _fecha_nacimiento_hace(alu["edad_anios"]),
                    "telefono": alu["telefono"],
                },
            )

            alu_usuario = Usuario(
                correo=alu["correo"],
                contrasenia=GestorAutenticacion.obtener_hash_contrasenia(alu["contrasenia"]),
                persona_id=alu_persona.id,
                roles=[rol_alumno],
            )
            db.add(alu_usuario)

            tm = tipos_membresia.get(alu["membresia_categoria"])
            if tm:
                membresia = Membresia(
                    estado=EstadoMembresia.ACTIVA,
                    monto_aplicado=tm.precio,
                    fecha_activacion=now,
                    persona_id=alu_persona.id,
                    tipo_membresia_id=tm.id,
                )
                db.add(membresia)
                # `flush()` obligatorio: el bloque 8 arma `alumno_horario` a
                # partir de una CONSULTA de membresías. Sin volcarla, la
                # sesión (autoflush desactivado) todavía no la ve y el alumno
                # recién creado se queda sin horarios hasta la corrida
                # SIGUIENTE del seed — el entrenador ve "este horario no
                # tiene alumnos asignados" en la primera. El bloque de hijos
                # ya hacía este flush; este no.
                db.flush()

            ranking = Ranking(
                persona_id=alu_persona.id,
                nivel_ranking_id=alu["nivel_ranking_id"],
                esta_en_ranking=True,
            )
            db.add(ranking)

            print(f"[seed] Alumno creado: {alu['nombres']} {alu['apellidos']} ({alu['correo']})")

        # ==================================================================
        # 8. Asignaciones alumno_horario (para que el wizard de asistencia
        # muestre estudiantes al seleccionar un horario). Sin este bloque,
        # la tabla `alumno_horario` queda vacía y `/asistencias/horarios/:id
        # /alumnos` responde `[]` para cualquier horario — el entrenador ve
        # "Este horario no tiene alumnos asignados" en todos lados.
        #
        # Asignamos cada alumno a TODOS los horarios de su categoría de
        # membresía:
        #   - "Mensual Infantil" (franja 15-18h) → FORMATIVO, INFANTIL,
        #     JUVENIL (cierren a las 18:00).
        #   - "Mensual Adultos" (franja 20-21h) → ADULTOS.
        # Idempotente: usa _obtener_o_crear con el unique (persona_id,
        # horario_id) para no duplicar al re-ejecutar el seed.
        # ==================================================================
        MIEMBRO_A_CATEGORIAS_HORARIOS = {
            "Mensual Infantil": [Categoria.FORMATIVO, Categoria.INFANTIL, Categoria.JUVENIL],
            "Mensual Adultos": [Categoria.ADULTOS],
        }

        alumno_persona_ids = db.query(Persona.id).join(Usuario, Usuario.persona_id == Persona.id).join(
            Rol, Usuario.roles  # relación M2M_usuario_rol
        ).filter(Rol.tipo_rol == TipoRol.ALUMNO).all()
        alumno_persona_ids = [pid[0] for pid in alumno_persona_ids]

        horarios_por_categoria: dict[Categoria, list[HorarioEntrenamiento]] = {
            cat: db.query(HorarioEntrenamiento).filter(
                HorarioEntrenamiento.categoria == cat
            ).all()
            for cat in CATEGORIA_METADATA.keys()
        }

        asignaciones_creadas = 0
        for persona_id in alumno_persona_ids:
            membresia = db.query(Membresia).filter(Membresia.persona_id == persona_id).first()
            if not membresia or not membresia.tipo_membresia_id:
                continue
            tipo_membresia = db.query(TipoMembresia).filter(
                TipoMembresia.id == membresia.tipo_membresia_id
            ).first()
            if not tipo_membresia:
                continue
            categorias_horario = MIEMBRO_A_CATEGORIAS_HORARIOS.get(
                tipo_membresia.categoria, []
            )
            for cat_horario in categorias_horario:
                for horario in horarios_por_categoria.get(cat_horario, []):
                    _, created = _obtener_o_crear(
                        db, AlumnoHorario,
                        (AlumnoHorario.persona_id == persona_id)
                        & (AlumnoHorario.horario_id == horario.id),
                        {"persona_id": persona_id, "horario_id": horario.id},
                    )
                    if created:
                        asignaciones_creadas += 1
        print(f"[seed] Asignaciones alumno_horario creadas: {asignaciones_creadas}")
        if asignaciones_creadas == 0 and alumno_persona_ids:
            print("[seed] WARN: alumno_horario vacío — alumnos sin categoría de membresía mapeada.")

        db.commit()
        print("[seed] Base seed completado exitosamente.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
