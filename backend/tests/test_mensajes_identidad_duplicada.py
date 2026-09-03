"""
Contrato de divulgación para los errores de "identidad ya registrada".

El mensaje anterior — "Ya existe una persona con la cédula 0102030499" — se
devolvía en endpoints PÚBLICOS y sin autenticar (inscripción, registro). El
número era el que escribió quien envía el formulario, pero la respuesta
CONFIRMABA que esa cédula está registrada en el club: cualquiera podía sondear
cédulas y descubrir quiénes son socios. El club custodia datos de menores de un
municipio, así que ese oráculo de enumeración se cierra aquí.

Reglas verificadas:
  1. En los flujos públicos y en los de representante, cédula y correo
     duplicados devuelven EXACTAMENTE el mismo mensaje genérico. Ese mensaje
     nombra el CONJUNTO de campos que pueden chocar ("cédula o correo",
     issue #999) pero no repite el identificador ni revela CUÁL de los dos
     coincidió (si los dos mensajes difirieran, cada uno sería un oráculo
     del otro).
  2. El panel de administración, que es autenticado y solo ADMINISTRADOR,
     conserva el mensaje preciso: ahí no hay divulgación (quien lo lee ya puede
     listar el padrón completo) y el operador necesita saber qué corregir.
  3. El texto genérico está fijado en el detector del frontend
     (`frontend/src/lib/duplicate-identity.ts`), que decide por texto si ofrece
     los enlaces de "iniciar sesión" / "recuperar contraseña".
"""
from datetime import date
from pathlib import Path

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import EntidadDuplicada
from app.dominio.mensajes import MENSAJE_IDENTIDAD_DUPLICADA
from app.dominio.modelos import Persona, Usuario
from app.servicios_negocio.dtos.enrollment_schemas import (
    EnrollmentAlumnoDTO,
    EnrollmentCreateDTO,
    EnrollmentCredencialesDTO,
    EnrollmentRepresentanteDTO,
)
from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.dtos.auth_schemas import RegistroUsuarioDTO
from app.servicios_negocio.dtos.persona_schemas import (
    PersonaCreateDTO,
    RepresentadoCreateDTO,
)
from app.servicios_negocio.admin_cuenta_servicio import AdminCuentaServicio
from app.servicios_negocio.auth_servicio import AuthServicio
from app.servicios_negocio.enrollment_servicio import EnrollmentServicio
from app.servicios_negocio.persona_servicio import PersonaServicio

CEDULA_OCUPADA = cedula_valida(450)
CORREO_OCUPADO = "ocupado@example.com"


