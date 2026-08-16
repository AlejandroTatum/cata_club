"""
Registro observacional de sesiones (PR 1/3 de la cadena de historial).

Nace de un hueco de UI: `/profile` deja ~500px vacíos en cuentas de staff y no
queda un solo campo de `GET /auth/me` sin mostrar, así que el dueño eligió
traer un dato que hoy no existe en vez de rellenar con adornos.

## La línea que esta tabla NO cruza

`Usuario.version_sesion` -- el epoch que viaja en el claim `sver` y que
`GestorAutenticacion.epoch_valido` compara -- sigue siendo EL mecanismo de
invalidación. Esta tabla es observacional: registra qué sesión se abrió, con
qué dispositivo y bajo qué epoch, y nunca decide si un token vale. Si decidiera,
habríamos reescrito un control de seguridad para tapar un hueco visual.

De ahí que cada fila lleve el `version_sesion` vigente al abrirse: una fila
cuyo epoch quedó por debajo del epoch del usuario está muerta, y eso se DERIVA
del mecanismo autoritativo en vez de duplicarlo.

## Sin IP, y sin `ultimo_uso_en`

No se guarda la IP: es dato personal, este club maneja cuentas de menores y sus
representantes, y nadie la va a leer. Lo que se guarda es una etiqueta de
dispositivo derivada del user-agent.

Tampoco hay `ultimo_uso_en` todavía. Actualizarlo exigiría que el refresh sepa
QUÉ fila le corresponde, y hoy el token no lleva identificador de sesión.
Una columna que nunca se actualiza es una mentira con forma de dato, así que
no se crea hasta que se pueda sostener.
"""
from datetime import date

import pytest

from app.dominio.excepciones import CredencialesInvalidas
from app.dominio.modelos import Persona, Sesion, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio
from app.soporte_transversal.dispositivo import describir_dispositivo


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


def _sesiones_de(db_session, usuario_id):
    return db_session.query(Sesion).filter(Sesion.usuario_id == usuario_id).all()


# ---------------------------------------------------------------------------
# La etiqueta de dispositivo
# ---------------------------------------------------------------------------

class TestDescribirDispositivo:
    def test_nombra_sistema_y_navegador_cuando_el_user_agent_los_declara(self):
        ua = (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        )
        assert describir_dispositivo(ua) == "Linux · Chrome"

    def test_reconoce_los_moviles_por_su_propio_nombre(self):
        android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile"
        iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"

        # Android declara "Linux" en el mismo string: gana el nombre más
        # específico, o todo teléfono Android se leería como una laptop.
        assert describir_dispositivo(android) == "Android · Chrome"
        assert describir_dispositivo(iphone) == "iPhone · Safari"

    def test_no_confunde_chrome_con_safari_ni_con_edge(self):
        # Todo navegador basado en Chromium miente en su user-agent diciendo
        # "Safari"; Edge además dice "Chrome". Se leen del más específico al
        # más genérico o Edge termina reportado como Safari.
        edge = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 Edg/126"
        safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15"

        assert describir_dispositivo(edge) == "Windows · Edge"
        assert describir_dispositivo(safari) == "macOS · Safari"

    def test_dice_que_no_sabe_en_vez_de_inventar(self):
        assert describir_dispositivo(None) == "Dispositivo desconocido"
        assert describir_dispositivo("") == "Dispositivo desconocido"
        assert describir_dispositivo("curl/8.7.1") == "Dispositivo desconocido"

    def test_recorta_un_user_agent_absurdo_al_ancho_de_la_columna(self):
        # `dispositivo` es String(80): un user-agent hostil no debe reventar el
        # INSERT ni truncarse en la base sin que nadie lo decida acá.
        assert len(describir_dispositivo("Mozilla/5.0 (" + "X" * 500 + ")")) <= 80


# ---------------------------------------------------------------------------
# El alta de la fila
# ---------------------------------------------------------------------------

