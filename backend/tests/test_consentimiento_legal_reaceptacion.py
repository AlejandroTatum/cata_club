"""Re-aceptación de los términos vigentes (S8): quien aceptó una versión
anterior debe aceptar la vigente antes de seguir usando la app."""
from datetime import date

from app.dominio.modelos import ConsentimientoLegal, Persona, RevocacionConsentimientoLegal
from app.servicios_negocio.consentimiento_legal_servicio import (
    DOCUMENTOS_LEGALES,
    TEXTOS_LEGALES_VIGENTES,
    VERSION_LEGAL_VIGENTE,
)
from tests.test_auth_activation import _crear_usuario, _token

RUTA = "/api/v1/auth/consentimiento-legal"
RUTA_ACEPTAR = f"{RUTA}/aceptar"


def _aceptar_version(db_session, usuario, version, documentos=DOCUMENTOS_LEGALES, representado=None):
    for documento in documentos:
        db_session.add(ConsentimientoLegal(
            cuenta_id=usuario.id, documento=documento, version_documento=version,
            texto_aceptado=TEXTOS_LEGALES_VIGENTES[documento], representado_persona_id=representado,
        ))
    db_session.commit()


def _representar(db_session, representante, representado):
    menor = db_session.get(Persona, representado.persona_id)
    menor.fecha_nacimiento = date.today().replace(year=date.today().year - 10, day=1)
    menor.representante_id = representante.persona_id
    db_session.commit()


def _revocar(db_session, usuario, documento, representado=None):
    consentimiento = db_session.query(ConsentimientoLegal).filter_by(
        cuenta_id=usuario.id, documento=documento, representado_persona_id=representado,
    ).one()
    db_session.add(RevocacionConsentimientoLegal(
        consentimiento_id=consentimiento.id, cuenta_id=usuario.id, motivo="retiro",
    ))
    db_session.commit()
    return consentimiento


def _headers(usuario):
    return {"Authorization": f"Bearer {_token(usuario)}"}


def _usuario(db_session, correo="reaceptar@cataclub.test"):
    return _crear_usuario(db_session, correo=correo, correo_verificado=True)


def test_pendiente_cuando_la_ultima_version_aceptada_es_anterior(client_sin_token, db_session):
    usuario = _usuario(db_session)
    _aceptar_version(db_session, usuario, "2.2")

    respuesta = client_sin_token.get(RUTA, headers=_headers(usuario))

    assert respuesta.status_code == 200
    assert respuesta.json() == {"pendiente": True, "version": VERSION_LEGAL_VIGENTE}


def test_no_pendiente_cuando_ya_acepto_la_vigente(client_sin_token, db_session):
    usuario = _usuario(db_session)
    _aceptar_version(db_session, usuario, VERSION_LEGAL_VIGENTE)

    respuesta = client_sin_token.get(RUTA, headers=_headers(usuario))

    assert respuesta.json()["pendiente"] is False


def test_aceptar_registra_la_version_vigente_y_limpia_el_pendiente(client_sin_token, db_session):
    usuario = _usuario(db_session)
    _aceptar_version(db_session, usuario, "2.2")

    respuesta = client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario))

    assert respuesta.status_code == 200
    assert respuesta.json()["pendiente"] is False
    vigentes = db_session.query(ConsentimientoLegal).filter_by(
        cuenta_id=usuario.id, version_documento=VERSION_LEGAL_VIGENTE,
    ).all()
    assert {registro.documento for registro in vigentes} == set(DOCUMENTOS_LEGALES)
    assert all(registro.aceptado_en is not None for registro in vigentes)
    assert client_sin_token.get(RUTA, headers=_headers(usuario)).json()["pendiente"] is False


def test_aceptar_es_idempotente_y_no_duplica_filas(client_sin_token, db_session):
    usuario = _usuario(db_session)
    _aceptar_version(db_session, usuario, "2.2")

    client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario))
    segunda = client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario))

    assert segunda.status_code == 200
    assert db_session.query(ConsentimientoLegal).filter_by(cuenta_id=usuario.id).count() == 8


