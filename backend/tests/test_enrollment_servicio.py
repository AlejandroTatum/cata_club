from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import (
    NivelTecnicoAlumno, TipoManoDominante, TipoNotificacion, TipoRol, TipoSangre,
)
from app.dominio.modelos import AntecedentesClub, FichaMedica, Notificacion, Persona, Usuario
from app.presentacion.schemas.enrollment_schemas import (
    EnrollmentAlumnoDTO,
    EnrollmentAntecedentesDTO,
    EnrollmentCreateDTO,
    EnrollmentCredencialesDTO,
    EnrollmentFichaMedicaDTO,
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

def _alumno_dto(cedula: str = cedula_valida(251), fecha_nacimiento: date = date(2015, 6, 15)) -> EnrollmentAlumnoDTO:
    return EnrollmentAlumnoDTO(
        nombres="Lucas", apellidos="Martinez", cedula=cedula,
        fecha_nacimiento=fecha_nacimiento, telefono="0991234567",
    )


def test_inscripcion_representante_persiste_roles_mas_alla_del_flush(db_session):
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
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
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(251),
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
    alumno = db_session.query(Persona).filter(Persona.cedula == cedula_valida(251)).one()
    assert alumno.representante_id is not None


def test_inscripcion_menor_sin_credenciales_no_crea_usuario_menor(db_session):
    """Sin credencialesMenor, solo se crea cuenta del representante."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
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
        nombres="Existente", apellidos="Test", cedula=cedula_valida(253),
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
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(251),
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

def test_alumno_menor_sin_representante_rechazado():
    """Un menor (5-17 años) sin representante ni credenciales propias es
    rechazado por el DTO (issue #275): el validador exige `representante`
    o `credenciales_alumno`, y el rechazo ocurre antes de tocar la base."""
    from pydantic import ValidationError
    with pytest.raises(ValidationError, match="representante"):
        EnrollmentCreateDTO(
            alumno=_alumno_dto(),
        )


def test_menor_con_credenciales_sin_representante_rechazado(db_session):
    """Defensa que queda en el servicio: un menor con `credenciales_alumno`
    (el camino de adulto) pero sin representante sigue rechazado — los
    menores requieren representante legal."""
    datos = EnrollmentCreateDTO(
        alumno=_alumno_dto(),  # 15 años
        credenciales_alumno=EnrollmentCredencialesDTO(
            correo="menor@example.com", contrasenia="password8",
        ),
    )
    from app.dominio.excepciones import OperacionInvalida
    with pytest.raises(OperacionInvalida, match="representante"):
        EnrollmentServicio(db_session).enroll(datos)


def test_alumno_menor_de_5_anos_rechazado(db_session):
    """Alumnos menores de 5 años no son admitidos."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Bebé", apellidos="Martinez", cedula=cedula_valida(251),
            fecha_nacimiento=date(2026, 1, 1), telefono="0991234567",
        ),
    )
    from app.dominio.excepciones import OperacionInvalida
    with pytest.raises(OperacionInvalida, match="edad"):
        EnrollmentServicio(db_session).enroll(datos)


def test_alumno_cedula_duplicada_rechazada(db_session):
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(cedula=cedula_valida(250)),  # misma cédula que representante
    )
    from app.dominio.excepciones import EntidadDuplicada
    with pytest.raises(EntidadDuplicada, match=MENSAJE_IDENTIDAD_DUPLICADA):
        EnrollmentServicio(db_session).enroll(datos)


def test_representante_cedula_duplicada_rechazada(db_session):
    """Si la cédula del representante ya existe, se rechaza."""
    persona = Persona(
        nombres="Existente", apellidos="Test", cedula=cedula_valida(250),
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.commit()

    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
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
            nombres="Menor Rep", apellidos="Martinez", cedula=cedula_valida(250),
            fecha_nacimiento=date(2012, 5, 20), telefono="0991234567",
            correo="menorrep@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(),
    )
    from app.dominio.excepciones import OperacionInvalida
    with pytest.raises(OperacionInvalida, match="mayor de edad"):
        EnrollmentServicio(db_session).enroll(datos)


