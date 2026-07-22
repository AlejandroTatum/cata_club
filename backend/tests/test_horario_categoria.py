"""PR1 (gestión de horarios): cobertura para el nuevo campo `categoria` en
HorarioEntrenamiento -- mapeo de backfill de la migración, repositorio
(cierre de gap de cobertura preexistente) y regresión del endpoint
GET/POST /asistencias/horarios."""
import importlib.util
from datetime import date, time
from pathlib import Path

import pytest

from app.dominio.enums import Categoria, DiaSemana, TipoRol
from app.dominio.modelos import Persona, Usuario, Rol
from app.infraestructura.repositorios.asistencia_repositorio import HorarioRepositorio
from app.seguridad.gestor_auth import GestorAutenticacion

MIGRACION_PATH = (
    Path(__file__).parents[1]
    / "alembic"
    / "versions"
    / "92089ed35b86_add_categoria_horario_entrenamiento.py"
)


def _cargar_modulo_migracion():
    spec = importlib.util.spec_from_file_location("migracion_categoria", MIGRACION_PATH)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


# ---------------------------------------------------------------------------
# Backfill mapping (task 1.3/1.4) — mapeo puro hora_inicio -> categoria,
# usado por la migración para poblar las filas existentes.
# ---------------------------------------------------------------------------
def test_backfill_mapea_los_5_rangos_horarios_seed_a_su_categoria():
    migracion = _cargar_modulo_migracion()
    assert migracion.categoria_para_hora_inicio(time(15, 0)) == "FORMATIVO"
    assert migracion.categoria_para_hora_inicio(time(16, 0)) == "INFANTIL"
    assert migracion.categoria_para_hora_inicio(time(17, 0)) == "JUVENIL"
    assert migracion.categoria_para_hora_inicio(time(18, 0)) == "COMPETITIVO"
    assert migracion.categoria_para_hora_inicio(time(20, 0)) == "ADULTOS"


def test_backfill_lanza_para_una_hora_fuera_de_los_5_rangos_conocidos():
    migracion = _cargar_modulo_migracion()
    with pytest.raises(ValueError):
        migracion.categoria_para_hora_inicio(time(8, 0))


# ---------------------------------------------------------------------------
# HorarioRepositorio (task 1.7) — cierre de gap de cobertura preexistente:
# create/list/query por categoria.
# ---------------------------------------------------------------------------
def _crear_entrenador(db_session, cedula="1710034065") -> Persona:
    persona = Persona(
        nombres="Carlos", apellidos="Mendoza", cedula=cedula,
        fecha_nacimiento=date(1985, 6, 15),
        telefono="0988888888",
    )
    db_session.add(persona)
    db_session.flush()
    rol = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")
    usuario = Usuario(
        correo=f"entrenador{cedula}@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("clave123"),
        persona_id=persona.id,
        roles=[rol],
    )
    db_session.add(usuario)
    db_session.commit()
    return persona


def test_horario_repositorio_crea_y_lista_horarios(db_session):
    from app.dominio.modelos import HorarioEntrenamiento

    entrenador = _crear_entrenador(db_session)
    repo = HorarioRepositorio(db_session)

    creado = repo.crear(HorarioEntrenamiento(
        dia_semana=DiaSemana.LUNES, hora_inicio=time(15, 0), hora_fin=time(16, 0),
        entrenador_id=entrenador.id, categoria=Categoria.FORMATIVO,
    ))

    assert creado.id is not None
    listado = repo.listar()
    assert len(listado) == 1
    assert listado[0].categoria == Categoria.FORMATIVO


def test_horario_repositorio_lista_por_categoria_filtra_correctamente(db_session):
    from app.dominio.modelos import HorarioEntrenamiento

    entrenador = _crear_entrenador(db_session)
    repo = HorarioRepositorio(db_session)
    repo.crear(HorarioEntrenamiento(
        dia_semana=DiaSemana.LUNES, hora_inicio=time(15, 0), hora_fin=time(16, 0),
        entrenador_id=entrenador.id, categoria=Categoria.FORMATIVO,
    ))
    repo.crear(HorarioEntrenamiento(
        dia_semana=DiaSemana.LUNES, hora_inicio=time(18, 0), hora_fin=time(20, 0),
        entrenador_id=entrenador.id, categoria=Categoria.COMPETITIVO,
    ))
    repo.crear(HorarioEntrenamiento(
        dia_semana=DiaSemana.SABADO, hora_inicio=time(18, 0), hora_fin=time(20, 0),
        entrenador_id=entrenador.id, categoria=Categoria.COMPETITIVO,
    ))

    solo_competitivo = repo.listar_por_categoria(Categoria.COMPETITIVO)
    assert len(solo_competitivo) == 2
    assert all(h.categoria == Categoria.COMPETITIVO for h in solo_competitivo)

    solo_formativo = repo.listar_por_categoria(Categoria.FORMATIVO)
    assert len(solo_formativo) == 1
    assert solo_formativo[0].dia_semana == DiaSemana.LUNES


# ---------------------------------------------------------------------------
# Regresión (task 1.5/1.8): GET/POST /asistencias/horarios sigue funcionando
# con el nuevo campo `categoria` obligatorio.
# ---------------------------------------------------------------------------
def _crear_persona_api(client, cedula="1710034065", nombres="Carlos"):
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": nombres, "apellidos": "Mendoza", "cedula": cedula,
            "fecha_nacimiento": "1985-06-15", "telefono": "0988888888",
        },
    ).json()


def test_post_horarios_requiere_y_devuelve_categoria(client, db_session):
    persona = _crear_persona_api(client)
    rol = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")
    usuario = Usuario(
        correo="entrenador_cat@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("clave123"),
        persona_id=persona["id"], roles=[rol],
    )
    db_session.add(usuario)
    db_session.commit()

    resp = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "dia_semana": "LUNES", "hora_inicio": "17:00:00", "hora_fin": "18:00:00",
            "entrenador_id": persona["id"], "categoria": "JUVENIL",
        },
    )
    assert resp.status_code == 201
    assert resp.json()["categoria"] == "JUVENIL"

    listado = client.get("/api/v1/asistencias/horarios")
    assert listado.status_code == 200
    assert listado.json()[0]["categoria"] == "JUVENIL"


def test_post_horarios_sin_categoria_falla_validacion(client, db_session):
    """`categoria` es obligatorio en el DTO -- confirma que no se puede crear
    un horario sin categoría (sin fallback silencioso)."""
    persona = _crear_persona_api(client)
    rol = Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador")
    usuario = Usuario(
        correo="entrenador_sincat@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("clave123"),
        persona_id=persona["id"], roles=[rol],
    )
    db_session.add(usuario)
    db_session.commit()

    resp = client.post(
        "/api/v1/asistencias/horarios",
        json={
            "dia_semana": "LUNES", "hora_inicio": "17:00:00", "hora_fin": "18:00:00",
            "entrenador_id": persona["id"],
        },
    )
    assert resp.status_code == 422