class TestRegistroEnLogin:
    def test_un_login_exitoso_abre_exactamente_una_sesion(self, db_session):
        usuario = _crear_usuario(db_session)

        AuthServicio(db_session).login(
            "ana@cataclub.test", "clave12345",
            user_agent="Mozilla/5.0 (X11; Linux x86_64) Chrome/126.0.0.0 Safari/537.36",
        )

        sesiones = _sesiones_de(db_session, usuario.id)
        assert len(sesiones) == 1
        assert sesiones[0].dispositivo == "Linux · Chrome"

    def test_la_fila_queda_atada_al_epoch_vigente_al_abrirse(self, db_session):
        """La fila NO decide validez: la deriva. Guardar el epoch de apertura
        es lo que después permite leer una fila como muerta sin que la tabla
        se vuelva autoritativa."""
        usuario = _crear_usuario(db_session)
        usuario.revocar_sesiones()
        usuario.revocar_sesiones()
        db_session.commit()
        epoch_actual = usuario.version_sesion

        AuthServicio(db_session).login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")

        assert _sesiones_de(db_session, usuario.id)[0].version_sesion == epoch_actual

    def test_dos_logins_son_dos_sesiones_y_no_una_sobrescrita(self, db_session):
        usuario = _crear_usuario(db_session)
        servicio = AuthServicio(db_session)

        servicio.login("ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (iPhone) Safari/604.1")
        servicio.login("ana@cataclub.test", "clave12345", user_agent="Mozilla/5.0 (Windows NT 10.0) Chrome/126")

        dispositivos = {s.dispositivo for s in _sesiones_de(db_session, usuario.id)}
        assert dispositivos == {"iPhone · Safari", "Windows · Chrome"}

    def test_un_login_fallido_no_abre_ninguna_sesion(self, db_session):
        usuario = _crear_usuario(db_session)

        with pytest.raises(CredencialesInvalidas):
            AuthServicio(db_session).login("ana@cataclub.test", "incorrecta", user_agent="curl/8.7.1")

        assert _sesiones_de(db_session, usuario.id) == []

    def test_una_cuenta_suspendida_tampoco_abre_sesion(self, db_session):
        """El login de una cuenta inactiva falla DESPUÉS de verificar la
        contraseña, así que es el caso donde un registro mal ubicado dejaría
        una fila de una sesión que nunca existió."""
        usuario = _crear_usuario(db_session)
        usuario.activo = False
        db_session.commit()

        with pytest.raises(CredencialesInvalidas):
            AuthServicio(db_session).login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")

        assert _sesiones_de(db_session, usuario.id) == []

    def test_sin_user_agent_la_sesion_se_abre_igual(self, db_session):
        """Un cliente que no manda user-agent sigue siendo una sesión real. La
        etiqueta dice que no se sabe; la fila existe."""
        usuario = _crear_usuario(db_session)

        AuthServicio(db_session).login("ana@cataclub.test", "clave12345")

        sesiones = _sesiones_de(db_session, usuario.id)
        assert len(sesiones) == 1
        assert sesiones[0].dispositivo == "Dispositivo desconocido"

    def test_revocar_no_borra_filas_porque_la_tabla_solo_observa(self, db_session):
        """`revocar_sesiones` bombea el epoch y con eso invalida los tokens.
        No toca esta tabla: si el borrado de filas fuera parte de la
        revocación, la tabla habría pasado a ser parte del mecanismo."""
        usuario = _crear_usuario(db_session)
        AuthServicio(db_session).login("ana@cataclub.test", "clave12345", user_agent="curl/8.7.1")
        epoch_de_apertura = _sesiones_de(db_session, usuario.id)[0].version_sesion

        usuario.revocar_sesiones()
        db_session.commit()

        sesiones = _sesiones_de(db_session, usuario.id)
        assert len(sesiones) == 1
        # Dos asserts y no una comparación encadenada (`a == b < c`): Python la
        # evalúa como `(a == b) and (b < c)`, que es correcto pero se lee como
        # otra cosa, y cuando falla no dice cuál de las dos mitades fue.
        assert sesiones[0].version_sesion == epoch_de_apertura
        assert epoch_de_apertura < usuario.version_sesion
