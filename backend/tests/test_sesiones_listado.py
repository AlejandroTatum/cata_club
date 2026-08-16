"""
Listado de sesiones propias (PR 2/3 de la cadena de historial).

`GET /auth/me/sesiones` devuelve las sesiones del usuario AUTENTICADO --
resueltas por el `sub` del token, nunca por un id de path-- para que
`/profile` pueda mostrarlas.

## Vigente se DERIVA, no se guarda

Una sesión está viva si su `version_sesion` coincide con el del usuario. Esa
comparación es una lectura del mecanismo autoritativo (el epoch del claim
`sver`), no una segunda fuente de verdad: la tabla sigue sin decidir nada. Por
eso `revocar_sesiones()` tampoco escribe acá en este PR -- no hace falta, la
verdad ya está en el epoch.

## `sid`: cuál de todas soy yo

Con tres equipos logueados bajo el mismo epoch hay tres filas vivas y ninguna
forma de saber cuál corresponde al que está mirando la pantalla. Por eso el
token lleva ahora un claim `sid` con el id de la fila que lo emitió. Es
ADITIVO y observacional: nada lo valida, nada autoriza con él, y un token sin
`sid` (los emitidos antes de este cambio) simplemente no marca ninguna sesión
como actual en vez de romper.

## Cerrar las otras sesiones abre una nueva

`invalidar_otras_sesiones` bombea el epoch y le reemite tokens al caller: por
definición eso es una sesión nueva para este equipo. Sin registrarla, el
usuario quedaría mirando una lista vacía inmediatamente después de usar el
botón, mientras sigue perfectamente logueado.
"""
from datetime import date

import pytest

import jwt

from app.dominio.modelos import Persona, Sesion, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio, LIMITE_SESIONES_LISTADAS
from app.soporte_transversal.configuracion import settings


def _crear_usuario(db_session, correo="ana@cataclub.test", cedula="1710034065", contrasenia="clave12345"):
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo=correo,
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia(contrasenia),
        persona_id=persona.id,
    )
    db_session.add(usuario)
    db_session.commit()
    return usuario


def _claims(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])


def _sid_del_token(par_de_tokens: dict) -> int | None:
    return _claims(par_de_tokens["access_token"]).get("sid")


class TestListado:
    def test_devuelve_las_sesiones_del_usuario_mas_reciente_primero(self, db_session):
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        servicio.login("ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (iPhone) Safari/604.1")
        servicio.login("ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/126")

        sesiones = servicio.listar_sesiones(usuario.correo, sesion_actual_id=None)

        assert [s.dispositivo for s in sesiones] == ["Windows · Chrome", "iPhone · Safari"]

    def test_no_devuelve_las_sesiones_de_otra_cuenta(self, db_session):
        ana = _crear_usuario(db_session)
        _crear_usuario(db_session, correo="beto@cataclub.test", cedula="0705806355")
        servicio = AuthServicio(db_session)
        servicio.login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")
        servicio.login("beto@cataclub.test", "clave12345", user_agent="curl/8.7.1")

        sesiones = servicio.listar_sesiones(ana.correo, sesion_actual_id=None)

        assert len(sesiones) == 1
        assert all(s.usuario_id == ana.id for s in sesiones)

    def test_marca_como_no_vigente_lo_que_quedo_bajo_un_epoch_viejo(self, db_session):
        """La verdad vive en el epoch. La fila no se toca, no se borra y no se
        actualiza: se LEE contra `usuario.version_sesion`."""
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        servicio.login("ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (iPhone) Safari/604.1")

        usuario.revocar_sesiones()
        db_session.commit()

        vieja = servicio.listar_sesiones(usuario.correo, sesion_actual_id=None)[-1]
        assert vieja.dispositivo == "iPhone · Safari"
        assert vieja.vigente is False

    def test_marca_como_vigente_lo_abierto_bajo_el_epoch_actual(self, db_session):
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        servicio.login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")

        assert servicio.listar_sesiones(usuario.correo, sesion_actual_id=None)[0].vigente is True

    def test_marca_actual_solo_la_del_sid_recibido(self, db_session):
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        servicio.login("ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (iPhone) Safari/604.1")
        segundo = servicio.login(
            "ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/126",
        )

        sesiones = servicio.listar_sesiones(usuario.correo, sesion_actual_id=_sid_del_token(segundo))

        actuales = [s for s in sesiones if s.actual]
        assert len(actuales) == 1
        assert actuales[0].dispositivo == "Windows · Chrome"

    def test_un_token_sin_sid_no_marca_ninguna_como_actual(self, db_session):
        """Los tokens emitidos antes de este cambio no llevan `sid`. Eso tiene
        que degradar a "no sé cuál sos", nunca a marcar la primera de la lista
        ni a romper."""
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        servicio.login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")

        sesiones = servicio.listar_sesiones(usuario.correo, sesion_actual_id=None)

        assert all(s.actual is False for s in sesiones)

    def test_corta_el_historial_en_las_mas_recientes(self, db_session):
        """Cada login agrega una fila para siempre. La tarjeta de perfil
        muestra las últimas, no una bitácora de auditoría."""
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        for _ in range(LIMITE_SESIONES_LISTADAS + 5):
            servicio.login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")

        assert len(servicio.listar_sesiones(usuario.correo, sesion_actual_id=None)) == LIMITE_SESIONES_LISTADAS
        # El corte es de LECTURA: nada se borra de la tabla.
        assert db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).count() == (
            LIMITE_SESIONES_LISTADAS + 5
        )


