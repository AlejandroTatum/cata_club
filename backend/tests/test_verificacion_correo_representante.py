"""
Issue #790: la vinculación de un representado exige que la cuenta que la
ejerce haya probado el control de su dirección de correo.

Contexto de las dos mitades, cada una razonable por separado:

  * `POST /enrollment/` es público, sin autenticar, y entrega credenciales de
    inmediato (`enrollment_servicio.py`). Hasta este cambio, el backend no
    tenía NINGUNA noción de correo verificado.
  * `POST /personas/{id}/vincular-representado` deja adjuntar por cédula a un
    menor ya registrado sin que nadie apruebe. Esa regla es una decisión de
    producto escrita y sostenida (`personas_router.py`, INS-2), y este
    archivo NO la toca: sigue sin requerir aprobación de nadie.

Lo que se cierra es la COMPOSICIÓN: quien todavía no probó que la dirección
con la que se inscribió es suya no puede usar la vinculación para alcanzar
los datos de una persona que no creó. Nada más se restringe -- en
particular, un representante recién inscripto conserva acceso completo a
los datos del hijo que él mismo dio de alta, porque la inscripción presencial
en el club no puede quedar a la espera de un correo.

La regla se expresa sobre la CUENTA del representante, no sobre el rol: una
Persona sin cuenta (un tutor cargado por el club, sin login) no tiene ninguna
dirección que verificar y no gana ninguna credencial, así que no se le
bloquea nada.
"""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol, TipoSangre
from app.dominio.excepciones import PermisosInsuficientes
from app.dominio.mensajes import MENSAJE_CORREO_SIN_VERIFICAR
from app.dominio.modelos import FichaMedica, Persona, Rol, Usuario
from app.presentacion.schemas.persona_schemas import VincularRepresentadoDTO
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio import persona_servicio as persona_servicio_modulo
from app.servicios_negocio.persona_servicio import PersonaServicio
from tests.fabricas_auth import SleeperEspia, crear_usuario_auth


CORREO_INSCRIPTO = "representante.nuevo@example.com"
CONTRASENIA_INSCRIPTA = "password8"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _limpiar_contador_intentos():
    """El freno progresivo de vinculación vive en un dict a nivel de módulo;
    se limpia entre tests para que un intento no se filtre al siguiente."""
    persona_servicio_modulo._INTENTOS_FALLIDOS_VINCULACION.clear()
    yield
    persona_servicio_modulo._INTENTOS_FALLIDOS_VINCULACION.clear()


def _menor_de_otra_familia(db_session, semilla: int = 901) -> Persona:
    """Un menor que YA existe en el club, con su propio representante y su
    ficha médica. Es la persona cuyos datos no deben quedar al alcance de una
    cuenta recién creada."""
    tutor = Persona(
        nombres="Pedro", apellidos="Salas", cedula=cedula_valida(semilla),
        fecha_nacimiento=date(1985, 3, 2), telefono="0991110000",
    )
    db_session.add(tutor)
    db_session.flush()
    menor = Persona(
        nombres="Lucia", apellidos="Salas", cedula=cedula_valida(semilla + 1),
        fecha_nacimiento=date(2016, 4, 10), telefono="0991110001",
        representante_id=tutor.id,
    )
    db_session.add(menor)
    db_session.flush()
    db_session.add(FichaMedica(
        tipo_sangre=TipoSangre.O_POSITIVO, persona_id=menor.id,
        contacto_emergencia="Pedro Salas", telefono_emergencia="0991110000",
    ))
    db_session.commit()
    return menor


def _cuerpo_de_inscripcion(semilla: int = 950) -> dict:
    """Payload del alta pública de un menor con su representante."""
    return {
        "representante": {
            "nombres": "Sofia", "apellidos": "Martinez",
            "cedula": cedula_valida(semilla),
            "fecha_nacimiento": "1990-05-20", "telefono": "0991234567",
            "correo": CORREO_INSCRIPTO, "contrasenia": CONTRASENIA_INSCRIPTA,
        },
        "alumno": {
            "nombres": "Mateo", "apellidos": "Martinez",
            "cedula": cedula_valida(semilla + 1),
            "fecha_nacimiento": "2015-06-15", "telefono": "0991234568",
        },
        "ficha_medica": {
            "tipo_sangre": TipoSangre.O_POSITIVO.value, "enfermedades": [],
            "contacto_emergencia": "Sofia Martinez",
            "telefono_emergencia": "0991112233",
        },
        "acepta_consentimientos": True,
    }