def test_aceptar_conserva_el_alcance_del_representante(client_sin_token, db_session):
    usuario = _usuario(db_session)
    hijo = _usuario(db_session, correo="hijo@cataclub.test")
    _representar(db_session, usuario, hijo)
    _aceptar_version(db_session, usuario, "2.2", representado=hijo.persona_id)

    client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario))

    nuevo = db_session.query(ConsentimientoLegal).filter_by(
        cuenta_id=usuario.id, version_documento=VERSION_LEGAL_VIGENTE,
    ).all()
    assert len(nuevo) == 4
    assert {registro.representado_persona_id for registro in nuevo} == {hijo.persona_id}


def test_sin_token_se_rechaza(client_sin_token):
    assert client_sin_token.get(RUTA).status_code == 401
    assert client_sin_token.post(RUTA_ACEPTAR).status_code == 401


def test_aceptar_no_registra_a_nombre_de_otra_cuenta(client_sin_token, db_session):
    propia = _usuario(db_session)
    ajena = _usuario(db_session, correo="ajena@cataclub.test")
    _aceptar_version(db_session, propia, "2.2")
    _aceptar_version(db_session, ajena, "2.2")

    client_sin_token.post(
        RUTA_ACEPTAR, headers=_headers(propia), json={"cuenta_id": ajena.id},
    )

    assert db_session.query(ConsentimientoLegal).filter_by(
        cuenta_id=ajena.id, version_documento=VERSION_LEGAL_VIGENTE,
    ).count() == 0
    assert client_sin_token.get(RUTA, headers=_headers(ajena)).json()["pendiente"] is True


def test_cuenta_sin_consentimientos_previos_no_queda_bloqueada(client_sin_token, db_session):
    usuario = _usuario(db_session)

    assert client_sin_token.get(RUTA, headers=_headers(usuario)).json()["pendiente"] is False
    assert client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario)).status_code == 200
    assert db_session.query(ConsentimientoLegal).filter_by(cuenta_id=usuario.id).count() == 0


def test_documento_revocado_no_se_reacepta_ni_queda_pendiente(client_sin_token, db_session):
    usuario = _usuario(db_session)
    _aceptar_version(db_session, usuario, "2.2")
    revocado = _revocar(db_session, usuario, "FETM")

    assert client_sin_token.get(RUTA, headers=_headers(usuario)).json()["pendiente"] is True
    client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario))

    nuevos = db_session.query(ConsentimientoLegal).filter_by(
        cuenta_id=usuario.id, version_documento=VERSION_LEGAL_VIGENTE,
    ).all()
    assert {registro.documento for registro in nuevos} == set(DOCUMENTOS_LEGALES) - {"FETM"}
    assert client_sin_token.get(RUTA, headers=_headers(usuario)).json()["pendiente"] is False
    assert db_session.query(RevocacionConsentimientoLegal).filter_by(
        consentimiento_id=revocado.id,
    ).count() == 1


def test_cuenta_solo_con_documentos_revocados_no_queda_pendiente(client_sin_token, db_session):
    usuario = _usuario(db_session)
    _aceptar_version(db_session, usuario, "2.2")
    for documento in DOCUMENTOS_LEGALES:
        _revocar(db_session, usuario, documento)

    assert client_sin_token.get(RUTA, headers=_headers(usuario)).json()["pendiente"] is False
    client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario))
    assert db_session.query(ConsentimientoLegal).filter_by(
        cuenta_id=usuario.id, version_documento=VERSION_LEGAL_VIGENTE,
    ).count() == 0


def test_ex_representado_no_se_reacepta_pero_el_actual_si(client_sin_token, db_session):
    usuario = _usuario(db_session)
    actual = _usuario(db_session, correo="actual@cataclub.test")
    antiguo = _usuario(db_session, correo="antiguo@cataclub.test")
    _representar(db_session, usuario, actual)
    _aceptar_version(db_session, usuario, "2.2", representado=antiguo.persona_id)

    assert client_sin_token.get(RUTA, headers=_headers(usuario)).json()["pendiente"] is False

    _aceptar_version(db_session, usuario, "2.2", representado=actual.persona_id)
    assert client_sin_token.get(RUTA, headers=_headers(usuario)).json()["pendiente"] is True
    client_sin_token.post(RUTA_ACEPTAR, headers=_headers(usuario))

    nuevos = db_session.query(ConsentimientoLegal).filter_by(
        cuenta_id=usuario.id, version_documento=VERSION_LEGAL_VIGENTE,
    ).all()
    assert {registro.representado_persona_id for registro in nuevos} == {actual.persona_id}
    assert len(nuevos) == 4
