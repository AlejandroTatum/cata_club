"""Aviso in-app a los administradores en cada activación de cobertura
bonificada 100% (issue #1369, slice 2).

Contexto: desde el #400/4d, `aplicar_beneficio_bonificado` avisa al titular
(`COBERTURA_BONIFICADA_OTORGADA`), pero un administrador que no es el titular
ni su representante se entera sólo si abre la membresía a mano. Este slice
agrega `TipoNotificacion.COBERTURA_BONIFICADA_ADMIN`: un aviso por
administrador con cuenta ACTIVA, creado DESPUÉS del commit de la cobertura con
try/except + rollback (mismo criterio que `_crear_notificacion`: un aviso
fallido nunca convierte en 5xx una activación que sí se procesó).

Reglas bajo prueba:
- Un aviso `COBERTURA_BONIFICADA_ADMIN` por admin activo, con
  `entidad_relacionada_id = cobertura.id` (la activación es la entidad).
- El titular sigue recibiendo SU aviso (`COBERTURA_BONIFICADA_OTORGADA`).
- Si el titular ES a la vez administrador, no recibe dos filas por la misma
  cobertura: su aviso de titular ya le avisó.
- Cualquier fallo del bloque de avisos a admins no rompe la activación.

El label nuevo en PostgreSQL lo respalda la migración hermana de
`798bfa9ae35e` (patrón `ALTER TYPE ... ADD VALUE IF NOT EXISTS`); el puente
Python↔Postgres lo vigila `test_drift_enums_postgres.py`.
"""
from datetime import date

import pytest
from sqlalchemy.orm import Session

import app.infraestructura.repositorios.rol_repositorio as rol_repo_mod
from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoNotificacion, TipoRol
from app.dominio.modelos import Notificacion, Persona, Rol, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from tests.fabricas_pagos import (
    asignar_beneficio_api, crear_membresia_api, crear_persona_api,
    crear_tipo_membresia_api,
)
from decimal import Decimal

RUTA_APLICAR = "/api/v1/membresias/{membresia_id}/aplicar-beneficio"


# --- Helpers locales ----------------------------------------------------------

def _autenticar_como(persona_id, roles):
    """Sobrescribe el token del cliente de test (mismo truco que
    `test_cobertura_bonificada.py`)."""
    from main import app
    app.dependency_overrides[GestorAutenticacion.decodificar_token] = lambda: {
        "sub": "sesion@cataclub.test", "persona_id": persona_id, "roles": roles,
    }


def _sembrar_admin(db_session: Session, numero: int) -> Persona:
    """Persona + Usuario ACTIVO con el rol ADMINISTRADOR (many-to-many vía
    `usuario_rol`, mismo modelado que `_sembrar_administradores` en
    `test_sin_n_mas_uno.py`). Devuelve la Persona."""
    rol = (
        db_session.query(Rol).filter(Rol.tipo_rol == TipoRol.ADMINISTRADOR).first()
    )
    if rol is None:
        rol = Rol(tipo_rol=TipoRol.ADMINISTRADOR, descripcion="Administrador")
        db_session.add(rol)
        db_session.flush()
    persona = Persona(
        nombres=f"Admin {numero}", apellidos="de Turno",
        cedula=cedula_valida(800 + numero),
        fecha_nacimiento=date(1985, 1, 1), telefono="0990000000",
    )
    db_session.add(persona)
    db_session.flush()
    db_session.add(Usuario(
        correo=f"admin-cobertura-{numero}@cataclub.test", contrasenia="hash",
        persona_id=persona.id, roles=[rol], activo=True,
    ))
    db_session.commit()
    db_session.expire_all()
    return persona


def _escenario_beneficio_total(client, persona_id: int):
    """Tipo (35.00/mes) + membresía de `persona_id` + beneficio 100% vigente,
    todo vía API con el `client` admin por defecto."""
    tipo = crear_tipo_membresia_api(client)
    membresia = crear_membresia_api(client, persona_id, tipo["id"])
    descuento = client.post(
        "/api/v1/descuentos/",
        json={"nombre": "Becado", "activo": True, "porcentaje": "100.00"},
    ).json()
    asignar_beneficio_api(client, persona_id, descuento["id"])
    return membresia


