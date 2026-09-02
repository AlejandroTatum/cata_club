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
  3. Los cuatro caminos de alta que el issue nombra -- endpoint admin,
     alta administrativa de cuentas, inscripción pública y membresía --
     cierran contra la misma regla. Antes cada uno tenía su propio
     `_asignar_rol` que solo miraba duplicados del mismo rol, así que dos
     flujos independientes podían acumular roles distintos sin que ninguno
     de los dos viera al otro.

La invariante de base de datos (trigger) y la migración se prueban aparte,
en `test_migracion_rol_unico.py`: acá la sesión vive dentro de la
transacción externa del test y no puede ejercitar concurrencia real.
"""
from datetime import date
from decimal import Decimal

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoMembresia, TipoModalidad, TipoRol
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Membresia, Persona, Rol, TipoMembresia, Usuario
from app.servicios_negocio.dtos.admin_cuenta_schemas import AdminCrearCuentaDTO
from app.servicios_negocio.dtos.enrollment_schemas import (
    EnrollmentAlumnoDTO,
    EnrollmentCreateDTO,
    EnrollmentCredencialesDTO,
    EnrollmentFichaMedicaDTO,
    EnrollmentRepresentanteDTO,
)
from app.servicios_negocio.dtos.membresia_pago_schemas import MembresiaCreateDTO
from app.servicios_negocio.admin_cuenta_servicio import AdminCuentaServicio
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


# --- 3b. Alta administrativa de cuentas ------------------------------------

def _payload_admin(**overrides) -> dict:
    datos = {
        "tipo_cuenta": "JUGADOR",
        "nombres": "Carlos",
        "apellidos": "Ruiz",
        "cedula": cedula_valida(710),
        "fecha_nacimiento": "1995-06-15",
        "telefono": "0991234567",
        "correo": "carlos762@test.com",
        "contrasenia": "clave12345",
        "ficha_medica": {
            "tipo_sangre": "O_POSITIVO",
            "enfermedades": [],
            "contacto_emergencia": "María Torres",
            "telefono_emergencia": "0991112233",
        },
    }
    datos.update(overrides)
    return datos


@pytest.mark.parametrize("tipo_cuenta,rol_esperado", [
    ("JUGADOR", TipoRol.ALUMNO),
    ("REPRESENTANTE", TipoRol.REPRESENTANTE),
    ("ENTRENADOR", TipoRol.ENTRENADOR),
])
def test_alta_admin_deja_exactamente_un_rol(db_session, tipo_cuenta, rol_esperado):
    """`REPRESENTANTE` es el caso que cambia: `ROLES_POR_TIPO_CUENTA` le
    otorgaba REPRESENTANTE **y** ALUMNO, o sea que el alta administrativa
    fabricaba una cuenta multirol de fábrica."""
    datos = AdminCrearCuentaDTO(**_payload_admin(
        tipo_cuenta=tipo_cuenta, correo=f"{tipo_cuenta.lower()}762@test.com",
    ))

    AdminCuentaServicio(db_session).crear_cuenta(datos)

    usuario = db_session.query(Usuario).filter(
        Usuario.correo == f"{tipo_cuenta.lower()}762@test.com"
    ).one()
    assert _tipos(usuario) == {rol_esperado}


# --- 3c. Inscripción pública ------------------------------------------------

def _ficha_dto() -> EnrollmentFichaMedicaDTO:
    return EnrollmentFichaMedicaDTO(
        tipo_sangre="O_POSITIVO", enfermedades=[],
        contacto_emergencia="María Torres", telefono_emergencia="0991112233",
    )


def test_inscripcion_de_menor_deja_un_solo_rol_en_cada_cuenta(db_session):
    """El flujo de inscripción con representante creaba la cuenta del
    representante con REPRESENTANTE + ALUMNO en dos llamadas seguidas."""
    datos = EnrollmentCreateDTO(
        representante=EnrollmentRepresentanteDTO(
            nombres="Sofia", apellidos="Martinez", cedula=cedula_valida(720),
            fecha_nacimiento=date(1990, 5, 20), telefono="0991234567",
            correo="sofia762@example.com", contrasenia="password8",
        ),
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(721),
            fecha_nacimiento=date(2015, 6, 15), telefono="0991234567",
            correo="lucas762@example.com", contrasenia="password8",
        ),
        ficha_medica=_ficha_dto(),
        acepta_consentimientos=True,
    )

    EnrollmentServicio(db_session).enroll(datos)
    db_session.rollback()

    representante = db_session.query(Usuario).filter(
        Usuario.correo == "sofia762@example.com"
    ).one()
    menor = db_session.query(Usuario).filter(
        Usuario.correo == "lucas762@example.com"
    ).one()
    assert _tipos(representante) == {TipoRol.REPRESENTANTE}
    assert _tipos(menor) == {TipoRol.ALUMNO}


def test_autoinscripcion_de_adulto_deja_un_solo_rol(db_session):
    datos = EnrollmentCreateDTO(
        alumno=EnrollmentAlumnoDTO(
            nombres="Lucas", apellidos="Martinez", cedula=cedula_valida(722),
            fecha_nacimiento=date(2000, 1, 1), telefono="0991234567",
        ),
        credenciales_alumno=EnrollmentCredencialesDTO(
            correo="adulto762@example.com", contrasenia="password8",
        ),
        ficha_medica=_ficha_dto(),
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


def test_la_membresia_asigna_alumno_a_una_cuenta_sin_rol(db_session):
    """Ancla del camino feliz: la asignación perezosa sigue funcionando."""
    usuario = _crear_cuenta_con_rol(db_session, None, semilla=730)
    tipo = _crear_tipo_membresia(db_session)

    MembresiaServicio(db_session).crear_membresia(MembresiaCreateDTO(
        persona_id=usuario.persona_id, tipo_membresia_id=tipo.id,
    ))

    db_session.refresh(usuario)
    assert _tipos(usuario) == {TipoRol.ALUMNO}


@pytest.mark.parametrize("rol_existente", [
    TipoRol.ADMINISTRADOR, TipoRol.ENTRENADOR, TipoRol.REPRESENTANTE,
])
def test_la_membresia_no_agrega_alumno_sobre_otro_rol(db_session, rol_existente):
    """El camino más silencioso de todos: `asignar_alumno_si_corresponde` es
    "mejor esfuerzo" y agregaba ALUMNO sin mirar qué rol había."""
    usuario = _crear_cuenta_con_rol(db_session, rol_existente, semilla=731)
    tipo = _crear_tipo_membresia(db_session)

    with pytest.raises(OperacionInvalida) as error:
        MembresiaServicio(db_session).crear_membresia(MembresiaCreateDTO(
            persona_id=usuario.persona_id, tipo_membresia_id=tipo.id,
        ))

    assert "un solo rol" in str(error.value).lower()
    db_session.rollback()
    db_session.refresh(usuario)
    assert _tipos(usuario) == {rol_existente}


def test_la_membresia_rechazada_por_rol_no_deja_una_membresia_colgada(db_session):
    """El rechazo llega ANTES de escribir la membresía: si llegara después,
    la persona quedaría matriculada y el request devolvería un error."""
    usuario = _crear_cuenta_con_rol(db_session, TipoRol.ENTRENADOR, semilla=732)
    tipo = _crear_tipo_membresia(db_session)

    with pytest.raises(OperacionInvalida):
        MembresiaServicio(db_session).crear_membresia(MembresiaCreateDTO(
            persona_id=usuario.persona_id, tipo_membresia_id=tipo.id,
        ))

    db_session.rollback()
    assert db_session.query(Membresia).filter(
        Membresia.persona_id == usuario.persona_id
    ).count() == 0
    assert db_session.query(Membresia).filter(
        Membresia.estado == EstadoMembresia.INACTIVA
    ).count() == 0
