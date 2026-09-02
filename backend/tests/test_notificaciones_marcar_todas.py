"""
Marcar TODAS las notificaciones pendientes como leídas (issue #859).

`PATCH /api/v1/ranking/notificaciones/leer-todas` no acepta ids: el alcance
se resuelve enteramente en el BACKEND, con el mismo criterio que ya usa el
feed paginado del representante (`NotificacionServicio.
_resolver_ids_autorizados`, compartido con `listar_para_persona_y_hijos` para
que las dos consultas no puedan divergir) -- la persona propia y sus
dependientes ACTIVOS, nunca un dependiente dado de baja ni otra familia.

Cubre: propias, propias + hijos activos (excluyendo hijo inactivo y otra
familia), filas ya leídas (el conteo solo suma las que cambiaron), no
autenticado, que la ruta literal `/leer-todas` no choque con
`/{notificacion_id}/leer`, y que funcione más allá de las 20 filas que pagina
`GET /mias`.
"""
from datetime import date, datetime, timezone

from fastapi.testclient import TestClient

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoNotificacion
from app.dominio.modelos import Notificacion, Persona
from app.infraestructura.db import obtener_sesion
from app.seguridad.gestor_auth import GestorAutenticacion
from main import app

FECHA = datetime(2029, 1, 1, tzinfo=timezone.utc)


def _crear_persona(db_session, secuencia_cedula: int, representante_id: int = None) -> Persona:
    persona = Persona(
        nombres="Ana", apellidos="Vega", cedula=cedula_valida(secuencia_cedula),
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
        representante_id=representante_id,
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _crear_notificaciones(db_session, persona_id: int, cantidad: int, leida: bool = False) -> None:
    db_session.add_all([
        Notificacion(
            tipo=TipoNotificacion.PAGO_APROBADO, mensaje=f"n{i}",
            persona_id=persona_id, leida=leida, fecha_creacion=FECHA,
        )
        for i in range(cantidad)
    ])
    db_session.commit()


def _no_leidas(db_session, persona_id: int) -> int:
    return (
        db_session.query(Notificacion)
        .filter(Notificacion.persona_id == persona_id, Notificacion.leida.is_(False))
        .count()
    )


def _client_como(db_session, persona_id: int, roles: list[str]) -> TestClient:
    """Cliente autenticado con `persona_id`/`roles` arbitrarios (mismo idiom que
    `test_notificaciones_paginacion.py::_client_como`)."""
    def _sesion():
        yield db_session

    app.dependency_overrides[obtener_sesion] = _sesion
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "test@cataclub.test", "persona_id": persona_id, "roles": roles,
    }
    return TestClient(app)


def test_marca_las_propias_notificaciones_como_leidas(client, db_session):
    # `client` autentica con persona_id=1 (ver conftest.py); la primera
    # Persona creada en este test se lleva ese id (decisión 1.4, reseteo de
    # secuencias por test).
    propia = _crear_persona(db_session, secuencia_cedula=1)
    assert propia.id == 1
    _crear_notificaciones(db_session, propia.id, cantidad=3)

    respuesta = client.patch("/api/v1/ranking/notificaciones/leer-todas")

    assert respuesta.status_code == 200
    assert respuesta.json()["actualizadas"] == 3
    assert _no_leidas(db_session, propia.id) == 0


def test_representante_marca_propias_e_hijos_activos_no_hijo_inactivo_ni_otra_familia(db_session):
    representante = _crear_persona(db_session, secuencia_cedula=10)
    hijo_activo = _crear_persona(db_session, secuencia_cedula=11, representante_id=representante.id)
    hijo_inactivo = _crear_persona(db_session, secuencia_cedula=12, representante_id=representante.id)
    hijo_inactivo.activo = False
    db_session.add(hijo_inactivo)
    db_session.commit()
    otra_familia = _crear_persona(db_session, secuencia_cedula=13)

    _crear_notificaciones(db_session, representante.id, cantidad=2)
    _crear_notificaciones(db_session, hijo_activo.id, cantidad=2)
    _crear_notificaciones(db_session, hijo_inactivo.id, cantidad=1)
    _crear_notificaciones(db_session, otra_familia.id, cantidad=1)

    with _client_como(db_session, representante.id, ["REPRESENTANTE"]) as c:
        respuesta = c.patch("/api/v1/ranking/notificaciones/leer-todas")
    app.dependency_overrides.clear()

    assert respuesta.status_code == 200
    assert respuesta.json()["actualizadas"] == 4
    assert _no_leidas(db_session, representante.id) == 0
    assert _no_leidas(db_session, hijo_activo.id) == 0
    assert _no_leidas(db_session, hijo_inactivo.id) == 1
    assert _no_leidas(db_session, otra_familia.id) == 1


def test_filas_ya_leidas_no_se_cuentan(client, db_session):
    propia = _crear_persona(db_session, secuencia_cedula=20)
    assert propia.id == 1
    _crear_notificaciones(db_session, propia.id, cantidad=2, leida=True)
    _crear_notificaciones(db_session, propia.id, cantidad=3, leida=False)

    respuesta = client.patch("/api/v1/ranking/notificaciones/leer-todas")

    assert respuesta.status_code == 200
    assert respuesta.json()["actualizadas"] == 3


def test_no_autenticado_devuelve_401(client_sin_token):
    respuesta = client_sin_token.patch("/api/v1/ranking/notificaciones/leer-todas")

    assert respuesta.status_code == 401


def test_ruta_leer_todas_no_choca_con_la_ruta_de_id(client, db_session):
    """Guardarraíl de orden de declaración: `/leer-todas` está registrada
    ANTES que `/{notificacion_id}/leer` en el router. Sin notificaciones
    pendientes, la respuesta tiene que ser 200 con `actualizadas: 0` -- nunca
    un 404/422 que delataría que el segmento literal fue capturado por otra
    ruta."""
    propia = _crear_persona(db_session, secuencia_cedula=30)
    assert propia.id == 1

    respuesta = client.patch("/api/v1/ranking/notificaciones/leer-todas")

    assert respuesta.status_code == 200
    assert respuesta.json() == {"actualizadas": 0}


def test_funciona_mas_alla_de_las_20_filas_que_pagina_mias(client, db_session):
    propia = _crear_persona(db_session, secuencia_cedula=40)
    assert propia.id == 1
    _crear_notificaciones(db_session, propia.id, cantidad=25)

    respuesta = client.patch("/api/v1/ranking/notificaciones/leer-todas")

    assert respuesta.status_code == 200
    assert respuesta.json()["actualizadas"] == 25
    assert _no_leidas(db_session, propia.id) == 0
