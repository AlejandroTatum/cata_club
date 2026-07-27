from datetime import date

import pytest

from app.dominio.enums import TipoNotificacion, TipoRol
from app.dominio.modelos import Notificacion, Persona, Usuario
from app.presentacion.schemas.enrollment_schemas import (
    EnrollmentAlumnoDTO,
    EnrollmentCreateDTO,
    EnrollmentCredencialesDTO,
    EnrollmentRepresentanteDTO,
)
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA
from app.servicios_negocio.enrollment_servicio import EnrollmentServicio


# Regression tests for a bug where `_asignar_rol` only called `db.flush()`
# instead of `db.commit()`: the role association was visible within the same
# request's session but silently discarded once that session closed without
# an explicit commit (as `obtener_sesion`'s `finally: db.close()` does in
# production). A single shared `db_session`/connection per test (see
# conftest.py) can't reproduce this — flushed-but-uncommitted writes are
# still visible to later queries on the same connection. Simulating the
# request boundary requires an explicit `rollback()` after the service call:
# only a real `commit()` survives that.

def _alumno_dto(cedula: str = "1723456789", fecha_nacimiento: date = date(2015, 6, 15)) -> EnrollmentAlumnoDTO:
    return EnrollmentAlumnoDTO(
        nombres="Lucas", apellidos="Martinez", cedula=cedula,
        fecha_nacimiento=fecha_nacimiento, telefono="0991234567",
    )


def test_inscripcion_representante_persiste_roles_mas_alla_del_flush(db_session):
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(),
    )
    EnrollmentServicio(db_session).enroll(datos)

    # Simulates the request-scoped session closing without an explicit
    # commit (`obtener_sesion`'s `finally: db.close()`) — only genuinely
    # committed rows survive this.
    db_session.rollback()

    usuario = db_session.query(Usuario).filter(Usuario.correo == "sofia@example.com").one()
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.REPRESENTANTE, TipoRol.ALUMNO}


def test_autoinscripcion_jugador_persiste_rol_mas_alla_del_flush(db_session):
    datos = EnrollmentCreateDTO(
        alumno=_alumno_dto(cedula="1798765432", fecha_nacimiento=date(2000, 1, 1)),
        credenciales_alumno=EnrollmentCredencialesDTO(
            correo="jugador@example.com", contrasenia="password8",
        ),
    )
    EnrollmentServicio(db_session).enroll(datos)

    db_session.rollback()

    usuario = db_session.query(Usuario).filter(Usuario.correo == "jugador@example.com").one()
    roles = {r.tipo_rol for r in usuario.roles}
    assert roles == {TipoRol.ALUMNO}


# --- Flujo 3: inscripción de menor con credenciales propias ----------------

def test_inscripcion_menor_con_credenciales_crea_usuario_menor(db_session):
    """Cuando el representante provee credencialesMenor, se crea también
    un Usuario + ALUMNO para el menor con esas credenciales."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula="1723456789",
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            correo="lucas@example.com", contrasenia="password8",
        ),
    )
    EnrollmentServicio(db_session).enroll(datos)

    # Representante tiene su cuenta
    usuario_rep = db_session.query(Usuario).filter(Usuario.correo == "sofia@example.com").one()
    roles_rep = {r.tipo_rol for r in usuario_rep.roles}
    assert roles_rep == {TipoRol.REPRESENTANTE, TipoRol.ALUMNO}

    # Menor tiene su propia cuenta
    usuario_menor = db_session.query(Usuario).filter(Usuario.correo == "lucas@example.com").one()
    roles_menor = {r.tipo_rol for r in usuario_menor.roles}
    assert roles_menor == {TipoRol.ALUMNO}

    # El menor apunta al mismo representante
    alumno = db_session.query(Persona).filter(Persona.cedula == "1723456789").one()
    assert alumno.representante_id is not None


def test_inscripcion_menor_sin_credenciales_no_crea_usuario_menor(db_session):
    """Sin credencialesMenor, solo se crea cuenta del representante."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(),
    )
    EnrollmentServicio(db_session).enroll(datos)

    # Solo el representante tiene cuenta
    assert db_session.query(Usuario).filter(Usuario.correo == "sofia@example.com").count() == 1
    assert db_session.query(Usuario).filter(Usuario.correo != "sofia@example.com").count() == 0


