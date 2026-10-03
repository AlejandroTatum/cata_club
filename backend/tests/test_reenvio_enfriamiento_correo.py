"""
Enfriamiento de 2 minutos por cuenta entre reenvíos de correo (QA3, GAP-01).

El límite por IP (10/min) no frena a quien pide un enlace nuevo cada minuto
para el MISMO correo: cada petición gastaba cupo diario de correos. Ahora, una
cuenta que ya recibió (o tiene recién encolado) un correo del mismo tipo no
encola otro hasta pasados 2 minutos.

Ambos endpoints son públicos y anti-enumeración: durante el enfriamiento la
respuesta es IDÉNTICA a la normal (mismo 200 y mismo mensaje), de modo que
nadie puede distinguir una cuenta existente de una inexistente.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import RecuperacionOutbox, VerificacionCorreoOutbox
from app.servicios_negocio.auth_servicio import AuthServicio
from tests.fabricas_auth import crear_usuario_auth

CASOS = [
    pytest.param(RecuperacionOutbox, "solicitar_recuperacion", 8430, id="recuperacion"),
    pytest.param(
        VerificacionCorreoOutbox, "solicitar_verificacion_correo", 8435, id="verificacion"
    ),
]


def _filas(db_session, modelo, usuario):
    db_session.expire_all()
    return db_session.query(modelo).filter(modelo.usuario_id == usuario.id).all()


def _marcar_enviada_hace(db_session, fila, delta):
    instante = datetime.now(timezone.utc) - delta
    fila.status, fila.sent_at, fila.created_at = "ENVIADO", instante, instante
    db_session.commit()


@pytest.mark.parametrize("modelo,metodo,semilla", CASOS)
def test_segunda_peticion_dentro_de_2_minutos_no_encola_otro_correo(
    db_session, modelo, metodo, semilla
):
    usuario = crear_usuario_auth(db_session, correo=f"{metodo}@cataclub.test", cedula=cedula_valida(semilla))
    servicio = AuthServicio(db_session)
    primera = getattr(servicio, metodo)(usuario.correo)
    _marcar_enviada_hace(db_session, _filas(db_session, modelo, usuario)[0], timedelta(seconds=62))

    segunda = getattr(servicio, metodo)(usuario.correo)

    assert len(_filas(db_session, modelo, usuario)) == 1
    assert segunda == primera, "la respuesta no debe delatar el enfriamiento"


@pytest.mark.parametrize("modelo,metodo,semilla", CASOS)
def test_pasados_2_minutos_se_vuelve_a_encolar(db_session, modelo, metodo, semilla):
    usuario = crear_usuario_auth(db_session, correo=f"{metodo}@cataclub.test", cedula=cedula_valida(semilla + 1))
    servicio = AuthServicio(db_session)
    getattr(servicio, metodo)(usuario.correo)
    _marcar_enviada_hace(db_session, _filas(db_session, modelo, usuario)[0], timedelta(seconds=125))

    getattr(servicio, metodo)(usuario.correo)

    assert len(_filas(db_session, modelo, usuario)) == 2


@pytest.mark.parametrize("modelo,metodo,semilla", CASOS)
def test_el_enfriamiento_es_por_cuenta(db_session, modelo, metodo, semilla):
    uno = crear_usuario_auth(db_session, correo=f"uno.{metodo}@cataclub.test", cedula=cedula_valida(semilla + 2))
    otro = crear_usuario_auth(db_session, correo=f"otro.{metodo}@cataclub.test", cedula=cedula_valida(semilla + 3))
    servicio = AuthServicio(db_session)
    getattr(servicio, metodo)(uno.correo)
    _marcar_enviada_hace(db_session, _filas(db_session, modelo, uno)[0], timedelta(seconds=10))

    getattr(servicio, metodo)(otro.correo)

    assert len(_filas(db_session, modelo, otro)) == 1
