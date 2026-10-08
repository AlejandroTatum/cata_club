"""
Issue #1666: invitar, aceptar y quitar al segundo guardián de un menor.

Decisiones del dueño (ver `odd/tasks/1666-second-guardian.md`): máximo dos
guardianes (principal + uno); el principal invita por correo y puede quitar,
el administrador también; "la invitación le crea la cuenta" -- si el correo no
tiene cuenta, se crea una REPRESENTANTE con el enlace de fijar contraseña de
siempre (token `reset_password` de un solo uso y corta duración, sin
contraseña en el correo); un correo de una cuenta que no es REPRESENTANTE se
rechaza; altas, aceptaciones y bajas quedan auditadas.
"""
from datetime import date
from unittest.mock import patch

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.modelos import (
    CoRepresentante, CoRepresentanteEvento, CoRepresentanteInvitacion, ConsentimientoLegal,
    CorreoOutbox, Persona, RecuperacionOutbox, Usuario,
)
from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio
from app.infraestructura.tareas import recuperacion_tareas
from app.seguridad.gestor_auth import GestorAutenticacion
from app.dominio.invitacion_co_representante import PROPOSITO_INVITACION_CO_REPRESENTANTE
from main import app
from tests.fabricas_pagos import crear_persona_orm

BASE = "/api/v1"
CONTRASENIA = "claveNueva12345"
CORREO_NUEVO = "padre.nuevo@x.com"


def _como(persona_id: int, roles: list[str], correo: str = "sesion@cataclub.test") -> None:
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": correo, "persona_id": persona_id, "roles": roles,
    }


def _cuenta(db_session, persona: Persona, correo: str, *roles: TipoRol, verificado=True) -> Usuario:
    usuario = Usuario(
        correo=correo,
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("claveVieja12345"),
        persona_id=persona.id, correo_verificado=verificado,
        roles=[RolRepositorio(db_session).obtener_o_crear(r) for r in roles],
    )
    db_session.add(usuario)
    db_session.flush()
    return usuario


class Familia:
    pass


@pytest.fixture()
def fam(db_session, client):
    f = Familia()
    f.principal = crear_persona_orm(db_session, cedula_valida(8200), nombres="Madre", apellidos="Principal")
    f.ajeno = crear_persona_orm(db_session, cedula_valida(8201), nombres="Tercero", apellidos="Ajeno")
    f.admin = crear_persona_orm(db_session, cedula_valida(8202), nombres="Admin", apellidos="Club")
    f.existente = crear_persona_orm(db_session, cedula_valida(8203), nombres="Padre", apellidos="Existente")
    f.menor = crear_persona_orm(
        db_session, cedula_valida(8204), nombres="Hijo", apellidos="Principal", fecha_nacimiento=date(2015, 3, 3),
    )
    f.menor2 = crear_persona_orm(
        db_session, cedula_valida(8205), nombres="Hija", apellidos="Principal", fecha_nacimiento=date(2017, 5, 5),
    )
    for m in (f.menor, f.menor2):
        m.representante_id = f.principal.id
    f.cuenta_principal = _cuenta(db_session, f.principal, "madre@x.com", TipoRol.REPRESENTANTE)
    f.cuenta_existente = _cuenta(db_session, f.existente, "existente@x.com", TipoRol.REPRESENTANTE)
    f.cuenta_ajeno = _cuenta(db_session, f.ajeno, "ajeno@x.com", TipoRol.REPRESENTANTE)
    db_session.commit()
    _como(f.principal.id, ["REPRESENTANTE"], "madre@x.com")
    return f


def _datos_invitado(secuencia=8300, **extra):
    d = {
        "nombres": "Padre", "apellidos": "Nuevo", "cedula": cedula_valida(secuencia),
        "fecha_nacimiento": "1982-04-04", "telefono": "0991234567",
    }
    d.update(extra)
    return d


NEUTRA = {"mensaje": "Si el correo es válido, enviaremos la invitación."}


def _invitar(client, fam, *, correo=CORREO_NUEVO, persona_ids=None, datos="auto"):
    cuerpo = {"persona_ids": persona_ids or [fam.menor.id], "correo": correo}
    if datos is not None:
        cuerpo["datos"] = _datos_invitado() if datos == "auto" else datos
    return client.post(f"{BASE}/co-representantes/invitaciones", json=cuerpo)


