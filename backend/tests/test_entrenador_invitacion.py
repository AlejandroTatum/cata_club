"""Issue #1575: el administrador crea entrenadores directo, con invitación."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import jwt
import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.modelos import (
    ConsentimientoLegal, FichaMedica, Membresia, Persona, RecuperacionOutbox, Usuario,
)
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.tareas import recuperacion_tareas
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.consentimiento_legal_servicio import VERSION_LEGAL_VIGENTE
from app.soporte_transversal.configuracion import settings

URL = "/api/v1/personas/entrenadores"
CONTRASENIA = "claveNueva12345"


def _payload(secuencia=7100, **cambios):
    datos = {
        "nombres": "Marta", "apellidos": "Zambrano", "cedula": cedula_valida(secuencia),
        "fecha_nacimiento": "1988-03-02", "correo": f"marta{secuencia}@x.com",
        "telefono": "0991234567",
    }
    datos.update(cambios)
    return datos


def _crear(client, **kwargs):
    respuesta = client.post(URL, json=_payload(**kwargs))
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def _usuario(db_session, persona_id) -> Usuario:
    return db_session.query(Usuario).filter_by(persona_id=persona_id).one()


def _token_de_invitacion(usuario: Usuario) -> str:
    """El token que acuña el worker: se captura del envío real."""
    capturado = {}

    def _espia(self, correo, token, nombre=None):
        capturado["token"] = token

    with patch.object(ServicioNotificaciones, "enviar_invitacion_entrenador", _espia):
        recuperacion_tareas._enviar_enlace(usuario)
    return capturado["token"]


def _restablecer(client, token, **extra):
    return client.post(
        "/api/v1/auth/restablecer-contrasenia",
        json={"token": token, "nueva_contrasenia": CONTRASENIA, **extra},
    )


# --- Alta ---------------------------------------------------------------------
def test_crea_persona_y_cuenta_de_entrenador_sin_nada_de_jugador(client, db_session):
    cuerpo = _crear(client)

    usuario = _usuario(db_session, cuerpo["id"])
    assert [r.tipo_rol for r in usuario.roles] == [TipoRol.ENTRENADOR]
    assert usuario.correo == "marta7100@x.com"
    assert usuario.correo_verificado is False
    assert db_session.query(FichaMedica).filter_by(persona_id=cuerpo["id"]).count() == 0
    assert db_session.query(Membresia).filter_by(persona_id=cuerpo["id"]).count() == 0
    evento = db_session.query(RecuperacionOutbox).filter_by(usuario_id=usuario.id).one()
    assert evento.status == "PENDIENTE"


def test_la_contrasenia_inicial_no_sirve_para_entrar(client, db_session):
    cuerpo = _crear(client)
    correo = _usuario(db_session, cuerpo["id"]).correo

    respuesta = client.post("/api/v1/auth/login", data={"username": correo, "password": ""})

    assert respuesta.status_code in (400, 401, 422)


@pytest.mark.parametrize("fixture", ["client_sin_permisos", "client_entrenador"])
def test_solo_el_administrador_crea_entrenadores(fixture, request, db_session):
    cliente = request.getfixturevalue(fixture)

    assert cliente.post(URL, json=_payload(7101)).status_code == 403
    assert db_session.query(Persona).count() == 0


def test_cedula_repetida_es_error_claro_y_no_crea_nada(client, db_session):
    _crear(client)
    antes = (db_session.query(Persona).count(), db_session.query(Usuario).count())

    respuesta = client.post(URL, json=_payload(7100, correo="otro@x.com"))

    assert respuesta.status_code == 400
    assert "Ya existe una persona o una cuenta" in respuesta.json()["detail"]
    assert (db_session.query(Persona).count(), db_session.query(Usuario).count()) == antes


def test_correo_repetido_sin_importar_mayusculas_no_crea_nada(client, db_session):
    _crear(client)
    antes = (db_session.query(Persona).count(), db_session.query(Usuario).count())

    respuesta = client.post(URL, json=_payload(7102, correo="MARTA7100@X.com"))

    assert respuesta.status_code == 400
    assert (db_session.query(Persona).count(), db_session.query(Usuario).count()) == antes


@pytest.mark.parametrize("cambio", [
    {"cedula": "1234567890"},
    {"telefono": "123"},
    {"correo": "no-es-correo"},
    {"fecha_nacimiento": None},
])
def test_aplica_las_validaciones_existentes(client, cambio):
    assert client.post(URL, json=_payload(7103, **cambio)).status_code == 422


def test_rechaza_a_un_menor_de_edad(client):
    respuesta = client.post(URL, json=_payload(7104, fecha_nacimiento="2025-01-01"))

    assert respuesta.status_code == 400
    assert "mayor de edad" in respuesta.json()["detail"]


# --- Invitación y primer ingreso ---------------------------------------------
def test_el_worker_envia_la_invitacion_con_un_enlace_de_un_solo_proposito(client, db_session):
    cuerpo = _crear(client)
    usuario = _usuario(db_session, cuerpo["id"])
    enviados = []
    with patch.object(ServicioNotificaciones, "enviar_correo", lambda self, *a: enviados.append(a)):
        recuperacion_tareas._enviar_enlace(usuario)

    correo, asunto, texto, _html = enviados[0]
    assert correo == usuario.correo
    assert "invitamos" in asunto
    assert "/reset-password?token=" in texto and "&invitacion=1" in texto
    token = texto.split("token=")[1].split("&")[0].split()[0]
    claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])
    assert claims["type"] == "reset_password" and claims["prp"] == "invitacion_entrenador"


def test_sin_aceptar_los_terminos_la_invitacion_no_fija_la_contrasenia(client, db_session):
    usuario = _usuario(db_session, _crear(client)["id"])
    token = _token_de_invitacion(usuario)

    respuesta = _restablecer(client, token)

    assert respuesta.status_code == 400
    assert "aceptar los términos" in respuesta.json()["detail"]
    db_session.refresh(usuario)
    assert usuario.correo_verificado is False
    assert usuario.version_contrasenia == 1


def test_con_la_invitacion_define_su_contrasenia_acepta_terminos_y_entra(client, db_session):
    usuario = _usuario(db_session, _crear(client)["id"])
    token = _token_de_invitacion(usuario)

    assert _restablecer(client, token, acepta_terminos=True).status_code == 204

    db_session.refresh(usuario)
    assert usuario.correo_verificado is True
    consentimientos = db_session.query(ConsentimientoLegal).filter_by(cuenta_id=usuario.id).all()
    assert {c.documento for c in consentimientos} == {"TERMINOS", "PRIVACIDAD"}
    assert {c.version_documento for c in consentimientos} == {VERSION_LEGAL_VIGENTE}
    login = client.post("/api/v1/auth/login", data={"username": usuario.correo, "password": CONTRASENIA})
    assert login.status_code == 200


def test_el_enlace_de_la_invitacion_es_de_un_solo_uso(client, db_session):
    usuario = _usuario(db_session, _crear(client)["id"])
    token = _token_de_invitacion(usuario)
    assert _restablecer(client, token, acepta_terminos=True).status_code == 204

    assert _restablecer(client, token, acepta_terminos=True).status_code == 401


def test_el_enlace_de_la_invitacion_vence(client, db_session):
    usuario = _usuario(db_session, _crear(client)["id"])
    vencido = jwt.encode(
        {
            "sub": usuario.correo, "type": "reset_password", "ver": usuario.version_contrasenia,
            "prp": "invitacion_entrenador",
            "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
        },
        settings.jwt_secret_key, algorithm=settings.jwt_algoritmo,
    )

    assert _restablecer(client, vencido, acepta_terminos=True).status_code == 401


def test_una_recuperacion_comun_no_verifica_ni_pide_terminos(client, db_session):
    usuario = _usuario(db_session, _crear(client)["id"])
    token = GestorAutenticacion.crear_token_recuperacion(usuario.correo, usuario.version_contrasenia)

    assert _restablecer(client, token).status_code == 204

    db_session.refresh(usuario)
    assert usuario.correo_verificado is False
    assert db_session.query(ConsentimientoLegal).filter_by(cuenta_id=usuario.id).count() == 0


# --- Estado y reenvío ---------------------------------------------------------
def test_el_listado_marca_la_invitacion_pendiente_hasta_que_crea_la_contrasenia(client, db_session):
    cuerpo = _crear(client)

    def _fila():
        items = client.get("/api/v1/personas/?limit=50").json()["items"]
        return next(i for i in items if i["id"] == cuerpo["id"])

    assert _fila()["invitacionPendiente"] is True
    usuario = _usuario(db_session, cuerpo["id"])
    assert _restablecer(client, _token_de_invitacion(usuario), acepta_terminos=True).status_code == 204
    assert _fila()["invitacionPendiente"] is False


def test_el_administrador_reenvia_la_invitacion_sin_enfriamiento(client, db_session):
    cuerpo = _crear(client)
    usuario = _usuario(db_session, cuerpo["id"])
    # La invitación original ya salió hace segundos: `solicitar_recuperacion`
    # (público) quedaría frenada por el enfriamiento de 2 minutos.
    evento = db_session.query(RecuperacionOutbox).filter_by(usuario_id=usuario.id).one()
    evento.status, evento.sent_at = "ENVIADO", datetime.now(timezone.utc)
    db_session.commit()

    respuesta = client.post(f"/api/v1/personas/{cuerpo['id']}/entrenador/invitacion")

    assert respuesta.status_code == 204
    estados = sorted(e.status for e in db_session.query(RecuperacionOutbox).filter_by(usuario_id=usuario.id))
    assert estados == ["ENVIADO", "PENDIENTE"]


def test_no_se_reenvia_una_invitacion_ya_usada(client, db_session):
    cuerpo = _crear(client)
    usuario = _usuario(db_session, cuerpo["id"])
    assert _restablecer(client, _token_de_invitacion(usuario), acepta_terminos=True).status_code == 204

    respuesta = client.post(f"/api/v1/personas/{cuerpo['id']}/entrenador/invitacion")

    assert respuesta.status_code == 400


def test_no_se_reenvia_a_quien_no_es_entrenador_ni_a_una_persona_inexistente(client, db_session):
    persona = client.post("/api/v1/personas/", json={
        "nombres": "Luis", "apellidos": "Mora", "cedula": cedula_valida(7110),
        "fecha_nacimiento": "1990-01-01", "telefono": "0991234567",
    }).json()

    assert client.post(f"/api/v1/personas/{persona['id']}/entrenador/invitacion").status_code == 404
    assert client.post("/api/v1/personas/999999/entrenador/invitacion").status_code == 404


@pytest.mark.parametrize("fixture", ["client_sin_permisos", "client_entrenador"])
def test_solo_el_administrador_reenvia(fixture, request):
    assert request.getfixturevalue(fixture).post("/api/v1/personas/1/entrenador/invitacion").status_code == 403