def test_inscripcion_menor_correo_duplicado_rechazada(db_session):
    """Si el correo del menor ya está en uso, se rechaza."""
    # Crear un usuario con ese correo primero
    persona = Persona(
        nombres="Existente", apellidos="Test", cedula="1799999999",
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo="ocupado@example.com", contrasenia="hash",
        persona_id=persona.id,
    )
    db_session.add(usuario)
    db_session.commit()

    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula="1723456789",
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            correo="ocupado@example.com", contrasenia="password8",
        ),
    )
    from app.dominio.excepciones import EntidadDuplicada
    # Texto genérico e idéntico para cédula y correo, a propósito:
    # ver app/dominio/mensajes.py y tests/test_mensajes_identidad_duplicada.py.
    with pytest.raises(EntidadDuplicada, match=MENSAJE_IDENTIDAD_DUPLICADA):
        EnrollmentServicio(db_session).enroll(datos)


# --- Validación de campos del enrollment -----------------------------------

def test_alumno_menor_sin_representante_rechazado(db_session):
    """Un menor (5-17 años) sin representante debe ser rechazado."""
    datos = EnrollmentCreateDTO(
        alumno=_alumno_dto(),
    )
    from app.dominio.excepciones import OperacionInvalida
    with pytest.raises(OperacionInvalida, match="representante"):
        EnrollmentServicio(db_session).enroll(datos)


def test_alumno_menor_de_5_anos_rechazado(db_session):
    """Alumnos menores de 5 años no son admitidos."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Bebé", apellidos="Martinez", cedula="1723456789",
            fecha_nacimiento=date(2026, 1, 1), telefono="0991234567",
        ),
    )
    from app.dominio.excepciones import OperacionInvalida
    with pytest.raises(OperacionInvalida, match="edad"):
        EnrollmentServicio(db_session).enroll(datos)


def test_alumno_cedula_duplicada_rechazada(db_session):
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(cedula="1712345678"),  # misma cédula que representante
    )
    from app.dominio.excepciones import EntidadDuplicada
    with pytest.raises(EntidadDuplicada, match=MENSAJE_IDENTIDAD_DUPLICADA):
        EnrollmentServicio(db_session).enroll(datos)


def test_representante_cedula_duplicada_rechazada(db_session):
    """Si la cédula del representante ya existe, se rechaza."""
    persona = Persona(
        nombres="Existente", apellidos="Test", cedula="1712345678",
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.commit()

    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(cedula="1798765432"),
    )
    from app.dominio.excepciones import EntidadDuplicada
    with pytest.raises(EntidadDuplicada, match=MENSAJE_IDENTIDAD_DUPLICADA):
        EnrollmentServicio(db_session).enroll(datos)


def test_representante_menor_de_edad_rechazado(db_session):
    """El representante debe ser mayor de 18 años."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Menor Rep", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(2012, 5, 20), telefono="0991234567",
            correo="menorrep@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(),
    )
    from app.dominio.excepciones import OperacionInvalida
    with pytest.raises(OperacionInvalida, match="mayor de edad"):
        EnrollmentServicio(db_session).enroll(datos)


def test_representante_correo_duplicado_rechazado(db_session):
    """Si el correo del representante ya está en uso, se rechaza."""
    persona = Persona(
        nombres="Existente", apellidos="Test", cedula="1799999999",
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo="ocupado@example.com", contrasenia="hash",
        persona_id=persona.id,
    )
    db_session.add(usuario)
    db_session.commit()

    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="ocupado@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(),
    )
    from app.dominio.excepciones import EntidadDuplicada
    with pytest.raises(EntidadDuplicada, match=MENSAJE_IDENTIDAD_DUPLICADA):
        EnrollmentServicio(db_session).enroll(datos)


