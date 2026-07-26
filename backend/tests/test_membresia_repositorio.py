"""
`MembresiaRepositorio.listar` desapareció detrás de un método hermano: su
cuerpo (docstring + `select(...).offset(skip).limit(limit)`) quedó como código
huérfano, sin firma `def`, colgando de `tiene_deudas_pendientes`. Cualquier
llamada a `.listar(skip=..., limit=...)` levantaba `AttributeError`, lo que
`GET /membresias/` propagaba como un 500 (ver `test_membresias_pagos.py` para
la cobertura a nivel API).

Estos tests fijan el contrato del repositorio directamente: paginación
correcta y, sobre todo, que la relación `persona`/`tipo_membresia` se resuelve
con `joinedload` y no dispara una consulta adicional por fila (N+1).
"""
from datetime import date, datetime, timezone
from decimal import Decimal

from app.dominio.enums import EstadoMembresia, TipoModalidad
from app.dominio.modelos import Membresia, Persona, TipoMembresia
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio


def _crear_persona(db_session, cedula: str) -> Persona:
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    return persona


def _crear_tipo_membresia(db_session) -> TipoMembresia:
    tipo = TipoMembresia(
        categoria="ADULTOS", franja_horaria="AM",
        precio=Decimal("30.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db_session.add(tipo)
    db_session.flush()
    return tipo


def _crear_membresias(db_session, cantidad: int) -> None:
    tipo = _crear_tipo_membresia(db_session)
    for i in range(cantidad):
        persona = _crear_persona(db_session, cedula=f"171003{4100 + i}")
        db_session.add(Membresia(
            estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
            fecha_activacion=datetime.now(timezone.utc),
            persona_id=persona.id, tipo_membresia_id=tipo.id,
        ))
    db_session.commit()


def test_listar_devuelve_vacio_cuando_no_hay_membresias(db_session):
    repo = MembresiaRepositorio(db_session)
    assert repo.listar() == []


def test_listar_respeta_skip_y_limit(db_session):
    _crear_membresias(db_session, cantidad=5)
    repo = MembresiaRepositorio(db_session)

    pagina_completa = repo.listar(skip=0, limit=200)
    assert len(pagina_completa) == 5

    primera_pagina = repo.listar(skip=0, limit=2)
    segunda_pagina = repo.listar(skip=2, limit=2)
    assert len(primera_pagina) == 2
    assert len(segunda_pagina) == 2
    assert {m.id for m in primera_pagina}.isdisjoint({m.id for m in segunda_pagina})


def test_listar_no_incurre_en_n_mas_uno_al_cargar_relaciones(db_session):
    """`joinedload(persona)` + `joinedload(tipo_membresia)` deben resolverse
    en el MISMO SELECT que trae las membresías. Si degeneran a lazy-load, el
    número de sentencias SQL crecería con la cantidad de filas."""
    from sqlalchemy import event

    _crear_membresias(db_session, cantidad=6)
    db_session.expire_all()  # fuerza recarga real desde la BD, no la identity map

    repo = MembresiaRepositorio(db_session)

    sentencias: list[str] = []

    def _contar(conn, cursor, statement, parameters, context, executemany):
        sentencias.append(statement)

    engine = db_session.get_bind()
    event.listen(engine, "after_cursor_execute", _contar)
    try:
        resultado = repo.listar(skip=0, limit=200)
        # Acceder a las relaciones NO debe disparar SELECTs adicionales si el
        # joinedload funcionó; si degenera a lazy-load, cada acceso agrega uno.
        for membresia in resultado:
            _ = membresia.persona.nombres
            _ = membresia.tipo_membresia.categoria
    finally:
        event.remove(engine, "after_cursor_execute", _contar)

    assert len(resultado) == 6
    selects = [s for s in sentencias if s.strip().upper().startswith("SELECT")]
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT (joinedload), se ejecutaron "
        f"{len(selects)}: {selects}"
    )