def _activar_como_titular(client, membresia_id: int, titular_id: int):
    """Autoservicio del dueño (la activación es del titular, nunca de un
    admin "por" él) y devuelve la respuesta."""
    _autenticar_como(titular_id, ["ALUMNO"])
    return client.post(RUTA_APLICAR.format(membresia_id=membresia_id), json={})


# --- Casos ---------------------------------------------------------------------

def test_cada_admin_activo_recibe_un_aviso_con_la_cobertura_como_entidad(
    client, db_session,
):
    """Slice 2, caso central: con dos administradores activos, una activación
    deja un `COBERTURA_BONIFICADA_ADMIN` para cada uno (más el aviso del
    titular), todos apuntando a la misma cobertura."""
    admin_uno = _sembrar_admin(db_session, 1)
    admin_dos = _sembrar_admin(db_session, 2)

    titular = crear_persona_api(client, cedula=cedula_valida(900))
    membresia = _escenario_beneficio_total(client, titular["id"])

    resp = _activar_como_titular(client, membresia["id"], titular["id"])
    assert resp.status_code == 201, resp.text
    cobertura_id = resp.json()["id"]

    for admin in (admin_uno, admin_dos):
        avisos = db_session.query(Notificacion).filter(
            Notificacion.persona_id == admin.id,
            Notificacion.tipo == TipoNotificacion.COBERTURA_BONIFICADA_ADMIN,
        ).all()
        assert len(avisos) == 1, (
            f"El admin {admin.id} debía recibir exactamente un aviso, "
            f"recibió {len(avisos)}"
        )
        assert avisos[0].entidad_relacionada_id == cobertura_id
        assert avisos[0].leida is False

    # El titular conservó SU aviso (tipo distinto, mismo derecho adquirido).
    aviso_titular = db_session.query(Notificacion).filter(
        Notificacion.persona_id == titular["id"],
        Notificacion.tipo == TipoNotificacion.COBERTURA_BONIFICADA_OTORGADA,
    ).all()
    assert len(aviso_titular) == 1


def test_admin_titular_no_recibe_duplicado(client, db_session):
    """Si quien activa el beneficio es a la vez administrador, su aviso de
    titular ya le avisó: la segunda fila sería la misma novedad dos veces
    (mismo criterio anti-duplicado que el #1227)."""
    admin_titular = _sembrar_admin(db_session, 3)

    membresia = _escenario_beneficio_total(client, admin_titular.id)

    resp = _activar_como_titular(client, membresia["id"], admin_titular.id)
    assert resp.status_code == 201, resp.text
    cobertura_id = resp.json()["id"]

    avisos = db_session.query(Notificacion).filter(
        Notificacion.persona_id == admin_titular.id,
    ).all()
    tipos = sorted(n.tipo.value for n in avisos)
    assert tipos == ["COBERTURA_BONIFICADA_OTORGADA"], (
        f"El admin-titular debía recibir un único aviso (el de titular), "
        f"recibió {tipos}"
    )
    assert avisos[0].entidad_relacionada_id == cobertura_id


def test_fallo_consultando_admins_no_rompe_la_activacion(
    client, db_session, monkeypatch,
):
    """El bloque de avisos corre DESPUÉS del commit de la cobertura, con
    try/except + rollback: cualquier error ahí nunca convierte en 5xx una
    activación que en los hechos SÍ se procesó (mismo criterio que
    `_crear_notificacion`)."""
    titular = crear_persona_api(client, cedula=cedula_valida(901))
    membresia = _escenario_beneficio_total(client, titular["id"])

    def _explotar(self, tipo_rol):
        raise RuntimeError("falla simulada del catálogo de roles")

    monkeypatch.setattr(
        rol_repo_mod.RolRepositorio,
        "obtener_por_tipo_con_usuarios",
        _explotar,
    )

    resp = _activar_como_titular(client, membresia["id"], titular["id"])
    assert resp.status_code == 201, resp.text

    aviso_titular = db_session.query(Notificacion).filter(
        Notificacion.persona_id == titular["id"],
        Notificacion.tipo == TipoNotificacion.COBERTURA_BONIFICADA_OTORGADA,
    ).all()
    assert len(aviso_titular) == 1
