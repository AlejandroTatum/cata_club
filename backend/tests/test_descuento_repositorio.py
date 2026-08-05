"""
Tests de paginación y conteo de `DescuentoRepositorio`.

A diferencia de geografía, este catálogo mantiene su orden por `id` (Design
D4): `/descuentos` tiene un consumidor real (`frontend/src/app/discounts/
page.tsx`) y reordenarlo sería un cambio de comportamiento visible sobre un
endpoint ya consumido. `id` ya es un orden TOTAL, así que la paginación
sobre él ya es determinística sin necesidad de un desempate adicional.
"""
from decimal import Decimal

from app.dominio.modelos import Descuento
from app.infraestructura.repositorios.descuento_repositorio import DescuentoRepositorio


def _crear_descuento(db_session, nombre: str, *, porcentaje=None, monto=None, activo=True) -> Descuento:
    descuento = Descuento(nombre=nombre, porcentaje=porcentaje, monto=monto, activo=activo)
    db_session.add(descuento)
    db_session.flush()
    return descuento


def _crear_descuentos(db_session, cantidad: int) -> None:
    for i in range(cantidad):
        _crear_descuento(db_session, nombre=f"Descuento {i}", porcentaje=Decimal("10"))
    db_session.commit()


def test_descuento_listar_sin_argumentos_devuelve_todo_ordenado_por_id(db_session):
    """Caracterización (no RED): `DescuentoServicio.listar()` sin argumentos
    hoy espera el catálogo completo sin límite. El orden por `id` NO cambia
    (D4): a diferencia de geografía, este catálogo tiene un consumidor real."""
    d1 = _crear_descuento(db_session, "Beca municipal", porcentaje=Decimal("100"))
    d2 = _crear_descuento(db_session, "Convenio empresa", monto=Decimal("10.00"))
    db_session.commit()

    resultado = DescuentoRepositorio(db_session).listar()

    assert [d.id for d in resultado] == [d1.id, d2.id]


def test_descuento_listar_skip_limit_pagina(db_session):
    _crear_descuentos(db_session, cantidad=5)
    repo = DescuentoRepositorio(db_session)

    pagina_completa = repo.listar(skip=0, limit=200)
    assert len(pagina_completa) == 5

    primera_pagina = repo.listar(skip=0, limit=2)
    segunda_pagina = repo.listar(skip=2, limit=2)
    assert len(primera_pagina) == 2
    assert len(segunda_pagina) == 2
    assert {d.id for d in primera_pagina}.isdisjoint({d.id for d in segunda_pagina})


def test_descuento_contar_devuelve_total_sin_importar_limit(db_session):
    """El `total` del envelope de paginación debe reflejar el conjunto
    completo, no la página: `contar()` no debe verse afectado por `limit`."""
    _crear_descuentos(db_session, cantidad=4)
    repo = DescuentoRepositorio(db_session)

    assert repo.contar() == 4
    assert len(repo.listar(limit=1)) == 1
