"""
Issue #1139: la baja de un representante no puede dejar a sus representados
menores sin nadie que pueda alcanzarlos.

`RolServicio.cambiar_estado_cuenta` (PATCH /personas/{id}/cuenta/estado) y
`PersonaServicio.cambiar_estado` (PATCH /personas/{id}/estado, baja lógica de
la Persona -- que TAMBIÉN apaga el `Usuario` si existe) son los dos caminos
auditados que pueden apagar la cuenta de un representante. Los dos reusan
`exigir_sin_representados_menores_activos` (`app/dominio/
representados_alcanzables.py`, mismo criterio que `rol_unico.py` para #762):
un solo lugar del dominio, consumido por ambos, ninguno depende del otro.

`independizar()` se auditó y NO necesita cambios: solo corta el vínculo hacia
ARRIBA de quien se independiza (su propio `representante_id`), nunca toca a
sus propios representados, y ya exige que la persona que se independiza sea
mayor de edad -- nunca puede nular el vínculo de un menor real.

`vincular_representado` se auditó y sí tenía un agujero: nada impedía
vincular a un representado a una cuenta YA desactivada, produciendo el mismo
estado prohibido sin pasar por ninguna baja. Se cierra acá con el mismo
criterio (`exigir_representante_destino_alcanzable`).

La garantía real contra la carrera (dos peticiones concurrentes) vive en
Postgres -- ver `tests/test_migracion_representados_alcanzables.py`.
"""
from datetime import date

from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion


MENOR_NACIMIENTO = date(2015, 5, 14)
ADULTO_NACIMIENTO = date(1990, 1, 1)


# --- Fábricas mínimas (ORM directo, mismo idiom que test_baja_logica_persona.py) --

