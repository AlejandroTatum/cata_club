"""Una transferencia reemplaza al efectivo autodeclarado (#1768, S10).

Un socio bloqueado por impago que ya declaró un pago en EFECTIVO (pendiente) y
ahora sube una TRANSFERENCIA no puede quedar atrapado por la regla de «un
pendiente por membresía»: el efectivo se anula solo y la transferencia ocupa su
lugar. Todo otro caso de pendiente duplicado conserva su rechazo de siempre.

Se ejercita por el router (`POST /pagos` y `POST /pagos/{id}/voucher`), el mismo
camino de dos pasos del portal: la transferencia nace sin comprobante y el
bloqueo se levanta recién cuando el comprobante queda adjunto.
"""
from datetime import timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.dominio.enums import EstadoPago, TipoPago
from app.dominio.modelos import Notificacion, Pago
from app.infraestructura.repositorios.bloqueo_impago_repositorio import BloqueoImpagoRepositorio
from app.infraestructura.repositorios.pago_repositorio import PagoRepositorio
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.membresia_pago_servicio import MENSAJE_PAGO_PENDIENTE_DUPLICADO
from app.soporte_transversal.tiempo import hoy_club
from tests.archivos_validos import jpeg_valido
from tests.arnes_bloqueo_impago import agregar_pago, crear_miembro, fijar_lanzamiento

URL_PAGOS = "/api/v1/membresias/pagos"


@pytest.fixture(autouse=True)
def _lanzamiento_lejano(monkeypatch):
    fijar_lanzamiento(monkeypatch)


@pytest.fixture(autouse=True)
def _sin_correos(monkeypatch):
    """El reemplazo no avisa nada al pagador: cualquier envío es un fallo."""
    enviados = []
    monkeypatch.setattr(
        "app.servicios_negocio.membresia_pago_servicio.PagoServicio._enviar_correo_de_validacion_pago",
        lambda self, *a, **k: enviados.append(a),
    )
    return enviados


def _como(persona_id, roles):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "socio@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _moroso(db_session):
    persona, membresia = crear_miembro(db_session, cubierto_hasta=hoy_club() - timedelta(days=10))
    db_session.commit()
    return persona, membresia


def _declarar(client, persona, membresia, tipo):
    return client.post(URL_PAGOS, json={
        "meses": 1, "tipo_pago": tipo, "persona_id": persona.id, "membresia_id": membresia.id,
    })


def _pagos(db_session, membresia):
    db_session.expire_all()
    return list(db_session.scalars(
        select(Pago).where(Pago.membresia_id == membresia.id).order_by(Pago.id)
    ))


def _foto(db_session, membresia):
    return [
        (p.id, p.estado_pago, p.tipo_pago, p.motivo_rechazo, p.validado_por_persona_id, p.fecha_validacion)
        for p in _pagos(db_session, membresia)
    ]


def _bloqueado(db_session, persona):
    db_session.expire_all()
    return BloqueoImpagoRepositorio(db_session).por_persona(persona.id).bloqueado


def _subir_voucher(client, pago_id):
    with patch("app.infraestructura.cloudinary_cliente.subir_voucher_pago", return_value="https://x/y.jpg"):
        return client.post(
            f"{URL_PAGOS}/{pago_id}/voucher",
            files={"archivo": ("voucher.jpg", jpeg_valido(), "image/jpeg")},
        )


# --- El caso de S10 ---------------------------------------------------------------------
def test_la_transferencia_reemplaza_al_efectivo_autodeclarado_del_bloqueado(
    client, db_session, _sin_correos,
):
    persona, membresia = _moroso(db_session)
    _como(persona.id, ["ALUMNO"])
    efectivo = _declarar(client, persona, membresia, "EFECTIVO").json()
    assert _bloqueado(db_session, persona) is True

    respuesta = _declarar(client, persona, membresia, "TRANSFERENCIA")

    assert respuesta.status_code == 201, respuesta.text
    anulado, transferencia = _pagos(db_session, membresia)[-2:]
    assert anulado.id == efectivo["id"]
    assert anulado.autodeclarado is True
    assert anulado.estado_pago == EstadoPago.RECHAZADO
    assert anulado.motivo_rechazo == "Reemplazado por una transferencia"
    assert anulado.validado_por_persona_id is None  # anulación del sistema, sin revisor
    assert transferencia.id == respuesta.json()["id"]
    assert transferencia.estado_pago == EstadoPago.PENDIENTE_VALIDACION
    assert transferencia.tipo_pago == TipoPago.TRANSFERENCIA
    # Sin aviso de rechazo al pagador: ni notificación in-app ni correo.
    assert db_session.scalars(select(Notificacion)).all() == []
    assert _sin_correos == []
    # Mientras no haya comprobante sigue bloqueado; con el comprobante, se levanta.
    assert _bloqueado(db_session, persona) is True
    assert _subir_voucher(client, transferencia.id).status_code == 201
    assert _bloqueado(db_session, persona) is False