def test_representante_edad_maxima_rechazada(db_session):
    """El representante también tiene techo (EDAD_MAXIMA_ALUMNO), no solo
    piso. Antes solo se validaba `edad_rep < EDAD_MAYORIA_EDAD`; una fecha
    de nacimiento implausible (patrón auditado: año 1800) se aceptaba en
    silencio del lado del cliente porque el cálculo de edad ahí devolvía
    NaN fuera de un rango arbitrario y toda comparación con NaN es `false`.
    Este es el mismo defecto de origen, del lado del servidor: sin este
    techo, el 400 nunca llega y el registro se completa igual."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Muy Longevo", apellidos="Martinez", cedula=cedula_valida(250),
            fecha_nacimiento=date(1800, 1, 1), telefono="0991234567",
            correo="longevo@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(),
    )
    from app.dominio.excepciones import OperacionInvalida
    with pytest.raises(OperacionInvalida, match="máximo"):
        EnrollmentServicio(db_session).enroll(datos)


def test_representante_correo_duplicado_rechazado(db_session):
    """Si el correo del representante ya está en uso, se rechaza."""
    persona = Persona(
        nombres="Existente", apellidos="Test", cedula=cedula_valida(253),
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
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
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
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(251),
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            correo="no-es-correo", contrasenia="password8",
        )


def test_credenciales_menor_contrasenia_corta_rechazada_schema(db_session):
    """Pydantic rechaza contraseniaMenor con < 8 caracteres."""
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(251),
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
        nombres="Admin", apellidos="Principal", cedula=cedula_valida(252),
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
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
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


def test_inscripcion_sin_credenciales_rechazada_en_dto():
    """El cuerpo sin `representante` y sin `credenciales_alumno` se rechaza
    en el DTO (issue #275): el endpoint público no tiene un tercer camino, y
    antes este cuerpo pasaba toda la validación y moría recién al serializar
    la respuesta, DESPUÉS de persistir la Persona."""
    from pydantic import ValidationError
    with pytest.raises(ValidationError, match="credenciales"):
        EnrollmentCreateDTO(
            alumno=_alumno_dto(cedula=cedula_valida(254), fecha_nacimiento=date(2000, 1, 1)),
        )


# --- Atomicidad del enroll (issue #338) ------------------------------------
# `enroll()` no era transaccional: cada `Repositorio.crear` hacía su propio
# `commit()`. Cuando el flujo fallaba en un paso TARDÍO, lo escrito hasta ahí
# quedaba commiteado igual -- el cliente recibía un 400 como si nada se
# hubiera guardado, pero una cuenta huérfana (a veces 100% funcional) quedaba
# en la base. Cada test de abajo reproduce una falla tardía real encontrada
# en el servicio y prueba que, tras la excepción, NINGUNA escritura de ese
# intento sobrevive.

def test_inscripcion_menor_correo_duplicado_no_deja_representante_huerfano(db_session):
    """Falla tardía #1 (la reportada en el issue): el correo del menor con
    cuenta propia se validaba dentro de `_crear_usuario_alumno`, el ÚLTIMO
    paso del flujo -- para entonces la Persona+Usuario+roles del
    representante y la Persona del alumno ya estaban commiteadas."""
    persona = Persona(
        nombres="Existente", apellidos="Test", cedula=cedula_valida(253),
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(correo="ocupado@example.com", contrasenia="hash", persona_id=persona.id)
    db_session.add(usuario)
    db_session.commit()

    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia-huerfano@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(251),
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            correo="ocupado@example.com", contrasenia="password8",
        ),
    )
    from app.dominio.excepciones import EntidadDuplicada
    with pytest.raises(EntidadDuplicada, match=MENSAJE_IDENTIDAD_DUPLICADA):
        EnrollmentServicio(db_session).enroll(datos)

    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(250)).count() == 0
    assert db_session.query(Usuario).filter(Usuario.correo == "sofia-huerfano@example.com").count() == 0
    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(251)).count() == 0


def test_autoinscripcion_adulto_correo_duplicado_no_deja_alumno_huerfano(db_session):
    """Falla tardía #2 (hallada al explorar el servicio, no reportada en el
    issue): autoinscripción de adulto (sin representante). El correo de
    `credenciales_alumno` se validaba DESPUÉS de crear la Persona del
    alumno (y su ficha médica/antecedentes, si venían), dejando una Persona
    huérfana ante un correo ya ocupado."""
    persona = Persona(
        nombres="Existente", apellidos="Test", cedula=cedula_valida(253),
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.flush()
    usuario = Usuario(correo="jugador-ocupado@example.com", contrasenia="hash", persona_id=persona.id)
    db_session.add(usuario)
    db_session.commit()

    datos = EnrollmentCreateDTO(
        alumno=_alumno_dto(cedula="1798765432", fecha_nacimiento=date(2000, 1, 1)),
        credenciales_alumno=EnrollmentCredencialesDTO(
            correo="jugador-ocupado@example.com", contrasenia="password8",
        ),
    )
    from app.dominio.excepciones import EntidadDuplicada
    with pytest.raises(EntidadDuplicada, match=MENSAJE_IDENTIDAD_DUPLICADA):
        EnrollmentServicio(db_session).enroll(datos)

    assert db_session.query(Persona).filter(Persona.cedula == "1798765432").count() == 0


def test_alumno_cedula_duplicada_no_deja_representante_huerfano(db_session):
    """Falla tardía #3 (hallada al explorar el servicio, no reportada en el
    issue): la cédula del alumno se validaba DESPUÉS de crear la Persona del
    representante, dejando un representante huérfano ante una cédula de
    alumno duplicada."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia-cedula@example.com", contrasenia="password8",
        ),
        alumno=_alumno_dto(cedula=cedula_valida(250)),  # misma cédula que representante
    )
    from app.dominio.excepciones import EntidadDuplicada
    with pytest.raises(EntidadDuplicada, match=MENSAJE_IDENTIDAD_DUPLICADA):
        EnrollmentServicio(db_session).enroll(datos)

    assert db_session.query(Persona).filter(Persona.cedula == cedula_valida(250)).count() == 0


