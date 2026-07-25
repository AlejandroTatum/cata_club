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
from app.dominio.modelos import Base, HorarioEntrenamiento, Persona, Usuario

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
