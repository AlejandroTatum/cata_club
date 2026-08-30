"""
Contrato de paginación y orden de `PersonaRepositorio`.

Dos defectos motivan este archivo:

1. `buscar_por_nombre` aceptaba `skip`/`limit` en su firma (y el router los
   declaraba con `le=50`) pero NUNCA los aplicaba a la sentencia: devolvía
   todas las coincidencias. El tope del router era decorativo — una `q` de
   dos caracteres que matcheara a todo el club devolvía el club entero.
2. `listar` y `listar_por_rol` no declaraban ningún `ORDER BY`. Sin orden
   total, `OFFSET/LIMIT` reparte filas de forma dependiente del motor: una
   misma persona puede repetirse entre páginas o no aparecer nunca.

La aserción de ids DISJUNTOS entre páginas (tomada de
`test_membresia_repositorio.py`) es la que detecta el defecto 1: comparar
solo el largo de la rebanada no prueba nada si el repositorio ignora
`skip`.
"""
from datetime import date

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Usuario
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio


def _crear_persona(db_session, cedula: str, nombres: str, apellidos: str) -> Persona:
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    return persona


def _asignar_rol(db_session, persona: Persona, tipo_rol: TipoRol) -> None:
    rol = Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value)
    db_session.add(Usuario(
        correo=f"usuario{persona.cedula}@cataclub.test",
        contrasenia="hash", persona_id=persona.id, roles=[rol],
    ))


def _crear_roster_desordenado(db_session) -> None:
    """Inserta apellidos en orden INVERSO al alfabético para que un listado
    sin `ORDER BY` (que en la práctica devuelve el orden físico de inserción)
    no pueda pasar el test por casualidad."""
    _crear_persona(db_session, cedula_valida(510), "Zoe", "Zambrano")
    _crear_persona(db_session, cedula_valida(511), "Mario", "Mendoza")
    _crear_persona(db_session, cedula_valida(512), "Beatriz", "Alvarez")
    db_session.commit()


# --- `listar` ---------------------------------------------------------------
def test_listar_ordena_por_apellidos_y_nombres(db_session):
    _crear_roster_desordenado(db_session)

    personas = PersonaRepositorio(db_session).listar(skip=0, limit=50)

    assert [p.apellidos for p in personas] == ["Alvarez", "Mendoza", "Zambrano"]


def test_listar_desempata_por_id_cuando_el_nombre_completo_se_repite(db_session):
    primera = _crear_persona(db_session, cedula_valida(513), "Ana", "Torres")
    segunda = _crear_persona(db_session, cedula_valida(514), "Ana", "Torres")
    tercera = _crear_persona(db_session, "1710034313", "Ana", "Torres")
    db_session.commit()

    personas = PersonaRepositorio(db_session).listar(skip=0, limit=50)

    assert [p.id for p in personas] == [primera.id, segunda.id, tercera.id]


def test_listar_pagina_sin_repetir_ni_perder_personas(db_session):
    _crear_roster_desordenado(db_session)
    repo = PersonaRepositorio(db_session)

    primera_pagina = repo.listar(skip=0, limit=2)
    segunda_pagina = repo.listar(skip=2, limit=2)

    assert len(primera_pagina) == 2
    assert len(segunda_pagina) == 1
    assert {p.id for p in primera_pagina}.isdisjoint({p.id for p in segunda_pagina})


# `listar_por_rol` se eliminó junto con `GET /personas/entrenadores`
# (issue #13): su único consumidor era el selector de entrenadores. El orden
# de nómina sigue cubierto por los tests de `listar` y
# `listar_por_rol_con_ranking`.


# --- `buscar_por_nombre` ----------------------------------------------------
def _crear_coincidencias(db_session, cantidad: int) -> None:
    """Todas comparten el apellido "Torres" para que la misma `q` las
    matchee; los nombres se insertan en orden inverso al alfabético."""
    nombres = ["Ursula", "Tamara", "Rosa", "Karina", "Ana"]
    for i in range(cantidad):
        _crear_persona(db_session, cedula_valida(3440 + i), nombres[i], "Torres")
    db_session.commit()


def test_buscar_por_nombre_respeta_skip_y_limit(db_session):
    _crear_coincidencias(db_session, cantidad=5)
    repo = PersonaRepositorio(db_session)

    todas = repo.buscar_por_nombre(q="Torres", skip=0, limit=50)
    assert len(todas) == 5

    primera_pagina = repo.buscar_por_nombre(q="Torres", skip=0, limit=2)
    segunda_pagina = repo.buscar_por_nombre(q="Torres", skip=2, limit=2)
    assert len(primera_pagina) == 2
    assert len(segunda_pagina) == 2
    assert {p.id for p in primera_pagina}.isdisjoint({p.id for p in segunda_pagina})


def test_buscar_por_nombre_ordena_por_apellidos_y_nombres(db_session):
    _crear_coincidencias(db_session, cantidad=5)

    encontradas = PersonaRepositorio(db_session).buscar_por_nombre(
        q="Torres", skip=0, limit=50
    )

    assert [p.nombres for p in encontradas] == [
        "Ana", "Karina", "Rosa", "Tamara", "Ursula",
    ]
