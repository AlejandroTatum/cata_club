"""
Tests de la capa de servicio de geografía (Pais, Provincia, Canton): los
pass-throughs de `skip`/`limit` y los nuevos métodos `contar_*` (D7).

Se prueban directamente contra `db_session`, sin pasar por los routers
(fuera del alcance de este track: `presentacion/routers/**` lo integra
Track A).
"""
from app.dominio.modelos import Pais
from app.servicios_negocio.geografia_servicio import PaisServicio


def _crear_pais(db_session, nombre: str) -> Pais:
    pais = Pais(nombre=nombre)
    db_session.add(pais)
    db_session.flush()
    return pais


def test_pais_servicio_listar_paises_respeta_skip_y_limit(db_session):
    for nombre in ["Ecuador", "Perú", "Colombia", "Bolivia"]:
        _crear_pais(db_session, nombre)
    db_session.commit()

    servicio = PaisServicio(db_session)

    assert len(servicio.listar_paises()) == 4
    assert len(servicio.listar_paises(skip=0, limit=2)) == 2


def test_pais_servicio_contar_paises_coincide_con_el_total(db_session):
    for nombre in ["Ecuador", "Perú", "Colombia"]:
        _crear_pais(db_session, nombre)
    db_session.commit()

    servicio = PaisServicio(db_session)

    assert servicio.contar_paises() == 3
    assert servicio.contar_paises() == len(servicio.listar_paises())
