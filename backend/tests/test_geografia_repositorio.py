"""
Tests de paginación, orden determinístico y conteo de los repositorios de
geografía (Pais, Provincia, Canton).

`nombre` NO es UNIQUE en el esquema (ver `app/dominio/modelos.py`): ordenar
solo por `nombre` no es un orden TOTAL, y `OFFSET/LIMIT` puede repetir o
saltear filas entre páginas. El desempate por `id` es obligatorio (Design D4).
"""
from app.dominio.modelos import Pais
from app.infraestructura.repositorios.geografia_repositorio import PaisRepositorio


def _crear_pais(db_session, nombre: str) -> Pais:
    pais = Pais(nombre=nombre)
    db_session.add(pais)
    db_session.flush()
    return pais


def _crear_paises(db_session, nombres) -> None:
    for nombre in nombres:
        _crear_pais(db_session, nombre)
    db_session.commit()


def test_pais_listar_sin_argumentos_devuelve_todo(db_session):
    """Caracterización (no RED): `PaisServicio.listar_paises()` llama a
    `.listar()` sin argumentos hoy y espera el catálogo completo sin límite.
    Este test documenta ese contrato y debe seguir pasando después del
    cambio (D1: `limit=None` => sin tope)."""
    _crear_paises(db_session, ["Ecuador", "Perú", "Colombia"])

    resultado = PaisRepositorio(db_session).listar()

    assert len(resultado) == 3


def test_pais_listar_skip_limit_pagina(db_session):
    _crear_paises(db_session, ["Ecuador", "Perú", "Colombia", "Bolivia", "Chile"])
    repo = PaisRepositorio(db_session)

    pagina_completa = repo.listar(skip=0, limit=200)
    assert len(pagina_completa) == 5

    primera_pagina = repo.listar(skip=0, limit=2)
    segunda_pagina = repo.listar(skip=2, limit=2)
    assert len(primera_pagina) == 2
    assert len(segunda_pagina) == 2
    assert {p.id for p in primera_pagina}.isdisjoint({p.id for p in segunda_pagina})


def test_pais_contar_devuelve_total_sin_importar_limit(db_session):
    """El `total` del envelope de paginación debe reflejar el conjunto
    completo, no la página: `contar()` no debe verse afectado por `limit`."""
    _crear_paises(db_session, ["Ecuador", "Perú", "Colombia", "Bolivia"])
    repo = PaisRepositorio(db_session)

    assert repo.contar() == 4
    assert len(repo.listar(limit=1)) == 1


def test_pais_listar_ordena_alfabetico_con_id_de_desempate(db_session):
    """Inserta países FUERA de orden alfabético: un `listar()` sin
    `ORDER BY` devolvería el orden físico de inserción (Postgres escanea
    tablas chicas en ese orden) y esta aserción fallaría por accidente
    de motor, no por diseño. Con `ORDER BY nombre, id` el resultado queda
    determinístico."""
    nombres = ["Zimbabue", "Argentina", "México", "Bolivia"]
    _crear_paises(db_session, nombres)

    resultado = PaisRepositorio(db_session).listar()

    assert [p.nombre for p in resultado] == sorted(nombres)
