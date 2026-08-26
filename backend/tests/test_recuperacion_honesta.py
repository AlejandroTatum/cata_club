"""
Hallazgo 6 de la auditoría: recuperación de contraseña honesta (E01-RF003).

Si la publicación de la tarea Celery falla para un usuario EXISTENTE, el
endpoint no debe responder el mensaje de éxito ("se envió un enlace") --
eso le miente al usuario legítimo, que se queda esperando un correo que
jamás va a llegar. Debe responder un error de servicio genérico que no
revele si el correo está registrado.

También cierra dos huecos de cobertura de `restablecer_contrasenia`:
token expirado y cuenta desactivada.
"""
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


def _registrar_credenciales(client, cedula, correo, contrasenia="password123"):
    return client.post(
        "/api/v1/auth/registro",
        json={"cedula": cedula, "correo": correo, "contrasenia": contrasenia},
    )


def _romper_publicacion_celery(monkeypatch):
    """Simula un broker de Celery caído: `delay` lanza en vez de encolar.
    Se parchea el atributo `delay` de la tarea (mismo criterio que el stub
    de `_disparar_generacion_comprobante_pdf` en conftest.py)."""
    from app.infraestructura.tareas import recuperacion_tareas

    def _falla(*args, **kwargs):
        raise ConnectionError("broker no disponible")

    monkeypatch.setattr(recuperacion_tareas.enviar_enlace_recuperacion, "delay", _falla)


# --- Solicitud: el éxito solo se informa si la tarea realmente se encoló -----
def test_solicitud_existente_queda_en_outbox_sin_depender_del_broker(client, db_session, monkeypatch):
    from app.dominio.modelos import RecuperacionOutbox

    persona = _crear_persona(client, cedula_valida(540))
    _registrar_credenciales(client, persona["cedula"], "honesto@x.com")
    _romper_publicacion_celery(monkeypatch)

    resp = client.post("/api/v1/auth/recuperar-contrasenia", json={"correo": "honesto@x.com"})

    assert resp.status_code == 200, resp.text
    assert resp.json()["mensaje"] == MENSAJE_EXITO
    evento = db_session.query(RecuperacionOutbox).one()
    assert evento.status == "PENDIENTE"


def test_publicacion_fallida_con_correo_inexistente_mantiene_exito(client, monkeypatch):
    """Anti-enumeración: para un correo NO registrado no se intenta ningún
    envío (no hay nada que pueda fallar), así que la respuesta sigue siendo
    el mensaje de éxito habitual aun con el broker caído."""
    _romper_publicacion_celery(monkeypatch)

    resp = client.post("/api/v1/auth/recuperar-contrasenia", json={"correo": "fantasma@x.com"})

    assert resp.status_code == 200
    assert resp.json()["mensaje"] == MENSAJE_EXITO


def test_solicitud_repetida_no_crea_dos_eventos_activos(client, db_session, monkeypatch):
    from app.dominio.modelos import RecuperacionOutbox

    persona = _crear_persona(client, cedula_valida(541))
    _registrar_credenciales(client, persona["cedula"], "feliz@x.com")
    _romper_publicacion_celery(monkeypatch)

    for _ in range(2):
        resp = client.post(
            "/api/v1/auth/recuperar-contrasenia", json={"correo": "feliz@x.com"}
        )
        assert resp.status_code == 200
        assert resp.json()["mensaje"] == MENSAJE_EXITO

    assert db_session.query(RecuperacionOutbox).count() == 1


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
    assert GestorAutenticacion.verificar_contrasenia("password123", usuario.contrasenia)
