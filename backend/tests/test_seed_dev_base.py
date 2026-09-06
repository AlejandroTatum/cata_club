"""Tests del seed script `seed_dev_base.py`: un smoke run de extremo a
extremo de `main()` contra un motor SQLite en memoria, para probar que la
fila realmente persiste `categoria` (y no solo que una estructura en
memoria la contiene).

`HORARIOS`/`dias_para` ya no existen como constantes importables (M1: las
horas/días de cada categoría se leen de `categoria_horario` en runtime, vía
`CategoriaRepositorio`, dentro de `main()`) -- la cobertura que antes vivía
acá sobre "las 5 categorías tienen las horas/días correctos" ahora es
`tests/test_categoria_repositorio.py`, contra la fuente de verdad real. Lo
que sigue viviendo acá es el smoke end-to-end: que `main()` REALMENTE
persiste 26 horarios con esos datos. Como `Base.metadata.create_all()` (a
diferencia de `alembic upgrade head`) no corre el data-seed de la migración,
`_motor_en_memoria` siembra `categoria_horario`/`categoria_horario_dia` a
mano (vía `tests._categoria_seed`, compartido con `test_seed_dev_bulk.py`)
antes de invocar `main()`."""
import importlib.util
from datetime import date, time
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.dominio.enums import Categoria, DiaSemana, TipoRol
from app.dominio.modelos import (
    AlumnoHorario,
    Base,
    HorarioEntrenamiento,
    Membresia,
    Pago,
    Persona,
    TipoMembresia,
    Usuario,
)
from tests._categoria_seed import LUN_SAB, sembrar_categorias
from tests._sqlite_btrim import registrar_btrim_sqlite

SEED_SCRIPT = Path(__file__).parents[1] / "scripts" / "seed_dev_base.py"


def _cargar_modulo_seed():
    spec = importlib.util.spec_from_file_location("seed_dev_base", SEED_SCRIPT)
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modulo)
    return modulo


