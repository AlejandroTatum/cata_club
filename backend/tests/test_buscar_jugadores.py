"""#1669 / #1661: `GET /personas/buscar?jugador=true` ofrece a los JUGADORES.

Jugador = rol ALUMNO o membresía que habilita entrenar (ACTIVA/VENCIDA), la
misma regla que `MembresiaRepositorio.puede_entrenar`. Un menor representado
no tiene `Usuario`, así que el filtro por rol (`rol=ALUMNO`) lo deja afuera;
el staff y los representantes sin membresía tampoco son jugadores.
"""
from datetime import date, datetime, timezone
from decimal import Decimal
from itertools import count

from app.dominio.enums import EstadoMembresia, TipoModalidad, TipoRol
from app.dominio.modelos import Membresia, Persona, Rol, TipoMembresia, Usuario

_cedulas = count(1)


def _persona(db, nombres: str, fecha=date(1990, 1, 1)) -> Persona:
    from app.dominio.cedula import cedula_valida

    persona = Persona(
        nombres=nombres, apellidos="Jugadortest", cedula=cedula_valida(7700 + next(_cedulas)),
        fecha_nacimiento=fecha, telefono="0991234567",
    )
    db.add(persona)
    db.commit()
    return persona


def _con_roles(db, persona: Persona, *tipos: TipoRol) -> None:
    roles = []
    for tipo in tipos:
        rol = db.query(Rol).filter(Rol.tipo_rol == tipo).first() or Rol(
            tipo_rol=tipo, descripcion=tipo.value
        )
        roles.append(rol)
    db.add(Usuario(
        correo=f"u{persona.cedula}@cataclub.test", contrasenia="x",
        persona_id=persona.id, roles=roles,
    ))
    db.commit()


def _membresia(db, persona: Persona, estado: EstadoMembresia) -> None:
    tipo = db.query(TipoMembresia).first()
    if tipo is None:
        tipo = TipoMembresia(
            categoria="Mensual", precio=Decimal("25.00"), modalidad=TipoModalidad.MENSUAL
        )
        db.add(tipo)
        db.flush()
    db.add(Membresia(
        estado=estado, monto_aplicado=Decimal("25.00"),
        fecha_activacion=datetime.now(timezone.utc),
        persona_id=persona.id, tipo_membresia_id=tipo.id,
    ))
    db.commit()


def _buscar(client, **params) -> set[int]:
    respuesta = client.get("/api/v1/personas/buscar", params={"q": "Jugadortest", **params})
    assert respuesta.status_code == 200
    return {p["id"] for p in respuesta.json()}


def test_jugador_incluye_menor_representado_sin_usuario_con_membresia_activa(client, db_session):
    menor = _persona(db_session, "Matias", date(2016, 1, 1))
    _membresia(db_session, menor, EstadoMembresia.ACTIVA)

    assert menor.id in _buscar(client, jugador="true")
    # `rol=ALUMNO` sigue exigiendo cuenta: los llamadores existentes no cambian.
    assert menor.id not in _buscar(client, rol="ALUMNO")


def test_jugador_incluye_alumno_y_membresia_vencida_y_excluye_el_resto(client, db_session):
    alumno = _persona(db_session, "Alumno")
    _con_roles(db_session, alumno, TipoRol.ALUMNO)
    vencido = _persona(db_session, "Vencido", date(2015, 1, 1))
    _membresia(db_session, vencido, EstadoMembresia.VENCIDA)
    suspendido = _persona(db_session, "Suspendido", date(2015, 1, 1))
    _membresia(db_session, suspendido, EstadoMembresia.SUSPENDIDA)
    admin = _persona(db_session, "Admin")
    _con_roles(db_session, admin, TipoRol.ADMINISTRADOR)
    representante = _persona(db_session, "Representante")
    _con_roles(db_session, representante, TipoRol.REPRESENTANTE)

    ids = _buscar(client, jugador="true")

    assert {alumno.id, vencido.id} <= ids
    assert not ids & {suspendido.id, admin.id, representante.id}


def test_jugador_incluye_staff_que_tambien_juega(client, db_session):
    # Una cuenta tiene un solo rol (#762): el staff que juega lo hace con membresía.
    mixto = _persona(db_session, "Mixto")
    _con_roles(db_session, mixto, TipoRol.ENTRENADOR)
    _membresia(db_session, mixto, EstadoMembresia.ACTIVA)

    assert mixto.id in _buscar(client, jugador="true")


def test_sin_filtro_jugador_la_busqueda_sigue_devolviendo_a_todos(client, db_session):
    admin = _persona(db_session, "Admin")
    _con_roles(db_session, admin, TipoRol.ADMINISTRADOR)

    assert admin.id in _buscar(client)
