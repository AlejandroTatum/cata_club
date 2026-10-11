"""
Rotación del refresh token y `sesion` autoritativa (#1653, S1-S3).

Reglas (un test por regla):

  S1  rotación: cada refresh devuelve un par nuevo; el refresh viejo, pasada
      la gracia, es REUSO -> 401 y la sesión queda revocada (el access de ese
      `sid` también muere).
  S1  gracia de 30 s: el refresh anterior, dentro de la gracia, es una carrera
      benigna -> par válido con el `jti` VIGENTE, sin nueva rotación.
  S2  ventana inactiva de 24 h deslizante y tope absoluto de 7 d desde
      `iniciada_en`: ambos revocan y rechazan.
  S3  transición: un refresh legacy (sin `jti`) se acepta UNA vez; con `sid`
      adopta la fila, sin `sid` abre una sesión. El segundo uso es reuso.

El tiempo se congela escribiendo las marcas de la fila `sesion`
(`ultimo_uso_en`, `iniciada_en`, `rotado_en`): las reglas se leen de la fila,
así que no hace falta parchear el reloj.

Tokens REALES contra `client_sin_token`, mismo patrón que
`test_revocacion_unificada_sesiones.py`.
"""
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.dominio.modelos import Sesion, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.soporte_transversal.configuracion import settings
from tests.fabricas_auth import crear_usuario_auth

CORREO = "ana@cataclub.test"
CLAVE = "clave12345"


@pytest.fixture()
def usuario(db_session) -> Usuario:
    return crear_usuario_auth(db_session, correo=CORREO, contrasenia=CLAVE)


def _claims(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])


def _login(db_session) -> dict:
    return AuthServicio(db_session).login(CORREO, CLAVE, user_agent="curl/8.7.1")


def _refrescar(client, refresh_token: str):
    return client.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})


def _me(client, access_token: str):
    return client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {access_token}"})


def _fila(db_session, sid: int) -> Sesion:
    db_session.expire_all()
    return db_session.get(Sesion, sid)


def _ahora() -> datetime:
    return datetime.now(timezone.utc)


def _refresh_legacy(usuario: Usuario, sid: int | None = None) -> str:
    """Un refresh emitido antes del deploy: sin `jti` y, a veces, sin `sid`."""
    datos = {"sub": usuario.correo, "persona_id": usuario.persona_id}
    if sid is not None:
        datos["sid"] = sid
    return GestorAutenticacion.crear_token_refresco(datos, version_sesion=usuario.version_sesion)


# --- S1: rotación + reuso ---------------------------------------------------
def test_rotacion_devuelve_refresh_nuevo_y_el_viejo_pasada_la_gracia_revoca_la_sesion(
    client_sin_token, usuario, db_session
):
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]

    respuesta = _refrescar(client_sin_token, par["refresh_token"])

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["token_type"] == "bearer"
    assert cuerpo["refresh_token"] != par["refresh_token"]
    claims_refresh = _claims(cuerpo["refresh_token"])
    assert claims_refresh["sid"] == sid
    assert claims_refresh["jti"] != _claims(par["refresh_token"])["jti"]
    assert "iat" in claims_refresh
    claims_acceso = _claims(cuerpo["access_token"])
    assert claims_acceso["sid"] == sid
    assert "iat" in claims_acceso

    # El refresh viejo, ya fuera de la gracia, es reuso: 401 + sesión revocada.
    fila = _fila(db_session, sid)
    fila.rotado_en = _ahora() - timedelta(seconds=settings.sesion_gracia_rotacion_segundos + 1)
    db_session.commit()

    assert _refrescar(client_sin_token, par["refresh_token"]).status_code == 401
    assert _fila(db_session, sid).revocada_en is not None

    # La sesión revocada mata también al par rotado: refresh y access.
    assert _refrescar(client_sin_token, cuerpo["refresh_token"]).status_code == 401
    assert _me(client_sin_token, cuerpo["access_token"]).status_code == 401


