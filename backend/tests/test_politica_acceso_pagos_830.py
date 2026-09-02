"""
Un solo punto de definición para la autorización owner/representante/admin
de pagos y membresías (issue #830).

`PagoServicio.registrar_pago`, `PagoServicio.listar_pagos_de_persona`,
`PagoServicio.adjuntar_voucher` y `MembresiaServicio.
listar_membresias_por_persona` tenían el mismo chequeo escrito a mano en
cada método. Este módulo prueba que, después de migrarlos a
`PoliticaAccesoPersona.puede_acceder`, la decisión vive en un único lugar:
parcheando `puede_acceder` se controla el resultado de los cuatro métodos
por igual, sin tocar nada de sus datos.

No duplica los 403 end-to-end ya cubiertos por HTTP (esos siguen probando
el camino real, sin mockear la política):
`tests/test_ownership_pagos.py::test_alumno_no_puede_registrar_pago_contra_membresia_ajena`,
`tests/test_membresias_pagos.py::test_persona_sin_relacion_no_puede_ver_historial_de_pagos_ajeno`,
`tests/test_voucher_pago.py::test_subir_voucher_sin_ser_duenio_ni_admin_da_403`.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, EstadoPago, TipoModalidad, TipoPago
from app.dominio.excepciones import PermisosInsuficientes
from app.dominio.modelos import Membresia, Persona, Pago, TipoMembresia
from app.servicios_negocio.dtos.membresia_pago_schemas import PagoCreateDTO
from app.servicios_negocio.membresia_pago_servicio import MembresiaServicio, PagoServicio
from app.servicios_negocio.politica_acceso import PoliticaAccesoPersona


@pytest.fixture()
def escenario_pago(db_session):
    """Persona + TipoMembresia + Membresia + Pago mínimos.

    Todos los métodos bajo prueba necesitan una entidad real que resolver
    -- sin esto, `adjuntar_voucher` corta en "el pago no existe" ANTES de
    llegar a invocar la política, y el mock de `puede_acceder` dejaría de
    ser la única variable del test.
    """
    persona = Persona(
        nombres="Titular", apellidos="Prueba", cedula=cedula_valida(910),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    tipo = TipoMembresia(
        categoria="Adultos", precio=Decimal("35.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db_session.add(tipo)
    db_session.flush()
    membresia = Membresia(
        estado=EstadoMembresia.ACTIVA, monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime.now(timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db_session.add(membresia)
    db_session.flush()
    pago = Pago(
        monto=Decimal("35.00"), tipo_pago=TipoPago.TRANSFERENCIA,
        estado_pago=EstadoPago.PENDIENTE_VALIDACION,
        fecha_inicio=date(2029, 1, 1), fecha_fin=date(2029, 2, 1),
        persona_id=persona.id, membresia_id=membresia.id,
    )
    db_session.add(pago)
    db_session.commit()
    return persona.id, membresia.id, pago.id


def _invocar_registrar_pago(db_session, escenario, persona_id_solicitante, roles):
    persona_id, membresia_id, _ = escenario
    datos = PagoCreateDTO(
        meses=1, tipo_pago=TipoPago.TRANSFERENCIA,
        persona_id=persona_id, membresia_id=membresia_id,
    )
    PagoServicio(db_session).registrar_pago(
        datos, persona_id_solicitante=persona_id_solicitante, roles_solicitante=roles,
    )


def _invocar_listar_pagos_de_persona(db_session, escenario, persona_id_solicitante, roles):
    persona_id, _, _ = escenario
    PagoServicio(db_session).listar_pagos_de_persona(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=persona_id_solicitante, roles_solicitante=roles,
    )


def _invocar_adjuntar_voucher(db_session, escenario, persona_id_solicitante, roles):
    _, _, pago_id = escenario
    # content_type inválido: llega hasta el paso 4 del método (sin red,
    # nunca toca Cloudinary) y ahí sí puede fallar con OperacionInvalida --
    # el punto es probar que NO fallÓ antes por PermisosInsuficientes.
    PagoServicio(db_session).adjuntar_voucher(
        pago_id, persona_id_solicitante, roles,
        b"contenido", "text/plain", "voucher.txt",
    )


def _invocar_listar_membresias_por_persona(db_session, escenario, persona_id_solicitante, roles):
    persona_id, _, _ = escenario
    MembresiaServicio(db_session).listar_membresias_por_persona(
        persona_id_objetivo=persona_id,
        persona_id_solicitante=persona_id_solicitante, roles_solicitante=roles,
    )


CASOS = [
    pytest.param(
        _invocar_registrar_pago,
        "Solo la propia persona, su representante, o un administrador "
        "pueden registrar este pago",
        id="registrar_pago",
    ),
    pytest.param(
        _invocar_listar_pagos_de_persona,
        "Solo la propia persona, su representante, o un administrador "
        "pueden ver este historial de pagos",
        id="listar_pagos_de_persona",
    ),
    pytest.param(
        _invocar_adjuntar_voucher,
        "Solo el titular del pago, su representante, o un administrador "
        "pueden adjuntar el voucher",
        id="adjuntar_voucher",
    ),
    pytest.param(
        _invocar_listar_membresias_por_persona,
        "Solo la propia persona, su representante, o un administrador "
        "pueden ver estas membresías",
        id="listar_membresias_por_persona",
    ),
]


@pytest.mark.parametrize("invocar,mensaje", CASOS)
def test_rechaza_cuando_la_politica_deniega(invocar, mensaje, db_session, escenario_pago, monkeypatch):
    """Un solo `puede_acceder` devuelto en `False` alcanza para que los
    cuatro métodos rechacen, con el mensaje propio de cada call site."""
    monkeypatch.setattr(PoliticaAccesoPersona, "puede_acceder", lambda self, **kwargs: False)

    with pytest.raises(PermisosInsuficientes) as excepcion:
        invocar(db_session, escenario_pago, 999, ["ALUMNO"])

    assert str(excepcion.value) == mensaje


@pytest.mark.parametrize("invocar,mensaje", CASOS)
def test_autoriza_cuando_la_politica_concede(invocar, mensaje, db_session, escenario_pago, monkeypatch):
    """`puede_acceder` devuelto en `True` alcanza para que los cuatro
    métodos avancen más allá de la autorización -- incluso con un
    solicitante (`999`, rol ALUMNO) que la relación real de datos jamás
    autorizaría. Lo que pase después (otra excepción de negocio, o éxito)
    no es parte de este contrato; solo que no sea `PermisosInsuficientes`.
    """
    monkeypatch.setattr(PoliticaAccesoPersona, "puede_acceder", lambda self, **kwargs: True)

    try:
        invocar(db_session, escenario_pago, 999, ["ALUMNO"])
    except PermisosInsuficientes:
        pytest.fail(f"{invocar.__name__} rechazó por permisos con la política concediendo acceso")
    except Exception:
        pass  # cualquier otra excepción pertenece a una etapa posterior a la autorización