def _autoinscribir(client_sin_token, semilla: int = 950) -> dict:
    """Ejerce el alta pública real y devuelve el cuerpo con los tokens."""
    respuesta = client_sin_token.post("/api/v1/enrollment/", json=_cuerpo_de_inscripcion(semilla))
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def _cabecera(tokens: dict) -> dict:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _verificar_correo(client_sin_token, correo: str):
    token = GestorAutenticacion.crear_token_verificacion_correo(correo)
    return client_sin_token.post("/api/v1/auth/verificar-correo", json={"token": token})


# ---------------------------------------------------------------------------
# El candado central
# ---------------------------------------------------------------------------

def test_una_cuenta_sin_verificar_no_alcanza_los_datos_de_otra_persona(
    client_sin_token, db_session
):
    """Caso negativo del issue #790: si este test se vuelve verde sin el
    candado, el eslabón se reabrió.

    Recorre el camino completo con tokens REALES emitidos por el alta
    pública -- no un override de dependencia -- porque lo que se mide es
    justamente qué puede hacer quien acaba de autoinscribirse."""
    ajena = _menor_de_otra_familia(db_session)
    tokens = _autoinscribir(client_sin_token)

    vinculacion = client_sin_token.post(
        f"/api/v1/personas/{tokens['persona_id']}/vincular-representado",
        json={"cedula": ajena.cedula}, headers=_cabecera(tokens),
    )

    assert vinculacion.status_code == 403
    db_session.expire_all()
    assert db_session.get(Persona, ajena.id).representante_id != tokens["persona_id"]

    # Y la consecuencia que importa: sus datos siguen fuera de alcance.
    for ruta in (
        f"/api/v1/personas/{ajena.id}",
        f"/api/v1/fichas-medicas/persona/{ajena.id}",
        f"/api/v1/asistencias/persona/{ajena.id}",
    ):
        assert client_sin_token.get(ruta, headers=_cabecera(tokens)).status_code == 403, ruta


def test_la_cuenta_sin_verificar_conserva_acceso_a_su_propio_representado(
    client_sin_token, db_session
):
    """El candado no puede dejar varada a una familia real: el hijo que la
    propia inscripción dio de alta sigue siendo accesible mientras el correo
    esté sin verificar."""
    tokens = _autoinscribir(client_sin_token)
    hijo = db_session.query(Persona).filter(
        Persona.cedula == cedula_valida(951)
    ).one()

    respuesta = client_sin_token.get(
        f"/api/v1/personas/{hijo.id}", headers=_cabecera(tokens)
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["id"] == hijo.id


def test_verificar_el_correo_habilita_la_vinculacion(client_sin_token, db_session):
    """La otra mitad del candado: una vez probado el control de la dirección,
    la vinculación vuelve a ser exactamente la que decidió el dueño."""
    ajena = _menor_de_otra_familia(db_session)
    tokens = _autoinscribir(client_sin_token)

    assert _verificar_correo(client_sin_token, CORREO_INSCRIPTO).status_code == 204

    vinculacion = client_sin_token.post(
        f"/api/v1/personas/{tokens['persona_id']}/vincular-representado",
        json={"cedula": ajena.cedula}, headers=_cabecera(tokens),
    )

    assert vinculacion.status_code == 200
    db_session.expire_all()
    assert db_session.get(Persona, ajena.id).representante_id == tokens["persona_id"]


def test_la_verificacion_marca_la_cuenta_y_es_idempotente(client_sin_token, db_session):
    """Reabrir el enlace no es un error: el segundo clic deja la cuenta en el
    mismo estado y responde igual, sin convertirse en un oráculo de si la
    verificación ya había ocurrido."""
    _autoinscribir(client_sin_token)

    primera = _verificar_correo(client_sin_token, CORREO_INSCRIPTO)
    segunda = _verificar_correo(client_sin_token, CORREO_INSCRIPTO)

    assert (primera.status_code, segunda.status_code) == (204, 204)
    db_session.expire_all()
    cuenta = db_session.query(Usuario).filter(Usuario.correo == CORREO_INSCRIPTO).one()
    assert cuenta.correo_verificado is True


# ---------------------------------------------------------------------------
# Separación de tipos de token
# ---------------------------------------------------------------------------

def test_un_token_de_verificacion_no_autentica_como_token_de_acceso(
    client_sin_token, db_session
):
    """Misma disciplina que el token de recuperación (`gestor_auth.py`): todos
    los tokens van firmados con la misma clave, así que el claim `type` es lo
    único que impide que un enlace que viaja por correo sirva de credencial."""
    cuenta = crear_usuario_auth(db_session, correo="ana@cataclub.test")
    token = GestorAutenticacion.crear_token_verificacion_correo(cuenta.correo)

    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"}
    )

    assert respuesta.status_code == 401


