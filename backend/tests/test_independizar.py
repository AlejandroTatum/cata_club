"""
Tests del Flujo 4: Independización de un ex-menor de su representante legal.

Cubre:
  - Happy path: persona mayor de edad con representante se independiza.
  - Asignación del rol REPRESENTANTE post-independización.
  - Preservación de datos (ficha médica, antecedentes, etc.).
  - Validación: persona sin representante_id.
  - Validación: persona menor de edad (< 18).
  - Validación: contraseña incorrecta.
  - Validación: deudas pendientes (membresía INACTIVA sin pago aprobado).
  - Validación: deudas pendientes (pago PENDIENTE_VALIDACION).
  - Acceso: solo propietario o ADMINISTRADOR.
  - Endpoint: respuesta HTTP correcta.
"""
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest

from app.dominio.enums import (
    TipoRol, EstadoMembresia, EstadoPago, TipoPago, TipoModalidad,
)
from app.dominio.modelos import Persona, Usuario, Rol, Membresia, Pago, TipoMembresia
from app.presentacion.schemas.persona_schemas import IndependizarDTO
from app.servicios_negocio.persona_servicio import PersonaServicio
from app.infraestructura.repositorios.usuario_ficha_repositorio import UsuarioRepositorio
from app.seguridad.gestor_auth import GestorAutenticacion


# --- helpers ----------------------------------------------------------------

