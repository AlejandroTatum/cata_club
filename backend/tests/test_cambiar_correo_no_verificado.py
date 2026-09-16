"""
Corrección del correo de una cuenta sin verificar (issue #1245).

Contexto: la autoinscripción pública auto-loguea al visitante con el correo
tal como lo tipeó (`enrollment_servicio.py`, `_emitir_tokens`). Si lo tipeó
mal, el enlace de verificación nunca llega y no había forma de corregirlo --
reinscribirse choca con el 409/400 de cédula duplicada antes de llegar
siquiera a mirar el correo (`enrollment_servicio.enroll`, precheck de
cédula). `PATCH /auth/correo` es la única puerta, y se cierra sola en
cuanto `correo_verificado` pasa a True (ver docstring de
`AuthServicio.cambiar_correo_no_verificado`).

Cubre:
  - 200: `usuario.correo` actualizado, las filas de
    `VerificacionCorreoOutbox` viejas desaparecen y queda exactamente una
    fila PENDIENTE nueva para la dirección corregida.
  - Cuenta ya verificada -> rechazado, nada cambia.
  - Dirección ya usada por otra cuenta -> rechazado, nada cambia.
  - Correo mal formado -> 422 (antes de tocar el servicio).
  - Sin token -> 401.
"""
from app.dominio.cedula import cedula_valida
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA, MENSAJE_VERIFICACION_ENVIADA
from app.dominio.modelos import Usuario, VerificacionCorreoOutbox
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_auth import crear_usuario_auth


def _restaurar_override_token(correo, persona_id=1, roles=None):
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": correo, "persona_id": persona_id, "roles": roles or [],
    }


def _con_fila_pendiente(db_session, usuario) -> VerificacionCorreoOutbox:
    from datetime import datetime, timedelta, timezone
    fila = VerificacionCorreoOutbox(
        usuario_id=usuario.id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db_session.add(fila)
    db_session.commit()
    return fila


def test_corrige_el_correo_borra_la_fila_vieja_y_encola_una_nueva(client, db_session):
    cuenta = crear_usuario_auth(db_session, correo="sofia@tpyo.com")
    _con_fila_pendiente(db_session, cuenta)
    _restaurar_override_token(correo="sofia@tpyo.com", persona_id=cuenta.persona_id)

    resp = client.patch("/api/v1/auth/correo", json={"correo": "sofia@example.com"})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["correo"] == "sofia@example.com"
    assert body["mensaje"] == MENSAJE_VERIFICACION_ENVIADA
    assert body["accessToken"]
    assert body["refreshToken"]

    db_session.expire_all()
    assert db_session.get(Usuario, cuenta.id).correo == "sofia@example.com"

    filas = db_session.query(VerificacionCorreoOutbox).filter(
        VerificacionCorreoOutbox.usuario_id == cuenta.id,
    ).all()
    assert [(f.status,) for f in filas] == [("PENDIENTE",)]


def test_una_cuenta_ya_verificada_no_puede_cambiar_su_correo(client, db_session):
    cuenta = crear_usuario_auth(db_session, correo="verificada@cataclub.test")
    cuenta.correo_verificado = True
    db_session.commit()
    _con_fila_pendiente(db_session, cuenta)
    _restaurar_override_token(correo="verificada@cataclub.test", persona_id=cuenta.persona_id)

    resp = client.patch("/api/v1/auth/correo", json={"correo": "otra@example.com"})

    assert resp.status_code == 400, resp.text
    db_session.expire_all()
    assert db_session.get(Usuario, cuenta.id).correo == "verificada@cataclub.test"
    assert db_session.query(VerificacionCorreoOutbox).filter(
        VerificacionCorreoOutbox.usuario_id == cuenta.id,
    ).count() == 1


def test_la_direccion_nueva_ya_pertenece_a_otra_cuenta(client, db_session):
    crear_usuario_auth(db_session, correo="ocupado@cataclub.com", cedula=cedula_valida(900))
    propia = crear_usuario_auth(db_session, correo="propia@cataclub.test", cedula=cedula_valida(901))
    _restaurar_override_token(correo="propia@cataclub.test", persona_id=propia.persona_id)

    resp = client.patch("/api/v1/auth/correo", json={"correo": "ocupado@cataclub.com"})

    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == MENSAJE_IDENTIDAD_DUPLICADA
    db_session.expire_all()
    assert db_session.get(Usuario, propia.id).correo == "propia@cataclub.test"


def test_un_correo_mal_formado_da_422(client, db_session):
    cuenta = crear_usuario_auth(db_session, correo="tipeo@cataclub.test")
    _restaurar_override_token(correo="tipeo@cataclub.test", persona_id=cuenta.persona_id)

    resp = client.patch("/api/v1/auth/correo", json={"correo": "no-es-un-correo"})

    assert resp.status_code == 422, resp.text
    db_session.expire_all()
    assert db_session.get(Usuario, cuenta.id).correo == "tipeo@cataclub.test"


def test_cambiar_correo_requiere_autenticacion(client_sin_token):
    resp = client_sin_token.patch("/api/v1/auth/correo", json={"correo": "nuevo@example.com"})
    assert resp.status_code == 401