def test_el_representante_tambien_reemplaza_el_efectivo_del_hijo_bloqueado(client, db_session):
    from tests.fabricas_pagos import crear_persona_orm
    padre = crear_persona_orm(db_session, "1710034065", nombres="Pat", apellidos="Padre")
    hijo, membresia = crear_miembro(
        db_session, cubierto_hasta=hoy_club() - timedelta(days=10), representante=padre,
    )
    db_session.commit()
    _como(padre.id, ["REPRESENTANTE"])
    efectivo = _declarar(client, hijo, membresia, "EFECTIVO").json()

    respuesta = _declarar(client, hijo, membresia, "TRANSFERENCIA")

    assert respuesta.status_code == 201, respuesta.text
    por_id = {p.id: p for p in _pagos(db_session, membresia)}
    assert por_id[efectivo["id"]].estado_pago == EstadoPago.RECHAZADO
    assert por_id[respuesta.json()["id"]].estado_pago == EstadoPago.PENDIENTE_VALIDACION


def test_si_la_transferencia_no_se_puede_crear_el_efectivo_sigue_pendiente(
    client, db_session, monkeypatch,
):
    persona, membresia = _moroso(db_session)
    _como(persona.id, ["ALUMNO"])
    _declarar(client, persona, membresia, "EFECTIVO")
    antes = _foto(db_session, membresia)

    def _falla(self, pago):
        raise RuntimeError("fallo al insertar")

    monkeypatch.setattr(PagoRepositorio, "crear", _falla)
    with pytest.raises(RuntimeError):
        _declarar(client, persona, membresia, "TRANSFERENCIA")

    assert _foto(db_session, membresia) == antes


# --- Todo lo demás se rechaza como hoy, sin tocar lo guardado ----------------------------
def _assert_rechazo_de_siempre(respuesta, db_session, membresia, antes):
    assert respuesta.status_code == 400, respuesta.text
    assert MENSAJE_PAGO_PENDIENTE_DUPLICADO in respuesta.text
    assert _foto(db_session, membresia) == antes


def test_sin_bloqueo_el_pendiente_duplicado_se_rechaza_como_hoy(client, db_session):
    persona, membresia = crear_miembro(db_session, cubierto_hasta=hoy_club() - timedelta(days=2))
    db_session.commit()
    _como(persona.id, ["ALUMNO"])
    assert _bloqueado(db_session, persona) is False
    _declarar(client, persona, membresia, "EFECTIVO")
    antes = _foto(db_session, membresia)

    respuesta = _declarar(client, persona, membresia, "TRANSFERENCIA")

    _assert_rechazo_de_siempre(respuesta, db_session, membresia, antes)


def test_un_pendiente_que_ya_es_transferencia_se_rechaza_como_hoy(client, db_session):
    persona, membresia = _moroso(db_session)
    _como(persona.id, ["ALUMNO"])
    _declarar(client, persona, membresia, "TRANSFERENCIA")
    antes = _foto(db_session, membresia)

    respuesta = _declarar(client, persona, membresia, "TRANSFERENCIA")

    _assert_rechazo_de_siempre(respuesta, db_session, membresia, antes)


def test_el_efectivo_registrado_por_el_admin_no_se_anula(client, db_session):
    persona, membresia = _moroso(db_session)
    _como(999_999, ["ADMINISTRADOR"])
    registrado = _declarar(client, persona, membresia, "EFECTIVO")
    assert registrado.status_code == 201, registrado.text
    assert _pagos(db_session, membresia)[-1].autodeclarado is False
    antes = _foto(db_session, membresia)
    _como(persona.id, ["ALUMNO"])

    respuesta = _declarar(client, persona, membresia, "TRANSFERENCIA")

    _assert_rechazo_de_siempre(respuesta, db_session, membresia, antes)


def test_la_transferencia_cargada_por_el_admin_no_anula_el_efectivo_del_socio(client, db_session):
    """S10 es un alivio para el socio desde el portal: el admin que carga una
    transferencia no anula el efectivo que el socio declaró."""
    persona, membresia = _moroso(db_session)
    _como(persona.id, ["ALUMNO"])
    _declarar(client, persona, membresia, "EFECTIVO")
    antes = _foto(db_session, membresia)
    _como(999_999, ["ADMINISTRADOR"])

    respuesta = _declarar(client, persona, membresia, "TRANSFERENCIA")

    _assert_rechazo_de_siempre(respuesta, db_session, membresia, antes)


def test_un_efectivo_sin_marca_de_origen_no_se_anula(client, db_session):
    persona, membresia = _moroso(db_session)
    agregar_pago(
        db_session, persona, membresia, EstadoPago.PENDIENTE_VALIDACION,
        tipo_pago=TipoPago.EFECTIVO, fecha_inicio=hoy_club(), fecha_fin=hoy_club() + timedelta(days=30),
    )
    db_session.commit()
    antes = _foto(db_session, membresia)
    _como(persona.id, ["ALUMNO"])

    respuesta = _declarar(client, persona, membresia, "TRANSFERENCIA")

    _assert_rechazo_de_siempre(respuesta, db_session, membresia, antes)


def test_un_pago_nuevo_en_efectivo_se_rechaza_como_hoy(client, db_session):
    persona, membresia = _moroso(db_session)
    _como(persona.id, ["ALUMNO"])
    _declarar(client, persona, membresia, "EFECTIVO")
    antes = _foto(db_session, membresia)

    respuesta = _declarar(client, persona, membresia, "EFECTIVO")

    _assert_rechazo_de_siempre(respuesta, db_session, membresia, antes)