def _persona(
    db_session, cedula: str, *, fecha_nacimiento: date = ADULTO_NACIMIENTO,
    nombres: str = "Marcela", apellidos: str = "Vega",
    representante_id: int | None = None,
) -> Persona:
    persona = Persona(
        nombres=nombres, apellidos=apellidos, cedula=cedula,
        fecha_nacimiento=fecha_nacimiento, telefono="0991230000",
        representante_id=representante_id,
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _usuario(
    db_session, persona: Persona, *, activo: bool = True,
    correo_verificado: bool = True, tipo_rol: TipoRol | None = None,
) -> Usuario:
    roles = [Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value)] if tipo_rol else []
    usuario = Usuario(
        correo=f"u{persona.cedula}@cataclub.test",
        contrasenia=GestorAutenticacion.obtener_hash_contrasenia("Secreta123"),
        persona_id=persona.id, activo=activo, correo_verificado=correo_verificado,
        roles=roles,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _desactivar_cuenta(client, persona_id: int):
    return client.patch(f"/api/v1/personas/{persona_id}/cuenta/estado", json={"activo": False})


def _activar_cuenta(client, persona_id: int):
    return client.patch(f"/api/v1/personas/{persona_id}/cuenta/estado", json={"activo": True})


def _dar_de_baja(client, persona_id: int):
    return client.patch(f"/api/v1/personas/{persona_id}/estado", json={"activo": False})


# --- PATCH /personas/{id}/cuenta/estado (RolServicio.cambiar_estado_cuenta) --

def test_desactivar_cuenta_con_representado_menor_activo_se_rechaza(client, db_session):
    representante = _persona(db_session, "1710034065")
    _usuario(db_session, representante)
    _persona(
        db_session, "1710034073", fecha_nacimiento=MENOR_NACIMIENTO,
        nombres="Beto", representante_id=representante.id,
    )

    respuesta = _desactivar_cuenta(client, representante.id)

    assert respuesta.status_code == 400
    mensaje = respuesta.json()["message"].lower()
    assert "vincular" in mensaje


def test_desactivar_cuenta_sin_representados_sigue_funcionando(client, db_session):
    representante = _persona(db_session, "1710034065")
    _usuario(db_session, representante)

    respuesta = _desactivar_cuenta(client, representante.id)

    assert respuesta.status_code == 200
    assert respuesta.json()["activo"] is False


def test_desactivar_cuenta_con_representado_mayor_de_edad_no_se_rechaza(client, db_session):
    """Control: el invariante es sobre MENORES. Un representado que ya
    cumplió la mayoría de edad puede seguir sin representante alcanzable
    (puede independizarse él mismo)."""
    representante = _persona(db_session, "1710034065")
    _usuario(db_session, representante)
    _persona(
        db_session, "1710034073", fecha_nacimiento=date(1995, 1, 1),
        nombres="Carla", representante_id=representante.id,
    )

    respuesta = _desactivar_cuenta(client, representante.id)

    assert respuesta.status_code == 200


def test_desactivar_cuenta_con_representado_menor_dado_de_baja_no_bloquea(client, db_session):
    """`PersonaRepositorio.listar_representados` ya filtra por
    `activo=True`: un representado que dejó el club no es alguien a quien
    haya que seguir reasignando."""
    representante = _persona(db_session, "1710034065")
    _usuario(db_session, representante)
    hijo = _persona(
        db_session, "1710034073", fecha_nacimiento=MENOR_NACIMIENTO,
        nombres="Beto", representante_id=representante.id,
    )
    hijo.activo = False
    db_session.commit()

    respuesta = _desactivar_cuenta(client, representante.id)

    assert respuesta.status_code == 200


def test_tras_reasignar_al_representado_menor_la_desactivacion_procede(client, db_session):
    representante = _persona(db_session, "1710034065")
    _usuario(db_session, representante)
    nuevo_representante = _persona(db_session, "1710034081", nombres="Diego")
    _persona(
        db_session, "1710034073", fecha_nacimiento=MENOR_NACIMIENTO,
        nombres="Beto", representante_id=representante.id,
    )

    reasignacion = client.post(
        f"/api/v1/personas/{nuevo_representante.id}/vincular-representado",
        json={"cedula": "1710034073"},
    )
    assert reasignacion.status_code == 200

    respuesta = _desactivar_cuenta(client, representante.id)

    assert respuesta.status_code == 200


def test_activar_una_cuenta_ya_activa_no_pasa_por_el_candado(client, db_session):
    """El invariante rechaza DESACTIVAR, nunca ACTIVAR: devolver el acceso
    nunca deja a nadie sin representante."""
    representante = _persona(db_session, "1710034065")
    _usuario(db_session, representante)
    _persona(
        db_session, "1710034073", fecha_nacimiento=MENOR_NACIMIENTO,
        nombres="Beto", representante_id=representante.id,
    )

    respuesta = _activar_cuenta(client, representante.id)

    assert respuesta.status_code == 200


# --- PATCH /personas/{id}/estado (PersonaServicio.cambiar_estado) -----------

def test_dar_de_baja_con_representado_menor_activo_se_rechaza(client, db_session):
    representante = _persona(db_session, "1710034065")
    _usuario(db_session, representante)
    _persona(
        db_session, "1710034073", fecha_nacimiento=MENOR_NACIMIENTO,
        nombres="Beto", representante_id=representante.id,
    )

    respuesta = _dar_de_baja(client, representante.id)

    assert respuesta.status_code == 400
    mensaje = respuesta.json()["message"].lower()
    assert "vincular" in mensaje


def test_dar_de_baja_sin_representados_sigue_funcionando(client, db_session):
    representante = _persona(db_session, "1710034065")
    _usuario(db_session, representante)

    respuesta = _dar_de_baja(client, representante.id)

    assert respuesta.status_code == 200


def test_dar_de_baja_a_quien_no_tiene_usuario_no_pasa_por_el_candado(client, db_session):
    """Sin `Usuario` no hay cuenta que apagar: el invariante es sobre el
    ACCESO. Un representante sin cuenta propia que además representa a un
    menor es un agujero preexistente y distinto (ese menor ya era
    inalcanzable ANTES de esta baja), fuera del alcance de este issue."""
    representante = _persona(db_session, "1710034065")
    _persona(
        db_session, "1710034073", fecha_nacimiento=MENOR_NACIMIENTO,
        nombres="Beto", representante_id=representante.id,
    )

    respuesta = _dar_de_baja(client, representante.id)

    assert respuesta.status_code == 200


# --- vincular_representado: cerrar el otro lado del mismo invariante -------

def test_vincular_un_representado_a_una_cuenta_desactivada_se_rechaza(client, db_session):
    representante_inactivo = _persona(db_session, "1710034065")
    _usuario(db_session, representante_inactivo, activo=False)
    _persona(
        db_session, "1710034073", fecha_nacimiento=MENOR_NACIMIENTO, nombres="Beto",
    )

    respuesta = client.post(
        f"/api/v1/personas/{representante_inactivo.id}/vincular-representado",
        json={"cedula": "1710034073"},
    )

    assert respuesta.status_code == 400


def test_vincular_un_representado_a_una_cuenta_sin_usuario_propio_sigue_funcionando(
    client, db_session,
):
    """Un tutor cargado a mano, sin login, no tiene ninguna cuenta que
    pueda estar desactivada -- mismo criterio que
    `_exigir_correo_verificado_del_representante`."""
    representante_sin_cuenta = _persona(db_session, "1710034065")
    _persona(
        db_session, "1710034073", fecha_nacimiento=MENOR_NACIMIENTO, nombres="Beto",
    )

    respuesta = client.post(
        f"/api/v1/personas/{representante_sin_cuenta.id}/vincular-representado",
        json={"cedula": "1710034073"},
    )

    assert respuesta.status_code == 200


# --- crear_representado: la puerta MÁS usada tenía el mismo agujero --------
# `POST /personas/{id}/representados` (self-service o admin) es el camino
# más común para dar de alta a un menor -- más que `vincular_representado`,
# que existe para reasignar a alguien YA cargado. Nada impedía crear un
# representado nuevo colgado de una cuenta de representante ya desactivada:
# mismo estado prohibido, alcanzado por la puerta de alta en vez de la de
# reasignación.

def _representado_payload(cedula: str) -> dict:
    return {
        "nombres": "Beto", "apellidos": "Vega", "cedula": cedula,
        "fecha_nacimiento": MENOR_NACIMIENTO.isoformat(), "telefono": "0991230002",
    }


def test_crear_representado_para_una_cuenta_desactivada_se_rechaza(client, db_session):
    representante_inactivo = _persona(db_session, "1710034065")
    _usuario(db_session, representante_inactivo, activo=False)

    respuesta = client.post(
        f"/api/v1/personas/{representante_inactivo.id}/representados",
        json=_representado_payload("1710034073"),
    )

    assert respuesta.status_code == 400
    mensaje = respuesta.json()["message"].lower()
    assert "desactivada" in mensaje


def test_crear_representado_para_una_cuenta_activa_sigue_funcionando(client, db_session):
    representante = _persona(db_session, "1710034065")
    _usuario(db_session, representante)

    respuesta = client.post(
        f"/api/v1/personas/{representante.id}/representados",
        json=_representado_payload("1710034073"),
    )

    assert respuesta.status_code == 201
