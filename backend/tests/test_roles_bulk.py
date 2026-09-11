"""Issue #1132 (cierre): `GET /personas/roles/bulk`.

`members-adapter.ts` hardcodeaba `role: "representante"` para toda fila
porque no existía ningún `GET` en bloque de roles -- solo `POST`/`DELETE
/{persona_id}/roles`, que mutan. Este endpoint responde en UNA consulta
`IN`, mismo patrón que `GET /membresias/deuda/bulk` (issue #326) y `GET
/fichas-medicas/existe` (issue #362): el número de SELECTs no puede crecer
con la cantidad de personas.
"""
from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.modelos import Rol, Usuario
from app.servicios_negocio.rol_servicio import RolServicio
from tests.fabricas_pagos import crear_persona_orm


def _crear_persona_con_roles(sesion, semilla: int, tipos_rol: list[TipoRol]) -> int:
    persona = crear_persona_orm(sesion, cedula_valida(semilla))
    roles = []
    for tipo_rol in tipos_rol:
        rol = sesion.query(Rol).filter(Rol.tipo_rol == tipo_rol).first()
        if rol is None:
            rol = Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value.capitalize())
            sesion.add(rol)
            sesion.flush()
        roles.append(rol)
    if roles:
        usuario = Usuario(
            correo=f"cuenta{semilla}@cataclub.test", contrasenia="hash",
            persona_id=persona.id, roles=roles,
        )
        sesion.add(usuario)
        sesion.flush()
    return persona.id


# --- 1. Camino feliz: agrupa por persona, omite quien no tiene Usuario -----

def test_obtener_roles_bulk_agrupa_por_persona(db_session):
    id_representante = _crear_persona_con_roles(
        db_session, 750, [TipoRol.REPRESENTANTE],
    )
    id_alumno = _crear_persona_con_roles(db_session, 751, [TipoRol.ALUMNO])
    id_sin_usuario = _crear_persona_con_roles(db_session, 752, [])
    db_session.commit()

    resultado = RolServicio(db_session).obtener_roles_bulk(
        [id_representante, id_alumno, id_sin_usuario],
    )

    assert resultado[id_representante] == ["REPRESENTANTE"]
    assert resultado[id_alumno] == ["ALUMNO"]
    # Sin `Usuario`, la persona simplemente no aparece como clave -- el
    # llamador la lee como lista vacía (mismo convenio que
    # `FichaMedicaRepositorio.listar_persona_ids_con_ficha`).
    assert id_sin_usuario not in resultado


def test_obtener_roles_bulk_lista_vacia_no_consulta_nada(db_session):
    assert RolServicio(db_session).obtener_roles_bulk([]) == {}


# --- 2. N+1: el número de SELECTs no depende de la cantidad de personas ----

def test_roles_bulk_no_incurre_en_n_mas_uno(db_session, contar_selects):
    ids_pocos = [
        _crear_persona_con_roles(db_session, 760 + i, [TipoRol.REPRESENTANTE])
        for i in range(3)
    ]
    db_session.commit()

    with contar_selects() as sentencias_pocas:
        RolServicio(db_session).obtener_roles_bulk(ids_pocos)
    selects_pocos = [s for s in sentencias_pocas if s.strip().upper().startswith("SELECT")]

    ids_muchos = list(ids_pocos) + [
        _crear_persona_con_roles(db_session, 800 + i, [TipoRol.ALUMNO])
        for i in range(10)
    ]
    db_session.commit()

    with contar_selects() as sentencias_muchas:
        RolServicio(db_session).obtener_roles_bulk(ids_muchos)
    selects_muchos = [s for s in sentencias_muchas if s.strip().upper().startswith("SELECT")]

    assert len(selects_pocos) == len(selects_muchos), (
        "El número de SELECTs debería ser O(1) (no depender de la cantidad "
        f"de personas): {len(selects_pocos)} con {len(ids_pocos)} personas vs. "
        f"{len(selects_muchos)} con {len(ids_muchos)}."
    )


# --- 3. Nivel HTTP: admin-only, tope de cardinalidad -----------------------

def test_endpoint_roles_bulk_admin_only(client_sin_permisos):
    respuesta = client_sin_permisos.get("/api/v1/personas/roles/bulk?persona_ids=1")
    assert respuesta.status_code == 403


def test_endpoint_roles_bulk_responde_los_roles_reales(client, db_session):
    id_representante = _crear_persona_con_roles(
        db_session, 820, [TipoRol.REPRESENTANTE],
    )
    db_session.commit()

    respuesta = client.get(f"/api/v1/personas/roles/bulk?persona_ids={id_representante}")
    assert respuesta.status_code == 200, respuesta.text
    cuerpo = respuesta.json()
    assert cuerpo == [{"personaId": id_representante, "roles": ["REPRESENTANTE"]}]


def test_endpoint_roles_bulk_rechaza_mas_de_200_ids(client):
    query = "&".join(f"persona_ids={i}" for i in range(1, 202))
    respuesta = client.get(f"/api/v1/personas/roles/bulk?{query}")
    assert respuesta.status_code == 422