def test_inscripcion_completa_persiste_todo_en_una_transaccion(db_session):
    """Camino feliz, candado obligatorio: representante + menor + roles +
    ficha médica + antecedentes quedan TODOS escritos. Sin este test, un fix
    de atomicidad que rompiera el camino feliz (p. ej. olvidar el `commit()`
    final) pasaría desapercibido."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(250),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia-completa@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(251),
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            correo="lucas-completa@example.com", contrasenia="password8",
        ),
        ficha_medica=EnrollmentFichaMedicaDTO(
            tipo_sangre=TipoSangre.O_POSITIVO,
            enfermedades=["Asma"],
            alergias="Ninguna",
            contacto_emergencia="Mamá",
            telefono_emergencia="0991112222",
        ),
        antecedentes=EnrollmentAntecedentesDTO(
            nivel_tecnico_alumno=NivelTecnicoAlumno.NIVEL_1,
            mano_dominante=TipoManoDominante.DIESTRO,
        ),
    )

    resultado = EnrollmentServicio(db_session).enroll(datos)
    # Simula el cierre de la sesión de request sin commit explícito (ver nota
    # al inicio del archivo): solo un `commit()` real sobrevive a esto.
    db_session.rollback()

    assert resultado["access_token"]

    rep = db_session.query(Persona).filter(Persona.cedula == cedula_valida(250)).one()
    alumno = db_session.query(Persona).filter(Persona.cedula == cedula_valida(251)).one()
    assert alumno.representante_id == rep.id

    usuario_rep = db_session.query(Usuario).filter(Usuario.correo == "sofia-completa@example.com").one()
    assert {r.tipo_rol for r in usuario_rep.roles} == {TipoRol.REPRESENTANTE, TipoRol.ALUMNO}

    usuario_alumno = db_session.query(Usuario).filter(Usuario.correo == "lucas-completa@example.com").one()
    assert {r.tipo_rol for r in usuario_alumno.roles} == {TipoRol.ALUMNO}

    ficha = db_session.query(FichaMedica).filter(FichaMedica.persona_id == alumno.id).one()
    assert ficha.tipo_sangre == TipoSangre.O_POSITIVO
    assert [e.nombre_enfermedad for e in ficha.enfermedades] == ["Asma"]

    antecedentes = db_session.query(AntecedentesClub).filter(AntecedentesClub.persona_id == alumno.id).one()
    assert antecedentes.nivel_tecnico_alumno == NivelTecnicoAlumno.NIVEL_1


def test_api_inscripcion_sin_credenciales_devuelve_422_y_no_persiste(client, db_session):
    """Criterios de aceptación del issue #275: POST sin representante ni
    credenciales_alumno devuelve 422 con un mensaje que dice qué falta, y
    el conteo de `persona` no cambia después del request rechazado."""
    cedula = cedula_valida(254)
    total_antes = db_session.query(Persona).count()
    respuesta = client.post(
        "/api/v1/enrollment/",
        json={
            "alumno": {
                "nombres": "Prueba",
                "apellidos": "Quinientos",
                "cedula": cedula,
                "fecha_nacimiento": "1990-05-05",
                "telefono": "0991234567",
            }
        },
    )
    assert respuesta.status_code == 422
    assert "representante" in respuesta.text and "credenciales" in respuesta.text
    assert db_session.query(Persona).count() == total_antes
    assert db_session.query(Persona).filter(Persona.cedula == cedula).count() == 0