def _sembrar_persona_con_cuenta(db_session) -> Persona:
    """Deja en la base una persona con cédula y correo ya tomados."""
    persona = Persona(
        nombres="Existente", apellidos="Test", cedula=CEDULA_OCUPADA,
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.flush()
    db_session.add(Usuario(correo=CORREO_OCUPADO, contrasenia="hash", persona_id=persona.id))
    db_session.commit()
    return persona


def _afirmar_generico(mensaje: str) -> None:
    """El mensaje nombra el CONJUNTO de campos posibles (cédula y correo,
    issue #999) pero no repite el identificador enviado ni delata cuál de
    los dos coincidió."""
    assert mensaje == MENSAJE_IDENTIDAD_DUPLICADA
    assert CEDULA_OCUPADA not in mensaje
    assert CORREO_OCUPADO not in mensaje
    assert "cédula" in mensaje.lower()
    assert "correo" in mensaje.lower()


def _representante(correo: str = "sofia@example.com", cedula: str = "1798765432"):
    return EnrollmentRepresentanteDTO(
        nombres="Sofia", apellidos="Martinez", cedula=cedula,
        fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
        correo=correo, contrasenia="password8",
    )


def _alumno(
    cedula: str = cedula_valida(451),
    fecha_nacimiento: date = date(2015, 6, 15),
    **extra,
) -> EnrollmentAlumnoDTO:
    return EnrollmentAlumnoDTO(
        nombres="Lucas", apellidos="Martinez", cedula=cedula,
        fecha_nacimiento=fecha_nacimiento, telefono="0991234567", **extra,
    )


# Issue #730. Este archivo prueba que un choque de identidad no divulgue CUÁL
# campo chocó -- la ficha médica no participa de esa decisión. Se completa
# por defecto para que las altas lleguen al detector de duplicados en vez de
# morir antes, en la validación del DTO.
_FICHA = dict(
    tipo_sangre="O_POSITIVO", enfermedades=[],
    contacto_emergencia="María Torres", telefono_emergencia="0991112233",
)


def _inscripcion(**kwargs) -> EnrollmentCreateDTO:
    kwargs.setdefault("ficha_medica", dict(_FICHA))
    kwargs.setdefault("acepta_consentimientos", True)
    return EnrollmentCreateDTO(**kwargs)


# --- 1. Inscripción pública (POST /enrollment/, sin autenticar) -------------

def test_inscripcion_cedula_de_representante_duplicada_no_divulga(db_session):
    _sembrar_persona_con_cuenta(db_session)
    datos = _inscripcion(
        representante=_representante(cedula=CEDULA_OCUPADA),
        alumno=_alumno(),
    )
    with pytest.raises(EntidadDuplicada) as error:
        EnrollmentServicio(db_session).enroll(datos)
    _afirmar_generico(error.value.mensaje)


def test_inscripcion_cedula_de_alumno_duplicada_no_divulga(db_session):
    _sembrar_persona_con_cuenta(db_session)
    datos = _inscripcion(
        representante=_representante(),
        alumno=_alumno(cedula=CEDULA_OCUPADA),
    )
    with pytest.raises(EntidadDuplicada) as error:
        EnrollmentServicio(db_session).enroll(datos)
    _afirmar_generico(error.value.mensaje)


def test_inscripcion_correo_de_representante_duplicado_no_divulga(db_session):
    _sembrar_persona_con_cuenta(db_session)
    datos = _inscripcion(
        representante=_representante(correo=CORREO_OCUPADO),
        alumno=_alumno(),
    )
    with pytest.raises(EntidadDuplicada) as error:
        EnrollmentServicio(db_session).enroll(datos)
    _afirmar_generico(error.value.mensaje)


def test_inscripcion_correo_de_menor_duplicado_no_divulga(db_session):
    _sembrar_persona_con_cuenta(db_session)
    datos = _inscripcion(
        representante=_representante(),
        alumno=_alumno(correo=CORREO_OCUPADO, contrasenia="password8"),
    )
    with pytest.raises(EntidadDuplicada) as error:
        EnrollmentServicio(db_session).enroll(datos)
    _afirmar_generico(error.value.mensaje)


def test_autoinscripcion_correo_duplicado_no_divulga(db_session):
    _sembrar_persona_con_cuenta(db_session)
    datos = _inscripcion(
        alumno=_alumno(cedula=cedula_valida(451), fecha_nacimiento=date(2000, 1, 1)),
        credenciales_alumno=EnrollmentCredencialesDTO(
            correo=CORREO_OCUPADO, contrasenia="password8",
        ),
    )
    with pytest.raises(EntidadDuplicada) as error:
        EnrollmentServicio(db_session).enroll(datos)
    _afirmar_generico(error.value.mensaje)


def test_cedula_y_correo_duplicados_son_indistinguibles(db_session):
    """Si los dos mensajes difirieran, cada uno sería un oráculo del otro."""
    _sembrar_persona_con_cuenta(db_session)

    with pytest.raises(EntidadDuplicada) as por_cedula:
        EnrollmentServicio(db_session).enroll(
            _inscripcion(representante=_representante(cedula=CEDULA_OCUPADA), alumno=_alumno())
        )
    with pytest.raises(EntidadDuplicada) as por_correo:
        EnrollmentServicio(db_session).enroll(
            _inscripcion(representante=_representante(correo=CORREO_OCUPADO), alumno=_alumno())
        )

    assert por_cedula.value.mensaje == por_correo.value.mensaje


def test_enroll_con_cedula_corregida_tiene_exito_tras_duplicado(db_session):
    """Issue #999: `enroll()` no deja estado entre intentos. Un primer envío
    con cédula duplicada falla; un segundo envío, con la cédula corregida y un
    correo nuevo, tiene éxito -- confirma que el defecto reportado ("corrijo
    la cédula y sigo chocando") no está en el backend, sino en que la
    interfaz señalaba un único campo como culpable."""
    _sembrar_persona_con_cuenta(db_session)
    servicio = EnrollmentServicio(db_session)

    with pytest.raises(EntidadDuplicada):
        servicio.enroll(
            _inscripcion(representante=_representante(cedula=CEDULA_OCUPADA), alumno=_alumno())
        )

    resultado = servicio.enroll(_inscripcion(representante=_representante(), alumno=_alumno()))
    assert resultado["persona_id"] is not None


# --- 2. Registro público de credenciales (POST /auth/registro) -------------

def test_registro_de_persona_que_ya_tiene_cuenta_no_divulga(db_session):
    _sembrar_persona_con_cuenta(db_session)
    datos = RegistroUsuarioDTO(
        cedula=CEDULA_OCUPADA, correo="nuevo@example.com", contrasenia="password8",
    )
    with pytest.raises(EntidadDuplicada) as error:
        AuthServicio(db_session).registrar_usuario(datos)
    _afirmar_generico(error.value.mensaje)


def test_registro_con_correo_ocupado_no_divulga(db_session):
    persona = Persona(
        nombres="Sin", apellidos="Cuenta", cedula="1798765432",
        fecha_nacimiento=date(1990, 1, 1), telefono="0990000001",
    )
    db_session.add(persona)
    _sembrar_persona_con_cuenta(db_session)

    datos = RegistroUsuarioDTO(
        cedula="1798765432", correo=CORREO_OCUPADO, contrasenia="password8",
    )
    with pytest.raises(EntidadDuplicada) as error:
        AuthServicio(db_session).registrar_usuario(datos)
    _afirmar_generico(error.value.mensaje)


# --- 3. Alta de persona / dependiente (representante autenticado) ----------

def test_registrar_persona_con_cedula_duplicada_no_divulga(db_session):
    """`registrar_persona` es admin-only por sí solo, pero `crear_representado`
    lo reutiliza desde `POST /personas/{id}/representados`, que un
    representante autenticado (no admin) puede invocar. Al ser compartido, el
    mensaje tiene que ser el genérico."""
    _sembrar_persona_con_cuenta(db_session)
    datos = PersonaCreateDTO(
        nombres="Otra", apellidos="Persona", cedula=CEDULA_OCUPADA,
        fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
    )
    with pytest.raises(EntidadDuplicada) as error:
        PersonaServicio(db_session).registrar_persona(datos)
    _afirmar_generico(error.value.mensaje)


def test_crear_representado_con_correo_duplicado_no_divulga(db_session):
    representante = Persona(
        nombres="Rep", apellidos="Legal", cedula="1798765432",
        fecha_nacimiento=date(1985, 1, 1), telefono="0990000002",
    )
    db_session.add(representante)
    db_session.flush()
    _sembrar_persona_con_cuenta(db_session)

    datos = RepresentadoCreateDTO(
        nombres="Hija", apellidos="Legal", cedula=cedula_valida(451),
        fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
        correo=CORREO_OCUPADO, contrasenia="password8",
    )
    with pytest.raises(EntidadDuplicada) as error:
        PersonaServicio(db_session).crear_representado(representante.id, datos)
    _afirmar_generico(error.value.mensaje)


# --- 4. Panel de administración: mensaje preciso a propósito ---------------

def test_panel_admin_conserva_el_mensaje_preciso_por_cedula(db_session):
    """`POST /personas/admin/cuentas` exige rol ADMINISTRADOR. Quien lo llama
    ya puede listar el padrón entero, así que decir qué campo chocó no divulga
    nada nuevo y le ahorra adivinar cuál de los dos corregir."""
    _sembrar_persona_con_cuenta(db_session)
    datos = AdminCrearCuentaDTO(
        nombres="Nueva", apellidos="Cuenta", cedula=CEDULA_OCUPADA,
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
        correo="libre@example.com", contrasenia="password8",
        tipo_cuenta="JUGADOR", ficha_medica=dict(_FICHA),
    )
    with pytest.raises(EntidadDuplicada) as error:
        AdminCuentaServicio(db_session).crear_cuenta(datos)
    assert "cédula" in error.value.mensaje
    assert CEDULA_OCUPADA in error.value.mensaje


def test_panel_admin_conserva_el_mensaje_preciso_por_correo(db_session):
    _sembrar_persona_con_cuenta(db_session)
    datos = AdminCrearCuentaDTO(
        nombres="Nueva", apellidos="Cuenta", cedula="1798765432",
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
        correo=CORREO_OCUPADO, contrasenia="password8",
        tipo_cuenta="JUGADOR", ficha_medica=dict(_FICHA),
    )
    with pytest.raises(EntidadDuplicada) as error:
        AdminCuentaServicio(db_session).crear_cuenta(datos)
    assert "correo" in error.value.mensaje.lower()


# --- 5. Contrato con el detector del frontend ------------------------------

def test_el_frontend_reconoce_el_mensaje_generico():
    """`frontend/src/lib/duplicate-identity.ts` decide POR TEXTO si muestra los
    enlaces de recuperación (PR #168). Si el texto de aquí cambia sin
    actualizar ese archivo, el usuario pierde esa salida sin que nada falle;
    este test es lo que lo hace fallar."""
    detector = (
        Path(__file__).resolve().parents[2]
        / "frontend" / "src" / "lib" / "duplicate-identity.ts"
    )
    assert detector.is_file(), f"No se encontró el detector del frontend en {detector}"
    assert MENSAJE_IDENTIDAD_DUPLICADA in detector.read_text(encoding="utf-8"), (
        "El mensaje genérico cambió en el backend pero no en "
        "frontend/src/lib/duplicate-identity.ts: los wizards dejarían de "
        "ofrecer 'Iniciar sesión' / 'Recuperar contraseña'."
    )