def _eventos(db_session, persona_id):
    db_session.expire_all()
    return [
        (e.operacion, e.origen, e.actor_persona_id, e.co_representante_id)
        for e in db_session.query(CoRepresentanteEvento)
        .filter_by(persona_id=persona_id).order_by(CoRepresentanteEvento.id)
    ]


def _token_del_correo(usuario: Usuario) -> str:
    """El token que acuña el worker al enviar: se captura del envío real."""
    capturado = {}

    def _espia(self, correo, token, nombre=None, nombre_menor="", nombre_invitante=""):
        capturado.update(token=token, nombre_menor=nombre_menor, nombre_invitante=nombre_invitante)

    with patch.object(ServicioNotificaciones, "enviar_invitacion_co_representante", _espia):
        recuperacion_tareas._enviar_enlace(usuario)
    return capturado["token"]


def _restablecer(client, token, **extra):
    return client.post(
        f"{BASE}/auth/restablecer-contrasenia",
        json={"token": token, "nueva_contrasenia": CONTRASENIA, **extra},
    )


# --- Invitar con un correo NUEVO: la invitación crea la cuenta --------------
def test_invitar_con_correo_nuevo_crea_la_cuenta_y_encola_el_correo(client, db_session, fam):
    respuesta = _invitar(client, fam)

    assert respuesta.status_code == 202, respuesta.text
    assert respuesta.json() == NEUTRA
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()
    assert [r.tipo_rol for r in cuenta.roles] == [TipoRol.REPRESENTANTE]
    assert cuenta.correo_verificado is False
    vinculo = db_session.query(CoRepresentante).filter_by(persona_id=fam.menor.id).one()
    assert vinculo.co_representante_id == cuenta.persona_id
    assert vinculo.creado_por_persona_id == fam.principal.id
    assert db_session.query(RecuperacionOutbox).filter_by(usuario_id=cuenta.id).one().status == "PENDIENTE"
    assert db_session.query(CoRepresentanteInvitacion).filter_by(co_representante_id=cuenta.persona_id).count() == 1


def test_el_worker_envia_un_enlace_de_un_solo_proposito_sin_contrasenia(client, db_session, fam):
    _invitar(client, fam)
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()
    enviados = []
    with patch.object(ServicioNotificaciones, "enviar_correo", lambda self, *a: enviados.append(a)):
        recuperacion_tareas._enviar_enlace(cuenta)

    correo, asunto, texto, html = enviados[0]
    assert correo == CORREO_NUEVO
    assert "segundo representante" in asunto
    assert "Hijo" in texto and "Madre Principal" in texto
    assert "/reset-password?token=" in texto and "invitacion=representante" in texto
    # Ninguna contraseña viaja en el cuerpo: ni su hash ni un "tu contraseña es".
    assert cuenta.contrasenia not in texto and cuenta.contrasenia not in html
    for fragmento in ("tu contraseña es", "contraseña temporal", "clave temporal"):
        assert fragmento not in texto.lower()
    payload = GestorAutenticacion.decodificar_token_recuperacion(
        texto.split("token=")[1].split("&")[0],
    )
    assert payload["prp"] == PROPOSITO_INVITACION_CO_REPRESENTANTE
    assert payload["type"] == "reset_password"


def test_sin_datos_la_peticion_se_rechaza_y_no_crea_nada(client, db_session, fam):
    antes = (db_session.query(Persona).count(), db_session.query(Usuario).count())

    respuesta = _invitar(client, fam, datos=None)

    assert respuesta.status_code == 422
    assert (db_session.query(Persona).count(), db_session.query(Usuario).count()) == antes
    assert db_session.query(CoRepresentante).count() == 0


