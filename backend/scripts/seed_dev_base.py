"""Dev-only bootstrap: creates the minimum viable dataset for local testing.

Combines the former seed_dev_admin.py + seed_dev_trainer.py into a single
idempotent script that runs automatically on every container start (when
AMBIENTE=development). Safe to re-run — uses check-before-insert everywhere.

Creates:
  - 1 Admin account         (admin@cataclub.test / admin12345)
  - 1 Trainer account       (entrenador@cataclub.test / trainer12345)
  - 26 weekly schedules     (5 categories, Mon-Fri; Competitivo also Sat)
  - 11 ranking levels       (1A .. 10)
  - 2 membership types      (Mensual Infantil, Mensual Adultos)
  - 2 representantes (padres/tutores) con 1 hijo cada uno
  - 3 self-managed students (Ana, Luis, Maria — sin representante)

Login credentials:
  Admin:      admin@cataclub.test       / admin12345
  Trainer:    entrenador@cataclub.test   / trainer12345
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
)
from app.dominio.enums import (
    TipoRol,
    DiaSemana,
    TipoModalidad,
    EstadoMembresia,
    EstadoPago,
    TipoPago,
    Categoria,
)
from app.seguridad.gestor_auth import GestorAutenticacion


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------
ADMIN_CEDULA = "0000000001"
ADMIN_CORREO = "admin@cataclub.test"
ADMIN_CONTRASENIA = "admin12345"

TRAINER_CEDULA = "0000000002"
TRAINER_CORREO = "entrenador@cataclub.test"
TRAINER_CONTRASENIA = "trainer12345"

# ---------------------------------------------------------------------------
# Horarios (5 categorias; Lun-Vie salvo Competitivo, que además dicta Sábado
# -- 4 categorias x 5 días + 1 categoria x 6 días = 26)
# ---------------------------------------------------------------------------
DIAS_LUN_VIE = [
    DiaSemana.LUNES,
    DiaSemana.MARTES,
    DiaSemana.MIERCOLES,
    DiaSemana.JUEVES,
    DiaSemana.VIERNES,
]
DIAS_LUN_SAB = DIAS_LUN_VIE + [DiaSemana.SABADO]

# (categoria, hora_inicio, hora_fin, dias)
HORARIOS = [
    (Categoria.FORMATIVO,   time(15, 0), time(16, 0), DIAS_LUN_VIE),
    (Categoria.INFANTIL,    time(16, 0), time(17, 0), DIAS_LUN_VIE),
    (Categoria.JUVENIL,     time(17, 0), time(18, 0), DIAS_LUN_VIE),
    (Categoria.COMPETITIVO, time(18, 0), time(20, 0), DIAS_LUN_SAB),
    (Categoria.ADULTOS,     time(20, 0), time(21, 15), DIAS_LUN_VIE),
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
# ---------------------------------------------------------------------------
ALUMNOS = [
    {
        "nombres": "Ana",
        "apellidos": "Garcia",
        "cedula": "0000000003",
        "correo": "ana@cataclub.test",
        "contrasenia": "alumno123",
        "telefono": "0971111111",
        "nivel_ranking_id": 2,
        "membresia_categoria": "Mensual Infantil",
    },
    {
        "nombres": "Luis",
        "apellidos": "Lopez",
        "cedula": "0000000004",
        "correo": "luis@cataclub.test",
        "contrasenia": "alumno123",
        "telefono": "0972222222",
        "nivel_ranking_id": 1,
        "membresia_categoria": "Mensual Infantil",
    },
    {
        "nombres": "Maria",
        "apellidos": "Torres",
        "cedula": "0000000005",
        "correo": "maria@cataclub.test",
        "contrasenia": "alumno123",
        "telefono": "0973333333",
        "nivel_ranking_id": 6,
        "membresia_categoria": "Mensual Adultos",
    },
]

# ---------------------------------------------------------------------------
# Representantes (padres/tutores) with 1 child each
# ---------------------------------------------------------------------------
REPRESENTANTES = [
    {
        "representante": {
            "nombres": "Laura",
            "apellidos": "Vera",
            "cedula": "0000000010",
            "correo": "laura@cataclub.test",
            "telefono": "0981000010",
        },
        "hijo": {
            "nombres": "Sofia",
            "apellidos": "Vera",
            "cedula": "0000000011",
            "correo": "sofia@cataclub.test",
            "telefono": "0981000011",
            "edad_anios": 10,
            "nivel_ranking_id": 4,
            "membresia_categoria": "Mensual Infantil",
        },
    },
    {
        "representante": {
            "nombres": "Carlos",
            "apellidos": "Mendoza",
            "cedula": "0000000012",
            "correo": "carlos@cataclub.test",
            "telefono": "0981000012",
        },
        "hijo": {
            "nombres": "Diego",
            "apellidos": "Mendoza",
            "cedula": "0000000013",
            "correo": "diego@cataclub.test",
            "telefono": "0981000013",
            "edad_anios": 12,
            "nivel_ranking_id": 3,
            "membresia_categoria": "Mensual Infantil",
        },
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
        # 3. Horarios (5 categorias; Competitivo también dicta Sábado)
        # ==================================================================
        trainer_persona_id = db.query(Usuario).filter(Usuario.correo == TRAINER_CORREO).first().persona_id
        horario_count = 0
        total_posibles = sum(len(dias) for _, _, _, dias in HORARIOS)
        for categoria, h_inicio, h_fin, dias in HORARIOS:
            for dia in dias:
                _, created = _obtener_o_crear(
                    db, HorarioEntrenamiento,
                    (
                        (HorarioEntrenamiento.entrenador_id == trainer_persona_id)
                        & (HorarioEntrenamiento.dia_semana == dia)
                        & (HorarioEntrenamiento.hora_inicio == h_inicio)
                    ),
                    {
                        "dia_semana": dia,
                        "hora_inicio": h_inicio,
                        "hora_fin": h_fin,
                        "entrenador_id": trainer_persona_id,
                        "categoria": categoria,
                    },
                )
                if created:
                    horario_count += 1
        print(f"[seed] Horarios creados: {horario_count} (de {total_posibles} posibles)")

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

        now = datetime.now(timezone.utc)

        representantes_creados = 0
        hijos_creados = 0

        for rep_data in REPRESENTANTES:
            rep = rep_data["representante"]
            # Representante persona (no roles — pure parent)
            existing_rep_user = db.query(Usuario).filter(Usuario.correo == rep["correo"]).first()
            if existing_rep_user:
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
                    roles=[],
                )
                db.add(rep_usuario)
                representantes_creados += 1

            # Hijo (ALUMNO role, linked to representante)
            hijo = rep_data["hijo"]
            existing_hijo_user = db.query(Usuario).filter(Usuario.correo == hijo["correo"]).first()
            if existing_hijo_user:
                print(f"[seed] Hijo {hijo['correo']} ya existe — saltando.")
            else:
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
        # 7. Self-managed students (Ana, Luis, Maria)
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
                    "fecha_nacimiento": date(2010, 3, 10),
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

            ranking = Ranking(
                persona_id=alu_persona.id,
                nivel_ranking_id=alu["nivel_ranking_id"],
                esta_en_ranking=True,
            )
            db.add(ranking)

            print(f"[seed] Alumno creado: {alu['nombres']} {alu['apellidos']} ({alu['correo']})")

        db.commit()
        print("[seed] Base seed completado exitosamente.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
