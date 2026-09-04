"""
Hallazgo 6 de la auditoría: recuperación de contraseña honesta (E01-RF003).

El endpoint no debe responder el mensaje de éxito ("se envió un enlace") si
la solicitud no quedó registrada -- eso le miente al usuario legítimo, que se
queda esperando un correo que jamás va a llegar.

Desde el outbox durable ese contrato ya no depende de Celery: el request no
publica ninguna tarea, solo inserta la fila en `recuperacion_outbox` y
commitea (`AuthServicio.solicitar_recuperacion`), y el despacho lo hace beat.
Lo único que puede impedir que la solicitud quede registrada es el commit, y
eso es lo que se prueba acá.

Hasta el issue #764 estos tests parcheaban `enviar_enlace_recuperacion.delay`
para "simular un broker caído". Esa tarea ya no está en el camino vivo, así
que el parche no simulaba nada: los tests pasaban con el broker roto porque
el camino real nunca lo tocaba. El mock se fue con la tarea.

La cadena completa -- fila `PENDIENTE` -> despachador -> worker -> SMTP --
se prueba en `test_recuperacion_extremo_a_extremo.py`.

También cierra dos huecos de cobertura de `restablecer_contrasenia`:
token expirado y cuenta desactivada.
"""
from datetime import datetime, timezone

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Usuario
from app.seguridad.gestor_auth import GestorAutenticacion

MENSAJE_EXITO = "Si el correo está registrado, se envió un enlace de recuperación"
MENSAJE_ERROR_GENERICO = "No se pudo procesar la solicitud. Intente nuevamente más tarde"


def _crear_persona(client, cedula):
    payload = {
        "nombres": "Test", "apellidos": cedula, "cedula": cedula,
        "fecha_nacimiento": "2000-05-14", "telefono": "0991234567",
    }
    return client.post("/api/v1/personas/", json=payload).json()


def _registrar_credenciales(client, cedula, correo, contrasenia="unaClaveSegura1"):
    return client.post(
        "/api/v1/auth/registro",
        json={"cedula": cedula, "correo": correo, "contrasenia": contrasenia},
    )


def _romper_commit(monkeypatch, db_session):
    """El único fallo que puede impedir que la solicitud quede registrada."""

    def _falla():
        raise RuntimeError("la base no acepta el commit")

    monkeypatch.setattr(db_session, "commit", _falla)


# --- Solicitud: el éxito solo se informa si la fila quedó registrada --------
def test_solicitud_existente_queda_en_outbox_sin_depender_del_broker(client, db_session):
    """El request no habla con Redis: PostgreSQL acepta la solicitud y listo."""
    from app.dominio.modelos import RecuperacionOutbox

    persona = _crear_persona(client, cedula_valida(540))
    _registrar_credenciales(client, persona["cedula"], "honesto@x.com")

    resp = client.post("/api/v1/auth/recuperar-contrasenia", json={"correo": "honesto@x.com"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["mensaje"] == MENSAJE_EXITO
    evento = db_session.query(RecuperacionOutbox).one()
    assert evento.status == "PENDIENTE"


def test_solicitud_que_no_se_puede_registrar_no_miente(client, db_session, monkeypatch):
    """Si el commit falla, el usuario NO puede recibir el mensaje de éxito.

    Es el contrato original del hallazgo 6, ahora sobre la costura que de
    verdad existe: sin fila en el outbox no hay nada que despachar, así que
    responder "se envió un enlace" sería una mentira.
    """
    persona = _crear_persona(client, cedula_valida(543))
    _registrar_credenciales(client, persona["cedula"], "sincommit@x.com")
    _romper_commit(monkeypatch, db_session)

    resp = client.post(
        "/api/v1/auth/recuperar-contrasenia", json={"correo": "sincommit@x.com"}
    )

    assert resp.status_code == 503, resp.text
    assert resp.json()["detail"] == MENSAJE_ERROR_GENERICO


def test_publicacion_fallida_con_correo_inexistente_mantiene_exito(client, db_session, monkeypatch):
    """Anti-enumeración: para un correo NO registrado no se toca la base (no
    hay nada que pueda fallar), así que la respuesta sigue siendo el mensaje
    de éxito habitual aun con el commit roto."""
    _romper_commit(monkeypatch, db_session)

    resp = client.post("/api/v1/auth/recuperar-contrasenia", json={"correo": "fantasma@x.com"})

    assert resp.status_code == 200
    assert resp.json()["mensaje"] == MENSAJE_EXITO


def test_solicitud_repetida_no_crea_dos_eventos_activos(client, db_session):
    """El dedupe reusa la fila activa, pero la adelanta.

    Reusarla es obligatorio: `uq_recuperacion_outbox_usuario_activo` es un
    índice parcial único sobre `usuario_id` para `PENDIENTE`/`ENVIANDO`. Lo
    que cambió con el issue #764 es que reusarla ya no significa ignorar la
    petición: `next_attempt_at` se adelanta para que el despachador vuelva a
    mirar la fila en el próximo tick en vez de esperar el backoff.
    """
    from app.dominio.modelos import RecuperacionOutbox

    persona = _crear_persona(client, cedula_valida(541))
    _registrar_credenciales(client, persona["cedula"], "feliz@x.com")

    for _ in range(2):
        resp = client.post(
            "/api/v1/auth/recuperar-contrasenia", json={"correo": "feliz@x.com"}
        )
        assert resp.status_code == 200
        assert resp.json()["mensaje"] == MENSAJE_EXITO

    evento = db_session.query(RecuperacionOutbox).one()
    assert evento.next_attempt_at <= datetime.now(timezone.utc)


# --- Restablecimiento: huecos de cobertura -----------------------------------
def test_restablecer_con_token_expirado_falla(client):
    persona = _crear_persona(client, cedula_valida(542))
    _registrar_credenciales(client, persona["cedula"], "tarde@x.com")

    token_vencido = GestorAutenticacion.crear_token_recuperacion(
        "tarde@x.com", version_contrasenia=1, expiracion_minutos=-1
    )
    resp = client.post(
        "/api/v1/auth/restablecer-contrasenia",
        json={"token": token_vencido, "nueva_contrasenia": "otraclave123"},
    )

    assert resp.status_code == 401
    assert "inválido o expiró" in resp.json()["detail"]


def test_restablecer_con_cuenta_desactivada_falla(client, db_session):
    """Una cuenta suspendida por el Administrador no debe recuperar acceso
    vía restablecimiento de contraseña. Mismo error genérico que un token
    inválido: no se revela el estado de la cuenta."""
    persona = _crear_persona(client, "1780000004")
    _registrar_credenciales(client, persona["cedula"], "suspendido@x.com")

    resp = client.patch(
        f"/api/v1/personas/{persona['id']}/cuenta/estado", json={"activo": False}
    )
    assert resp.status_code == 200

    token = GestorAutenticacion.crear_token_recuperacion(
        "suspendido@x.com", version_contrasenia=1
    )
    resp = client.post(
        "/api/v1/auth/restablecer-contrasenia",
        json={"token": token, "nueva_contrasenia": "otraclave123"},
    )

    assert resp.status_code == 401
    assert "inválido o expiró" in resp.json()["detail"]
    # La contraseña original sigue intacta.
    usuario = db_session.query(Usuario).filter_by(correo="suspendido@x.com").one()
    assert GestorAutenticacion.verificar_contrasenia("unaClaveSegura1", usuario.contrasenia)