def test_datos_invalidos_o_duplicados_no_dejan_nada(client, db_session, fam):
    antes = (db_session.query(Persona).count(), db_session.query(Usuario).count())

    menor_de_edad = _invitar(client, fam, datos=_datos_invitado(fecha_nacimiento="2015-01-01"))
    cedula_repetida = _invitar(client, fam, datos=_datos_invitado(cedula=fam.ajeno.cedula))
    sin_cedula_valida = _invitar(client, fam, datos=_datos_invitado(cedula="1234567890"))

    assert menor_de_edad.status_code == 400 and "mayor de edad" in menor_de_edad.json()["detail"]
    assert cedula_repetida.status_code == 202 and cedula_repetida.json() == NEUTRA
    assert sin_cedula_valida.status_code == 422
    assert (db_session.query(Persona).count(), db_session.query(Usuario).count()) == antes
    assert db_session.query(CoRepresentante).count() == 0


# --- Cuenta existente: invitación pendiente, nunca vínculo silencioso -------
def _correos_enviados():
    enviados = []
    return enviados, patch.object(
        ServicioNotificaciones, "enviar_correo", lambda self, *a: enviados.append(a),
    )


def test_invitar_a_un_representante_existente_deja_una_invitacion_pendiente_sin_vincular(client, db_session, fam):
    antes = (db_session.query(Persona).count(), db_session.query(Usuario).count())
    enviados, espia = _correos_enviados()

    with espia:
        respuesta = _invitar(client, fam, correo="Existente@X.com")

    assert respuesta.status_code == 202 and respuesta.json() == NEUTRA
    assert (db_session.query(Persona).count(), db_session.query(Usuario).count()) == antes
    assert db_session.query(CoRepresentante).count() == 0
    assert db_session.query(RecuperacionOutbox).count() == 0
    invitacion = db_session.query(CoRepresentanteInvitacion).one()
    assert invitacion.co_representante_id == fam.existente.id and invitacion.aceptada_en is None
    assert _eventos(db_session, fam.menor.id) == [("INVITACION", "REPRESENTANTE", fam.principal.id, fam.existente.id)]
    # Aviso sin enlace de un solo uso ni contraseña.
    assert enviados[0][0] == "existente@x.com" and "token=" not in enviados[0][2]
    # Antes de aceptar no hay acceso a nada del menor.
    _como(fam.existente.id, ["REPRESENTANTE"], "existente@x.com")
    assert client.get(f"{BASE}/personas/{fam.menor.id}").status_code == 403
    assert client.get(f"{BASE}/co-representantes/mios").json() == []


def test_el_aviso_a_un_representante_existente_se_encola_en_la_cola_de_correos(client, db_session, fam):
    """Issue #1710: el aviso no sale en la petición; queda en `correo_outbox`
    para que un tope diario agotado lo difiera en vez de perderlo."""
    respuesta = _invitar(client, fam, correo="Existente@X.com")

    assert respuesta.status_code == 202
    db_session.expire_all()
    [fila] = db_session.query(CorreoOutbox).all()
    assert fila.destinatario == "existente@x.com"
    assert fila.status == "PENDIENTE"
    assert "token=" not in fila.cuerpo_texto


def test_la_respuesta_es_identica_exista_o_no_el_correo(client, db_session, fam):
    otra = crear_persona_orm(db_session, cedula_valida(8212), nombres="Otro", apellidos="Rol")
    _cuenta(db_session, otra, "admin2@x.com", TipoRol.ADMINISTRADOR)
    inactiva = crear_persona_orm(db_session, cedula_valida(8213), nombres="In", apellidos="Activa")
    _cuenta(db_session, inactiva, "sinverificar@x.com", TipoRol.REPRESENTANTE, verificado=False)
    db_session.commit()

    correos = [CORREO_NUEVO, "existente@x.com", "admin2@x.com", "sinverificar@x.com", "madre@x.com", "no-existe@x.com"]
    respuestas = []
    for i, correo in enumerate(correos):
        # Cada correo se prueba sobre un menor sin guardián: se quita lo que dejó el intento previo.
        client.delete(f"{BASE}/co-representantes/persona/{fam.menor.id}")
        with _correos_enviados()[1]:
            r = _invitar(client, fam, correo=correo, datos=_datos_invitado(8400 + i))
        respuestas.append((correo, r.status_code, r.json()))

    assert {(s, tuple(sorted(b.items()))) for _, s, b in respuestas} == {(202, tuple(sorted(NEUTRA.items())))}, respuestas


