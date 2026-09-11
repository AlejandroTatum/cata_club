"""Regla compartida de capacidad REPRESENTANTE (#1137, slice PR 2; #762).

`RolServicio.establecer_capacidad_representante` es el núcleo de capacidad
compartido de los caminos de cuenta: deja en el usuario EXACTAMENTE un rol,
REPRESENTANTE, con los cuatro resultados deterministas del #762 sobre las
filas YA BLOQUEADAS del usuario:

  1. multirol legado (el trigger `trg_usuario_rol_unico_por_usuario` lo
     impide persistirse) → se RECHAZA para que lo remedie su dueño, sin
     adivinar ni reescribir nada en silencio;
  2. ya es REPRESENTANTE → se REUSA, sin segunda inserción (devuelve False);
  3. un único rol legal distinto → REEMPLAZO explícito: se quita ese rol y
     se asigna REPRESENTANTE en la misma transacción (devuelve True) --
     conducta que solo existe en el comando presencial autorizado, nunca
     como conversión genérica de roles;
  4. sin roles → se INSERTA REPRESENTANTE (devuelve True); jamás ALUMNO:
     la capacidad de representante no crea jugador.

Como el resto de los núcleos del slice, NO comitea (solo `flush()`): la
transacción la cierra el comando. Cada test de este módulo lleva el guardia
que revienta si el núcleo llega a `commit()`.

El reemplazo explícito ejercita el trigger #762 REAL de `db-test`: quitar el
rol viejo se flushea ANTES de insertar el nuevo, que es exactamente el orden
que el trigger exige para admitir el par DELETE+INSERT en una transacción.
"""
from datetime import date

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.excepciones import OperacionInvalida
from app.dominio.modelos import Persona, Rol, Usuario
from app.servicios_negocio.rol_servicio import RolServicio


ROLES_LEGALES = (
    TipoRol.ADMINISTRADOR,
    TipoRol.ENTRENADOR,
    TipoRol.ALUMNO,
)


# --- fábricas y guardias ------------------------------------------------------

def _persona(db_session, *, seed: int, representante_id: int | None = None) -> Persona:
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula_valida(seed),
        fecha_nacimiento=date(1990, 1, 1), telefono="0991234567",
        representante_id=representante_id,
    )
    db_session.add(persona)
    db_session.commit()
    db_session.refresh(persona)
    return persona


