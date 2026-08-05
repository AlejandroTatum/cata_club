"""
Tests de la capa de servicio de descuentos: el pass-through de `skip`/
`limit` y el nuevo `contar_descuentos()` (D7), espejo de `geografia_servicio`.

Se prueban directamente contra `db_session`, sin pasar por los routers
(fuera del alcance de este track: `presentacion/routers/**` lo integra
Track A).
"""
from decimal import Decimal

from app.dominio.modelos import Descuento
from app.servicios_negocio.descuento_servicio import DescuentoServicio


def _crear_descuento(db_session, nombre: str, *, porcentaje=None) -> Descuento:
    descuento = Descuento(nombre=nombre, porcentaje=porcentaje)
    db_session.add(descuento)
    db_session.flush()
    return descuento


def test_descuento_servicio_listar_respeta_skip_y_limit(db_session):
    for i in range(4):
        _crear_descuento(db_session, f"Descuento {i}", porcentaje=Decimal("10"))
    db_session.commit()

    servicio = DescuentoServicio(db_session)

    assert len(servicio.listar()) == 4
    assert len(servicio.listar(skip=0, limit=2)) == 2


def test_descuento_servicio_contar_descuentos_coincide_con_el_total(db_session):
    for i in range(3):
        _crear_descuento(db_session, f"Descuento {i}", porcentaje=Decimal("10"))
    db_session.commit()

    servicio = DescuentoServicio(db_session)

    assert servicio.contar_descuentos() == 3
    assert servicio.contar_descuentos() == len(servicio.listar())