def test_un_correo_ajeno_o_de_otro_rol_no_deja_rastro(client, db_session, fam):
    otra = crear_persona_orm(db_session, cedula_valida(8214), nombres="Otro", apellidos="Rol")
    _cuenta(db_session, otra, "otrorol@x.com", TipoRol.ENTRENADOR)
    db_session.commit()

    assert _invitar(client, fam, correo="otrorol@x.com").json() == NEUTRA
    assert _invitar(client, fam, correo="madre@x.com").json() == NEUTRA

    assert db_session.query(CoRepresentante).count() == 0
    assert db_session.query(CoRepresentanteInvitacion).count() == 0
    db_session.expire_all()
    assert [r.tipo_rol for r in db_session.query(Usuario).filter_by(correo="otrorol@x.com").one().roles] == [TipoRol.ENTRENADOR]


def test_el_principal_no_ve_los_datos_del_invitado_hasta_que_acepta(client, db_session, fam):
    _invitar(client, fam, correo="existente@x.com")

    segundo = {m["personaId"]: m for m in client.get(f"{BASE}/co-representantes/mios").json()}[fam.menor.id]
    assert segundo["completo"] is True
    assert segundo["segundoGuardian"] == {
        "personaId": None, "nombres": None, "apellidos": None,
        "correo": "existente@x.com", "estado": "PENDIENTE",
    }
    assert "Padre" not in str(segundo) and "Existente" not in str(segundo)


def test_la_cuenta_invitada_ve_la_invitacion_y_al_aceptar_queda_vinculada(client, db_session, fam):
    _invitar(client, fam, correo="existente@x.com")
    _como(fam.existente.id, ["REPRESENTANTE"], "existente@x.com")

    recibidas = client.get(f"{BASE}/co-representantes/invitaciones/recibidas").json()
    assert len(recibidas) == 1 and recibidas[0]["nombreMenor"] == "Hijo"
    assert "apellidos" not in str(recibidas).lower()

    assert client.post(f"{BASE}/co-representantes/invitaciones/{recibidas[0]['id']}/aceptar").status_code == 204

    assert db_session.query(CoRepresentante).filter_by(persona_id=fam.menor.id).one().co_representante_id == fam.existente.id
    assert [e[0] for e in _eventos(db_session, fam.menor.id)] == ["INVITACION", "ACEPTACION", "ALTA"]
    assert client.get(f"{BASE}/personas/{fam.menor.id}").status_code == 200
    assert client.get(f"{BASE}/co-representantes/invitaciones/recibidas").json() == []
    _como(fam.principal.id, ["REPRESENTANTE"], "madre@x.com")
    visto = {m["personaId"]: m for m in client.get(f"{BASE}/co-representantes/mios").json()}[fam.menor.id]
    assert visto["segundoGuardian"]["estado"] == "ACTIVO" and visto["segundoGuardian"]["nombres"] == "Padre"


def test_nadie_mas_puede_aceptar_una_invitacion_ajena(client, db_session, fam):
    _invitar(client, fam, correo="existente@x.com")
    invitacion_id = db_session.query(CoRepresentanteInvitacion).one().id

    for persona, correo in ((fam.ajeno, "ajeno@x.com"), (fam.principal, "madre@x.com")):
        _como(persona.id, ["REPRESENTANTE"], correo)
        assert client.post(f"{BASE}/co-representantes/invitaciones/{invitacion_id}/aceptar").status_code == 404
    assert client.post(f"{BASE}/co-representantes/invitaciones/999999/aceptar").status_code == 404
    assert db_session.query(CoRepresentante).count() == 0


def test_quitar_cancela_la_invitacion_pendiente_y_ya_no_se_puede_aceptar(client, db_session, fam):
    _invitar(client, fam, correo="existente@x.com")
    invitacion_id = db_session.query(CoRepresentanteInvitacion).one().id

    assert client.delete(f"{BASE}/co-representantes/persona/{fam.menor.id}").status_code == 204

    _como(fam.existente.id, ["REPRESENTANTE"], "existente@x.com")
    assert client.post(f"{BASE}/co-representantes/invitaciones/{invitacion_id}/aceptar").status_code == 404
    assert db_session.query(CoRepresentante).count() == 0
    assert [e[0] for e in _eventos(db_session, fam.menor.id)] == ["INVITACION", "INVITACION_CANCELADA"]


