"""Núcleo de credenciales para una Persona YA existente (#1137, slice PR 2).

`AuthServicio.establecer_credenciales_persona_existente` es el núcleo NO
comiteador que los comandos presenciales usan para dar credenciales a una
persona que ya existe y ya viene BLOQUEADA por el comando llamador:

  - crea UN `Usuario` sobre el `persona_id` recibido (que no cambia jamás)
  o ACTUALIZA el usuario legado que esa persona ya tenía -- nunca una
  segunda cuenta, nunca una `Persona` nueva;
  - el correo lo verificó el personal en el mostrador: la cuenta nace (o
  queda) con `correo_verificado=True` sin ningún clic en ningún buzón;
  - la unicidad del correo se chequea NORMALIZADA contra cuentas de OTRAS
  personas (el mismo predicado `lower(btrim)` de `obtener_por_correo` y del
  índice `ix_usuario_correo_lower`); el rechazo no muta nada;
  - NO emite tokens (quien ejecuta el comando es el administrador, no el
  titular) y NO comitea (solo `flush()`: el comando es dueño del único
  `commit`).

El `commit` explícito está PROHIBIDO en cada test de este módulo vía un
guardia sobre la sesión: si el núcleo llega a comitear, el test reventará,
porque un commit acá rompería la atomicidad del comando que lo invoque.

La lógica del ROUTER y del comando de independencia no vive acá: este slice
solo entrega el primitivo compartido (PR 2); el cableado presencial es PR 3.
"""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.excepciones import EntidadDuplicada
from app.dominio.modelos import Persona, Usuario
from app.seguridad.gestor_auth import GestorAutenticacion
from app.servicios_negocio.auth_servicio import AuthServicio


CLAVE = "clave-segura-123"


# --- fábricas y guardias ------------------------------------------------------

