"""
Issue #1043: bcrypt solo hashea los primeros 72 BYTES de la contraseña.
`validar_contrasenia` (issue #1017, ADR-5) ahora rechaza en la puerta lo que
supera ese tope -- ver `backend/app/dominio/contrasenia.py`. Estas pruebas
cubren el escenario de punta a punta que documenta el issue: la API pública
(no solo el DTO) y el caso multibyte, donde el corte real de bcrypt llega
mucho antes del largo visible en pantalla.

`test_contrasenia_validada.py` ya prueba, DTO por DTO, que los 7 campos
reales aplican la misma regla que `test_contrasenia.py` fija a nivel unidad.
Acá se agrega el round-trip HTTP: crear la cuenta y comprobar que el prefijo
truncado (lo único que bcrypt vería si la contraseña se hubiese aceptado)
tampoco abre ninguna cuenta, porque la cuenta nunca llegó a crearse.
"""
from app.dominio.cedula import cedula_valida
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_auth import crear_usuario_auth

_FICHA = {
    "tipo_sangre": "O_POSITIVO",
    "enfermedades": [],
    "contacto_emergencia": "María Torres",
    "telefono_emergencia": "0991112233",
}


def _cuerpo_alta_self(cedula: str, correo: str, contrasenia: str) -> dict:
    """Cuerpo mínimo de `POST /api/v1/enrollment/` para un alumno adulto que
    se inscribe sin representante (mismo patrón que
    `test_enrollment_idempotencia.py::_cuerpo`)."""
    return {
        "alumno": {
            "nombres": "Ana", "apellidos": "Torres", "cedula": cedula,
            "fecha_nacimiento": "1990-05-20", "telefono": "0991234567",
        },
        "credenciales_alumno": {"correo": correo, "contrasenia": contrasenia},
        "ficha_medica": dict(_FICHA),
        "acepta_consentimientos": True,
    }


def test_alta_publica_rechaza_contrasenia_ascii_que_supera_72_bytes(client, db_session):
    # Evidencia ASCII del issue: 89 caracteres, todos de 1 byte -> 89 bytes.
    contrasenia_larga = "x" * 89
    correo = "ascii-89@example.com"

    alta = client.post(
        "/api/v1/enrollment/",
        json=_cuerpo_alta_self(cedula_valida(9401), correo, contrasenia_larga),
    )
    assert alta.status_code == 422
    assert "72 bytes" in alta.json()["detail"]
    assert "72 caracteres" not in alta.json()["detail"]

    # La cuenta nunca se creó: ni la contraseña completa ni su prefijo
    # truncado a 72 bytes abren nada.
    login_con_prefijo = client.post(
        "/api/v1/auth/login",
        data={"username": correo, "password": contrasenia_larga[:72]},
    )
    assert login_con_prefijo.status_code == 401


def test_alta_publica_rechaza_contrasenia_con_emoji_que_supera_72_bytes(client, db_session):
    # Evidencia UTF-8 del issue: 30 emoji = 120 bytes; bcrypt solo vería los
    # primeros 18 (72 bytes) si esto se aceptara.
    contrasenia_30_emoji = "😀" * 30
    contrasenia_18_emoji = "😀" * 18
    assert len(contrasenia_30_emoji.encode("utf-8")) == 120
    assert len(contrasenia_18_emoji.encode("utf-8")) == 72
    correo = "emoji-30@example.com"

    alta = client.post(
        "/api/v1/enrollment/",
        json=_cuerpo_alta_self(cedula_valida(9402), correo, contrasenia_30_emoji),
    )
    assert alta.status_code == 422
    assert "72 bytes" in alta.json()["detail"]

    # Ni los 30 emoji completos ni el prefijo de 18 (lo que bcrypt hubiera
    # visto) abren una cuenta que nunca se creó.
    login_con_prefijo = client.post(
        "/api/v1/auth/login",
        data={"username": correo, "password": contrasenia_18_emoji},
    )
    assert login_con_prefijo.status_code == 401


def test_cuenta_previa_con_contrasenia_larga_sigue_pudiendo_loguearse(db_session, client):
    """El tope es de ESCRITURA, no de verificación (criterio de aceptación
    del issue: no dejar a nadie afuera de su propia cuenta). Una fila creada
    ANTES de este cambio -- `crear_usuario_auth` hashea directo por ORM,
    bypaseando `validar_contrasenia`, igual que la regresión análoga en
    `test_contrasenia_validada.py` para la lista negra -- con una
    contraseña de más de 72 bytes sigue entrando con esa MISMA contraseña
    completa: `POST /auth/login` nunca pasa por `validar_contrasenia`, solo
    compara contra el hash ya guardado."""
    contrasenia_previa = "x" * 89
    assert len(contrasenia_previa.encode("utf-8")) > 72
    usuario = crear_usuario_auth(
        db_session, correo="previa-larga@cataclub.test", contrasenia=contrasenia_previa,
    )
    assert GestorAutenticacion.verificar_contrasenia(contrasenia_previa, usuario.contrasenia)

    respuesta = client.post(
        "/api/v1/auth/login",
        data={"username": "previa-larga@cataclub.test", "password": contrasenia_previa},
    )

    assert respuesta.status_code == 200