def test_una_invitacion_pendiente_ocupa_el_cupo_del_segundo_guardian(client, db_session, fam):
    _invitar(client, fam, correo="existente@x.com")

    otra = _invitar(client, fam, correo="ajeno@x.com")

    assert otra.status_code == 400 and "dos representantes" in otra.json()["detail"]


def test_no_se_puede_invitar_al_propio_principal(client, db_session, fam):
    respuesta = _invitar(client, fam, correo="madre@x.com")

    assert respuesta.status_code == 202 and respuesta.json() == NEUTRA
    assert db_session.query(CoRepresentante).count() == 0


# --- Máximo dos guardianes ---------------------------------------------------
def test_un_menor_no_admite_un_tercer_guardian(client, db_session, fam):
    _con_segundo_guardian(client, db_session, fam)

    tercero = _invitar(client, fam, correo="ajeno@x.com")

    assert tercero.status_code == 400
    assert "dos representantes" in tercero.json()["detail"]
    assert db_session.query(CoRepresentante).filter_by(persona_id=fam.menor.id).count() == 1


def test_la_base_tambien_impone_el_tope(db_session, fam):
    db_session.add(CoRepresentante(
        persona_id=fam.menor.id, co_representante_id=fam.existente.id, creado_por_persona_id=fam.principal.id,
    ))
    db_session.commit()
    from sqlalchemy.exc import IntegrityError
    db_session.add(CoRepresentante(
        persona_id=fam.menor.id, co_representante_id=fam.ajeno.id, creado_por_persona_id=fam.principal.id,
    ))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_invitar_para_varios_hijos_es_todo_o_nada(client, db_session, fam):
    db_session.add(CoRepresentante(
        persona_id=fam.menor2.id, co_representante_id=fam.ajeno.id, creado_por_persona_id=fam.principal.id,
    ))
    db_session.commit()
    antes = db_session.query(Usuario).count()

    respuesta = _invitar(client, fam, persona_ids=[fam.menor.id, fam.menor2.id])

    assert respuesta.status_code == 400
    assert db_session.query(Usuario).count() == antes
    assert db_session.query(CoRepresentante).filter_by(persona_id=fam.menor.id).count() == 0


def test_una_invitacion_cubre_a_varios_hijos_con_un_solo_correo(client, db_session, fam):
    respuesta = _invitar(client, fam, persona_ids=[fam.menor.id, fam.menor2.id])

    assert respuesta.status_code == 202, respuesta.text
    assert db_session.query(CoRepresentante).count() == 2
    assert db_session.query(RecuperacionOutbox).count() == 1
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()
    assert _token_del_correo(cuenta)


# --- Token: un solo uso y corta duración ------------------------------------
def test_aceptar_con_el_enlace_verifica_el_correo_y_audita_la_aceptacion(client, db_session, fam):
    _invitar(client, fam)
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()
    token = _token_del_correo(cuenta)

    sin_terminos = _restablecer(client, token)
    assert sin_terminos.status_code == 400
    aceptado = _restablecer(client, token, acepta_terminos=True)
    assert aceptado.status_code == 204, aceptado.text

    db_session.expire_all()
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()
    assert cuenta.correo_verificado is True
    assert {c.documento for c in db_session.query(ConsentimientoLegal).filter_by(cuenta_id=cuenta.id)} == {
        "TERMINOS", "PRIVACIDAD",
    }
    assert db_session.query(CoRepresentanteInvitacion).one().aceptada_en is not None
    assert [e[0] for e in _eventos(db_session, fam.menor.id)] == ["INVITACION", "ALTA", "ACEPTACION"]
    # En su primer ingreso la cuenta YA es guardián del menor.
    _como(cuenta.persona_id, ["REPRESENTANTE"], CORREO_NUEVO)
    assert client.get(f"{BASE}/personas/{fam.menor.id}").status_code == 200
    login = client.post(f"{BASE}/auth/login", data={"username": CORREO_NUEVO, "password": CONTRASENIA})
    assert login.status_code == 200, login.text


