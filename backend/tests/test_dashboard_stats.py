"""GET /dashboard/stats — conteo "sin membresía" y denominador del Panel.

Candados del fix del Panel de Control (issue de conteos):

- `personas_sin_membresia` debe contar alumnos SIN membresía ACTIVA ("por
  regularizar"), no personas sin ninguna membresía histórica. Un alumno con
  membresía VENCIDA era invisible en la tarjeta aunque debe regularizarse.
- `total_personas` sigue contando a TODAS las personas registradas (alimenta
  la tarjeta "Miembros"); el denominador de "MEMBRESÍAS ACTIVAS · X de Y" es
  un campo nuevo, `total_alumnos`: la misma población que el numerador. El
  administrador y el entrenador nunca pueden tener membresía.

Alumno = tiene `Usuario` con rol ALUMNO, o no tiene `Usuario` (un menor
representado sin credenciales no recibe Usuario — ver
`PersonaServicio.crear_representado` — pero entrena y paga membresía).
"""
from datetime import date, datetime, timezone
from decimal import Decimal

from app.dominio.enums import EstadoMembresia, TipoModalidad, TipoRol
from app.dominio.modelos import Membresia, Persona, Rol, TipoMembresia, Usuario


def _crear_alumno(db, cedula: str, correo: str) -> Persona:
    persona = Persona(
        nombres="Alumno", apellidos=f"Test{cedula[-3:]}", cedula=cedula,
        fecha_nacimiento=date(2000, 1, 1), telefono="0999999999",
    )
    db.add(persona)
    db.flush()
    usuario = Usuario(correo=correo, contrasenia="hash", persona_id=persona.id)
    usuario.roles.append(_obtener_o_crear_rol(db, TipoRol.ALUMNO))
    db.add(usuario)
    db.flush()
    return persona


def _crear_persona_con_rol(db, cedula: str, correo: str, tipo_rol: TipoRol) -> Persona:
    persona = Persona(
        nombres="Staff", apellidos=f"Test{cedula[-3:]}", cedula=cedula,
        fecha_nacimiento=date(1980, 1, 1), telefono="0988888888",
    )
    db.add(persona)
    db.flush()
    usuario = Usuario(correo=correo, contrasenia="hash", persona_id=persona.id)
    usuario.roles.append(_obtener_o_crear_rol(db, tipo_rol))
    db.add(usuario)
    db.flush()
    return persona


def _crear_alumno_sin_usuario(db, cedula: str) -> Persona:
    """Menor representado sin credenciales: Persona SIN Usuario (camino real
    de `PersonaServicio.crear_representado` cuando no llegan correo ni
    contraseña). Entrena y paga membresía igual."""
    persona = Persona(
        nombres="Menor", apellidos=f"Test{cedula[-3:]}", cedula=cedula,
        fecha_nacimiento=date(2015, 1, 1), telefono="0977777777",
    )
    db.add(persona)
    db.flush()
    return persona


def _obtener_o_crear_rol(db, tipo_rol: TipoRol) -> Rol:
    rol = db.query(Rol).filter(Rol.tipo_rol == tipo_rol).one_or_none()
    if rol is None:
        rol = Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value.title())
        db.add(rol)
        db.flush()
    return rol


def _crear_membresia(db, persona: Persona, estado: EstadoMembresia) -> Membresia:
    tipo = TipoMembresia(
        categoria=f"Dash {persona.cedula}",
        precio=Decimal("35.00"), modalidad=TipoModalidad.MENSUAL,
    )
    db.add(tipo)
    db.flush()
    membresia = Membresia(
        estado=estado, monto_aplicado=Decimal("35.00"),
        fecha_activacion=datetime(2026, 1, 1, tzinfo=timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    )
    db.add(membresia)
    db.flush()
    return membresia


def _stats(client) -> dict:
    respuesta = client.get("/api/v1/dashboard/stats")
    assert respuesta.status_code == 200
    return respuesta.json()


def test_alumno_con_membresia_vencida_cuenta_como_por_regularizar(client, db_session):
    """Candado del bug: un alumno con membresía VENCIDA tiene membresía
    histórica pero NO activa — debe aparecer en "por regularizar"."""
    alumno = _crear_alumno(db_session, "1750000001", "vencido@cataclub.test")
    _crear_membresia(db_session, alumno, EstadoMembresia.VENCIDA)

    assert _stats(client)["personasSinMembresia"] == 1


def test_alumno_con_membresia_inactiva_cuenta_como_por_regularizar(client, db_session):
    alumno = _crear_alumno(db_session, "1750000002", "inactivo@cataclub.test")
    _crear_membresia(db_session, alumno, EstadoMembresia.INACTIVA)

    assert _stats(client)["personasSinMembresia"] == 1


def test_alumno_con_membresia_activa_no_cuenta_como_por_regularizar(client, db_session):
    alumno = _crear_alumno(db_session, "1750000003", "activo@cataclub.test")
    _crear_membresia(db_session, alumno, EstadoMembresia.ACTIVA)

    assert _stats(client)["personasSinMembresia"] == 0


def test_alumno_sin_ninguna_membresia_sigue_contando(client, db_session):
    _crear_alumno(db_session, "1750000004", "nuevo@cataclub.test")

    assert _stats(client)["personasSinMembresia"] == 1


def test_menor_sin_usuario_con_membresia_vencida_cuenta_como_por_regularizar(
    client, db_session
):
    """Candado del blocker de la review: un menor representado sin Usuario
    puede tener membresía; con la VENCIDA debe contar como "por regularizar"
    y pertenecer a la población de alumnos."""
    menor = _crear_alumno_sin_usuario(db_session, "1750000011")
    _crear_membresia(db_session, menor, EstadoMembresia.VENCIDA)

    stats = _stats(client)
    assert stats["personasSinMembresia"] == 1
    assert stats["totalAlumnos"] == 1


def test_staff_sin_membresia_no_cuenta_como_por_regularizar(client, db_session):
    """El administrador y el entrenador nunca tienen membresía: no son
    "por regularizar" aunque no tengan ninguna."""
    _crear_persona_con_rol(
        db_session, "1750000005", "admin.dash@cataclub.test", TipoRol.ADMINISTRADOR
    )
    _crear_persona_con_rol(
        db_session, "1750000006", "coach.dash@cataclub.test", TipoRol.ENTRENADOR
    )

    assert _stats(client)["personasSinMembresia"] == 0


def test_total_alumnos_es_el_denominador_y_total_personas_cuenta_a_todos(
    client, db_session
):
    """`total_alumnos` (denominador de "MEMBRESÍAS ACTIVAS · X de Y") cuenta
    solo alumnos; `total_personas` (tarjeta "Miembros") cuenta a todas las
    personas registradas, administrador y entrenador incluidos."""
    alumno = _crear_alumno(db_session, "1750000007", "denom1@cataclub.test")
    _crear_alumno(db_session, "1750000008", "denom2@cataclub.test")
    _crear_persona_con_rol(
        db_session, "1750000009", "admin.denom@cataclub.test", TipoRol.ADMINISTRADOR
    )
    _crear_persona_con_rol(
        db_session, "1750000010", "coach.denom@cataclub.test", TipoRol.ENTRENADOR
    )
    _crear_membresia(db_session, alumno, EstadoMembresia.ACTIVA)

    stats = _stats(client)
    assert stats["totalPersonas"] == 4
    assert stats["totalAlumnos"] == 2
    assert stats["activeMemberships"] == 1