def test_un_token_de_acceso_no_sirve_para_verificar_el_correo(client_sin_token, db_session):
    """El otro lado del par: un access token robado no debe poder marcar
    verificada una dirección que su portador nunca leyó."""
    cuenta = crear_usuario_auth(db_session, correo="ana@cataclub.test")
    access = GestorAutenticacion.crear_token_acceso(
        {"sub": cuenta.correo, "persona_id": cuenta.persona_id, "roles": []},
        version_sesion=cuenta.version_sesion,
    )

    respuesta = client_sin_token.post("/api/v1/auth/verificar-correo", json={"token": access})

    assert respuesta.status_code == 401
    db_session.expire_all()
    assert db_session.get(Usuario, cuenta.id).correo_verificado is False


# ---------------------------------------------------------------------------
# Cuentas que ya existían y cuentas que no existen
# ---------------------------------------------------------------------------

def test_una_cuenta_ya_verificada_vincula_sin_ningun_paso_extra(db_session):
    """Las cuentas anteriores al control quedan verificadas por la migración
    (ver `test_migracion_correo_verificado.py`). Acá se fija la consecuencia a
    nivel de servicio: no cambian de comportamiento en nada."""
    ajena = _menor_de_otra_familia(db_session)
    cuenta = crear_usuario_auth(db_session, correo="tutor.antiguo@cataclub.test",
                                cedula=cedula_valida(960))
    cuenta.correo_verificado = True
    cuenta.roles.append(Rol(tipo_rol=TipoRol.REPRESENTANTE, descripcion="Representante"))
    db_session.commit()

    resultado = PersonaServicio(db_session, dormir=SleeperEspia()).vincular_representado(
        cuenta.persona_id, VincularRepresentadoDTO(cedula=ajena.cedula)
    )

    assert resultado.representante_id == cuenta.persona_id


def test_una_persona_sin_cuenta_no_queda_bloqueada(db_session):
    """Un tutor cargado por el club, sin login, no tiene dirección que
    verificar y no gana ninguna credencial: exigirle una verificación
    imposible le impediría al administrador hacer su trabajo."""
    ajena = _menor_de_otra_familia(db_session)
    tutor_sin_cuenta = Persona(
        nombres="Marcela", apellidos="Vega", cedula=cedula_valida(970),
        fecha_nacimiento=date(1988, 7, 1), telefono="0991230000",
    )
    db_session.add(tutor_sin_cuenta)
    db_session.commit()

    resultado = PersonaServicio(db_session, dormir=SleeperEspia()).vincular_representado(
        tutor_sin_cuenta.id, VincularRepresentadoDTO(cedula=ajena.cedula)
    )

    assert resultado.representante_id == tutor_sin_cuenta.id


