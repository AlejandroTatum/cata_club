"""
Tests de paginación, orden determinístico y conteo de los repositorios de
geografía (Pais, Provincia, Canton).

`nombre` NO es UNIQUE en el esquema (ver `app/dominio/modelos.py`): ordenar
solo por `nombre` no es un orden TOTAL, y `OFFSET/LIMIT` puede repetir o
saltear filas entre páginas. El desempate por `id` es obligatorio (Design D4).
"""
from app.dominio.modelos import Pais, Provincia, Canton
from app.infraestructura.repositorios.geografia_repositorio import (
    PaisRepositorio, ProvinciaRepositorio, CantonRepositorio,
)


def _crear_pais(db_session, nombre: str) -> Pais:
    pais = Pais(nombre=nombre)
    db_session.add(pais)
    db_session.flush()
    return pais


def _crear_paises(db_session, nombres) -> None:
    for nombre in nombres:
        _crear_pais(db_session, nombre)
    db_session.commit()


def _crear_provincia(db_session, nombre: str, pais_id: int) -> Provincia:
    provincia = Provincia(nombre=nombre, pais_id=pais_id)
    db_session.add(provincia)
    db_session.flush()
    return provincia


def _crear_canton(db_session, nombre: str, provincia_id: int) -> Canton:
    canton = Canton(nombre=nombre, provincia_id=provincia_id)
    db_session.add(canton)
    db_session.flush()
    return canton


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


# --- ProvinciaRepositorio ----------------------------------------------------

def test_provincia_listar_sin_argumentos_devuelve_todo(db_session):
    """Caracterización (no RED): `ProvinciaServicio.listar_provincias()` sin
    `pais_id` ni paginación debe seguir devolviendo todas las provincias."""
    pais = _crear_pais(db_session, "Ecuador")
    _crear_provincia(db_session, "Pichincha", pais.id)
    _crear_provincia(db_session, "Guayas", pais.id)
    db_session.commit()

    resultado = ProvinciaRepositorio(db_session).listar()

    assert len(resultado) == 2


def test_provincia_listar_skip_limit_pagina(db_session):
    pais = _crear_pais(db_session, "Ecuador")
    for nombre in ["Pichincha", "Guayas", "Azuay", "Manabí", "Loja"]:
        _crear_provincia(db_session, nombre, pais.id)
    db_session.commit()
    repo = ProvinciaRepositorio(db_session)

    pagina_completa = repo.listar(pais_id=pais.id, skip=0, limit=200)
    assert len(pagina_completa) == 5

    primera_pagina = repo.listar(pais_id=pais.id, skip=0, limit=2)
    segunda_pagina = repo.listar(pais_id=pais.id, skip=2, limit=2)
    assert len(primera_pagina) == 2
    assert len(segunda_pagina) == 2
    assert {p.id for p in primera_pagina}.isdisjoint({p.id for p in segunda_pagina})


def test_provincia_contar_respeta_el_filtro_de_pais_sin_importar_limit(db_session):
    pais = _crear_pais(db_session, "Ecuador")
    otro_pais = _crear_pais(db_session, "Perú")
    for nombre in ["Pichincha", "Guayas", "Azuay"]:
        _crear_provincia(db_session, nombre, pais.id)
    _crear_provincia(db_session, "Lima", otro_pais.id)
    db_session.commit()
    repo = ProvinciaRepositorio(db_session)

    assert repo.contar(pais_id=pais.id) == 3
    assert repo.contar(pais_id=otro_pais.id) == 1
    assert len(repo.listar(pais_id=pais.id, limit=1)) == 1


def test_provincia_listar_ordena_alfabetico_con_id_de_desempate(db_session):
    """Mismo razonamiento que Pais: filas insertadas fuera de orden para que
    un `ORDER BY` faltante no pase por accidente del orden físico."""
    pais = _crear_pais(db_session, "Ecuador")
    nombres = ["Zamora Chinchipe", "Azuay", "Manabí", "Bolívar"]
    for nombre in nombres:
        _crear_provincia(db_session, nombre, pais.id)
    db_session.commit()

    resultado = ProvinciaRepositorio(db_session).listar(pais_id=pais.id)

    assert [p.nombre for p in resultado] == sorted(nombres)


# --- CantonRepositorio --------------------------------------------------------

def test_canton_listar_sin_argumentos_devuelve_todo(db_session):
    """Caracterización (no RED): `CantonServicio.listar_cantones()` sin
    `provincia_id` ni paginación debe seguir devolviendo todos los cantones."""
    pais = _crear_pais(db_session, "Ecuador")
    provincia = _crear_provincia(db_session, "Pichincha", pais.id)
    _crear_canton(db_session, "Quito", provincia.id)
    _crear_canton(db_session, "Rumiñahui", provincia.id)
    db_session.commit()

    resultado = CantonRepositorio(db_session).listar()

    assert len(resultado) == 2


def test_canton_listar_skip_limit_pagina(db_session):
    pais = _crear_pais(db_session, "Ecuador")
    provincia = _crear_provincia(db_session, "Pichincha", pais.id)
    for nombre in ["Quito", "Rumiñahui", "Mejía", "Cayambe", "Pedro Moncayo"]:
        _crear_canton(db_session, nombre, provincia.id)
    db_session.commit()
    repo = CantonRepositorio(db_session)

    pagina_completa = repo.listar(provincia_id=provincia.id, skip=0, limit=200)
    assert len(pagina_completa) == 5

    primera_pagina = repo.listar(provincia_id=provincia.id, skip=0, limit=2)
    segunda_pagina = repo.listar(provincia_id=provincia.id, skip=2, limit=2)
    assert len(primera_pagina) == 2
    assert len(segunda_pagina) == 2
    assert {c.id for c in primera_pagina}.isdisjoint({c.id for c in segunda_pagina})


def test_canton_contar_respeta_el_filtro_de_provincia_sin_importar_limit(db_session):
    pais = _crear_pais(db_session, "Ecuador")
    provincia = _crear_provincia(db_session, "Pichincha", pais.id)
    otra_provincia = _crear_provincia(db_session, "Guayas", pais.id)
    for nombre in ["Quito", "Rumiñahui"]:
        _crear_canton(db_session, nombre, provincia.id)
    _crear_canton(db_session, "Guayaquil", otra_provincia.id)
    db_session.commit()
    repo = CantonRepositorio(db_session)

    assert repo.contar(provincia_id=provincia.id) == 2
    assert repo.contar(provincia_id=otra_provincia.id) == 1
    assert len(repo.listar(provincia_id=provincia.id, limit=1)) == 1


def test_canton_listar_ordena_alfabetico_con_id_de_desempate(db_session):
    pais = _crear_pais(db_session, "Ecuador")
    provincia = _crear_provincia(db_session, "Pichincha", pais.id)
    nombres = ["Rumiñahui", "Cayambe", "Quito", "Mejía"]
    for nombre in nombres:
        _crear_canton(db_session, nombre, provincia.id)
    db_session.commit()

    resultado = CantonRepositorio(db_session).listar(provincia_id=provincia.id)

    assert [c.nombre for c in resultado] == sorted(nombres)
