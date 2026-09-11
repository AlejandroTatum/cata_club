"""
Invariante del issue #762: exactamente UN rol activo por cuenta/persona.

Qué fija este archivo, y por qué cada cosa:

  1. Un segundo rol DISTINTO se rechaza explícitamente, para cada par
     ordenado de roles. "Explícitamente" tiene dos mitades y las dos se
     verifican: sale un error de dominio con un mensaje legible, y el rol
     que ya estaba sigue estando. Un reemplazo implícito destruiría el rol
     anterior sin dejar rastro de quién lo decidió.
  2. Un duplicado del MISMO rol sigue siendo el rechazo de duplicado que ya
     existía (no se degrada a la regla nueva, que dice otra cosa).
  3. El camino de alta que sigue vigente -- inscripción pública -- cierra
     contra la misma regla. Antes cada uno tenía su propio `_asignar_rol`
     que solo miraba duplicados del mismo rol, así que dos flujos
     independientes podían acumular roles distintos sin que ninguno de los
     dos viera al otro. El camino de membresía dejó de asignar rol alguno
     (issue #1132): "ser jugador" se deriva de la membresía ACTIVA, no de
     un rol, así que `crear_membresia` ya no participa de esta invariante
     -- las pruebas de esa sección confirman que no toca ningún rol.

La invariante de base de datos (trigger) y la migración se prueban aparte,
en `test_migracion_rol_unico.py`: acá la sesión vive dentro de la
transacción externa del test y no puede ejercitar concurrencia real.
"""
from datetime import date
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoModalidad, TipoRol
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Persona, Rol, TipoMembresia, Usuario
from app.servicios_negocio.dtos.enrollment_schemas import (
    EnrollmentAlumnoDTO,
    EnrollmentCreateDTO,
    EnrollmentCredencialesDTO,
    EnrollmentFichaMedicaDTO,
    EnrollmentFichaMedicaMenorDTO,
    EnrollmentRepresentanteDTO,
)
from app.servicios_negocio.dtos.membresia_pago_schemas import MembresiaCreateDTO
from app.servicios_negocio.enrollment_servicio import EnrollmentServicio
from app.servicios_negocio.membresia_pago_servicio import MembresiaServicio
from app.servicios_negocio.rol_servicio import RolServicio


TODOS_LOS_ROLES = (
    TipoRol.ADMINISTRADOR,
    TipoRol.ENTRENADOR,
    TipoRol.ALUMNO,
    TipoRol.REPRESENTANTE,
)

PARES_DISTINTOS = [
    (existente, nuevo)
    for existente in TODOS_LOS_ROLES
    for nuevo in TODOS_LOS_ROLES
    if existente is not nuevo
]


# --- fábricas ---------------------------------------------------------------