def test_el_enlace_no_acepta_la_invitacion_de_otro_principal_a_la_misma_cuenta_nueva(client, db_session, fam):
    """La cuenta que creo una invitacion solo consiente, al fijar la contrasenia,
    los vinculos que esa invitacion ya creo. La invitacion posterior de OTRO
    principal queda pendiente y se acepta con la sesion, como cualquier otra."""
    otro = crear_persona_orm(db_session, cedula_valida(8210), nombres="Otra", apellidos="Familia")
    menor3 = crear_persona_orm(
        db_session, cedula_valida(8211), nombres="Nieta", apellidos="Familia", fecha_nacimiento=date(2016, 6, 6),
    )
    menor3.representante_id = otro.id
    _cuenta(db_session, otro, "otra@x.com", TipoRol.REPRESENTANTE)
    db_session.commit()
    _invitar(client, fam)
    _como(otro.id, ["REPRESENTANTE"], "otra@x.com")
    _invitar(client, fam, persona_ids=[menor3.id])
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()

    assert _restablecer(client, _token_del_correo(cuenta), acepta_terminos=True).status_code == 204

    db_session.expire_all()
    assert db_session.query(CoRepresentante).filter_by(persona_id=menor3.id).count() == 0
    assert db_session.query(CoRepresentanteInvitacion).filter_by(persona_id=menor3.id).one().aceptada_en is None
    assert [e[0] for e in _eventos(db_session, menor3.id)] == ["INVITACION"]
    assert [e[0] for e in _eventos(db_session, fam.menor.id)] == ["INVITACION", "ALTA", "ACEPTACION"]
    _como(cuenta.persona_id, ["REPRESENTANTE"], CORREO_NUEVO)
    recibidas = client.get(f"{BASE}/co-representantes/invitaciones/recibidas").json()
    assert [r["nombreMenor"] for r in recibidas] == ["Nieta"]
    assert client.post(f"{BASE}/co-representantes/invitaciones/{recibidas[0]['id']}/aceptar").status_code == 204
    assert client.get(f"{BASE}/personas/{menor3.id}").status_code == 200


def test_un_token_reutilizado_se_rechaza(client, db_session, fam):
    _invitar(client, fam)
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()
    token = _token_del_correo(cuenta)
    assert _restablecer(client, token, acepta_terminos=True).status_code == 204

    otra_vez = _restablecer(client, token, acepta_terminos=True)

    assert otra_vez.status_code in (400, 401), otra_vez.text


def test_un_token_vencido_se_rechaza_y_no_acepta_nada(client, db_session, fam):
    _invitar(client, fam)
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()
    vencido = GestorAutenticacion.crear_token_recuperacion(
        cuenta.correo, cuenta.version_contrasenia, expiracion_minutos=-1,
        proposito=PROPOSITO_INVITACION_CO_REPRESENTANTE,
    )

    respuesta = _restablecer(client, vencido, acepta_terminos=True)

    assert respuesta.status_code in (400, 401), respuesta.text
    db_session.expire_all()
    assert db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one().correo_verificado is False
    assert db_session.query(CoRepresentanteInvitacion).one().aceptada_en is None


def test_quitar_al_invitado_antes_de_aceptar_anula_el_enlace_ya_enviado(client, db_session, fam):
    _invitar(client, fam)
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()
    token = _token_del_correo(cuenta)

    assert client.delete(f"{BASE}/co-representantes/persona/{fam.menor.id}").status_code == 204

    assert _restablecer(client, token, acepta_terminos=True).status_code in (400, 401)
    db_session.expire_all()
    assert db_session.query(CoRepresentanteInvitacion).one().cancelada_en is not None
    assert [e[0] for e in _eventos(db_session, fam.menor.id)] == [
        "INVITACION", "ALTA", "INVITACION_CANCELADA", "BAJA",
    ]


def test_reinvitar_al_mismo_correo_reenvia_el_enlace_sin_duplicar_nada(client, db_session, fam):
    _invitar(client, fam)
    cuenta = db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).one()
    # Simula que el worker ya despachó el primer envío.
    db_session.query(RecuperacionOutbox).update({"status": "ENVIADO"})
    db_session.commit()

    otra = _invitar(client, fam)

    assert otra.status_code == 202 and otra.json() == NEUTRA
    assert db_session.query(Usuario).filter_by(correo=CORREO_NUEVO).count() == 1
    assert db_session.query(CoRepresentante).count() == 1
    assert db_session.query(RecuperacionOutbox).filter_by(usuario_id=cuenta.id, status="PENDIENTE").count() == 1


