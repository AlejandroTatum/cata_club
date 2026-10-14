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
      adopta la fila, sin `sid` abre una sesión con la huella del token. El
      segundo uso, pasada la gracia, es reuso.
  S12 (#1775) concurrencia REAL: dos refresh simultáneos con el MISMO token
      contra PostgreSQL, cada uno en su hilo, su loop y su sesión de BD (ver
      el final del archivo). Exactamente UNO rota; el otro cae en la gracia.

El tiempo se congela escribiendo las marcas de la fila `sesion`
(`ultimo_uso_en`, `iniciada_en`, `rotado_en`): las reglas se leen de la fila,
así que no hace falta parchear el reloj.

Tokens REALES contra `client_sin_token`, mismo patrón que
`test_revocacion_unificada_sesiones.py`.
"""
import asyncio
import threading
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona, Sesion, Usuario
from app.infraestructura.db import engine as db_engine
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.soporte_transversal.configuracion import settings
from main import app
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


def test_legacy_sin_sid_pasada_la_gracia_el_segundo_uso_es_reuso(
    client_sin_token, usuario, db_session
):
    """S3: aceptado UNA vez. El segundo uso del mismo token sin `sid` no abre
    otra sesión: es reuso y revoca la que abrió el primero."""
    legacy = _refresh_legacy(usuario)
    primero = _refrescar(client_sin_token, legacy)
    assert primero.status_code == 200
    sid = _claims(primero.json()["refresh_token"])["sid"]
    fila = _fila(db_session, sid)
    fila.rotado_en = _ahora() - timedelta(seconds=settings.sesion_gracia_rotacion_segundos + 5)
    db_session.commit()
    antes = db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).count()

    assert _refrescar(client_sin_token, legacy).status_code == 401
    db_session.expire_all()
    assert db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).count() == antes
    assert _fila(db_session, sid).revocada_en is not None


def test_legacy_sin_sid_dentro_de_la_gracia_reemite_la_misma_sesion(
    client_sin_token, usuario, db_session
):
    """Dos refresh paralelos del BFF con la misma cookie legacy al deploy: el
    segundo es la carrera benigna, reemite el `jti` vigente de la MISMA fila."""
    legacy = _refresh_legacy(usuario)
    primero = _refrescar(client_sin_token, legacy)
    segundo = _refrescar(client_sin_token, legacy)

    assert segundo.status_code == 200
    claims_1 = _claims(primero.json()["refresh_token"])
    claims_2 = _claims(segundo.json()["refresh_token"])
    assert claims_2["sid"] == claims_1["sid"]
    assert claims_2["jti"] == claims_1["jti"]
    assert _fila(db_session, claims_1["sid"]).revocada_en is None


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


# --- S10 (#1775): las ventanas también rigen en la ruta del access ----------
def _marcas(fila: Sesion) -> tuple:
    return (fila.iniciada_en, fila.ultimo_uso_en, fila.rotado_en, fila.refresh_jti,
            fila.refresh_jti_anterior, fila.revocada_en)


def _login_con_marcas(db_session, *, iniciada_hace: timedelta, ultimo_uso_hace: timedelta | None):
    par = _login(db_session)
    sid = _claims(par["access_token"])["sid"]
    fila = _fila(db_session, sid)
    fila.iniciada_en = _ahora() - iniciada_hace
    fila.ultimo_uso_en = None if ultimo_uso_hace is None else _ahora() - ultimo_uso_hace
    db_session.commit()
    return par, sid


@pytest.mark.parametrize(
    "iniciada_hace, ultimo_uso_hace",
    [
        pytest.param(timedelta(days=2), timedelta(hours=24, minutes=1), id="inactiva-24h-1m"),
        pytest.param(timedelta(days=7, minutes=1), timedelta(minutes=5), id="tope-absoluto-7d-1m"),
        pytest.param(timedelta(days=9), timedelta(days=9), id="ambas"),
    ],
)
def test_access_de_una_sesion_vencida_recibe_el_mismo_401_que_una_revocada(
    client_sin_token, usuario, db_session, iniciada_hace, ultimo_uso_hace
):
    par, sid = _login_con_marcas(db_session, iniciada_hace=iniciada_hace, ultimo_uso_hace=ultimo_uso_hace)
    antes = _marcas(_fila(db_session, sid))

    respuesta = _me(client_sin_token, par["access_token"])

    assert respuesta.status_code == 401
    # El mismo cuerpo que hoy recibe la sesión revocada: el cliente no puede
    # distinguir (ni necesita) por qué murió.
    revocada, sid_revocada = _login_con_marcas(
        db_session, iniciada_hace=timedelta(minutes=1), ultimo_uso_hace=timedelta(minutes=1),
    )
    fila = _fila(db_session, sid_revocada)
    fila.revocada_en = _ahora()
    db_session.commit()
    assert respuesta.json() == _me(client_sin_token, revocada["access_token"]).json()
    # La ruta caliente no escribe: rechazar no revoca ni toca la fila.
    assert _marcas(_fila(db_session, sid)) == antes


@pytest.mark.parametrize(
    "iniciada_hace, ultimo_uso_hace",
    [
        pytest.param(timedelta(days=2), timedelta(hours=23, minutes=59), id="inactiva-justo-dentro"),
        pytest.param(timedelta(days=6, hours=23, minutes=59), timedelta(minutes=5), id="tope-justo-dentro"),
        pytest.param(timedelta(days=6, hours=23, minutes=59), timedelta(hours=23, minutes=59), id="ambas-justo-dentro"),
        pytest.param(timedelta(hours=1), None, id="sin-ultimo-uso-cae-en-iniciada_en"),
        pytest.param(timedelta(minutes=1), timedelta(minutes=1), id="sesion-nueva"),
    ],
)
def test_access_dentro_de_ambas_ventanas_sigue_aceptado_y_no_toca_la_fila(
    client_sin_token, usuario, db_session, iniciada_hace, ultimo_uso_hace
):
    par, sid = _login_con_marcas(db_session, iniciada_hace=iniciada_hace, ultimo_uso_hace=ultimo_uso_hace)
    antes = _marcas(_fila(db_session, sid))

    for _ in range(2):
        assert _me(client_sin_token, par["access_token"]).status_code == 200
    # El access NO desliza `ultimo_uso_en`: la ventana inactiva se juzga sobre
    # lo que actualiza el refresh (ver `GestorAutenticacion.sesion_inactiva`).
    assert _marcas(_fila(db_session, sid)) == antes


def test_sesion_activa_con_refresh_reciente_nunca_pierde_su_access(client_sin_token, usuario, db_session):
    """El caso real que no puede romperse: una sesión de 6 días y 23 horas
    que refresca dentro de la ventana inactiva recibe un access que funciona."""
    par, sid = _login_con_marcas(
        db_session, iniciada_hace=timedelta(days=6, hours=23), ultimo_uso_hace=timedelta(hours=23),
    )

    refresco = _refrescar(client_sin_token, par["refresh_token"])

    assert refresco.status_code == 200, refresco.text
    assert _me(client_sin_token, refresco.json()["access_token"]).status_code == 200
    assert _fila(db_session, sid).revocada_en is None


def test_access_con_sid_cuesta_una_sola_lectura_de_la_tabla_sesion(
    client_sin_token, usuario, db_session, contar_selects
):
    par, _ = _login_con_marcas(
        db_session, iniciada_hace=timedelta(hours=1), ultimo_uso_hace=timedelta(minutes=5),
    )

    with contar_selects() as sentencias:
        assert _me(client_sin_token, par["access_token"]).status_code == 200

    lecturas_de_sesion = [sql for sql in sentencias if "FROM sesion" in sql]
    print(f"S10 access path: {len(sentencias)} SELECT en total, {len(lecturas_de_sesion)} de `sesion`")
    assert len(lecturas_de_sesion) == 1


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


def test_reemitir_tokens_para_no_commitea_la_transaccion_del_llamador(usuario, db_session, monkeypatch):
    """#1775 S11: el llamador decide la atomicidad. Si su operación falla
    después de reemitir y hace rollback, la fila `sesion` se va con ella en
    vez de quedar huérfana de un cambio que nunca ocurrió."""
    commits: list[int] = []
    commit_real = db_session.commit
    monkeypatch.setattr(db_session, "commit", lambda: (commits.append(1), commit_real())[1])

    par = AuthServicio(db_session).reemitir_tokens_para(usuario)
    sid = _claims(par["refresh_token"])["sid"]

    assert commits == []
    assert db_session.get(Sesion, sid) is not None  # visible dentro de la transacción

    db_session.rollback()

    assert db_session.get(Sesion, sid) is None


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


# --- S12 (#1775): dos refresh simultáneos con el mismo token, PostgreSQL real
# Por qué no `client_sin_token`: su `db_session` es UNA sola transacción
# compartida, así que dos "requests" sobre ella nunca compiten por el
# `FOR UPDATE` -- es la misma conexión. Y `refrescar` es `async def` que llama
# al servicio síncrono, así que dos corutinas en UN loop se ejecutan una tras
# otra y tampoco se solapan. Acá cada refresh corre en su hilo con su propio
# loop (`asyncio.run`) y su propia sesión real (`obtener_sesion` sin override,
# mismo motor que producción), y los datos se commitean de verdad y se limpian
# a mano -- mismo criterio que `test_disponibilidad_pagos_concurrentes.py`.
#
# "Exactamente uno" significa UNO ROTA, no uno responde 200: el segundo, que
# espera el bloqueo y luego ve la fila ya rotada, cae en la gracia y recibe el
# par con el `jti` VIGENTE del ganador (`refrescar_sesion`, regla 3). Sin el
# `FOR UPDATE` los dos leerían el `jti` original, rotarían los dos, y una de
# las dos respuestas llevaría un `jti` ya muerto: el siguiente refresh de ese
# cliente sería REUSO y revocaría la sesión.
_ESPERA_MAXIMA_SEGUNDOS = 10


def _crear_cuenta_real(semilla: int) -> tuple[int, int, str]:
    setup = Session(bind=db_engine)
    try:
        correo = f"concurrencia{semilla}@cataclub.test"
        usuario = crear_usuario_auth(
            setup, correo=correo, cedula=cedula_valida(semilla), contrasenia=CLAVE,
        )
        return usuario.id, usuario.persona_id, correo
    finally:
        setup.close()


def _limpiar_cuenta_real(usuario_id: int, persona_id: int) -> None:
    """`sesion` y `actividad_usuario` caen por `ON DELETE CASCADE`."""
    limpieza = Session(bind=db_engine)
    try:
        limpieza.query(Usuario).filter(Usuario.id == usuario_id).delete(synchronize_session=False)
        limpieza.query(Persona).filter(Persona.id == persona_id).delete(synchronize_session=False)
        limpieza.commit()
    finally:
        limpieza.close()


def _login_real(correo: str) -> dict:
    sesion = Session(bind=db_engine)
    try:
        return AuthServicio(sesion).login(correo, CLAVE, user_agent="curl/8.7.1")
    finally:
        sesion.close()


def _fila_real(sid: int) -> Sesion:
    lectura = Session(bind=db_engine)
    try:
        fila = lectura.get(Sesion, sid)
        lectura.expunge(fila)
        return fila
    finally:
        lectura.close()


def _filas_con_huella_real(usuario_id: int) -> list[Sesion]:
    lectura = Session(bind=db_engine)
    try:
        filas = lectura.query(Sesion).filter(
            Sesion.usuario_id == usuario_id, Sesion.legacy_huella.is_not(None),
        ).all()
        lectura.expunge_all()
        return filas
    finally:
        lectura.close()


def _refresh_legacy_real(correo: str, persona_id: int, version_sesion: int, sid: int | None = None) -> str:
    datos = {"sub": correo, "persona_id": persona_id}
    if sid is not None:
        datos["sid"] = sid
    return GestorAutenticacion.crear_token_refresco(datos, version_sesion=version_sesion)


def _hay_un_refresh_esperando_el_bloqueo() -> bool:
    with db_engine.connect() as conexion:
        esperando = conexion.execute(text(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
            "AND wait_event_type = 'Lock' AND query ILIKE '%FOR UPDATE%'"
        )).scalar()
    return esperando >= 1


def _post_refresh(refresh_token: str):
    async def _cuerpo():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as cliente:
            return await cliente.post("/api/v1/auth/refresh", json={"refresh_token": refresh_token})

    return asyncio.run(_cuerpo())


class _Corrida:
    """Dos refresh con el mismo token, cada uno en su hilo."""

    def __init__(self) -> None:
        self.resultados: dict[str, object] = {}
        self.hilos: list[threading.Thread] = []

    def lanzar(self, nombre: str, refresh_token: str) -> None:
        def _correr():
            try:
                self.resultados[nombre] = _post_refresh(refresh_token)
            except BaseException as error:  # noqa: BLE001 -- se re-lanza en el hilo principal
                self.resultados[nombre] = error

        hilo = threading.Thread(target=_correr, daemon=True)
        self.hilos.append(hilo)
        hilo.start()

    def esperar(self) -> tuple:
        for hilo in self.hilos:
            hilo.join(timeout=_ESPERA_MAXIMA_SEGUNDOS * 2)
            assert not hilo.is_alive(), "un refresh quedó colgado"
        for resultado in self.resultados.values():
            if isinstance(resultado, BaseException):
                raise resultado
        return self.resultados["a"], self.resultados["b"]


def _refrescos_con_ganador_retenido(monkeypatch, refresh_token: str, metodo: str) -> tuple:
    """Lanza A, lo RETIENE con el bloqueo de la fila tomado (dentro de
    `metodo`, antes de que decida) hasta ver en `pg_stat_activity` que B espera
    ese bloqueo, y recién entonces lo suelta: el solape es determinista, no una
    carrera de suerte. Devuelve `(respuesta_a, respuesta_b, b_espero_el_bloqueo)`."""
    original = getattr(AuthServicio, metodo)
    a_tiene_el_bloqueo = threading.Event()
    guardia = threading.Lock()
    b_espero = {"valor": False}

    def retener(self, *args, **kwargs):
        with guardia:
            soy_a = not a_tiene_el_bloqueo.is_set()
            a_tiene_el_bloqueo.set()
        if soy_a:
            limite = time.monotonic() + _ESPERA_MAXIMA_SEGUNDOS
            while time.monotonic() < limite:
                if _hay_un_refresh_esperando_el_bloqueo():
                    b_espero["valor"] = True
                    break
                time.sleep(0.05)
        return original(self, *args, **kwargs)

    monkeypatch.setattr(AuthServicio, metodo, retener)
    corrida = _Corrida()
    corrida.lanzar("a", refresh_token)
    assert a_tiene_el_bloqueo.wait(timeout=_ESPERA_MAXIMA_SEGUNDOS), "A nunca llegó a decidir"
    corrida.lanzar("b", refresh_token)
    respuesta_a, respuesta_b = corrida.esperar()
    return respuesta_a, respuesta_b, b_espero["valor"]


def test_dos_refresh_simultaneos_con_el_mismo_token_rotan_una_sola_vez():
    usuario_id, persona_id, correo = _crear_cuenta_real(7101)
    try:
        par = _login_real(correo)
        jti_original = _claims(par["refresh_token"])["jti"]
        sid = _claims(par["refresh_token"])["sid"]
        mp = pytest.MonkeyPatch()
        try:
            a, b, b_espero = _refrescos_con_ganador_retenido(mp, par["refresh_token"], "_rotar_o_rechazar")
        finally:
            mp.undo()

        assert b_espero, "el segundo refresh no esperó el FOR UPDATE: no hubo solape real"
        assert a.status_code == 200, a.text
        assert b.status_code == 200, b.text
        jti_a = _claims(a.json()["refresh_token"])["jti"]
        jti_b = _claims(b.json()["refresh_token"])["jti"]
        fila = _fila_real(sid)
        # Una sola rotación: los dos reciben el MISMO `jti`, el vigente.
        assert jti_a == jti_b == fila.refresh_jti
        assert fila.refresh_jti != jti_original
        assert fila.refresh_jti_anterior == jti_original
        assert fila.revocada_en is None
        # Y nadie quedó trabado: el par recibido sigue rotando con normalidad.
        siguiente = _post_refresh(a.json()["refresh_token"])
        assert siguiente.status_code == 200, siguiente.text
        assert _fila_real(sid).revocada_en is None
    finally:
        _limpiar_cuenta_real(usuario_id, persona_id)


def test_dos_adopciones_legacy_simultaneas_con_sid_adoptan_una_sola_vez():
    usuario_id, persona_id, correo = _crear_cuenta_real(7102)
    try:
        par = _login_real(correo)
        sid = _claims(par["refresh_token"])["sid"]
        # La fila de antes de la rotación: sin `jti`, sin marcas de actividad.
        preparacion = Session(bind=db_engine)
        try:
            fila = preparacion.get(Sesion, sid)
            fila.refresh_jti = None
            fila.rotado_en = None
            fila.ultimo_uso_en = None
            version = fila.version_sesion
            preparacion.commit()
        finally:
            preparacion.close()
        legacy = _refresh_legacy_real(correo, persona_id, version, sid=sid)

        mp = pytest.MonkeyPatch()
        try:
            a, b, b_espero = _refrescos_con_ganador_retenido(mp, legacy, "_adoptar_legacy")
        finally:
            mp.undo()

        assert b_espero, "el segundo refresh no esperó el FOR UPDATE: no hubo solape real"
        assert a.status_code == 200, a.text
        assert b.status_code == 200, b.text
        fila = _fila_real(sid)
        assert fila.refresh_jti is not None
        # La misma cookie legacy usada dos veces a la vez es la carrera benigna
        # del BFF: una adopción, los dos con el `jti` adoptado, sin revocar.
        assert _claims(a.json()["refresh_token"])["jti"] == fila.refresh_jti
        assert _claims(b.json()["refresh_token"])["jti"] == fila.refresh_jti
        assert fila.revocada_en is None
    finally:
        _limpiar_cuenta_real(usuario_id, persona_id)


def test_dos_primeros_usos_legacy_sin_sid_abren_una_sola_sesion(monkeypatch):
    """Sin `sid` no hay fila que bloquear: el desempate es el índice único de
    `legacy_huella`. Los dos hilos esperan en una barrera tras ver que no hay
    fila, así los dos intentan insertar; el perdedor choca en el índice y lee
    la fila del ganador."""
    usuario_id, persona_id, correo = _crear_cuenta_real(7103)
    try:
        version = _fila_real(_claims(_login_real(correo)["refresh_token"])["sid"]).version_sesion
        legacy = _refresh_legacy_real(correo, persona_id, version)

        original = AuthServicio._sesion_legacy_bloqueada
        barrera = threading.Barrier(2, timeout=_ESPERA_MAXIMA_SEGUNDOS)
        visto = threading.local()

        def sin_fila_todavia(self, usuario, huella):
            fila = original(self, usuario, huella)
            if not getattr(visto, "primera_lectura_hecha", False):
                visto.primera_lectura_hecha = True
                barrera.wait()
            return fila

        monkeypatch.setattr(AuthServicio, "_sesion_legacy_bloqueada", sin_fila_todavia)
        corrida = _Corrida()
        corrida.lanzar("a", legacy)
        corrida.lanzar("b", legacy)
        a, b = corrida.esperar()

        assert a.status_code == 200, a.text
        assert b.status_code == 200, b.text
        filas = _filas_con_huella_real(usuario_id)
        assert len(filas) == 1
        sid = filas[0].id
        assert _claims(a.json()["refresh_token"])["sid"] == sid
        assert _claims(b.json()["refresh_token"])["sid"] == sid
        assert _claims(a.json()["refresh_token"])["jti"] == filas[0].refresh_jti
        assert _claims(b.json()["refresh_token"])["jti"] == filas[0].refresh_jti
        assert filas[0].revocada_en is None
    finally:
        _limpiar_cuenta_real(usuario_id, persona_id)