def _cuenta_con_rol(
    db_session, tipo_rol: TipoRol | None, *, seed: int,
    correo: str | None = None, representante_id: int | None = None,
) -> Usuario:
    """Persona + Usuario con, a lo sumo, UN rol. Vía ORM directo: acá se
    construye el estado de partida, no se ejercita la regla."""
    persona = _persona(db_session, seed=seed, representante_id=representante_id)
    roles: list[Rol] = []
    if tipo_rol is not None:
        rol = db_session.query(Rol).filter(Rol.tipo_rol == tipo_rol).first()
        if rol is None:
            rol = Rol(tipo_rol=tipo_rol, descripcion=tipo_rol.value.capitalize())
            db_session.add(rol)
            db_session.flush()
        roles = [rol]
    usuario = Usuario(
        correo=correo or f"capacidad{seed}@cataclub.test", contrasenia="hash",
        persona_id=persona.id, roles=roles,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _tipos(usuario: Usuario) -> set[TipoRol]:
    return {rol.tipo_rol for rol in usuario.roles}


def _asociaciones(db_session, usuario_id: int) -> int:
    """Filas REALES en `usuario_rol`, releídas de la base: `len(usuario.roles)`
    en memoria no prueba que el trigger no haya dejado pasar un duplicado."""
    return (
        db_session.query(Rol).join(Rol.usuarios)
        .filter(Usuario.id == usuario_id).count()
    )


def _prohibir_commit(sesion) -> None:
    def _boom():
        raise AssertionError(
            "el núcleo de capacidad no debe comitear: el comando que lo "
            "invoque es el dueño del único commit de la transacción"
        )
    sesion.commit = _boom


# --- 4. sin roles: se inserta REPRESENTANTE -----------------------------------

def test_sin_roles_asigna_exactamente_representante(db_session):
    usuario = _cuenta_con_rol(db_session, None, seed=510)

    _prohibir_commit(db_session)
    cambio = RolServicio(db_session).establecer_capacidad_representante(usuario)

    assert cambio is True
    assert _tipos(usuario) == {TipoRol.REPRESENTANTE}
    assert _asociaciones(db_session, usuario.id) == 1
    db_session.rollback()


def test_el_otorgamiento_nunca_crea_alumno_ni_toca_el_vinculo(db_session):
    """La capacidad de representante no crea jugador: jamás aparece ALUMNO.
    Y la regla no escribe columnas de relación: el `representante_id` de la
    persona queda exactamente como estaba."""
    persona = _persona(db_session, seed=511)
    usuario = _cuenta_con_rol(db_session, None, seed=512, representante_id=persona.id)
    db_session.refresh(persona)
    vinculo_antes = persona.representante_id

    _prohibir_commit(db_session)
    RolServicio(db_session).establecer_capacidad_representante(usuario)

    assert _tipos(usuario) == {TipoRol.REPRESENTANTE}
    db_session.expire_all()
    assert db_session.get(Persona, persona.id).representante_id == vinculo_antes
    db_session.rollback()


# --- 2. ya REPRESENTANTE: se reusa ----------------------------------------------

def test_representante_unico_se_reusa_sin_duplicar(db_session):
    usuario = _cuenta_con_rol(db_session, TipoRol.REPRESENTANTE, seed=513)

    _prohibir_commit(db_session)
    cambio = RolServicio(db_session).establecer_capacidad_representante(usuario)

    assert cambio is False
    assert _tipos(usuario) == {TipoRol.REPRESENTANTE}
    assert _asociaciones(db_session, usuario.id) == 1
    db_session.rollback()


# --- 3. rol legal único: reemplazo explícito ------------------------------------

@pytest.mark.parametrize("rol_viejo", ROLES_LEGALES)
def test_rol_unico_legal_se_reemplaza_por_representante(db_session, rol_viejo):
    """El ÚNICO rol legal se reemplaza EXPLÍCITAMENTE: queda solo
    REPRESENTANTE, en exactamente una asociación (el trigger #762 real ve el
    DELETE flusheado antes del INSERT y admite el par)."""
    usuario = _cuenta_con_rol(db_session, rol_viejo, seed=514)

    _prohibir_commit(db_session)
    cambio = RolServicio(db_session).establecer_capacidad_representante(usuario)

    assert cambio is True
    assert _tipos(usuario) == {TipoRol.REPRESENTANTE}
    assert _asociaciones(db_session, usuario.id) == 1
    db_session.rollback()


# --- 1. multirol legado: rechazo sin mutar nada ----------------------------------

def test_multirol_legado_rechazado_sin_mutar_nada(db_session):
    """La cuenta multirol legada se rechaza para que su dueño elija qué rol
    conserva: la capacidad NUNCA se adivina. El estado ilegal vive solo en la
    unidad de trabajo (el trigger impide persistirlo), y el rechazo salta
    ANTES de cualquier flush: ni el rol viejo se quita ni el nuevo se
    asigna."""
    usuario = _cuenta_con_rol(db_session, TipoRol.ALUMNO, seed=515)
    db_session.autoflush = False
    usuario.roles.append(Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador"))

    with pytest.raises(OperacionInvalida, match="más de un rol"):
        _prohibir_commit(db_session)
        RolServicio(db_session).establecer_capacidad_representante(usuario)

    db_session.rollback()
    db_session.expire_all()
    sobreviviente = db_session.get(Usuario, usuario.id)
    assert _tipos(sobreviviente) == {TipoRol.ALUMNO}
    db_session.rollback()


# --- disciplina transaccional ----------------------------------------------------

def test_no_comitea_y_el_rollback_descarta_el_cambio(db_session):
    """Disciplina transaccional sobre el camino de asignación: el núcleo solo
    flushea, así que un rollback del comando llamador deja la cuenta sin
    roles -- igual que el rechazo, sin estado a medio camino."""
    usuario = _cuenta_con_rol(db_session, None, seed=516)

    _prohibir_commit(db_session)
    RolServicio(db_session).establecer_capacidad_representante(usuario)
    db_session.rollback()

    db_session.expire_all()
    assert _tipos(db_session.get(Usuario, usuario.id)) == set()


# --- triangulación: complementos adversariales -----------------------------------

def test_el_comando_es_quien_comitea_y_el_resultado_persiste(db_session):
    """Mitad positiva del contrato de commit: el comando llamador hace su
    ÚNICO commit después del núcleo y la capacidad asignada persiste."""
    usuario = _cuenta_con_rol(db_session, None, seed=517)

    RolServicio(db_session).establecer_capacidad_representante(usuario)
    db_session.commit()  # el commit es del COMANDO (acá, el test), no del núcleo
    db_session.expire_all()

    assert _tipos(db_session.get(Usuario, usuario.id)) == {TipoRol.REPRESENTANTE}


def test_establecer_capacidad_no_bombea_el_epoch(db_session):
    """La revocación de sesiones NO es del núcleo: el epoch lo bombea el
    comando (con su auditoría y su clave de idempotencia) cuando corresponde.
    Asignar y reemplazar dejan `version_sesion` exactamente como estaba."""
    usuario = _cuenta_con_rol(db_session, TipoRol.ALUMNO, seed=518)
    epoch_antes = usuario.version_sesion

    _prohibir_commit(db_session)
    servicio = RolServicio(db_session)
    assert servicio.establecer_capacidad_representante(usuario) is True
    assert servicio.establecer_capacidad_representante(usuario) is False

    assert usuario.version_sesion == epoch_antes
    db_session.rollback()


def test_el_reemplazo_no_borra_el_rol_del_catalogo(db_session):
    """El reemplazo quita la ASOCIACIÓN, no el catálogo: la fila `rol` de
    ALUMNO sigue existiendo para las demás cuentas."""
    usuario = _cuenta_con_rol(db_session, TipoRol.ALUMNO, seed=519)

    _prohibir_commit(db_session)
    RolServicio(db_session).establecer_capacidad_representante(usuario)

    catalogo = (
        db_session.query(Rol).filter(Rol.tipo_rol == TipoRol.ALUMNO).count()
    )
    assert catalogo == 1
    db_session.rollback()


def test_el_reuso_mantiene_la_misma_fila_de_asociacion(db_session):
    """Reusar no es borrar y reinsertar: la asociación persistente conserva
    la MISMA fila del catálogo REPRESENTANTE que ya tenía."""
    usuario = _cuenta_con_rol(db_session, TipoRol.REPRESENTANTE, seed=520)
    rol_antes = usuario.roles[0].id

    _prohibir_commit(db_session)
    RolServicio(db_session).establecer_capacidad_representante(usuario)

    assert usuario.roles[0].id == rol_antes
    db_session.rollback()
