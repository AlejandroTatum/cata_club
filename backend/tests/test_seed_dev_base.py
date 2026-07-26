"""Tests del seed script `seed_dev_base.py`: verificaciones estructurales de
`HORARIOS` (leídas vía import, sin ejecutar `main()`, mismo patrón que
`test_seed_dev_bulk.py`) más un smoke run de extremo a extremo de `main()`
contra un motor SQLite en memoria, para probar que la fila realmente
persiste `categoria` (y no solo que la estructura en memoria la contiene)."""
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
    Ranking,
    TipoMembresia,
    Usuario,
)

SEED_SCRIPT = Path(__file__).parents[1] / "scripts" / "seed_dev_base.py"


def _cargar_modulo_seed():
    spec = importlib.util.spec_from_file_location("seed_dev_base", SEED_SCRIPT)
    modulo = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(modulo)
    return modulo


def test_horarios_incluye_las_5_categorias_con_categoria_asignada():
    modulo = _cargar_modulo_seed()

    categorias = {categoria for categoria, _, _ in modulo.HORARIOS}

    assert categorias == {
        Categoria.FORMATIVO, Categoria.INFANTIL, Categoria.JUVENIL,
        Categoria.COMPETITIVO, Categoria.ADULTOS,
    }


def test_adultos_termina_a_las_21_15():
    modulo = _cargar_modulo_seed()

    adultos = next(h for h in modulo.HORARIOS if h[0] == Categoria.ADULTOS)

    assert adultos[2] == time(21, 15)


def test_competitivo_corre_lunes_a_sabado_las_otras_solo_lunes_a_viernes():
    modulo = _cargar_modulo_seed()

    assert DiaSemana.SABADO in modulo.dias_para(Categoria.COMPETITIVO)
    assert DiaSemana.SABADO not in modulo.dias_para(Categoria.FORMATIVO)
    assert DiaSemana.SABADO not in modulo.dias_para(Categoria.INFANTIL)
    assert DiaSemana.SABADO not in modulo.dias_para(Categoria.JUVENIL)
    assert DiaSemana.SABADO not in modulo.dias_para(Categoria.ADULTOS)


def test_total_de_filas_de_horario_generadas_es_26():
    """4 categorías x 5 días (Lun-Vie) + Competitivo x 6 días (Lun-Sáb) = 26."""
    modulo = _cargar_modulo_seed()

    total = sum(len(modulo.dias_para(categoria)) for categoria, _, _ in modulo.HORARIOS)

    assert total == 26


def test_main_persiste_26_horarios_con_categoria_adultos_21_15_y_competitivo_sabado():
    """Smoke run de extremo a extremo: ejecuta `main()` de verdad contra un
    motor SQLite en memoria y verifica los datos REALMENTE persistidos (no
    solo la estructura HORARIOS en memoria) -- cierra el hueco que el propio
    diseño señaló como 'no verificado end-to-end' en el intento anterior."""
    modulo = _cargar_modulo_seed()

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    modulo.SessionLocal = TestingSessionLocal

    modulo.main()

    with TestingSessionLocal() as verificacion:
        horarios = list(verificacion.execute(select(HorarioEntrenamiento)).scalars().all())

        assert len(horarios) == 26
        assert all(h.categoria is not None for h in horarios)

        adultos = [h for h in horarios if h.categoria == Categoria.ADULTOS]
        assert len(adultos) == 5
        assert all(h.hora_fin == time(21, 15) for h in adultos)

        competitivo_dias = {h.dia_semana for h in horarios if h.categoria == Categoria.COMPETITIVO}
        assert competitivo_dias == set(modulo.dias_para(Categoria.COMPETITIVO))
        assert DiaSemana.SABADO in competitivo_dias


def _motor_en_memoria(modulo):
    """Motor SQLite fresco con las tablas creadas, ya inyectado en el módulo
    del seed (mismo montaje que el smoke run de arriba)."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    modulo.SessionLocal = TestingSessionLocal
    return TestingSessionLocal


def test_main_repara_representante_preexistente_sin_roles():
    """Regresión del bug real observado con `laura@cataclub.com`.

    La asignación de roles REPRESENTANTE+ALUMNO se añadió al seed DESPUÉS de
    que las bases de datos de desarrollo ya estuvieran sembradas (commit
    `0bfd88d`). Como la rama "el usuario ya existe" solo imprimía y saltaba,
    esas cuentas quedaban con `roles = []` para siempre: `/auth/me` devuelve
    una lista vacía, el frontend la mapea a `"unsupported"` y el login
    aterriza en `/unauthorized`. Volver a correr el seed debe repararlas."""
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
        assert {r.tipo_rol for r in usuario.roles} == {TipoRol.REPRESENTANTE, TipoRol.ALUMNO}


def test_main_no_duplica_roles_de_un_representante_ya_correcto():
    """El backfill es idempotente: correr el seed dos veces no acumula roles
    repetidos en la cuenta del representante."""
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    modulo.main()
    modulo.main()

    rep = modulo.REPRESENTANTES[0]["representante"]
    with SessionLocal() as verificacion:
        usuario = verificacion.execute(
            select(Usuario).where(Usuario.correo == rep["correo"])
        ).scalar_one()
        tipos = [r.tipo_rol for r in usuario.roles]
        assert sorted(tipos, key=lambda t: t.value) == sorted(
            [TipoRol.ALUMNO, TipoRol.REPRESENTANTE], key=lambda t: t.value
        )


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


def test_main_persiste_un_alumno_adulto_sin_representante_con_membresia_y_ranking():
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

        ranking = verificacion.execute(
            select(Ranking).where(Ranking.persona_id == persona.id)
        ).scalar_one()
        assert ranking.nivel_ranking_id == adulto["nivel_ranking_id"]


def test_el_primer_representante_declara_varios_hijos_y_el_resto_uno():
    """El selector de dependiente solo se muestra con 2+ perfiles, pero el
    caso de un único representado tiene que seguir cubierto."""
    modulo = _cargar_modulo_seed()

    conteos = [len(rep["hijos"]) for rep in modulo.REPRESENTANTES]

    assert conteos[0] >= 2
    assert any(conteo == 1 for conteo in conteos[1:])


def test_los_hijos_de_un_mismo_representante_tienen_datos_distintos():
    """Con datos idénticos el selector no probaría nada: edad, nivel y
    categoría de membresía deben diferir entre hermanos."""
    modulo = _cargar_modulo_seed()

    hijos = modulo.REPRESENTANTES[0]["hijos"]

    assert len({h["edad_anios"] for h in hijos}) == len(hijos)
    assert len({h["nivel_ranking_id"] for h in hijos}) == len(hijos)
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


def test_main_es_idempotente_para_personas_membresias_pagos_y_rankings():
    """El script se re-ejecuta en cada arranque del contenedor: la segunda
    corrida no debe duplicar ninguna fila."""
    modulo = _cargar_modulo_seed()
    SessionLocal = _motor_en_memoria(modulo)

    def _conteos():
        with SessionLocal() as sesion:
            return {
                modelo.__name__: len(list(sesion.execute(select(modelo)).scalars().all()))
                for modelo in (Persona, Usuario, Membresia, Pago, Ranking, AlumnoHorario)
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