class TestElTokenLlevaSuSesion:
    def test_el_login_emite_un_token_atado_a_la_fila_que_abrio(self, db_session):
        usuario = _crear_usuario(db_session)

        par = AuthServicio(db_session).login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")

        fila = db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).one()
        assert _sid_del_token(par) == fila.id

    def test_el_refresh_conserva_la_sesion_en_vez_de_perderla(self, db_session):
        """Refrescar no abre una sesión nueva ni deja al token huérfano: es el
        mismo equipo continuando la misma sesión."""
        _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        par = servicio.login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")
        sid_original = _sid_del_token(par)

        refrescado = servicio.refrescar_sesion(par["refresh_token"])

        assert _claims(refrescado["access_token"]).get("sid") == sid_original


class TestCerrarLasOtrasSesiones:
    def test_abre_una_sesion_nueva_para_el_caller(self, db_session):
        """El caller sigue logueado con el par reemitido, así que tiene que
        tener una fila viva. Sin esto, tocar el botón dejaría al usuario
        mirando una lista vacía mientras usa la aplicación."""
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        servicio.login("ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (iPhone) Safari/604.1")

        servicio.invalidar_otras_sesiones(
            usuario.correo, user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/126",
        )

        vivas = [s for s in servicio.listar_sesiones(usuario.correo, sesion_actual_id=None) if s.vigente]
        assert len(vivas) == 1
        assert vivas[0].dispositivo == "Windows · Chrome"

    def test_la_sesion_previa_queda_listada_pero_muerta(self, db_session):
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        servicio.login("ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (iPhone) Safari/604.1")

        servicio.invalidar_otras_sesiones(usuario.correo, user_agent="curl/8.7.1")

        muertas = [s for s in servicio.listar_sesiones(usuario.correo, sesion_actual_id=None) if not s.vigente]
        assert [s.dispositivo for s in muertas] == ["iPhone · Safari"]

    def test_el_logout_no_abre_ninguna_sesion(self, db_session):
        """Cerrar sesión no reemite tokens, así que no hay sesión nueva que
        registrar -- a diferencia de `invalidar_otras_sesiones`."""
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)
        servicio.login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")

        servicio.cerrar_sesion(usuario.correo)

        assert db_session.query(Sesion).filter(Sesion.usuario_id == usuario.id).count() == 1
        assert all(
            not s.vigente for s in servicio.listar_sesiones(usuario.correo, sesion_actual_id=None)
        )

@pytest.fixture()
def cliente_como(db_session):
    """Cliente cuyo token apunta al usuario de ESTE test.

    La fixture `client` del conftest fija `sub` en admin@cataclub.test y nunca
    lleva `sid`, y esta respuesta depende de los dos. Se pasa `claims=None`
    para dejar correr la dependencia real y comprobar el 401.
    """
    from fastapi.testclient import TestClient

    from app.infraestructura.db import obtener_sesion
    from main import app

    def _construir(claims: dict | None) -> TestClient:
        def _override_sesion():
            yield db_session

        app.dependency_overrides[obtener_sesion] = _override_sesion
        if claims is not None:
            app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: claims
        return TestClient(app)

    yield _construir
    app.dependency_overrides.clear()


class TestEndpoint:
    def test_devuelve_las_sesiones_del_caller(self, cliente_como, db_session):
        usuario = _crear_usuario(db_session)
        par = AuthServicio(db_session).login(
            "ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (iPhone) Safari/604.1",
        )
        cliente = cliente_como({"sub": usuario.correo, "sid": _sid_del_token(par)})

        respuesta = cliente.get("/api/v1/auth/me/sesiones")

        assert respuesta.status_code == 200
        cuerpo = respuesta.json()
        assert len(cuerpo) == 1
        assert cuerpo[0]["dispositivo"] == "iPhone · Safari"
        assert cuerpo[0]["vigente"] is True
        assert cuerpo[0]["actual"] is True

    def test_exige_autenticacion(self, cliente_como):
        assert cliente_como(None).get("/api/v1/auth/me/sesiones").status_code == 401

    def test_nunca_expone_el_user_agent_crudo_ni_una_ip(self, cliente_como, db_session):
        """El contrato de privacidad es parte de la respuesta, no solo del
        esquema: lo que sale es una etiqueta, y ningún campo más."""
        usuario = _crear_usuario(db_session)
        AuthServicio(db_session).login(
            "ana@cataclub.test", "clave12345",
            user_agent="Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0.0.0 Safari/537.36",
        )
        cliente = cliente_como({"sub": usuario.correo})

        cuerpo = cliente.get("/api/v1/auth/me/sesiones").json()

        assert set(cuerpo[0]) == {"id", "dispositivo", "iniciadaEn", "vigente", "actual"}
        assert "Mozilla" not in cuerpo[0]["dispositivo"]