def _crear_persona_adulta(db_session, *, cedula: str = "1712345678",
                           representante_id: int | None = None) -> Persona:
    """Crea una Persona adulta (> 18) con fecha de nacimiento fija."""
    p = Persona(
        nombres="Carlos", apellidos="Ruiz",
        cedula=cedula,
        fecha_nacimiento=date(2005, 6, 15),  # ~23 años (congelado a 2029-01-01)
        telefono="0991234567",
        representante_id=representante_id,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


def _crear_usuario(db_session, persona: Persona, *, correo: str = "carlos@test.com",
                    contrasenia: str = "clave12345") -> Usuario:
    """Crea un Usuario + rol ALUMNO para la persona dada."""
    hash_pw = GestorAutenticacion.obtener_hash_contrasenia(contrasenia)
    rol_alumno = db_session.query(Rol).filter_by(tipo_rol=TipoRol.ALUMNO).first()
    if not rol_alumno:
        rol_alumno = Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")
        db_session.add(rol_alumno)
        db_session.flush()
    usuario = Usuario(
        correo=correo,
        contrasenia=hash_pw,
        persona_id=persona.id,
        roles=[rol_alumno],
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _crear_representante(db_session, *, cedula: str = "1790012345") -> Persona:
    """Crea un representante adulto (>= 18)."""
    rep = Persona(
        nombres="María", apellidos="López",
        cedula=cedula,
        fecha_nacimiento=date(1985, 3, 20),
        telefono="0998765432",
    )
    db_session.add(rep)
    db_session.commit()
    db_session.refresh(rep)
    return rep


def _crear_tipo_membresia(db_session) -> TipoMembresia:
    tm = TipoMembresia(
        categoria="Formativo",
        franja_horaria="06:00-08:00",
        precio=Decimal("50.00"),
        modalidad=TipoModalidad.MENSUAL,
    )
    db_session.add(tm)
    db_session.commit()
    db_session.refresh(tm)
    return tm


def _crear_membresia(db_session, persona: Persona, *,
                     estado: EstadoMembresia = EstadoMembresia.INACTIVA) -> Membresia:
    tm = _crear_tipo_membresia(db_session)
    m = Membresia(
        estado=estado,
        monto_aplicado=Decimal("50.00"),
        fecha_activacion=datetime.now(timezone.utc),
        es_gratuidad_familiar=False,
        persona_id=persona.id,
        tipo_membresia_id=tm.id,
    )
    db_session.add(m)
    db_session.commit()
    db_session.refresh(m)
    return m


def _crear_pago(db_session, membresia: Membresia, persona: Persona, *,
                estado_pago: EstadoPago = EstadoPago.APROBADO) -> Pago:
    p = Pago(
        monto=Decimal("50.00"),
        estado_pago=estado_pago,
        tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(2029, 1, 1),
        fecha_fin=date(2029, 12, 31),
        persona_id=persona.id,
        membresia_id=membresia.id,
    )
    db_session.add(p)
    db_session.commit()
    db_session.refresh(p)
    return p


# --- Happy path -------------------------------------------------------------

def test_independizar_happy_path(db_session):
    """Un adulto con representante se independiza exitosamente."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    servicio = PersonaServicio(db_session)
    resultado = servicio.independizar(persona.id, IndependizarDTO(contrasenia="clave12345"))

    assert resultado.representante_id is None


def test_independizar_asigna_rol_representante(db_session):
    """Post-independización, la persona recibe el rol REPRESENTANTE."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    PersonaServicio(db_session).independizar(
        persona.id, IndependizarDTO(contrasenia="clave12345")
    )

    usuario = UsuarioRepositorio(db_session).obtener_por_persona_id(persona.id)
    roles = {r.tipo_rol for r in usuario.roles}
    assert TipoRol.REPRESENTANTE in roles


def test_independizar_preserva_datos(db_session):
    """La independización preserva la ficha médica y otros datos."""
    from app.dominio.modelos import FichaMedica
    from app.dominio.enums import TipoSangre

    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    # Crear ficha médica
    ficha = FichaMedica(
        tipo_sangre=TipoSangre.O_POSITIVO,
        persona_id=persona.id,
        alergias="Polen",
    )
    db_session.add(ficha)
    db_session.commit()

    PersonaServicio(db_session).independizar(
        persona.id, IndependizarDTO(contrasenia="clave12345")
    )

    persona_refrescada = db_session.get(Persona, persona.id)
    assert persona_refrescada.ficha_medica is not None
    assert persona_refrescada.ficha_medica.tipo_sangre.value == "O_POSITIVO"


def test_independizar_sin_deudas_pendientes(db_session):
    """Una membresía INACTIVA con pago APROBADO no bloquea la independización."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    membresia = _crear_membresia(db_session, persona)
    _crear_pago(db_session, membresia, persona, estado_pago=EstadoPago.APROBADO)

    resultado = PersonaServicio(db_session).independizar(
        persona.id, IndependizarDTO(contrasenia="clave12345")
    )
    assert resultado.representante_id is None


# --- Validación: sin representante ------------------------------------------

def test_independizar_sin_representante_rechazado(db_session):
    """Una persona sin representante_id no puede independizarse."""
    persona = _crear_persona_adulta(db_session)
    _crear_usuario(db_session, persona)

    with pytest.raises(Exception, match="representante"):
        PersonaServicio(db_session).independizar(
            persona.id, IndependizarDTO(contrasenia="clave12345")
        )


# --- Validación: menor de edad ---------------------------------------------

def test_independizar_menor_de_edad_rechazado(db_session):
    """Una persona menor de edad no puede independizarse."""
    rep = _crear_representante(db_session)
    menor = Persona(
        nombres="Lucía", apellidos="Pérez",
        cedula="1712345679",
        fecha_nacimiento=date(2015, 6, 15),  # menor de 18 (congelado a 2029-01-01 = 13 años)
        telefono="0991234567",
        representante_id=rep.id,
    )
    db_session.add(menor)
    db_session.commit()
    db_session.refresh(menor)
    _crear_usuario(db_session, menor, correo="lucia@test.com")

    with pytest.raises(Exception, match="mayor de edad"):
        PersonaServicio(db_session).independizar(
            menor.id, IndependizarDTO(contrasenia="clave12345")
        )


# --- Validación: contraseña incorrecta -------------------------------------

def test_independizar_contrasena_incorrecta_rechazado(db_session):
    """Contraseña incorrecta rechaza la independización."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    with pytest.raises(Exception, match="contraseña"):
        PersonaServicio(db_session).independizar(
            persona.id, IndependizarDTO(contrasenia="incorrecta123")
        )


# --- Validación: deudas pendientes -----------------------------------------

def test_independizar_membresia_inactiva_sin_pago_bloqueado(db_session):
    """Una membresía INACTIVA sin pago APROBADO bloquea la independización."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    _crear_membresia(db_session, persona)

    with pytest.raises(Exception, match="pendientes"):
        PersonaServicio(db_session).independizar(
            persona.id, IndependizarDTO(contrasenia="clave12345")
        )


def test_independizar_pago_pendiente_validacion_bloqueado(db_session):
    """Un pago PENDIENTE_VALIDACION bloquea la independización."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    membresia = _crear_membresia(db_session, persona)
    _crear_pago(db_session, membresia, persona, estado_pago=EstadoPago.PENDIENTE_VALIDACION)

    with pytest.raises(Exception, match="pendientes"):
        PersonaServicio(db_session).independizar(
            persona.id, IndependizarDTO(contrasenia="clave12345")
        )


def test_independizar_membresia_activa_no_bloquea(db_session):
    """Una membresía ACTIVA con pago aprobado NO bloquea la independización."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    membresia = _crear_membresia(db_session, persona, estado=EstadoMembresia.ACTIVA)
    _crear_pago(db_session, membresia, persona, estado_pago=EstadoPago.APROBADO)

    resultado = PersonaServicio(db_session).independizar(
        persona.id, IndependizarDTO(contrasenia="clave12345")
    )
    assert resultado.representante_id is None


# --- Acceso: solo propietario o admin -------------------------------------

def test_independizar_endpoint_propietario_accede(client, db_session):
    """El propietario puede independizarse vía endpoint."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    # Override token para que persona_id coincida
    from main import app
    from app.seguridad.gestor_auth import GestorAutenticacion as GA

    def _override_token():
        return {"sub": "carlos@test.com", "persona_id": persona.id, "roles": ["ALUMNO"]}

    app.dependency_overrides[GA.decodificar_token] = _override_token
    try:
        resp = client.post(
            f"/api/v1/personas/{persona.id}/independizar",
            json={"contrasenia": "clave12345"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "id" in body
        assert body.get("representante_id") is None
    finally:
        app.dependency_overrides.pop(GA.decodificar_token, None)


def test_independizar_endpoint_no_propietario_rechazado(client_sin_permisos, db_session):
    """Un usuario que no es propietario ni admin recibe 403."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    resp = client_sin_permisos.post(
        f"/api/v1/personas/{persona.id}/independizar",
        json={"contrasenia": "clave12345"},
    )
    assert resp.status_code == 403


# --- Endpoint: validaciones HTTP -------------------------------------------

def test_independizar_endpoint_contrasena_invalida(client, db_session):
    """Contraseña inválida retorna 400 vía endpoint."""
    rep = _crear_representante(db_session)
    persona = _crear_persona_adulta(db_session, representante_id=rep.id)
    _crear_usuario(db_session, persona)

    resp = client.post(
        f"/api/v1/personas/{persona.id}/independizar",
        json={"contrasenia": "incorrecta123"},
    )
    assert resp.status_code == 400


def test_independizar_endpoint_sin_representante(client, db_session):
    """Sin representante retorna 400 vía endpoint."""
    persona = _crear_persona_adulta(db_session)
    _crear_usuario(db_session, persona)

    resp = client.post(
        f"/api/v1/personas/{persona.id}/independizar",
        json={"contrasenia": "clave12345"},
    )
    assert resp.status_code == 400
    assert "representante" in resp.json()["detail"].lower()


def test_independizar_endpoint_menor_de_edad(client, db_session):
    """Menor de edad retorna 400 vía endpoint."""
    rep = _crear_representante(db_session)
    menor = Persona(
        nombres="Lucía", apellidos="Pérez",
        cedula="1712345680",
        fecha_nacimiento=date(2015, 6, 15),
        telefono="0991234567",
        representante_id=rep.id,
    )
    db_session.add(menor)
    db_session.commit()
    db_session.refresh(menor)
    _crear_usuario(db_session, menor, correo="lucia@test.com")

    resp = client.post(
        f"/api/v1/personas/{menor.id}/independizar",
        json={"contrasenia": "clave12345"},
    )
    assert resp.status_code == 400
    assert "mayor de edad" in resp.json()["detail"].lower()


# --- Pydantic: validación del DTO -----------------------------------------

def test_independizar_dto_contrasena_corta_rechazada():
    """Pydantic rechaza contraseñas menores a 8 caracteres."""
    with pytest.raises(Exception):
        IndependizarDTO(contrasenia="corta")