def test_una_cuenta_creada_por_un_administrador_nace_verificada(client, db_session):
    """Las dos vías que crean cuentas exigen ya una sesión de ADMINISTRADOR
    (`POST /personas/admin/cuentas` y `POST /auth/registro`), así que no son el
    eslabón que este issue cierra: no hay forma de llegar a ellas sin que el
    club ya te haya dado credenciales.

    Nacen verificadas porque la alternativa no protege nada y sí rompe el
    mostrador: el administrador que da de alta a un padre parado frente a él
    quedaría sin poder vincularle a su hijo, esperando un correo. Que el club
    identifique a alguien en persona es una comprobación más fuerte que una
    ida y vuelta por correo, no una más débil."""
    respuesta = client.post("/api/v1/personas/admin/cuentas", json={
        "tipo_cuenta": "REPRESENTANTE",
        "nombres": "Marcela", "apellidos": "Vega", "cedula": cedula_valida(991),
        "fecha_nacimiento": "1988-07-01", "telefono": "0991230000",
        "correo": "marcela.mostrador@example.com", "contrasenia": "password8",
    })

    assert respuesta.status_code == 201, respuesta.text
    cuenta = db_session.query(Usuario).filter(
        Usuario.correo == "marcela.mostrador@example.com"
    ).one()
    assert cuenta.correo_verificado is True


def test_el_rechazo_dice_que_hacer_y_no_gasta_el_freno_de_intentos(db_session):
    """El freno progresivo existe para castigar a quien prueba cédulas en
    serie. Un correo sin verificar no es un intento fallido de adivinanza:
    ni penaliza ni deja rastro en el contador, y el mensaje es accionable
    (habla de la propia cuenta del solicitante, no de la persona buscada)."""
    ajena = _menor_de_otra_familia(db_session)
    cuenta = crear_usuario_auth(db_session, correo="sin.verificar@cataclub.test",
                                cedula=cedula_valida(980))
    dormilon = SleeperEspia()

    with pytest.raises(PermisosInsuficientes) as excepcion:
        PersonaServicio(db_session, dormir=dormilon).vincular_representado(
            cuenta.persona_id, VincularRepresentadoDTO(cedula=ajena.cedula)
        )

    assert str(excepcion.value) == MENSAJE_CORREO_SIN_VERIFICAR
    assert dormilon.llamadas == []
    assert persona_servicio_modulo._INTENTOS_FALLIDOS_VINCULACION == {}


def test_el_403_viaja_marcado_como_seguro_de_mostrar(client_sin_token, db_session):
    """Escribir un mensaje accionable no sirve si el frontend lo tira.

    El traductor del frontend (`lib/error-message.ts`) responde con su texto
    enlatado --"No tiene permisos para realizar esta acción."-- ante CUALQUIER
    403, y con razón: un mensaje de autorización suele nombrar qué existe y
    quién puede tocarlo. La única llave que abre esa puerta es la misma que
    ya abre la de los 5xx (issue #355): `seguro_mostrar`, que este raise site
    tiene que declarar explícitamente.

    Se mide sobre la RESPUESTA HTTP y no sobre la excepción: `mensaje_seguro`
    lo agrega el manejador global de `main.py`, así que un `seguro_mostrar`
    que no llegue al cuerpo deja el mensaje igual de invisible que antes.
    """
    ajena = _menor_de_otra_familia(db_session)
    tokens = _autoinscribir(client_sin_token)

    respuesta = client_sin_token.post(
        f"/api/v1/personas/{tokens['persona_id']}/vincular-representado",
        json={"cedula": ajena.cedula}, headers=_cabecera(tokens),
    )

    assert respuesta.status_code == 403
    cuerpo = respuesta.json()
    assert cuerpo["detail"] == MENSAJE_CORREO_SIN_VERIFICAR
    assert cuerpo["mensaje_seguro"] is True


def test_el_403_de_la_regla_de_elegibilidad_sigue_sin_marcar(client_sin_token, db_session):
    """Caso negativo del test de arriba: la llave es de ESTE mensaje, no del
    código 403. Cualquier otro rechazo de autorización tiene que seguir
    llegando sin marca, para que el frontend lo reemplace por su enlatado.

    Si este test se vuelve rojo, el 403 dejó de ser fail-closed y se
    convirtió en un oráculo general."""
    tokens = _autoinscribir(client_sin_token)
    ajena = _menor_de_otra_familia(db_session)

    # Una cuenta ajena: el chequeo de propiedad del router rechaza antes de
    # llegar siquiera a la regla de correo verificado.
    respuesta = client_sin_token.get(
        f"/api/v1/personas/{ajena.id}", headers=_cabecera(tokens),
    )

    assert respuesta.status_code == 403
    assert respuesta.json()["mensaje_seguro"] is False