def _motor_en_memoria(modulo):
    """Motor SQLite fresco con las tablas creadas y `categoria_horario` +
    `categoria_horario_dia` ya sembradas, inyectado en el módulo del seed."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    registrar_btrim_sqlite(engine)
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    sembrar_categorias(TestingSessionLocal)

    modulo.SessionLocal = TestingSessionLocal
    return TestingSessionLocal


def test_main_persiste_26_horarios_con_categoria_adultos_21_15_y_competitivo_sabado():
    """Smoke run de extremo a extremo: ejecuta `main()` de verdad contra un
    motor SQLite en memoria y verifica los datos REALMENTE persistidos (no
    solo la estructura en memoria) -- cierra el hueco que el propio diseño
    señaló como 'no verificado end-to-end' en el intento anterior."""
    modulo = _cargar_modulo_seed()
    _motor_en_memoria(modulo)

    modulo.main()

    with modulo.SessionLocal() as verificacion:
        horarios = list(verificacion.execute(select(HorarioEntrenamiento)).scalars().all())

        assert len(horarios) == 26
        assert all(h.categoria is not None for h in horarios)

        adultos = [h for h in horarios if h.categoria == Categoria.ADULTOS]
        assert len(adultos) == 5
        assert all(h.hora_fin == time(21, 15) for h in adultos)

        competitivo_dias = {h.dia_semana for h in horarios if h.categoria == Categoria.COMPETITIVO}
        assert competitivo_dias == set(LUN_SAB)
        assert DiaSemana.SABADO in competitivo_dias


def test_main_repara_representante_preexistente_sin_roles():
    """Regresión del bug real observado con `laura@cataclub.com`.

    La asignación de rol al representante se añadió al seed DESPUÉS de que
    las bases de datos de desarrollo ya estuvieran sembradas (commit
    `0bfd88d`). Como la rama "el usuario ya existe" solo imprimía y saltaba,
    esas cuentas quedaban con `roles = []` para siempre: `/auth/me` devuelve
    una lista vacía, el frontend la mapea a `"unsupported"` y el login
    aterriza en `/unauthorized`. Volver a correr el seed debe repararlas.

    Desde el issue #762 el backfill repone UN rol, no dos: reponer
    REPRESENTANTE+ALUMNO es hoy un error de base, porque la segunda fila la
    rechaza `trg_usuario_rol_unico_por_usuario`."""
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    rep = modulo.REPRESENTANTES[0]["representante"]
    with SessionLocal() as legado:
        persona = Persona(
            nombres=rep["nombres"], apellidos=rep["apellidos"], cedula=rep["cedula"],
            fecha_nacimiento=date(1988, 1, 1), telefono=rep["telefono"],
        )
        legado.add(persona)
        legado.flush()
        legado.add(Usuario(
            correo=rep["correo"], contrasenia="hash-heredado",
            persona_id=persona.id, roles=[],
        ))
        legado.commit()

    modulo.main()

    with SessionLocal() as verificacion:
        usuario = verificacion.execute(
            select(Usuario).where(Usuario.correo == rep["correo"])
        ).scalar_one()
        assert {r.tipo_rol for r in usuario.roles} == {TipoRol.REPRESENTANTE}


def test_main_no_duplica_roles_de_un_representante_ya_correcto():
    """El backfill es idempotente: correr el seed dos veces no acumula roles
    repetidos ni agrega un segundo rol a la cuenta del representante."""
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()
    modulo.main()

    rep = modulo.REPRESENTANTES[0]["representante"]
    with SessionLocal() as verificacion:
        usuario = verificacion.execute(
            select(Usuario).where(Usuario.correo == rep["correo"])
        ).scalar_one()
        assert [r.tipo_rol for r in usuario.roles] == [TipoRol.REPRESENTANTE]


# ---------------------------------------------------------------------------
# Casos de uso que la semilla no permitía probar:
#   a) un alumno adulto auto-gestionado (llega al formulario de pago real en
#      vez del muro de "eres menor, avisa a tu representante"), y
#   b) un representante con VARIOS representados (el selector de dependiente
#      del portal solo aparece a partir de dos perfiles).
# ---------------------------------------------------------------------------
EDAD_MAYORIA_EDAD = 18


def _edad_en_anios(fecha_nacimiento: date) -> int:
    hoy = date.today()
    return hoy.year - fecha_nacimiento.year - (
        (hoy.month, hoy.day) < (fecha_nacimiento.month, fecha_nacimiento.day)
    )


def test_todo_alumno_autogestionado_declara_su_edad_explicitamente():
    """La edad dejó de ser una `fecha_nacimiento` compartida y hardcodeada:
    cada alumno declara `edad_anios`, así la diferencia entre un adulto y un
    menor es visible en los datos y no implícita en una constante."""
    modulo = _cargar_modulo_seed()

    assert all("edad_anios" in alu for alu in modulo.ALUMNOS)


def test_existe_al_menos_un_alumno_autogestionado_mayor_de_edad():
    modulo = _cargar_modulo_seed()

    adultos = [alu for alu in modulo.ALUMNOS if alu["edad_anios"] >= EDAD_MAYORIA_EDAD]

    assert adultos, "sin un alumno adulto sin representante el portal siempre bloquea el pago"


def test_se_conserva_al_menos_un_alumno_autogestionado_menor_de_edad():
    """El caso `minor-blocked` sigue cubierto: no basta con volver adultos a
    todos los alumnos."""
    modulo = _cargar_modulo_seed()

    menores = [alu for alu in modulo.ALUMNOS if alu["edad_anios"] < EDAD_MAYORIA_EDAD]

    assert menores


def test_main_persiste_un_alumno_adulto_sin_representante_con_membresia():
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()

    adulto = next(alu for alu in modulo.ALUMNOS if alu["edad_anios"] >= EDAD_MAYORIA_EDAD)
    with SessionLocal() as verificacion:
        usuario = verificacion.execute(
            select(Usuario).where(Usuario.correo == adulto["correo"])
        ).scalar_one()
        persona = verificacion.execute(
            select(Persona).where(Persona.id == usuario.persona_id)
        ).scalar_one()

        assert {r.tipo_rol for r in usuario.roles} == {TipoRol.ALUMNO}
        assert persona.representante_id is None
        assert _edad_en_anios(persona.fecha_nacimiento) >= EDAD_MAYORIA_EDAD

        membresia = verificacion.execute(
            select(Membresia).where(Membresia.persona_id == persona.id)
        ).scalar_one()
        tipo = verificacion.execute(
            select(TipoMembresia).where(TipoMembresia.id == membresia.tipo_membresia_id)
        ).scalar_one()
        assert tipo.categoria == adulto["membresia_categoria"]


def test_el_primer_representante_declara_varios_hijos_y_el_resto_uno():
    """El selector de dependiente solo se muestra con 2+ perfiles, pero el
    caso de un único representado tiene que seguir cubierto."""
    modulo = _cargar_modulo_seed()

    conteos = [len(rep["hijos"]) for rep in modulo.REPRESENTANTES]

    assert conteos[0] >= 2
    assert any(conteo == 1 for conteo in conteos[1:])


def test_los_hijos_de_un_mismo_representante_tienen_datos_distintos():
    """Con datos idénticos el selector no probaría nada: edad y categoría de
    membresía deben diferir entre hermanos."""
    modulo = _cargar_modulo_seed()

    hijos = modulo.REPRESENTANTES[0]["hijos"]

    assert len({h["edad_anios"] for h in hijos}) == len(hijos)
    assert len({h["membresia_categoria"] for h in hijos}) > 1


def test_main_persiste_todos_los_representados_del_primer_representante():
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()

    rep = modulo.REPRESENTANTES[0]["representante"]
    hijos_esperados = modulo.REPRESENTANTES[0]["hijos"]
    with SessionLocal() as verificacion:
        rep_persona = verificacion.execute(
            select(Persona).where(Persona.cedula == rep["cedula"])
        ).scalar_one()
        representados = list(verificacion.execute(
            select(Persona).where(Persona.representante_id == rep_persona.id)
        ).scalars().all())

        assert {p.cedula for p in representados} == {h["cedula"] for h in hijos_esperados}
        assert len(representados) >= 2

        for hijo in hijos_esperados:
            persona = next(p for p in representados if p.cedula == hijo["cedula"])
            assert _edad_en_anios(persona.fecha_nacimiento) == hijo["edad_anios"]
            assert verificacion.execute(
                select(Membresia).where(Membresia.persona_id == persona.id)
            ).scalar_one() is not None
            assert verificacion.execute(
                select(Usuario).where(Usuario.correo == hijo["correo"])
            ).scalar_one() is not None


def test_main_es_idempotente_para_personas_membresias_y_pagos():
    """El script se re-ejecuta en cada arranque del contenedor: la segunda
    corrida no debe duplicar ninguna fila."""
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    def _conteos():
        with SessionLocal() as sesion:
            return {
                modelo.__name__: len(list(sesion.execute(select(modelo)).scalars().all()))
                for modelo in (Persona, Usuario, Membresia, Pago, AlumnoHorario)
            }

    modulo.main()
    despues_de_la_primera = _conteos()
    modulo.main()

    assert _conteos() == despues_de_la_primera


def test_una_sola_corrida_basta_para_asignar_horarios_a_los_alumnos_autogestionados():
    """La membresía del alumno auto-gestionado se guardaba sin `flush()`, así
    que la consulta que arma `alumno_horario` todavía no la veía y el alumno
    se quedaba sin horarios hasta la SIGUIENTE corrida del seed (el
    entrenador veía "este horario no tiene alumnos asignados")."""
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()

    with SessionLocal() as verificacion:
        for alu in modulo.ALUMNOS:
            usuario = verificacion.execute(
                select(Usuario).where(Usuario.correo == alu["correo"])
            ).scalar_one()
            asignaciones = list(verificacion.execute(
                select(AlumnoHorario).where(AlumnoHorario.persona_id == usuario.persona_id)
            ).scalars().all())
            assert asignaciones, f"{alu['correo']} quedó sin horarios tras la primera corrida"


def test_main_agrega_las_personas_nuevas_a_una_bd_ya_sembrada_con_los_datos_viejos():
    """Simula la BD de desarrollo real: ya tiene al representante y a su
    único hijo original. Re-correr el seed debe añadir el hermano nuevo y al
    alumno adulto sin tocar lo existente."""
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    rep = modulo.REPRESENTANTES[0]["representante"]
    hijo_original = modulo.REPRESENTANTES[0]["hijos"][0]
    with SessionLocal() as legado:
        rep_persona = Persona(
            nombres=rep["nombres"], apellidos=rep["apellidos"], cedula=rep["cedula"],
            fecha_nacimiento=date(1988, 1, 1), telefono=rep["telefono"],
        )
        legado.add(rep_persona)
        legado.flush()
        legado.add(Usuario(
            correo=rep["correo"], contrasenia="hash-heredado",
            persona_id=rep_persona.id, roles=[],
        ))
        hijo_persona = Persona(
            nombres=hijo_original["nombres"], apellidos=hijo_original["apellidos"],
            cedula=hijo_original["cedula"], fecha_nacimiento=date(2015, 5, 5),
            telefono=hijo_original["telefono"], representante_id=rep_persona.id,
        )
        legado.add(hijo_persona)
        legado.flush()
        legado.add(Usuario(
            correo=hijo_original["correo"], contrasenia="hash-heredado",
            persona_id=hijo_persona.id, roles=[],
        ))
        legado.commit()

    modulo.main()

    adulto = next(alu for alu in modulo.ALUMNOS if alu["edad_anios"] >= EDAD_MAYORIA_EDAD)
    with SessionLocal() as verificacion:
        rep_persona = verificacion.execute(
            select(Persona).where(Persona.cedula == rep["cedula"])
        ).scalar_one()
        representados = list(verificacion.execute(
            select(Persona).where(Persona.representante_id == rep_persona.id)
        ).scalars().all())

        assert {p.cedula for p in representados} == {
            h["cedula"] for h in modulo.REPRESENTANTES[0]["hijos"]
        }
        assert verificacion.execute(
            select(Usuario).where(Usuario.correo == adulto["correo"])
        ).scalar_one() is not None


# ---------------------------------------------------------------------------
# Issue #790: el seed no puede nacer sin verificar
# ---------------------------------------------------------------------------

def test_todas_las_cuentas_sembradas_nacen_con_el_correo_verificado():
    """`correo_verificado` tiene `server_default="false"` a propósito: un
    INSERT crudo debe caer del lado no verificado. El seed NO es ese caso.

    En un volumen ya existente el defecto es invisible -- la migración
    `a790verifcorreo` dejó en `true` a todas las filas anteriores. En un
    volumen NUEVO la migración corre primero y el seed después, así que cada
    cuenta sembrada quedaba sin verificar; en particular los representantes,
    que entonces no pueden vincular ni a sus propios hijos. En QA, donde
    `celery-beat` está excluido, la salida "solicite un nuevo enlace" tampoco
    hace nada.

    Este motor en memoria reproduce el volumen fresco: `create_all()` aplica
    el mismo default del esquema que la migración deja instalado.
    """
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()

    with SessionLocal() as verificacion:
        cuentas = list(verificacion.execute(select(Usuario)).scalars().all())

        assert cuentas, "el seed no creó ninguna cuenta"
        sin_verificar = sorted(u.correo for u in cuentas if not u.correo_verificado)
        assert sin_verificar == [], f"cuentas sembradas sin verificar: {sin_verificar}"


def test_los_representantes_sembrados_pueden_vincular_a_sus_hijos():
    """La consecuencia concreta, dicha con los nombres que se usan a mano en
    QA: `laura@cataclub.com` y `carlos@cataclub.com` son las dos cuentas con
    las que se prueba el flujo de vinculación. Si nacen sin verificar, ese
    flujo responde 403 antes de empezar."""
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()

    correos = [rep["representante"]["correo"] for rep in modulo.REPRESENTANTES]
    with SessionLocal() as verificacion:
        for correo in correos:
            cuenta = verificacion.execute(
                select(Usuario).where(Usuario.correo == correo)
            ).scalar_one()
            assert cuenta.correo_verificado is True, correo


# ---------------------------------------------------------------------------
# Administrador extra opcional (repositorio público)
# ---------------------------------------------------------------------------

def test_sin_la_variable_de_entorno_el_seed_crea_un_solo_administrador(monkeypatch):
    """El default es exactamente lo de hoy: `admin@cataclub.com` y nadie más.

    Esa dirección es un contrato, no un detalle: dos specs E2E
    (`content-measure.spec.ts`, `trainer-attendance-correction.spec.ts`)
    inician sesión con ella literal contra el stack de QA. Por eso el
    override AGREGA una cuenta en vez de reemplazarla."""
    monkeypatch.delenv("SEED_ADMIN_EXTRA_CORREO", raising=False)
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()

    with SessionLocal() as verificacion:
        admins = _correos_administradores(verificacion)
        assert admins == [modulo.ADMIN_CORREO]


def test_la_variable_de_entorno_agrega_un_administrador_sin_tocar_el_de_siempre(monkeypatch):
    """El dueño entra con su propia dirección en QA local sin escribirla en
    este repositorio público -- y `admin@cataclub.com` sigue existiendo, con
    su contraseña de siempre, así que los specs E2E no se enteran."""
    monkeypatch.setenv("SEED_ADMIN_EXTRA_CORREO", "duenio@example.com")
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()

    with SessionLocal() as verificacion:
        assert _correos_administradores(verificacion) == [
            modulo.ADMIN_CORREO, "duenio@example.com",
        ]
        extra = verificacion.execute(
            select(Usuario).where(Usuario.correo == "duenio@example.com")
        ).scalar_one()
        assert extra.correo_verificado is True


def test_la_variable_en_blanco_no_agrega_nada(monkeypatch):
    """Una variable definida pero vacía es el caso de un `.env` con la línea
    presente y sin valor; tratarla como "hay override" crearía una cuenta con
    correo vacío."""
    monkeypatch.setenv("SEED_ADMIN_EXTRA_CORREO", "   ")
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()

    with SessionLocal() as verificacion:
        assert _correos_administradores(verificacion) == [modulo.ADMIN_CORREO]


def test_la_variable_apuntando_al_admin_de_siempre_no_duplica_la_cuenta(monkeypatch):
    """Idempotencia: apuntar el override a la dirección que el seed ya crea
    no puede reventar por unicidad ni dejar dos filas."""
    monkeypatch.setenv("SEED_ADMIN_EXTRA_CORREO", "admin@cataclub.com")
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()
    modulo.main()

    with SessionLocal() as verificacion:
        assert _correos_administradores(verificacion) == [modulo.ADMIN_CORREO]


def _correos_administradores(sesion) -> list[str]:
    """Correos de las cuentas con rol ADMINISTRADOR, en orden de creación."""
    cuentas = list(sesion.execute(select(Usuario).order_by(Usuario.id)).scalars().all())
    return [
        u.correo for u in cuentas
        if any(r.tipo_rol == TipoRol.ADMINISTRADOR for r in u.roles)
    ]
