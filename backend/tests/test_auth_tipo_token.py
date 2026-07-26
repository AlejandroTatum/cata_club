"""
Confusión de tipo de token (E01-RF002/RF003).

`GestorAutenticacion.crear_token_acceso` estampa `type=access`, y tanto el
refresh token como el token de recuperación llevan su propio `type`. El
endpoint `/auth/refresh` ya verifica que lo que recibe sea `type=refresh`,
pero la dependencia de autenticación general (`decodificar_token`) no
verificaba nada: aceptaba CUALQUIER JWT firmado con la clave del sistema.

Consecuencia: un refresh token (vida de 7 días) o un token de recuperación
de contraseña (que viaja por correo) servían como bearer de autenticación
para todo endpoint que solo exige "estar autenticado", contradiciendo lo que
el propio docstring de `crear_token_refresco` promete.
"""
from datetime import date, datetime, timedelta, timezone

import jwt
import pytest

from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.soporte_transversal.configuracion import settings


@pytest.fixture()
def usuario_real(db_session):
    """Persona + Usuario reales, para que `/auth/me` pueda resolver el `sub`."""
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula="1710034065",
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    db_session.add(Usuario(
        correo="ana@cataclub.test", contrasenia="hash", persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")],
    ))
    db_session.commit()
    return persona


def test_refresh_token_no_autentica_endpoints_de_negocio(client_sin_token, usuario_real):
    """Un refresh token solo sirve para pedir un access token en /auth/refresh."""
    refresh = GestorAutenticacion.crear_token_refresco(
        {"sub": "ana@cataclub.test", "persona_id": usuario_real.id}, version_sesion=1
    )
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {refresh}"}
    )
    assert respuesta.status_code == 401


def test_token_de_recuperacion_no_autentica_endpoints_de_negocio(client_sin_token, usuario_real):
    """Un enlace de recuperación interceptado no debe valer como sesión.

    Es el caso más grave de los dos: el token viaja por correo y su uso como
    bearer no incrementa `version_contrasenia`, así que la víctima nunca ve
    señal de que su cuenta fue leída.
    """
    recuperacion = GestorAutenticacion.crear_token_recuperacion("ana@cataclub.test", 0)
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {recuperacion}"}
    )
    assert respuesta.status_code == 401


def test_access_token_si_autentica(client_sin_token, usuario_real):
    """Contraparte positiva: el access token legítimo sigue funcionando."""
    access = GestorAutenticacion.crear_token_acceso(
        {"sub": "ana@cataclub.test", "persona_id": usuario_real.id, "roles": ["ALUMNO"]}, version_sesion=1
    )
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}
    )
    assert respuesta.status_code == 200
    assert respuesta.json()["correo"] == "ana@cataclub.test"


# --- E01: invalidación de sesión -- ruta ACCESS (B2) ------------------------
# El diseño original solo cableó el epoch en decodificar_token. Estas pruebas
# fijan ese contrato a nivel de API (no solo la función pura epoch_valido,
# ya cubierta en test_epoch_valido.py): un token minted ANTES de invalidar
# debe dejar de servir, uno reemitido con el sver actual debe seguir sirviendo,
# y la invalidación de OTRO usuario no debe afectar tokens ajenos.

def test_access_token_previo_a_invalidacion_es_rechazado_y_uno_reemitido_funciona(
    client_sin_token, usuario_real, db_session
):
    usuario = usuario_real.usuario
    access_previo = GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario_real.id, "roles": ["ALUMNO"]},
        version_sesion=usuario.version_sesion,
    )
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access_previo}"}
    )
    assert respuesta.status_code == 200

    # Simula "cerrar mis otras sesiones": bump directo de version_sesion
    # (el endpoint real que hace esto llega en el slice B3; aquí se prueba
    # el mecanismo de enforcement que B3 va a disparar).
    usuario.version_sesion += 1
    db_session.commit()

    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access_previo}"}
    )
    assert respuesta.status_code == 401

    access_reemitido = GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario_real.id, "roles": ["ALUMNO"]},
        version_sesion=usuario.version_sesion,
    )
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access_reemitido}"}
    )
    assert respuesta.status_code == 200


def test_access_token_sin_claim_sver_es_rechazado(client_sin_token, usuario_real):
    """Un access token sin `sver` (construido a mano, simulando uno emitido
    antes de este cambio) se trata como INVÁLIDO -- no como epoch `1`."""
    payload = {
        "sub": "ana@cataclub.test",
        "persona_id": usuario_real.id,
        "roles": ["ALUMNO"],
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
    }
    token_sin_sver = jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algoritmo)
    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {token_sin_sver}"}
    )
    assert respuesta.status_code == 401


def test_invalidar_sesion_de_otro_usuario_no_afecta_token_propio(
    client_sin_token, usuario_real, db_session
):
    usuario = usuario_real.usuario
    access = GestorAutenticacion.crear_token_acceso(
        {"sub": usuario.correo, "persona_id": usuario_real.id, "roles": ["ALUMNO"]},
        version_sesion=usuario.version_sesion,
    )

    otra_persona = Persona(
        nombres="Beto", apellidos="Ruiz", cedula="1799999999",
        fecha_nacimiento=date(1992, 1, 1), telefono="0990000000",
    )
    db_session.add(otra_persona)
    db_session.flush()
    otro_usuario = Usuario(
        correo="beto@cataclub.test", contrasenia="hash", persona_id=otra_persona.id,
        roles=[Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")],
    )
    db_session.add(otro_usuario)
    db_session.commit()
    otro_usuario.version_sesion += 1
    db_session.commit()

    respuesta = client_sin_token.get(
        "/api/v1/auth/me", headers={"Authorization": f"Bearer {access}"}
    )
    assert respuesta.status_code == 200


# --- E01: invalidación de sesión -- ruta REFRESH (B2, MANDATORIO) -----------
# Este es el escenario que dos jueces adversariales independientes marcaron
# como BLOCKER en el diseño original: /auth/refresh nunca pasaba por
# decodificar_token, así que un refresh token capturado junto al access
# comprometido (van en cookies hermanas) seguía vivo hasta 7 días y podía
# reemitir un access token nuevo, totalmente compatible con el epoch --
# bypass total de "cerrar mis otras sesiones".

def test_refresh_rechaza_refresh_token_previo_a_invalidacion(
    client_sin_token, usuario_real, db_session
):
    usuario = usuario_real.usuario
    refresh_previo = GestorAutenticacion.crear_token_refresco(
        {"sub": usuario.correo, "persona_id": usuario_real.id},
        version_sesion=usuario.version_sesion,
    )

    usuario.version_sesion += 1
    db_session.commit()

    respuesta = client_sin_token.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh_previo}
    )
    assert respuesta.status_code == 401


def test_refresh_acepta_refresh_token_reemitido_y_el_access_nuevo_lleva_sver_vigente(
    client_sin_token, usuario_real, db_session
):
    usuario = usuario_real.usuario
    usuario.version_sesion += 1
    db_session.commit()

    refresh_nuevo = GestorAutenticacion.crear_token_refresco(
        {"sub": usuario.correo, "persona_id": usuario_real.id},
        version_sesion=usuario.version_sesion,
    )
    respuesta = client_sin_token.post(
        "/api/v1/auth/refresh", json={"refresh_token": refresh_nuevo}
    )
    assert respuesta.status_code == 200

    nuevo_access = respuesta.json()["access_token"]
    payload_nuevo = jwt.decode(nuevo_access, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo])
    assert payload_nuevo["sver"] == usuario.version_sesion