def _persona(db_session, *, seed: int, representante_id: int | None = None) -> Persona:
    persona = Persona(
        nombres="Carlos", apellidos="Ruiz", cedula=cedula_valida(seed),
        fecha_nacimiento=date(2000, 6, 15), telefono="0991234567",
        representante_id=representante_id,
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _usuario_legado(
    db_session, persona: Persona, correo: str, *,
    verificado: bool = False,
    contrasenia: str | None = None,
) -> Usuario:
    """Estado de partida: una cuenta legada sin verificar (el alta vieja).
    La contraseña de fábrica es un HASH real de `clave-vieja-123`, para que
    los tests puedan afirmar que la vieja ya no verifica y la nueva sí."""
    usuario = Usuario(
        correo=correo,
        contrasenia=contrasenia or GestorAutenticacion.obtener_hash_contrasenia("clave-vieja-123"),
        persona_id=persona.id,
        correo_verificado=verificado,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _prohibir_commit(sesion) -> None:
    """Guardia: ningún test de este módulo tolera un `commit` del núcleo."""
    def _boom():
        raise AssertionError(
            "el núcleo de credenciales no debe comitear: el comando que lo "
            "invoque es el dueño del único commit de la transacción"
        )
    sesion.commit = _boom


@pytest.fixture()
def _sin_tokens(monkeypatch):
    """Guardia: si el núcleo emitiera un token, estos dobles reventan."""
    def _boom(*args, **kwargs):
        raise AssertionError("el núcleo de credenciales no debe emitir tokens")
    monkeypatch.setattr(GestorAutenticacion, "crear_token_acceso", _boom)
    monkeypatch.setattr(GestorAutenticacion, "crear_token_refresco", _boom)


def _usuarios_de(db_session, persona_id: int) -> list[Usuario]:
    return (
        db_session.query(Usuario).filter(Usuario.persona_id == persona_id)
        .order_by(Usuario.id).all()
    )


# --- camino de creación --------------------------------------------------------

@pytest.mark.usefixtures("_sin_tokens")
def test_crea_una_sola_cuenta_sobre_el_persona_id_existente(db_session):
    """Sin cuenta previa: EXACTAMENTE un `Usuario` nuevo sobre la persona
    recibida, verificada de fábrica, y ninguna `Persona` nueva."""
    persona = _persona(db_session, seed=410, representante_id=None)
    personas_antes = db_session.query(Persona).count()

    _prohibir_commit(db_session)
    usuario = AuthServicio(db_session).establecer_credenciales_persona_existente(
        persona, "Carlos.Nuevo@Test.com", CLAVE,
    )

    cuentas = _usuarios_de(db_session, persona.id)
    assert len(cuentas) == 1
    assert usuario.id == cuentas[0].id
    assert usuario.persona_id == persona.id
    # El correo se persiste NORMALIZADO (la entrada llegó con mayúsculas).
    assert usuario.correo == "carlos.nuevo@test.com"
    assert usuario.correo_verificado is True
    assert GestorAutenticacion.verificar_contrasenia(CLAVE, usuario.contrasenia)
    assert db_session.query(Persona).count() == personas_antes
    db_session.rollback()


@pytest.mark.usefixtures("_sin_tokens")
def test_no_comitea_y_el_rollback_descarta_la_cuenta(db_session):
    """Disciplina transaccional: el núcleo solo flushea. Un rollback del
    comando llamador deja CERO cuentas nuevas -- credenciales, capacidad,
    vínculo y auditoría deben comitear juntos o no comitear (PR 3)."""
    persona = _persona(db_session, seed=411)

    _prohibir_commit(db_session)
    AuthServicio(db_session).establecer_credenciales_persona_existente(
        persona, "rollback@test.com", CLAVE,
    )
    db_session.rollback()

    assert _usuarios_de(db_session, persona.id) == []


# --- camino de actualización ---------------------------------------------------

@pytest.mark.usefixtures("_sin_tokens")
def test_actualiza_el_usuario_legado_sin_crear_otro(db_session):
    """Con cuenta legada previa: se ACTUALIZA esa misma fila (mismo id) --
    correo nuevo, contraseña nueva y `correo_verificado=True` -- sin crear
    una segunda cuenta para la persona."""
    persona = _persona(db_session, seed=412)
    legado = _usuario_legado(db_session, persona, "viejo@test.com")

    _prohibir_commit(db_session)
    usuario = AuthServicio(db_session).establecer_credenciales_persona_existente(
        persona, "Carlos.Actual@Test.com", CLAVE,
    )

    assert usuario.id == legado.id
    cuentas = _usuarios_de(db_session, persona.id)
    assert len(cuentas) == 1
    assert usuario.correo == "carlos.actual@test.com"
    assert usuario.correo_verificado is True
    # La contraseña nueva verifica y la vieja ya no.
    assert GestorAutenticacion.verificar_contrasenia(CLAVE, usuario.contrasenia)
    assert not GestorAutenticacion.verificar_contrasenia("clave-vieja-123", usuario.contrasenia)
    db_session.rollback()


def test_reusa_su_propio_correo_sin_chocar(db_session):
    """El conflicto de correo es contra cuentas de OTRAS personas: reafirmar
    la dirección que la propia cuenta ya tenía es una actualización legítima
    (mismo predicado normalizado que el índice único funcional)."""
    persona = _persona(db_session, seed=413)
    legado = _usuario_legado(db_session, persona, "Propio@Test.com")

    _prohibir_commit(db_session)
    usuario = AuthServicio(db_session).establecer_credenciales_persona_existente(
        persona, "propio@test.com", CLAVE,
    )

    assert usuario.id == legado.id
    assert usuario.correo_verificado is True
    db_session.rollback()


# --- conflicto de correo normalizado: rechazo sin mutar ------------------------

def test_correo_de_otra_persona_rechazado_y_nada_cambiado(db_session):
    """Si el correo pertenece a OTRA persona (aunque cambien mayúsculas), el
    comando se rechaza y el estado queda intacto: el comando de independencia
    nunca debe desvincular a cuenta partida (el rollback completo lo
    ejercitará PR 3; acá se fija que el núcleo no mutó NADA antes de fallar)."""
    persona = _persona(db_session, seed=414)
    otro = _persona(db_session, seed=415)
    _usuario_legado(db_session, otro, "Ocupado@Test.com")
    legado = _usuario_legado(db_session, persona, "suyo@test.com")

    with pytest.raises(EntidadDuplicada):
        _prohibir_commit(db_session)
        AuthServicio(db_session).establecer_credenciales_persona_existente(
            persona, "ocupado@test.com", CLAVE,
        )

    db_session.rollback()
    db_session.expire_all()
    legado = db_session.get(Usuario, legado.id)
    assert legado.correo == "suyo@test.com"
    assert legado.correo_verificado is False
    # La contraseña vieja sigue siendo la única válida: nada fue escrito.
    assert GestorAutenticacion.verificar_contrasenia("clave-vieja-123", legado.contrasenia)
    assert not GestorAutenticacion.verificar_contrasenia(CLAVE, legado.contrasenia)
    assert len(_usuarios_de(db_session, persona.id)) == 1


def test_variante_con_espacios_del_correo_ajeno_tambien_choca(db_session):
    """El rechazo comparte el predicado del índice único funcional:
    `lower(btrim(...))`. Una variante con espacios al borde y mayúsculas de
    la dirección ajena choca con la MISMA resolución -- si no, el índice y
    el núcleo verían dos identidades distintas (issue #1023)."""
    persona = _persona(db_session, seed=416)
    otro = _persona(db_session, seed=417)
    _usuario_legado(db_session, otro, "Ocupado@Test.com")

    with pytest.raises(EntidadDuplicada):
        _prohibir_commit(db_session)
        AuthServicio(db_session).establecer_credenciales_persona_existente(
            persona, "  OCUPADO@test.com  ", CLAVE,
        )

    db_session.rollback()
    assert _usuarios_de(db_session, persona.id) == []


def test_actualizar_no_bombea_el_epoch_por_si_solo(db_session):
    """El epoch de sesión NO lo toca el núcleo: el diseño lo asigna al
    comando presencial (que lo bombea junto con su auditoría, su capacidad y
    su clave de idempotencia). Separación de responsabilidades, no descuido."""
    persona = _persona(db_session, seed=418)
    legado = _usuario_legado(db_session, persona, "viejo@test.com")
    epoch_antes = legado.version_sesion

    _prohibir_commit(db_session)
    AuthServicio(db_session).establecer_credenciales_persona_existente(
        persona, "nuevo@test.com", CLAVE,
    )

    assert legado.version_sesion == epoch_antes
    db_session.rollback()


def test_el_comando_es_quien_comitea_y_el_resultado_persiste(db_session):
    """Mitad positiva del contrato de commit: el comando llamador hace su
    ÚNICO commit después del núcleo y las credenciales establecidas
    persisten."""
    persona = _persona(db_session, seed=419)

    AuthServicio(db_session).establecer_credenciales_persona_existente(
        persona, "persiste@test.com", CLAVE,
    )
    db_session.commit()  # el commit es del COMANDO (acá, el test), no del núcleo
    db_session.expire_all()

    cuentas = _usuarios_de(db_session, persona.id)
    assert len(cuentas) == 1
    assert cuentas[0].correo_verificado is True
