"""Bloqueo inmediato por re-aceptación legal pendiente (T4/S5): quien aceptó
una versión anterior no usa nada hasta aceptar la vigente. Solo quedan
accesibles aceptar, leer el estado, `/auth/me`, logout y la plomería de
sesión. Las pruebas no dependen del valor de `VERSION_LEGAL_VIGENTE`."""
import pytest

from app.dominio.enums import EstadoMembresia, TipoRol
from app.dominio.modelos import ConsentimientoLegal
from app.servicios_negocio.consentimiento_legal_servicio import (
    TEXTOS_LEGALES_VIGENTES,
    VERSION_LEGAL_VIGENTE,
)
from tests.test_auth_activation import _crear_usuario
from tests.test_consentimiento_legal_reaceptacion import (
    RUTA,
    RUTA_ACEPTAR,
    _aceptar_version,
    _headers,
    _representar,
)

VERSION_ANTERIOR = "0.9-anterior"
MODULO = "/api/v1/membresias/mias"


def _usuario(db_session, correo, rol=TipoRol.ALUMNO):
    return _crear_usuario(
        db_session, correo=correo, correo_verificado=True,
        estado_membresia=EstadoMembresia.ACTIVA, rol=rol,
    )


@pytest.mark.parametrize("rol", list(TipoRol))
def test_pendiente_recibe_403_con_codigo_en_un_modulo_de_cualquier_rol(client_sin_token, db_session, rol):
    usuario = _usuario(db_session, f"bloqueado-{rol.value}@cataclub.test", rol)
    _aceptar_version(db_session, usuario, VERSION_ANTERIOR)

    respuesta = client_sin_token.get(MODULO, headers=_headers(usuario))

    assert respuesta.status_code == 403
    cuerpo = respuesta.json()
    assert cuerpo["codigo"] == "reaceptacion_legal_pendiente"
    assert cuerpo["version"] == VERSION_LEGAL_VIGENTE
    assert cuerpo["message"] == cuerpo["detail"] == (
        "Debes aceptar la versión vigente de los términos para continuar."
    )
    assert cuerpo["mensaje_seguro"] is True


def test_pendiente_tampoco_alcanza_los_datos_familiares(client_sin_token, db_session):
    """`/personas` ya no es un carve-out de la re-aceptación (sí del gate de activación)."""
    usuario = _usuario(db_session, "familia-bloqueada@cataclub.test", TipoRol.REPRESENTANTE)
    _aceptar_version(db_session, usuario, VERSION_ANTERIOR)

    respuesta = client_sin_token.get(
        f"/api/v1/personas/{usuario.persona_id}/representados", headers=_headers(usuario),
    )

    assert respuesta.status_code == 403
    assert respuesta.json()["codigo"] == "reaceptacion_legal_pendiente"


def test_leer_estado_perfil_y_sesiones_siguen_disponibles_mientras_esta_pendiente(client_sin_token, db_session):
    usuario = _usuario(db_session, "exenta@cataclub.test")
    _aceptar_version(db_session, usuario, VERSION_ANTERIOR)
    h = _headers(usuario)

    assert client_sin_token.get(RUTA, headers=h).json()["pendiente"] is True
    assert client_sin_token.get("/api/v1/auth/me", headers=h).status_code == 200
    assert client_sin_token.get("/api/v1/auth/me/sesiones", headers=h).status_code == 200
    assert client_sin_token.post(RUTA_ACEPTAR, headers=h).status_code == 200


@pytest.mark.parametrize(
    "ruta", ["/api/v1/auth/sesiones/invalidar", "/api/v1/auth/contrasenia/cambiar", "/api/v1/auth/logout"],
)
def test_logout_y_plomeria_de_sesion_no_se_bloquean_mientras_esta_pendiente(client_sin_token, db_session, ruta):
    usuario = _usuario(db_session, f"plomeria-{ruta.rsplit('/', 1)[-1]}@cataclub.test")
    _aceptar_version(db_session, usuario, VERSION_ANTERIOR)

    respuesta = client_sin_token.post(ruta, headers=_headers(usuario), json={})

    assert respuesta.json().get("codigo") != "reaceptacion_legal_pendiente"