# --- S1: gracia -------------------------------------------------------------
def test_gracia_reemite_un_par_con_el_jti_vigente_sin_rotar_de_nuevo(
    client_sin_token, usuario, db_session
):
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]
    primera = _refrescar(client_sin_token, par["refresh_token"]).json()
    jti_vigente = _claims(primera["refresh_token"])["jti"]

    # Segunda llamada con el MISMO refresh viejo, dentro de la gracia.
    segunda = _refrescar(client_sin_token, par["refresh_token"])

    assert segunda.status_code == 200
    assert _claims(segunda.json()["refresh_token"])["jti"] == jti_vigente
    assert _me(client_sin_token, segunda.json()["access_token"]).status_code == 200
    fila = _fila(db_session, sid)
    assert fila.refresh_jti == jti_vigente
    assert fila.revocada_en is None
    # El refresh vigente sigue sirviendo (no se rotó por segunda vez).
    assert _refrescar(client_sin_token, primera["refresh_token"]).status_code == 200


# --- S2: ventanas -----------------------------------------------------------
def test_inactividad_de_mas_de_24_horas_se_rechaza_y_revoca(client_sin_token, usuario, db_session):
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]
    fila = _fila(db_session, sid)
    fila.ultimo_uso_en = _ahora() - timedelta(hours=24, minutes=1)
    db_session.commit()

    assert _refrescar(client_sin_token, par["refresh_token"]).status_code == 401
    assert _fila(db_session, sid).revocada_en is not None


def test_refresh_dentro_de_las_24_horas_desliza_la_ventana(client_sin_token, usuario, db_session):
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]
    fila = _fila(db_session, sid)
    anterior = _ahora() - timedelta(hours=23)
    fila.ultimo_uso_en = anterior
    db_session.commit()

    assert _refrescar(client_sin_token, par["refresh_token"]).status_code == 200
    assert _fila(db_session, sid).ultimo_uso_en > anterior + timedelta(hours=22)


def test_tope_absoluto_de_7_dias_desde_el_login_se_rechaza_y_revoca(
    client_sin_token, usuario, db_session
):
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]
    fila = _fila(db_session, sid)
    fila.iniciada_en = _ahora() - timedelta(days=7, minutes=1)
    fila.ultimo_uso_en = _ahora()  # activa, pero pasó el tope absoluto
    db_session.commit()

    assert _refrescar(client_sin_token, par["refresh_token"]).status_code == 401
    assert _fila(db_session, sid).revocada_en is not None


# --- S3: transición ---------------------------------------------------------
def test_legacy_con_sid_se_adopta_una_vez_y_el_segundo_uso_pasada_la_gracia_es_reuso(
    client_sin_token, usuario, db_session
):
    # Fila preexistente al deploy: sin `refresh_jti` ni `ultimo_uso_en`.
    fila = Sesion(
        usuario_id=usuario.id, dispositivo="Linux · Firefox",
        version_sesion=usuario.version_sesion,
        iniciada_en=_ahora() - timedelta(days=3),
    )
    db_session.add(fila)
    db_session.commit()
    sid = fila.id
    legacy = _refresh_legacy(usuario, sid=sid)

    primera = _refrescar(client_sin_token, legacy)

    assert primera.status_code == 200
    claims_nuevo = _claims(primera.json()["refresh_token"])
    assert claims_nuevo["sid"] == sid
    assert _fila(db_session, sid).refresh_jti == claims_nuevo["jti"]
    assert _fila(db_session, sid).ultimo_uso_en is not None

    # Segundo uso del mismo legacy, ya fuera de la gracia: reuso.
    fila = _fila(db_session, sid)
    fila.rotado_en = _ahora() - timedelta(seconds=settings.sesion_gracia_rotacion_segundos + 1)
    db_session.commit()

    assert _refrescar(client_sin_token, legacy).status_code == 401
    assert _fila(db_session, sid).revocada_en is not None


