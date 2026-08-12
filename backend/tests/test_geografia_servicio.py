"""
Tests de la capa de servicio de geografía (Pais, Provincia, Canton): los
pass-throughs de `skip`/`limit`.

Se prueban directamente contra `db_session`, sin pasar por los routers
(fuera del alcance de este track: `presentacion/routers/**` lo integra
Track A).
"""
from app.dominio.modelos import Pais, Provincia, Canton
from app.servicios_negocio.geografia_servicio import (
    PaisServicio, ProvinciaServicio, CantonServicio,
)


def _crear_pais(db_session, nombre: str) -> Pais:
    pais = Pais(nombre=nombre)
    db_session.add(pais)
    db_session.flush()
    return pais


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


def test_pais_servicio_listar_paises_respeta_skip_y_limit(db_session):
    for nombre in ["Ecuador", "Perú", "Colombia", "Bolivia"]:
        _crear_pais(db_session, nombre)
    db_session.commit()

    servicio = PaisServicio(db_session)

    assert len(servicio.listar_paises()) == 4
    assert len(servicio.listar_paises(skip=0, limit=2)) == 2


def test_provincia_servicio_listar_provincias_respeta_skip_y_limit(db_session):
    pais = _crear_pais(db_session, "Ecuador")
    for nombre in ["Pichincha", "Guayas", "Azuay"]:
        _crear_provincia(db_session, nombre, pais.id)
    db_session.commit()

    servicio = ProvinciaServicio(db_session)

    assert len(servicio.listar_provincias(pais_id=pais.id)) == 3
    assert len(servicio.listar_provincias(pais_id=pais.id, skip=0, limit=1)) == 1


def test_canton_servicio_listar_cantones_respeta_skip_y_limit(db_session):
    pais = _crear_pais(db_session, "Ecuador")
    provincia = _crear_provincia(db_session, "Pichincha", pais.id)
    for nombre in ["Quito", "Rumiñahui", "Mejía"]:
        _crear_canton(db_session, nombre, provincia.id)
    db_session.commit()

    servicio = CantonServicio(db_session)

    assert len(servicio.listar_cantones(provincia_id=provincia.id)) == 3
    assert len(servicio.listar_cantones(provincia_id=provincia.id, skip=0, limit=1)) == 1