# --- Quién puede invitar / quitar -------------------------------------------
def _con_segundo_guardian(client, db_session, fam):
    """Invita a la cuenta existente y ella acepta con su propia sesión."""
    assert _invitar(client, fam, correo="existente@x.com").status_code == 202
    invitacion_id = db_session.query(CoRepresentanteInvitacion).order_by(CoRepresentanteInvitacion.id.desc()).first().id
    _como(fam.existente.id, ["REPRESENTANTE"], "existente@x.com")
    assert client.post(f"{BASE}/co-representantes/invitaciones/{invitacion_id}/aceptar").status_code == 204
    _como(fam.principal.id, ["REPRESENTANTE"], "madre@x.com")


def test_el_segundo_guardian_no_invita_ni_quita(client, db_session, fam):
    _con_segundo_guardian(client, db_session, fam)
    _como(fam.existente.id, ["REPRESENTANTE"], "existente@x.com")

    assert _invitar(client, fam, correo="ajeno@x.com").status_code == 403
    assert client.delete(f"{BASE}/co-representantes/persona/{fam.menor.id}").status_code == 403
    assert db_session.query(CoRepresentante).filter_by(persona_id=fam.menor.id).count() == 1


def test_un_adulto_ajeno_no_invita_ni_quita_ni_distingue_si_el_menor_existe(client, db_session, fam):
    _con_segundo_guardian(client, db_session, fam)
    _como(fam.ajeno.id, ["REPRESENTANTE"], "ajeno@x.com")

    assert _invitar(client, fam, correo="otro@x.com").status_code == 403
    assert client.delete(f"{BASE}/co-representantes/persona/{fam.menor.id}").status_code == 403
    assert client.delete(f"{BASE}/co-representantes/persona/999999").status_code == 403
    assert db_session.query(CoRepresentante).filter_by(persona_id=fam.menor.id).count() == 1


def test_el_administrador_agrega_y_quita_y_queda_auditado_como_admin(client, db_session, fam):
    _como(fam.admin.id, ["ADMINISTRADOR"])

    assert _invitar(client, fam, correo="existente@x.com").status_code == 202
    assert client.delete(f"{BASE}/co-representantes/persona/{fam.menor.id}").status_code == 204

    assert _eventos(db_session, fam.menor.id) == [
        ("ALTA", "ADMIN", fam.admin.id, fam.existente.id),
        ("BAJA", "ADMIN", fam.admin.id, fam.existente.id),
    ]
    assert client.delete(f"{BASE}/co-representantes/persona/999999").status_code == 404


def test_quitar_sin_segundo_guardian_es_404(client, fam):
    assert client.delete(f"{BASE}/co-representantes/persona/{fam.menor.id}").status_code == 404


def test_quitar_corta_el_acceso_del_segundo_guardian_en_la_siguiente_llamada(client, db_session, fam):
    _con_segundo_guardian(client, db_session, fam)
    _como(fam.existente.id, ["REPRESENTANTE"], "existente@x.com")
    assert client.get(f"{BASE}/personas/{fam.menor.id}").status_code == 200
    assert client.get(f"{BASE}/fichas-medicas/persona/{fam.menor.id}").status_code in (200, 404)

    _como(fam.principal.id, ["REPRESENTANTE"], "madre@x.com")
    assert client.delete(f"{BASE}/co-representantes/persona/{fam.menor.id}").status_code == 204

    _como(fam.existente.id, ["REPRESENTANTE"], "existente@x.com")
    for ruta in (
        f"/personas/{fam.menor.id}", f"/fichas-medicas/persona/{fam.menor.id}",
        f"/membresias/persona/{fam.menor.id}", f"/membresias/pagos/persona/{fam.menor.id}",
        f"/asistencias/persona/{fam.menor.id}", f"/portal/alumno/{fam.principal.id}",
    ):
        assert client.get(f"{BASE}{ruta}").status_code == 403, ruta
    assert client.get(f"{BASE}/co-representantes/mios").json() == []