def test_legacy_con_sid_ya_adoptado_dentro_de_la_gracia_reemite_el_jti_vigente(
    client_sin_token, usuario, db_session
):
    """S3: el BFF puede disparar varios refresh en paralelo con la MISMA cookie
    legacy justo después del deploy; el segundo no puede cerrar la sesión."""
    fila = Sesion(
        usuario_id=usuario.id, dispositivo="Linux · Firefox",
        version_sesion=usuario.version_sesion,
        iniciada_en=_ahora() - timedelta(days=3),
    )
    db_session.add(fila)
    db_session.commit()
    sid = fila.id
    legacy = _refresh_legacy(usuario, sid=sid)
    primera = _refrescar(client_sin_token, legacy).json()
    jti_vigente = _claims(primera["refresh_token"])["jti"]

    segunda = _refrescar(client_sin_token, legacy)

    assert segunda.status_code == 200
    assert _claims(segunda.json()["refresh_token"])["jti"] == jti_vigente
    assert _me(client_sin_token, segunda.json()["access_token"]).status_code == 200
    fila = _fila(db_session, sid)
    assert fila.refresh_jti == jti_vigente
    assert fila.revocada_en is None


def test_legacy_con_sid_de_una_fila_nacida_de_login_sigue_siendo_reuso(
    client_sin_token, usuario, db_session
):
    """Una fila de login tiene `rotado_en` nulo: no es una adopción, así que
    un token legacy que apunta a ella no goza de gracia."""
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]

    assert _refrescar(client_sin_token, _refresh_legacy(usuario, sid=sid)).status_code == 401
    assert _fila(db_session, sid).revocada_en is not None


def test_legacy_sin_sid_abre_una_sesion_y_rota(client_sin_token, usuario, db_session):
    antes = db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).count()

    respuesta = _refrescar(client_sin_token, _refresh_legacy(usuario))

    assert respuesta.status_code == 200
    claims_refresh = _claims(respuesta.json()["refresh_token"])
    assert "jti" in claims_refresh
    assert _claims(respuesta.json()["access_token"])["sid"] == claims_refresh["sid"]
    db_session.expire_all()
    assert db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).count() == antes + 1
    fila = db_session.get(Sesion, claims_refresh["sid"])
    assert fila.usuario_id == usuario.id
    assert fila.refresh_jti == claims_refresh["jti"]


def test_legacy_sin_sid_conserva_el_tope_absoluto_del_login_original(
    client_sin_token, usuario, db_session
):
    """El refresh legacy no trae `iat`, pero su `exp` es la emisión + 7 días:
    la fila que se abre hereda ESE inicio, así el deploy no le regala al
    token una semana nueva de tope absoluto."""
    emitido = _ahora() - timedelta(days=5)
    legacy = jwt.encode(
        {
            "sub": usuario.correo,
            "persona_id": usuario.persona_id,
            "type": "refresh",
            "sver": usuario.version_sesion,
            "exp": emitido + timedelta(days=settings.jwt_refresh_expira_dias),
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algoritmo,
    )

    respuesta = _refrescar(client_sin_token, legacy)

    assert respuesta.status_code == 200
    fila = _fila(db_session, _claims(respuesta.json()["refresh_token"])["sid"])
    assert abs(fila.iniciada_en - emitido) < timedelta(minutes=1)


def test_legacy_sin_sid_ni_exp_se_rechaza_con_401(client_sin_token, usuario, db_session):
    """Ningún emisor produjo jamás un refresh sin `exp`, pero uno firmado así
    tiene que ser un 401 y no un 500, y no abre ninguna sesión."""
    antes = db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).count()
    sin_exp = jwt.encode(
        {"sub": usuario.correo, "type": "refresh", "sver": usuario.version_sesion},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algoritmo,
    )

    assert _refrescar(client_sin_token, sin_exp).status_code == 401
    db_session.expire_all()
    assert db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).count() == antes


def test_legacy_con_sid_sobre_una_fila_revocada_se_rechaza_sin_tocarla(
    client_sin_token, usuario, db_session
):
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]
    fila = _fila(db_session, sid)
    revocada_en = _ahora() - timedelta(minutes=5)
    fila.revocada_en = revocada_en
    jti_antes = fila.refresh_jti
    db_session.commit()

    assert _refrescar(client_sin_token, _refresh_legacy(usuario, sid=sid)).status_code == 401
    fila = _fila(db_session, sid)
    assert fila.revocada_en == revocada_en
    assert fila.refresh_jti == jti_antes


# --- S1: el lado access -----------------------------------------------------
def test_access_de_una_sesion_revocada_recibe_401(client_sin_token, usuario, db_session):
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]
    assert _me(client_sin_token, par["access_token"]).status_code == 200

    fila = _fila(db_session, sid)
    fila.revocada_en = _ahora()
    db_session.commit()

    assert _me(client_sin_token, par["access_token"]).status_code == 401