def test_correccion_de_correo_no_es_una_superficie_exenta(client_sin_token, db_session):
    usuario = _usuario(db_session, "correo-bloqueado@cataclub.test")
    _aceptar_version(db_session, usuario, VERSION_ANTERIOR)

    respuesta = client_sin_token.patch("/api/v1/auth/correo", headers=_headers(usuario), json={})

    assert respuesta.status_code == 403
    assert respuesta.json()["codigo"] == "reaceptacion_legal_pendiente"


def test_tras_aceptar_el_mismo_modulo_responde(client_sin_token, db_session):
    usuario = _usuario(db_session, "acepta-y-sigue@cataclub.test")
    _aceptar_version(db_session, usuario, VERSION_ANTERIOR)
    assert client_sin_token.get(MODULO, headers=_headers(usuario)).status_code == 403

    assert client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario)).status_code == 200

    assert client_sin_token.get(MODULO, headers=_headers(usuario)).status_code == 200


def test_sin_aceptacion_previa_no_se_bloquea(client_sin_token, db_session):
    usuario = _usuario(db_session, "sin-previa@cataclub.test")

    assert client_sin_token.get(MODULO, headers=_headers(usuario)).status_code == 200


def test_quien_ya_acepto_la_vigente_no_se_bloquea(client_sin_token, db_session):
    usuario = _usuario(db_session, "vigente@cataclub.test")
    _aceptar_version(db_session, usuario, VERSION_ANTERIOR)
    _aceptar_version(db_session, usuario, VERSION_LEGAL_VIGENTE)

    assert client_sin_token.get(MODULO, headers=_headers(usuario)).status_code == 200


def test_una_aceptacion_del_representante_cubre_a_todos_sus_representados(client_sin_token, db_session):
    usuario = _usuario(db_session, "guardian@cataclub.test", TipoRol.REPRESENTANTE)
    hijo_a = _usuario(db_session, "hijo-a@cataclub.test")
    hijo_b = _usuario(db_session, "hijo-b@cataclub.test")
    for hijo in (hijo_a, hijo_b):
        _representar(db_session, usuario, hijo)
        _aceptar_version(db_session, usuario, VERSION_ANTERIOR, representado=hijo.persona_id)
    assert client_sin_token.get(MODULO, headers=_headers(usuario)).status_code == 403

    client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario))

    assert client_sin_token.get(MODULO, headers=_headers(usuario)).status_code == 200
    vigentes = db_session.query(ConsentimientoLegal).filter_by(
        cuenta_id=usuario.id, version_documento=VERSION_LEGAL_VIGENTE,
    ).all()
    assert {r.representado_persona_id for r in vigentes} == {hijo_a.persona_id, hijo_b.persona_id}
    assert {r.texto_aceptado for r in vigentes} <= set(TEXTOS_LEGALES_VIGENTES.values())


def test_el_refresh_sigue_disponible_mientras_esta_pendiente(client_sin_token, db_session):
    """El refresh no pasa por `decodificar_token`: el cliente conserva la sesión para poder aceptar."""
    from app.seguridad.gestor_auth import GestorAutenticacion

    usuario = _usuario(db_session, "refresca@cataclub.test")
    _aceptar_version(db_session, usuario, VERSION_ANTERIOR)
    refresh = GestorAutenticacion.crear_token_refresco(
        {"sub": usuario.correo, "persona_id": usuario.persona_id}, version_sesion=usuario.version_sesion,
    )

    respuesta = client_sin_token.post("/api/v1/auth/refresh", json={"refresh_token": refresh})

    assert respuesta.status_code == 200


def test_el_cuerpo_de_otros_errores_de_dominio_no_cambia(client_sin_token, db_session):
    """El manejador solo agrega `codigo`/`version` cuando la excepción los trae."""
    usuario = _usuario(db_session, "sin-codigo@cataclub.test", TipoRol.ALUMNO)

    respuesta = client_sin_token.post("/api/v1/auth/registro", headers=_headers(usuario), json={})

    assert respuesta.status_code == 403
    assert set(respuesta.json()) == {"detail", "message", "mensaje_seguro"}