def _crear_cuenta_con_rol(
    db_session, tipo_rol: TipoRol | None, semilla: int = 700,
) -> Usuario:
    """Persona + Usuario con, a lo sumo, UN rol. Vía ORM directo y no vía
    servicio: acá se construye el estado de partida, no se ejercita la regla."""
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula_valida(semilla),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
    )
    db_session.add(persona)
    db_session.flush()
    roles = []
    if tipo_rol is not None:
        rol = db_session.query(Rol).filter(Rol.tipo_rol == tipo_rol).first()
        if rol is None:
            rol = Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value.capitalize())
            db_session.add(rol)
            db_session.flush()
        roles = [rol]
    usuario = Usuario(
        correo=f"cuenta{semilla}@cataclub.test", contrasenia="hash",
        persona_id=persona.id, roles=roles,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _tipos(usuario: Usuario) -> set[TipoRol]:
    return {rol.tipo_rol for rol in usuario.roles}


# --- 1. Un segundo rol distinto se rechaza, para CADA par -------------------

@pytest.mark.parametrize("rol_existente,rol_nuevo", PARES_DISTINTOS)
def test_un_segundo_rol_distinto_se_rechaza(db_session, rol_existente, rol_nuevo):
    usuario = _crear_cuenta_con_rol(db_session, rol_existente)

    with pytest.raises(OperacionInvalida) as error:
        RolServicio(db_session).asignar_rol(usuario.persona_id, rol_nuevo)

    assert "un solo rol" in str(error.value).lower()


@pytest.mark.parametrize("rol_existente,rol_nuevo", PARES_DISTINTOS)
def test_el_rechazo_no_reemplaza_el_rol_que_ya_estaba(
    db_session, rol_existente, rol_nuevo,
):
    """La mitad que un `pytest.raises` solo no demuestra: que el rol anterior
    sobrevive intacto. Un reemplazo implícito borraría datos sin auditoría."""
    usuario = _crear_cuenta_con_rol(db_session, rol_existente)

    with pytest.raises(OperacionInvalida):
        RolServicio(db_session).asignar_rol(usuario.persona_id, rol_nuevo)

    db_session.rollback()
    db_session.refresh(usuario)
    assert _tipos(usuario) == {rol_existente}


# --- 2. El duplicado del MISMO rol conserva su propio mensaje ---------------

@pytest.mark.parametrize("tipo_rol", TODOS_LOS_ROLES)
def test_el_mismo_rol_dos_veces_sigue_siendo_un_duplicado(db_session, tipo_rol):
    usuario = _crear_cuenta_con_rol(db_session, tipo_rol)

    with pytest.raises(OperacionInvalida) as error:
        RolServicio(db_session).asignar_rol(usuario.persona_id, tipo_rol)

    mensaje = str(error.value).lower()
    assert "ya tiene el rol" in mensaje
    assert "un solo rol" not in mensaje


def test_una_cuenta_sin_rol_recibe_el_primero(db_session):
    """Ancla: la regla nueva no puede volverse un "nadie recibe nada"."""
    usuario = _crear_cuenta_con_rol(db_session, None)

    RolServicio(db_session).asignar_rol(usuario.persona_id, TipoRol.ENTRENADOR)

    db_session.refresh(usuario)
    assert _tipos(usuario) == {TipoRol.ENTRENADOR}


def test_quitar_y_volver_a_asignar_es_el_camino_soportado(db_session):
    """El cambio de rol existe, pero como DOS decisiones explícitas."""
    usuario = _crear_cuenta_con_rol(db_session, TipoRol.ALUMNO)
    servicio = RolServicio(db_session)

    servicio.quitar_rol(usuario.persona_id, TipoRol.ALUMNO)
    servicio.asignar_rol(usuario.persona_id, TipoRol.ENTRENADOR)

    db_session.refresh(usuario)
    assert _tipos(usuario) == {TipoRol.ENTRENADOR}


# --- 3a. Endpoint administrativo de roles ----------------------------------

def test_endpoint_admin_de_roles_rechaza_el_segundo_rol(client, db_session):
    usuario = _crear_cuenta_con_rol(db_session, TipoRol.ADMINISTRADOR, semilla=701)

    respuesta = client.post(
        f"/api/v1/personas/{usuario.persona_id}/roles",
        json={"tipo_rol": TipoRol.ALUMNO.value},
    )

    assert respuesta.status_code == 400
    assert "un solo rol" in respuesta.json()["detail"].lower()

    lectura = client.get(f"/api/v1/personas/{usuario.persona_id}/roles")
    assert lectura.json()["roles"] == [TipoRol.ADMINISTRADOR.value]


# --- 3b. Inscripción pública ------------------------------------------------
# --- 3c. Inscripción pública ------------------------------------------------

def _ficha_dto() -> EnrollmentFichaMedicaMenorDTO:
    # Issue #1138: camino representado -- sin contacto de emergencia propio.
    return EnrollmentFichaMedicaMenorDTO(tipo_sangre="O_POSITIVO", enfermedades=[])


def _ficha_dto_adulto() -> EnrollmentFichaMedicaDTO:
    # Camino adulto: sigue exigiendo contacto de emergencia propio.
    return EnrollmentFichaMedicaDTO(
        tipo_sangre="O_POSITIVO", enfermedades=[],
        contacto_emergencia="María Torres", telefono_emergencia="0991112233",
    )


def test_inscripcion_de_menor_deja_un_solo_rol_en_la_cuenta_del_representante(db_session):
    """El flujo de inscripción con representante creaba la cuenta del
    representante con REPRESENTANTE + ALUMNO en dos llamadas seguidas (issue
    #762). El menor mismo ya no tiene cuenta propia (issue #1137,
    invariante B)."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(720),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia762@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(721),
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
        ),
        ficha_medica=_ficha_dto(),
        acepta_consentimientos=True,
    )

    EnrollmentServicio(db_session).enroll(datos)
    db_session.rollback()

    representante = db_session.query(Usuario).filter(
        Usuario.correo == "sofia762@example.com"
    ).one()
    menor = db_session.query(Persona).filter(Persona.cedula == cedula_valida(721)).one()
    assert _tipos(representante) == {TipoRol.REPRESENTANTE}
    assert db_session.query(Usuario).filter(Usuario.persona_id == menor.id).count() == 0


def test_autoinscripcion_de_adulto_deja_un_solo_rol(db_session):
    datos = EnrollmentCreateDTO(
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(722),
            fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
        ),
        credenciales_alumno=EnrollmentCredencialesDTO(
            correo="adulto762@example.com", contrasenia="password8",
        ),
        ficha_medica=_ficha_dto_adulto(),
        acepta_consentimientos=True,
    )

    EnrollmentServicio(db_session).enroll(datos)
    db_session.rollback()

    usuario = db_session.query(Usuario).filter(
        Usuario.correo == "adulto762@example.com"
    ).one()
    assert _tipos(usuario) == {TipoRol.ALUMNO}


# --- 3d. Flujo de membresía -------------------------------------------------

def _crear_tipo_membresia(db_session) -> TipoMembresia:
    tipo = TipoMembresia(
        categoria="Formativo", precio=Decimal("30.00"),
        modalidad=TipoModalidad.MENSUAL,
    )
    db_session.add(tipo)
    db_session.commit()
    db_session.refresh(tipo)
    return tipo


def test_la_membresia_ya_no_asigna_ningun_rol_a_una_cuenta_sin_rol(db_session):
    """Ancla del camino feliz, actualizada por el issue #1132: "ser jugador"
    se deriva de la membresía ACTIVA, no de un rol -- matricularse ya no
    otorga ALUMNO, ni a una cuenta sin rol ni a ninguna otra."""
    usuario = _crear_cuenta_con_rol(db_session, None, semilla=730)
    tipo = _crear_tipo_membresia(db_session)

    MembresiaServicio(db_session).crear_membresia(MembresiaCreateDTO(
        persona_id=usuario.persona_id, tipo_membresia_id=tipo.id,
    ))

    db_session.refresh(usuario)
    assert _tipos(usuario) == set()


@pytest.mark.parametrize("rol_existente", [
    TipoRol.ADMINISTRADOR, TipoRol.ENTRENADOR, TipoRol.REPRESENTANTE,
])
def test_la_membresia_no_toca_ningun_rol_existente(db_session, rol_existente):
    """Issue #1132: `crear_membresia` ya no lee ni muta roles -- un
    representante que paga una membresía para sí mismo conserva EXACTAMENTE
    su rol técnico (issue #762), sin que el trigger `e762rolunico` tenga
    nada que rechazar."""
    usuario = _crear_cuenta_con_rol(db_session, rol_existente, semilla=731)
    tipo = _crear_tipo_membresia(db_session)

    MembresiaServicio(db_session).crear_membresia(MembresiaCreateDTO(
        persona_id=usuario.persona_id, tipo_membresia_id=tipo.id,
    ))

    db_session.refresh(usuario)
    assert _tipos(usuario) == {rol_existente}
