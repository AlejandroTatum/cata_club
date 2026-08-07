"""
Fábricas compartidas del grafo persona → tipo → membresía → pago.

Varias suites necesitan construir exactamente el mismo grafo mínimo para
ejercitar el ciclo de pagos: `test_invariantes_constraints.py` (constraints
de Postgres), `test_pago_comprobante_atomico.py` (guardia de estado y
reconciliación de comprobantes). Antes cada archivo duplicaba sus propias
fábricas; este módulo es la única copia (mismo criterio que
`arnes_migraciones.py`: helpers de tests viven como módulo en `tests/`).

Dos familias, según lo que la prueba quiera demostrar:

- `*_orm`: escriben directo por SQLAlchemy, SALTÁNDOSE los chequeos de los
  servicios a propósito (para probar que la base o el lock los respalda).
  `crear_pago_orm` NO hace flush: las pruebas de constraints necesitan
  decidir ellas cuándo flushear para atrapar el `IntegrityError`.
- `*_api`: pasan por los endpoints reales con el `client` de conftest
  (camino de negocio completo, mismos payloads que usa el frontend).
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from app.dominio.enums import EstadoMembresia, EstadoPago, TipoModalidad, TipoPago
from app.dominio.modelos import Membresia, Pago, Persona, TipoMembresia


# --- Fábricas ORM (burlan los servicios a propósito) -------------------------

def crear_persona_orm(
    sesion,
    cedula: str,
    *,
    nombres: str = "Invariante",
    apellidos: str = "Constraint",
    telefono: str = "0990001111",
    fecha_nacimiento: date = date(1990, 1, 1),
) -> Persona:
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=fecha_nacimiento, telefono=telefono,
    )
    sesion.add(persona)
    sesion.flush()
    return persona


def crear_tipo_membresia_orm(
    sesion,
    *,
    categoria: str = "Adultos",
    precio: Decimal = Decimal("30.00"),
) -> TipoMembresia:
    tipo = TipoMembresia(
        categoria=categoria, precio=precio, modalidad=TipoModalidad.MENSUAL,
    )
    sesion.add(tipo)
    sesion.flush()
    return tipo


def crear_membresia_orm(
    sesion,
    persona: Persona,
    tipo: TipoMembresia,
    estado: EstadoMembresia,
    *,
    monto_aplicado: Decimal = Decimal("30.00"),
    fecha_activacion: Optional[datetime] = None,
) -> Membresia:
    membresia = Membresia(
        estado=estado, monto_aplicado=monto_aplicado,
        fecha_activacion=fecha_activacion or datetime.now(timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    sesion.add(membresia)
    sesion.flush()
    return membresia


def crear_pago_orm(
    sesion,
    persona: Persona,
    membresia: Membresia,
    estado: EstadoPago,
    *,
    monto: Decimal = Decimal("30.00"),
    tipo_pago: TipoPago = TipoPago.EFECTIVO,
    fecha_validacion: Optional[datetime] = None,
) -> Pago:
    """`add` SIN flush: los tests de constraints deciden cuándo flushear."""
    pago = Pago(
        monto=monto, estado_pago=estado, tipo_pago=tipo_pago,
        fecha_validacion=fecha_validacion,
        fecha_inicio=date(2026, 7, 1), fecha_fin=date(2026, 7, 31),
        persona_id=persona.id, membresia_id=membresia.id,
    )
    sesion.add(pago)
    return pago


# --- Fábricas API (camino de negocio completo) -------------------------------

def crear_persona_api(client, cedula: str = "1710034065",
                      *, fecha_nacimiento: str = "2010-05-14") -> dict:
    return client.post(
        "/api/v1/personas/",
        json={
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": fecha_nacimiento, "telefono": "0991234567",
        },
    ).json()


def crear_tipo_membresia_api(client) -> dict:
    return client.post(
        "/api/v1/membresias/tipos",
        json={
            "categoria": "Adultos",
            "precio": "35.00", "modalidad": "MENSUAL",
        },
    ).json()


def crear_membresia_api(client, persona_id: int, tipo_id: int) -> dict:
    return client.post(
        "/api/v1/membresias/",
        json={
            "monto_aplicado": "35.00", "fecha_activacion": "2026-07-01T00:00:00",
            "persona_id": persona_id, "tipo_membresia_id": tipo_id,
        },
    ).json()


def registrar_pago_api(
    client,
    persona_id: int,
    membresia_id: int,
    *,
    monto: str = "35.00",
    descuento_ids: Optional[list[int]] = None,
):
    """POST /membresias/pagos devolviendo la Response CRUDA (no .json()):
    las pruebas de descuentos (issue #11) necesitan asertar también los
    códigos de error (400/403/404), no solo el cuerpo del caso feliz."""
    payload = {
        "monto": monto, "tipo_pago": "TRANSFERENCIA",
        "fecha_inicio": "2026-07-01", "fecha_fin": "2026-07-31",
        "persona_id": persona_id, "membresia_id": membresia_id,
    }
    if descuento_ids is not None:
        payload["descuento_ids"] = descuento_ids
    return client.post("/api/v1/membresias/pagos", json=payload)


def crear_pago_api(client, persona_id: int, membresia_id: int) -> dict:
    return registrar_pago_api(client, persona_id, membresia_id).json()


def escenario_membresia_sin_pago_api(client) -> tuple[dict, dict]:
    """Persona + tipo + membresía (sin ningún pago todavía) vía API.
    Devuelve (persona, membresia). Base común de las pruebas que registran
    el pago con variantes propias (ej. con descuentos aplicados)."""
    persona = crear_persona_api(client)
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona["id"], tipo["id"])
    return persona, membresia


def escenario_pago_pendiente_api(client) -> tuple[dict, dict, dict]:
    """Persona + tipo + membresía + pago PENDIENTE_VALIDACION vía API.
    Devuelve (persona, membresia, pago)."""
    persona, membresia = escenario_membresia_sin_pago_api(client)
    pago = crear_pago_api(client, persona["id"], membresia["id"])
    return persona, membresia, pago