def test_access_sin_sid_sigue_aceptado(client_sin_token, usuario):
    access = GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": []},
        version_sesion=usuario.version_sesion,
    )

    assert _me(client_sin_token, access).status_code == 200


def test_access_con_sid_de_otro_usuario_o_inexistente_recibe_401(
    client_sin_token, usuario, db_session
):
    ajeno = crear_usuario_auth(
        db_session, correo="beto@cataclub.test", cedula="1710034073", contrasenia=CLAVE,
    )
    sesion_ajena = AuthServicio(db_session).login("beto@cataclub.test", CLAVE)
    sid_ajeno = _claims(sesion_ajena["access_token"])["sid"]
    assert ajeno.id != usuario.id

    for sid in (sid_ajeno, 999_999):
        access = GestorAutenticacion.crear_token_acceso(
            {"sub": usuario.correo, "persona_id": usuario.persona_id, "roles": [], "sid": sid},
            version_sesion=usuario.version_sesion,
        )
        assert _me(client_sin_token, access).status_code == 401


# --- Todo emisor de pares abre una sesión -----------------------------------
def test_reemitir_tokens_para_abre_una_sesion_con_jti(usuario, db_session):
    par = AuthServicio(db_session).reemitir_tokens_para(usuario)

    claims_refresh = _claims(par["refresh_token"])
    fila = db_session.get(Sesion, claims_refresh["sid"])
    assert fila.usuario_id == usuario.id
    assert fila.refresh_jti == claims_refresh["jti"]
    assert _claims(par["access_token"])["sid"] == claims_refresh["sid"]


def test_emisor_de_inscripcion_abre_una_sesion_con_jti(usuario, db_session):
    from app.servicios_negocio.enrollment_servicio import EnrollmentServicio

    par = EnrollmentServicio(db_session)._emitir_tokens(usuario)

    claims_refresh = _claims(par["refresh_token"])
    fila = db_session.get(Sesion, claims_refresh["sid"])
    assert fila.usuario_id == usuario.id
    assert fila.refresh_jti == claims_refresh["jti"]
    assert _claims(par["access_token"])["sid"] == claims_refresh["sid"]


# --- Regresión: lo existente sigue valiendo ---------------------------------
def test_epoch_revoca_todo_aunque_la_sesion_este_viva(client_sin_token, usuario, db_session):
    par = _login(db_session)

    usuario.revocar_sesiones()
    db_session.commit()

    assert _refrescar(client_sin_token, par["refresh_token"]).status_code == 401
    assert _me(client_sin_token, par["access_token"]).status_code == 401


def test_cuenta_inactiva_se_rechaza_en_refresh(client_sin_token, usuario, db_session):
    par = _login(db_session)

    usuario.activo = False
    db_session.commit()

    assert _refrescar(client_sin_token, par["refresh_token"]).status_code == 401


def test_listado_de_sesiones_marca_la_actual_tras_rotar(client_sin_token, usuario, db_session):
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]
    rotado = _refrescar(client_sin_token, par["refresh_token"]).json()

    respuesta = client_sin_token.get(
        "/api/v1/auth/me/sesiones",
        headers={"Authorization": f"Bearer {rotado['access_token']}"},
    )

    assert respuesta.status_code == 200
    actuales = [s["id"] for s in respuesta.json() if s["actual"]]
    assert actuales == [sid]


def test_invalidar_otras_sesiones_deja_vivo_el_par_nuevo_y_mata_el_anterior(
    client_sin_token, usuario, db_session
):
    par = _login(db_session)
    encabezado = {"Authorization": f"Bearer {par['access_token']}"}

    respuesta = client_sin_token.post("/api/v1/auth/sesiones/invalidar", headers=encabezado)

    assert respuesta.status_code == 200
    nuevo = respuesta.json()
    assert _me(client_sin_token, nuevo["access_token"]).status_code == 200
    assert _refrescar(client_sin_token, nuevo["refresh_token"]).status_code == 200
    assert _refrescar(client_sin_token, par["refresh_token"]).status_code == 401
