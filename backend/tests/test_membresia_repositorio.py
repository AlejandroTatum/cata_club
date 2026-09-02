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
from typing import Optional

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoModalidad, TipoPago
from app.dominio.modelos import Membresia, Pago, Persona, TipoMembresia
from app.infraestructura.repositorios.membresia_repositorio import MembresiaRepositorio


def _crear_persona(db_session, cedula: str, *, representante_id: Optional[int] = None) -> Persona:
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
        representante_id=representante_id,
    )
    db_session.add(persona)
    db_session.flush()
    return persona


def _crear_tipo_membresia(db_session) -> TipoMembresia:
    tipo = TipoMembresia(
        categoria="ADULTOS",
        precio=Decimal("30.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db_session.add(tipo)
    db_session.flush()
    return tipo


def _crear_membresia_activa(
    db_session, persona: Persona, tipo: TipoMembresia, *, fecha_activacion: datetime,
) -> Membresia:
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
        fecha_activacion=fecha_activacion,
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db_session.add(membresia)
    db_session.flush()
    return membresia


def _crear_pago_aprobado(
    db_session, persona: Persona, membresia: Membresia, *,
    fecha_inicio: date, fecha_fin: date,
) -> Pago:
    pago = Pago(
        monto=Decimal("30.00"), estado_pago=EstadoPago.APROBADO, tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=fecha_inicio, fecha_fin=fecha_fin,
        persona_id=persona.id, membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.flush()
    return pago


def _crear_membresias(db_session, cantidad: int) -> None:
    tipo = _crear_tipo_membresia(db_session)
    for i in range(cantidad):
        persona = _crear_persona(db_session, cedula=cedula_valida(350 + i))
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


def test_listar_no_incurre_en_n_mas_uno_al_cargar_relaciones(db_session, contar_selects):
    """`joinedload(persona)` + `joinedload(tipo_membresia)` deben resolverse
    en el MISMO SELECT que trae las membresías. Si degeneran a lazy-load, el
    número de sentencias SQL crecería con la cantidad de filas."""
    _crear_membresias(db_session, cantidad=6)
    db_session.expire_all()  # fuerza recarga real desde la BD, no la identity map

    repo = MembresiaRepositorio(db_session)

    with contar_selects() as sentencias:
        resultado = repo.listar(skip=0, limit=200)
        # Acceder a las relaciones NO debe disparar SELECTs adicionales si el
        # joinedload funcionó; si degenera a lazy-load, cada acceso agrega uno.
        for membresia in resultado:
            _ = membresia.persona.nombres
            _ = membresia.tipo_membresia.categoria

    assert len(resultado) == 6
    selects = [s for s in sentencias if s.strip().upper().startswith("SELECT")]
    assert len(selects) == 1, (
        f"Se esperaba 1 sola sentencia SELECT (joinedload), se ejecutaron "
        f"{len(selects)}: {selects}"
    )


def test_listar_ordena_por_fecha_de_activacion_descendente(db_session):
    """Sin `ORDER BY`, el reparto de filas entre páginas queda a criterio del
    motor: una membresía puede repetirse entre páginas o no aparecer nunca.
    El orden fijado es el mismo criterio que ya usa `PagoRepositorio.listar`
    (lo más reciente primero), con el id como desempate para que sea total."""
    tipo = _crear_tipo_membresia(db_session)
    # Insertadas en orden CRONOLÓGICO ascendente: un listado sin orden
    # devolvería el orden físico de inserción y no pasaría esta aserción.
    fechas = [
        datetime(2026, 1, 10, tzinfo=timezone.utc),
        datetime(2026, 3, 10, tzinfo=timezone.utc),
        datetime(2026, 5, 10, tzinfo=timezone.utc),
    ]
    for i, fecha in enumerate(fechas):
        persona = _crear_persona(db_session, cedula=cedula_valida(360 + i))
        db_session.add(Membresia(
            estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
            fecha_activacion=fecha, persona_id=persona.id,
            tipo_membresia_id=tipo.id,
        ))
    db_session.commit()

    membresias = MembresiaRepositorio(db_session).listar(skip=0, limit=200)

    assert [m.fecha_activacion.date() for m in membresias] == [
        date(2026, 5, 10), date(2026, 3, 10), date(2026, 1, 10),
    ]


def test_listar_desempata_por_id_descendente_con_igual_fecha(db_session):
    tipo = _crear_tipo_membresia(db_session)
    fecha = datetime(2026, 4, 1, tzinfo=timezone.utc)
    creadas = []
    for i in range(3):
        persona = _crear_persona(db_session, cedula=cedula_valida(370 + i))
        membresia = Membresia(
            estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("30.00"),
            fecha_activacion=fecha, persona_id=persona.id,
            tipo_membresia_id=tipo.id,
        )
        db_session.add(membresia)
        db_session.flush()
        creadas.append(membresia)
    db_session.commit()

    membresias = MembresiaRepositorio(db_session).listar(skip=0, limit=200)

    assert [m.id for m in membresias] == [m.id for m in reversed(creadas)]


# --- `contar_membresias_activas_familia` (issue #814) ------------------------
# Antes era `len(listar_membresias_activas_por_representante(...))`: traía
# filas completas solo para descartarlas. Reescrito a SQL, debe seguir
# devolviendo EXACTAMENTE lo mismo que el listado -- incluso cuando el JOIN a
# Pago duplica una Membresia con más de un pago APROBADO solapando
# `en_fecha`, que es justo donde un `COUNT(*)` ingenuo divergería de
# `len(listar(...))`.

def test_contar_membresias_activas_familia_coincide_con_listar_y_es_distinct(db_session):
    tipo = _crear_tipo_membresia(db_session)
    representante = _crear_persona(db_session, cedula_valida(400))
    en_fecha = date(2026, 7, 15)

    representados = [
        _crear_persona(db_session, cedula_valida(401 + i), representante_id=representante.id)
        for i in range(2)
    ]
    membresias_activas = [
        _crear_membresia_activa(
            db_session, representado, tipo,
            fecha_activacion=datetime(2026, 7, 1, tzinfo=timezone.utc),
        )
        for representado in representados
    ]

    # La primera membresía tiene DOS pagos APROBADOS que solapan `en_fecha`:
    # el JOIN produce dos filas para la MISMA membresía. Sin DISTINCT el
    # conteo daría 3 en vez de 2.
    _crear_pago_aprobado(
        db_session, representados[0], membresias_activas[0],
        fecha_inicio=date(2026, 7, 1), fecha_fin=date(2026, 7, 31),
    )
    _crear_pago_aprobado(
        db_session, representados[0], membresias_activas[0],
        fecha_inicio=date(2026, 6, 15), fecha_fin=date(2026, 7, 20),
    )
    _crear_pago_aprobado(
        db_session, representados[1], membresias_activas[1],
        fecha_inicio=date(2026, 7, 1), fecha_fin=date(2026, 7, 31),
    )

    # Una tercera membresía del mismo representante, cuyo pago NO cubre
    # `en_fecha`: fuera de rango, no debe contarse.
    otro_representado = _crear_persona(db_session, cedula_valida(410), representante_id=representante.id)
    membresia_fuera_de_rango = _crear_membresia_activa(
        db_session, otro_representado, tipo,
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    _crear_pago_aprobado(
        db_session, otro_representado, membresia_fuera_de_rango,
        fecha_inicio=date(2026, 1, 1), fecha_fin=date(2026, 1, 31),
    )
    db_session.commit()

    repo = MembresiaRepositorio(db_session)
    listadas = repo.listar_membresias_activas_por_representante(representante.id, en_fecha)
    contadas = repo.contar_membresias_activas_familia(representante.id, en_fecha)

    assert len(listadas) == 2
    assert contadas == 2
    assert contadas == len(listadas)
