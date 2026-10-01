"""Fábricas para las pruebas de "Actividad del club" (issue #1314)."""
from datetime import date, datetime, timezone

from sqlalchemy import select

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.modelos import ActividadUsuario, Persona, Rol, Usuario

# 2026-10-01 15:30 hora del club (UTC-5): el "ahora" del demo aprobado.
AHORA = datetime(2026, 10, 1, 20, 30, 0, tzinfo=timezone.utc)

_contador = {"n": 5000}


def rol(db, tipo: TipoRol) -> Rol:
    existente = db.scalars(select(Rol).where(Rol.tipo_rol == tipo)).first()
    if existente:
        return existente
    nuevo = Rol(tipo_rol=tipo, descripcion=tipo.value.title())
    db.add(nuevo)
    db.flush()
    return nuevo


def persona(db, *, fecha_registro: datetime = datetime(2020, 1, 1, tzinfo=timezone.utc)) -> Persona:
    _contador["n"] += 1
    p = Persona(
        nombres="Ana", apellidos=f"Prueba{_contador['n']}", cedula=cedula_valida(_contador["n"]),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567", fecha_registro=fecha_registro,
    )
    db.add(p)
    db.flush()
    return p


def usuario(db, *roles: TipoRol) -> Usuario:
    p = persona(db)
    u = Usuario(
        correo=f"u{p.id}@secreto.test", contrasenia="hash", persona_id=p.id,
        roles=[rol(db, r) for r in roles],
    )
    db.add(u)
    db.flush()
    return u


def actividad(db, u: Usuario, fecha: date, franja: int) -> None:
    db.add(ActividadUsuario(usuario_id=u.id, fecha=fecha, franja=franja))
    db.flush()