def test_el_principal_y_el_segundo_pueden_ser_el_mismo_menor_solo_una_vez(client, db_session, fam):
    """Quitar y volver a invitar al mismo correo es válido: el ledger conserva
    ambas altas y la base una sola fila activa."""
    _con_segundo_guardian(client, db_session, fam)
    assert client.delete(f"{BASE}/co-representantes/persona/{fam.menor.id}").status_code == 204

    _con_segundo_guardian(client, db_session, fam)

    assert db_session.query(CoRepresentante).filter_by(persona_id=fam.menor.id).count() == 1
    assert [e[0] for e in _eventos(db_session, fam.menor.id)] == [
        "INVITACION", "ACEPTACION", "ALTA", "BAJA", "INVITACION", "ACEPTACION", "ALTA",
    ]


# --- Tablero del representante ----------------------------------------------
def test_el_tablero_muestra_el_segundo_guardian_solo_al_principal(client, db_session, fam):
    sin_segundo = client.get(f"{BASE}/co-representantes/mios").json()
    assert [(m["personaId"], m["rol"], m["completo"], m["segundoGuardian"]) for m in sin_segundo] == [
        (fam.menor2.id, "PRINCIPAL", False, None), (fam.menor.id, "PRINCIPAL", False, None),
    ]

    _con_segundo_guardian(client, db_session, fam)
    del_principal = {m["personaId"]: m for m in client.get(f"{BASE}/co-representantes/mios").json()}
    assert del_principal[fam.menor.id]["completo"] is True
    assert del_principal[fam.menor.id]["segundoGuardian"]["correo"] == "existente@x.com"
    assert del_principal[fam.menor.id]["segundoGuardian"]["estado"] == "ACTIVO"
    assert del_principal[fam.menor2.id]["segundoGuardian"] is None

    _como(fam.existente.id, ["REPRESENTANTE"], "existente@x.com")
    del_segundo = client.get(f"{BASE}/co-representantes/mios").json()
    assert [(m["personaId"], m["rol"], m["segundoGuardian"]) for m in del_segundo] == [
        (fam.menor.id, "SEGUNDO", None),
    ]

    _como(fam.ajeno.id, ["REPRESENTANTE"], "ajeno@x.com")
    assert client.get(f"{BASE}/co-representantes/mios").json() == []


def test_el_tablero_marca_pendiente_al_invitado_sin_aceptar(client, db_session, fam):
    _invitar(client, fam)

    segundo = client.get(f"{BASE}/co-representantes/mios").json()[1]["segundoGuardian"]

    assert segundo["estado"] == "PENDIENTE" and segundo["correo"] == CORREO_NUEVO


# --- Ficha médica y consentimientos: el segundo guardián solo ve -------------
def test_el_segundo_guardian_no_firma_consentimientos_del_menor(client, db_session, fam):
    _con_segundo_guardian(client, db_session, fam)
    _como(fam.existente.id, ["REPRESENTANTE"], "existente@x.com")

    respuesta = client.post(f"{BASE}/auth/consentimiento-legal/aceptar")

    assert respuesta.status_code == 200
    assert db_session.query(ConsentimientoLegal).filter_by(representado_persona_id=fam.menor.id).count() == 0


# --- Regresión: un menor con un solo guardián no cambia ----------------------
def test_un_menor_sin_segundo_guardian_se_comporta_como_siempre(client, db_session, fam):
    _como(fam.principal.id, ["REPRESENTANTE"], "madre@x.com")
    assert client.get(f"{BASE}/personas/{fam.menor.id}").status_code == 200
    assert client.get(f"{BASE}/portal/alumno/{fam.principal.id}").json()["representados"][0]["persona"]["id"] in (
        fam.menor.id, fam.menor2.id,
    )
    _como(fam.ajeno.id, ["REPRESENTANTE"], "ajeno@x.com")
    assert client.get(f"{BASE}/personas/{fam.menor.id}").status_code == 403
    assert client.get(f"{BASE}/fichas-medicas/persona/{fam.menor.id}").status_code == 403