def test_credenciales_menor_correo_invalido_rechazado_schema(db_session):
    """Pydantic rechaza correoMenor con formato inválido en EnrollmentAlumnoDTO."""
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula="1723456789",
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            correo="no-es-correo", contrasenia="password8",
        )


def test_credenciales_menor_contrasenia_corta_rechazada_schema(db_session):
    """Pydantic rechaza contraseniaMenor con < 8 caracteres."""
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula="1723456789",
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            correo="lucas@test.com", contrasenia="123",
        )


# --- Notificación a administradores (hueco de cobertura) -------------------
# Ninguna prueba anterior de este archivo llega a crear una Notificacion:
# `_notificar_nueva_inscripcion` sale temprano cuando no existe el rol
# ADMINISTRADOR en la base (`rol_admin is None`), y ningún escenario previo
# lo creaba. Por eso las 455 pruebas pasaban mientras producción moría con
# `invalid input value for enum tiponotificacion: "NUEVA_INSCRIPCION"`.

def _crear_administrador(db_session, correo: str = "admin@cataclub.test") -> int:
    """Crea una Persona + Usuario con rol ADMINISTRADOR y devuelve su
    persona_id. Es la precondición que activa la notificación."""
    from app.dominio.modelos import Rol

    persona = Persona(
        nombres="Admin", apellidos="Principal", cedula="1701010101",
        fecha_nacimiento=date(1985, 3, 10), telefono="0990000001",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(
        correo=correo, contrasenia="hash", persona_id=persona.id,
        roles=[Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")],
    )
    db_session.add(usuario)
    db_session.commit()
    return persona.id


def test_inscripcion_con_representante_notifica_a_los_administradores(db_session):
    """La autoinscripción debe dejar una notificación NUEVA_INSCRIPCION para
    cada administrador. Exige que el label exista en el enum de PostgreSQL."""
    admin_id = _crear_administrador(db_session)
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula="1712345678",
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(),
    )

    resultado = EnrollmentServicio(db_session).enroll(datos)

    assert resultado["access_token"]
    notificaciones = (
        db_session.query(Notificacion)
        .filter(Notificacion.persona_id == admin_id)
        .all()
    )
    assert len(notificaciones) == 1
    assert notificaciones[0].tipo == TipoNotificacion.NUEVA_INSCRIPCION
    assert "Lucas Martinez" in notificaciones[0].mensaje


def test_autoinscripcion_adulto_notifica_a_los_administradores(db_session):
    """Segundo camino de `enroll()`: adulto con credenciales propias."""
    admin_id = _crear_administrador(db_session)
    datos = EnrollmentCreateDTO(
        alumno=_alumno_dto(cedula="1798765432", fecha_nacimiento=date(2000, 1, 1)),
        credenciales_alumno=EnrollmentCredencialesDTO(
            correo="jugador@example.com", contrasenia="password8",
        ),
    )

    EnrollmentServicio(db_session).enroll(datos)

    tipos = [
        n.tipo for n in db_session.query(Notificacion)
        .filter(Notificacion.persona_id == admin_id).all()
    ]
    assert tipos == [TipoNotificacion.NUEVA_INSCRIPCION]


def test_inscripcion_sin_credenciales_notifica_a_los_administradores(db_session):
    """Tercer camino de `enroll()`: registro sin auto-login."""
    admin_id = _crear_administrador(db_session)
    datos = EnrollmentCreateDTO(
        alumno=_alumno_dto(cedula="1755555555", fecha_nacimiento=date(2000, 1, 1)),
    )

    resultado = EnrollmentServicio(db_session).enroll(datos)

    assert "persona_id" in resultado
    tipos = [
        n.tipo for n in db_session.query(Notificacion)
        .filter(Notificacion.persona_id == admin_id).all()
    ]
    assert tipos == [TipoNotificacion.NUEVA_INSCRIPCION]
