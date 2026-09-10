"""Salida de independencia administrada por un administrador presencial (#1137).

Reemplaza el autoservicio del antiguo `POST /personas/{id}/independizar`
(el ex-menor se "independizaba" él mismo confirmando su contraseña): esa
puerta no puede garantizar identidad verificada, correo actual ni cuenta
-- y bloqueaba por deuda, justo lo que la salida de un adulto NO debe
hacer. El comando nuevo:

  - lo ejecuta SOLO un ADMINISTRADOR con la persona enfrente;
  - establece credenciales con correo VERIFICADO (lo verifica el personal
    en el mostrador) sobre el MISMO `persona_id`, sin crear Persona ni
    emitir token;
  - deja EXACTAMENTE un rol: REPRESENTANTE (regla #762: inserción, reuso,
    reemplazo explícito del único rol legal, rechazo del multirol legado);
  - la deuda NO bloquea;
  - un menor NO se puede desvincular;
  - credenciales + capacidad + remoción del vínculo + auditoría + epoch de
    sesión comitean JUNTOS (un solo commit, o nada);
  - el reintento con la misma clave devuelve el resultado establecido;
  - la notificación al ex representante es post-commit y best-effort.
"""
from datetime import date, datetime, timezone

import pytest

from app.dominio.cedula import cedula_valida
from app.dominio.enums import EstadoPago, EstadoMembresia, TipoPago, TipoModalidad, TipoRol
from app.dominio.excepciones import (
    ConflictoConcurrencia, EntidadDuplicada, EntidadNoEncontrada, OperacionInvalida,
)
from app.dominio.modelos import (
    FichaMedica, Membresia, Notificacion, Pago, Persona, Rol, TipoMembresia, Usuario,
    VinculacionRepresentante,
)
from app.dominio.enums import TipoSangre
from app.servicios_negocio.dtos.persona_schemas import IndependizarDTO
from app.servicios_negocio.relacion_representacion_servicio import (
    RelacionRepresentacionServicio,
)
from app.seguridad.gestor_auth import GestorAutenticacion


CLAVE_COMANDO = "independencia-test-0001"


# --- helpers ----------------------------------------------------------------

def _admin(db_session) -> Persona:
    """El administrador que ejecuta el comando presencial."""
    admin = Persona(
        nombres="Ada", apellidos="Administradora",
        cedula=cedula_valida(310), fecha_nacimiento=date(1980, 1, 1),
        telefono="0990000001",
    )
    db_session.add(admin)
    db_session.commit()
    db_session.refresh(admin)
    return admin


def _representante(db_session, *, correo: str = "rep@test.com") -> tuple[Persona, Usuario]:
    rep = Persona(
        nombres="María", apellidos="López", cedula=cedula_valida(311),
        fecha_nacimiento=date(1985, 3, 20), telefono="0998765432",
    )
    db_session.add(rep)
    db_session.flush()
    usuario = Usuario(
        correo=correo, contrasenia="hash", persona_id=rep.id,
        correo_verificado=True,
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(rep)
    db_session.refresh(usuario)
    return rep, usuario


def _representado_adulto(db_session, representante_id: int, *,
                         cedula_seed: int = 330) -> Persona:
    """Adulto representado: nacido en 2000, mayor de 18 en cualquier fecha
    razonable de ejecución (la edad la calcula el servicio con `hoy_club`,
    que esta suite NO congela para el módulo nuevo)."""
    adulto = Persona(
        nombres="Carlos", apellidos="Ruiz", cedula=cedula_valida(cedula_seed),
        fecha_nacimiento=date(2000, 6, 15), telefono="0991234567",
        representante_id=representante_id,
    )
    db_session.add(adulto)
    db_session.commit()
    db_session.refresh(adulto)
    return adulto


def _representado_menor(db_session, representante_id: int, *,
                        cedula_seed: int = 331) -> Persona:
    menor = Persona(
        nombres="Lucía", apellidos="Pérez", cedula=cedula_valida(cedula_seed),
        fecha_nacimiento=date(2020, 6, 15), telefono="0991234568",
        representante_id=representante_id,
    )
    db_session.add(menor)
    db_session.commit()
    db_session.refresh(menor)
    return menor


def _usuario_legado(db_session, persona: Persona, *, correo: str,
                    roles: list[Rol] | None = None) -> Usuario:
    usuario = Usuario(
        correo=correo, contrasenia="hash", persona_id=persona.id,
        correo_verificado=False, roles=roles or [],
    )
    db_session.add(usuario)
    db_session.commit()
    db_session.refresh(usuario)
    return usuario


def _comando(correo: str = "carlos.nuevo@test.com",
             contrasenia: str = "clave-segura-123") -> IndependizarDTO:
    return IndependizarDTO(
        correo=correo, contrasenia=contrasenia,
        evidencia_identidad="cédula verificada en mostrador",
    )


def _independizar(db_session, admin: Persona, persona: Persona, *,
                  comando: IndependizarDTO | None = None,
                  clave: str = CLAVE_COMANDO) -> dict:
    return RelacionRepresentacionServicio(db_session).independizar_presencial(
        admin_actor_id=admin.id, persona_id=persona.id,
        comando=comando or _comando(), idempotency_key=clave,
    )


# --- Camino feliz: cuenta nueva sobre el mismo persona_id -------------------

def test_admin_crea_la_cuenta_en_el_mismo_persona_id(db_session):
    """La cuenta nace sobre la Persona YA existente: mismo `persona_id`,
    ninguna Persona nueva, y el vínculo queda cortado."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    personas_antes = db_session.query(Persona).count()
    resultado = _independizar(db_session, admin, adulto)

    assert resultado["persona_id"] == adulto.id
    assert resultado["representante_anterior_id"] == rep.id
    assert resultado["cuenta_creada"] is True
    usuario = db_session.query(Usuario).filter_by(persona_id=adulto.id).one()
    assert usuario.persona_id == adulto.id
    assert db_session.query(Persona).count() == personas_antes
    db_session.refresh(adulto)
    assert adulto.representante_id is None


def test_el_correo_queda_verificado_y_no_se_emite_token(db_session):
    """El correo lo verificó el personal en persona: la cuenta nace
    `correo_verificado=True`. La respuesta nunca lleva token: quien la
    ejecuta es el administrador, no el adulto."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    resultado = _independizar(db_session, admin, adulto)

    usuario = db_session.query(Usuario).filter_by(persona_id=adulto.id).one()
    assert usuario.correo == "carlos.nuevo@test.com"
    assert usuario.correo_verificado is True
    assert "access_token" not in resultado
    assert "refresh_token" not in resultado


def test_regla_762_asigna_exactamente_representante(db_session):
    """Cuenta sin roles: se inserta EXACTAMENTE un rol REPRESENTANTE --
    nunca ALUMNO (la independencia no crea jugador)."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    _independizar(db_session, admin, adulto)

    usuario = db_session.query(Usuario).filter_by(persona_id=adulto.id).one()
    assert [r.tipo_rol for r in usuario.roles] == [TipoRol.REPRESENTANTE]


def test_rol_unico_legal_se_reemplaza_por_representante(db_session):
    """Cuenta legada con un único rol ALUMNO: el reemplazo es EXPLÍCITO --
    se quita ALUMNO y queda solo REPRESENTANTE, en la misma transacción."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)
    rol_alumno = Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")
    _usuario_legado(db_session, adulto, correo="viejo@test.com", roles=[rol_alumno])

    resultado = _independizar(db_session, admin, adulto)

    assert resultado["cuenta_creada"] is False
    usuario = db_session.query(Usuario).filter_by(persona_id=adulto.id).one()
    assert [r.tipo_rol for r in usuario.roles] == [TipoRol.REPRESENTANTE]


def test_representante_existente_se_reusa_sin_duplicar_rol(db_session):
    """La cuenta ya era REPRESENTANTE: se reusa, no se inserta un segundo."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)
    rol_rep = Rol(tipo_rol=TipoRol.REPRESENTANTE, descripcion="Representante")
    _usuario_legado(db_session, adulto, correo="ya-rep@test.com", roles=[rol_rep])

    _independizar(db_session, admin, adulto)

    usuario = db_session.query(Usuario).filter_by(persona_id=adulto.id).one()
    assert [r.tipo_rol for r in usuario.roles] == [TipoRol.REPRESENTANTE]


def test_cuenta_multirol_legada_rechazada_sin_mutar_nada(db_session):
    """El multirol legado se rechaza para que lo remedie su dueño: la
    capacidad NUNCA se adivina ni se reescribe en silencio. El estado
    ilegal vive solo en la unidad de trabajo (el trigger #762 impide
    persistirlo): el núcleo de capacidad debe reventar ANTES de cualquier
    flush -- ni el rol viejo se quita ni el nuevo se asigna."""
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)
    rol_alumno = Rol(tipo_rol=TipoRol.ALUMNO, descripcion="Alumno")
    usuario = _usuario_legado(db_session, adulto, correo="multi@test.com", roles=[rol_alumno])
    db_session.autoflush = False
    usuario.roles.append(Rol(tipo_rol=TipoRol.ENTRENADOR, descripcion="Entrenador"))

    from app.servicios_negocio.rol_servicio import RolServicio

    with pytest.raises(OperacionInvalida, match="más de un rol"):
        RolServicio(db_session).establecer_capacidad_representante(usuario)

    db_session.rollback()
    db_session.refresh(adulto)
    assert adulto.representante_id == rep.id
    assert db_session.query(VinculacionRepresentante).count() == 0


# --- La deuda NO bloquea; el menor NO se desvincula -------------------------

def test_la_deuda_no_bloquea_la_independencia(db_session):
    """El criterio nuevo: la deuda la gestiona el club por su canal; la
    salida de un adulto de la cuenta de su representante no puede quedar
    rehén de una membresía impaga (el autoservicio viejo lo bloqueaba)."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    tipo = TipoMembresia(categoria="Formativo", precio=50, modalidad=TipoModalidad.MENSUAL)
    db_session.add(tipo)
    db_session.flush()
    membresia = Membresia(
        estado=EstadoMembresia.INACTIVA, monto_aplicado=50,
        fecha_activacion=datetime.now(timezone.utc),
        es_gratuidad_familiar=False, persona_id=adulto.id, tipo_membresia_id=tipo.id,
    )
    db_session.add(membresia)
    db_session.flush()
    db_session.add(Pago(
        monto=50, estado_pago=EstadoPago.PENDIENTE_VALIDACION, tipo_pago=TipoPago.EFECTIVO,
        fecha_inicio=date(2029, 1, 1), fecha_fin=date(2029, 12, 31),
        persona_id=adulto.id, membresia_id=membresia.id,
    ))
    db_session.commit()

    resultado = _independizar(db_session, admin, adulto)

    db_session.refresh(adulto)
    assert adulto.representante_id is None
    assert resultado["cuenta_creada"] is True


def test_menor_de_edad_rechazado_y_vinculo_intacto(db_session):
    """Un menor no se puede desvincular: el comando lo rechaza y el g1139
    de la base (trigger `g1139repmenor`) queda como respaldo."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    menor = _representado_menor(db_session, rep.id)

    with pytest.raises(OperacionInvalida, match="mayor de edad"):
        _independizar(db_session, admin, menor)

    db_session.refresh(menor)
    assert menor.representante_id == rep.id
    assert db_session.query(VinculacionRepresentante).count() == 0


def test_persona_sin_representante_rechazada(db_session):
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    suelto = _representado_adulto(db_session, rep.id)
    suelto.representante_id = None
    db_session.commit()

    with pytest.raises(OperacionInvalida, match="representante"):
        _independizar(db_session, admin, suelto)


def test_persona_inexistente_rechazada(db_session):
    admin = _admin(db_session)
    with pytest.raises(EntidadNoEncontrada):
        _independizar(db_session, admin, Persona(id=999999))


# --- Conflicto de correo normalizado: rollback completo ----------------------

def test_correo_de_otra_cuenta_hace_rollback_completo(db_session):
    """Si el correo pertenece a OTRA persona (aunque cambien mayúsculas:
    el índice funcional compara `lower(btrim(correo))`), la transacción
    completa se revierte: el vínculo queda exactamente como estaba y no
    queda ninguna fila nueva."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)
    otro = _representado_adulto(db_session, rep.id, cedula_seed=340)
    _usuario_legado(db_session, otro, correo="Ocupado@Test.com")

    with pytest.raises(EntidadDuplicada):
        _independizar(db_session, admin, adulto, comando=_comando(correo="ocupado@test.com"))

    db_session.refresh(adulto)
    assert adulto.representante_id == rep.id
    assert db_session.query(Usuario).filter_by(persona_id=adulto.id).count() == 0
    assert db_session.query(VinculacionRepresentante).count() == 0


# --- Auditoría, epoch y conservación ----------------------------------------

def test_auditoria_independencia_completa(db_session):
    """La evidencia del ledger: actor admin, origen presencial, operación
    INDEPENDENCIA, representante anterior, nuevo=NULL, clave+huella."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    _independizar(db_session, admin, adulto)

    evento = db_session.query(VinculacionRepresentante).one()
    assert evento.operacion == "INDEPENDENCIA"
    assert evento.origen == "ADMIN_PRESENCIAL"
    assert evento.actor_persona_id == admin.id
    assert evento.persona_id == adulto.id
    assert evento.representante_anterior_id == rep.id
    assert evento.representante_nuevo_id is None
    assert evento.idempotency_key == CLAVE_COMANDO
    assert len(evento.request_fingerprint) == 64


def test_epoch_del_ex_representante_se_revoca(db_session):
    """El ex representante pierde el acceso a la ficha al instante: epoch
    bombeado. La cuenta NUEVA del adulto no bombea: no hay token previo."""
    admin = _admin(db_session)
    rep, usuario_rep = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    _independizar(db_session, admin, adulto)

    db_session.refresh(usuario_rep)
    assert usuario_rep.version_sesion == 2
    usuario_adulto = db_session.query(Usuario).filter_by(persona_id=adulto.id).one()
    assert usuario_adulto.version_sesion == 1


def test_epoch_del_objetivo_legado_tambien_se_revoca(db_session):
    """Cuenta legada actualizada (credenciales+rol cambiaron): SU epoch
    también se bombea, junto con el del ex representante."""
    admin = _admin(db_session)
    rep, usuario_rep = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)
    usuario_legado = _usuario_legado(db_session, adulto, correo="viejo@test.com")

    _independizar(db_session, admin, adulto, comando=_comando(correo="nuevo@test.com"))

    db_session.refresh(usuario_rep)
    db_session.refresh(usuario_legado)
    assert usuario_rep.version_sesion == 2
    assert usuario_legado.version_sesion == 2
    assert usuario_legado.correo == "nuevo@test.com"
    assert usuario_legado.correo_verificado is True


def test_los_datos_del_adulto_se_conservan(db_session):
    """La remoción del vínculo no borra nada: ficha médica, membresía y
    pagos quedan intactos -- la salida cambia la AUTORIZACIÓN, no la
    historia del miembro."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    db_session.add(FichaMedica(tipo_sangre=TipoSangre.O_POSITIVO, persona_id=adulto.id, alergias="Polen"))
    db_session.commit()

    _independizar(db_session, admin, adulto)

    adulto_refrescado = db_session.get(Persona, adulto.id)
    assert adulto_refrescado.representante_id is None
    assert adulto_refrescado.ficha_medica.tipo_sangre.value == "O_POSITIVO"
    assert adulto_refrescado.nombres == "Carlos"


# --- Idempotencia ------------------------------------------------------------

def test_reintento_con_la_misma_clave_devuelve_el_resultado_establecido(db_session):
    """Replay: misma clave + mismo comando → el resultado ya establecido,
    sin segundo Usuario, sin segundo evento, sin tocar roles."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    primero = _independizar(db_session, admin, adulto)
    segundo = _independizar(db_session, admin, adulto)

    assert primero["replay"] is False
    assert segundo["replay"] is True
    assert segundo["persona_id"] == primero["persona_id"]
    assert segundo["representante_anterior_id"] == primero["representante_anterior_id"]
    assert db_session.query(VinculacionRepresentante).count() == 1
    assert db_session.query(Usuario).filter_by(persona_id=adulto.id).count() == 1
    usuario = db_session.query(Usuario).filter_by(persona_id=adulto.id).one()
    assert [r.tipo_rol for r in usuario.roles] == [TipoRol.REPRESENTANTE]


def test_clave_reusada_con_otro_comando_conflicta(db_session):
    """Misma clave, comando DISTINTO (otro correo): 409 de conflicto, nada
    se escribe -- la clave identifica UN comando, no al que llega primero."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    _independizar(db_session, admin, adulto)

    db_session.refresh(adulto)
    otro_adulto = _representado_adulto(db_session, rep.id, cedula_seed=350)
    with pytest.raises(ConflictoConcurrencia):
        _independizar(db_session, admin, otro_adulto,
                      comando=_comando(correo="otro@test.com"))


def test_clave_reusada_sobre_otra_persona_conflicta(db_session):
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)
    _independizar(db_session, admin, adulto)

    otro = _representado_adulto(db_session, rep.id, cedula_seed=351)
    with pytest.raises(ConflictoConcurrencia):
        _independizar(db_session, admin, otro)


# --- Rollback ----------------------------------------------------------------

def test_fallo_antes_del_commit_deja_el_vinculo_y_cero_filas(db_session):
    """Si cualquier escritura falla antes del único commit (acá: el evento
    de auditoría), la transacción entera se revierte: vínculo original
    usable, cero Usuarios, cero evidencia."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    servicio = RelacionRepresentacionServicio(db_session)
    original = servicio.repo_ledger.registrar

    def _explotar(**kwargs):
        raise RuntimeError("falla de base simulada")

    servicio.repo_ledger.registrar = _explotar
    with pytest.raises(RuntimeError):
        servicio.independizar_presencial(
            admin_actor_id=admin.id, persona_id=adulto.id,
            comando=_comando(), idempotency_key=CLAVE_COMANDO,
        )
    servicio.repo_ledger.registrar = original

    db_session.refresh(adulto)
    assert adulto.representante_id == rep.id
    assert db_session.query(Usuario).filter_by(persona_id=adulto.id).count() == 0
    assert db_session.query(VinculacionRepresentante).count() == 0
    assert db_session.query(Notificacion).count() == 0


# --- Notificación post-commit, best-effort -----------------------------------

def test_notifica_al_ex_representante_despues_del_commit(db_session):
    """Canal existente (`Notificacion` in-app) para el ex representante,
    con copia neutra, apuntando al evento de auditoría."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    resultado = _independizar(db_session, admin, adulto)

    evento = db_session.query(VinculacionRepresentante).one()
    aviso = db_session.query(Notificacion).filter_by(persona_id=rep.id).one()
    assert aviso.entidad_relacionada_id == evento.id
    assert aviso.mensaje
    assert resultado["persona_id"] == adulto.id


def test_fallo_de_notificacion_post_commit_no_revierte_el_exito(db_session):
    """El canal se cae DESPUÉS del commit: la independencia ya está comiteada
    y el comando la devuelve igual -- el fallo es observable, no letal."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    import app.servicios_negocio.relacion_representacion_servicio as rrs

    class _CanalCaido:
        def __init__(self, *args, **kwargs):
            raise RuntimeError("canal de notificación caído")

    _independizar(db_session, admin, adulto)
    db_session.refresh(adulto)
    assert adulto.representante_id is None
    assert db_session.query(VinculacionRepresentante).count() == 1

    # Y en un caso nuevo, el fallo del canal no rompe la respuesta:
    monkeypatch_fallo = _CanalCaido
    original = rrs.Notificacion
    rrs.Notificacion = monkeypatch_fallo
    try:
        adulto_2 = _representado_adulto(db_session, rep.id, cedula_seed=360)
        segundo = _independizar(
            db_session, admin, adulto_2,
            comando=_comando(correo="segundo@test.com"), clave="clave-2",
        )
        assert segundo["persona_id"] == adulto_2.id
        db_session.refresh(adulto_2)
        assert adulto_2.representante_id is None
    finally:
        rrs.Notificacion = original


# --- Triangulación: límites reales de PostgreSQL ----------------------------

def test_la_base_rechaza_desvincular_a_un_menor_por_sql_directo(db_session):
    """El rechazo del menor NO depende solo del servicio: un write crudo que
    bypasea la aplicación choca contra el trigger g1139 (`g1139repmenor`)
    y el vínculo del menor sobrevive."""
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    rep, _ = _representante(db_session)
    menor = _representado_menor(db_session, rep.id)

    with pytest.raises(DBAPIError):
        db_session.execute(
            text("UPDATE persona SET representante_id = NULL WHERE id = :i"),
            {"i": menor.id},
        )
    db_session.rollback()
    db_session.refresh(menor)
    assert menor.representante_id == rep.id


def test_el_comando_bloquea_las_filas_que_decide(db_session, contar_selects):
    """Las decisiones se toman sobre filas BLOQUEADAS: el comando emite
    `SELECT ... FOR UPDATE` sobre la persona objetivo y sobre las cuentas
    (orden ascendente), el orden estable que evita abrazos entre comandos
    concurrentes."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    with contar_selects() as sentencias:
        _independizar(db_session, admin, adulto)

    con_lock = [s for s in sentencias if "FOR UPDATE" in s]
    assert any("persona" in s for s in con_lock), con_lock
    assert any("usuario" in s for s in con_lock), con_lock


def test_el_token_previo_del_ex_representante_queda_muerto(db_session):
    """Un token emitido ANTES de la independencia (sver del epoch viejo) ya
    no es sesión vigente: el epoch comiteado con el comando lo cierra sin
    esperar la expiración natural."""
    admin = _admin(db_session)
    rep, usuario_rep = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    token = GestorAutenticacion.crear_token_acceso(
        {"sub": "rep@test.com", "persona_id": rep.id},
        version_sesion=usuario_rep.version_sesion,
    )
    from app.soporte_transversal.configuracion import settings
    import jwt as pyjwt

    sver_previo = pyjwt.decode(
        token, settings.jwt_secret_key, algorithms=[settings.jwt_algoritmo]
    ).get("sver")
    assert GestorAutenticacion.sesion_vigente(sver_previo, usuario_rep)

    _independizar(db_session, admin, adulto)

    db_session.refresh(usuario_rep)
    assert not GestorAutenticacion.sesion_vigente(sver_previo, usuario_rep)


def test_el_adulto_independizado_sigue_editable_y_con_cuenta_usable(db_session):
    """Después de la salida, la Persona independiente sigue siendo una fila
    viva y editable: el trigger g1139 solo vigila escrituras del vínculo
    (`UPDATE OF representante_id`), no reaparece por editar un teléfono."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)
    _independizar(db_session, admin, adulto)

    adulto.telefono = "0990000099"
    db_session.commit()
    db_session.refresh(adulto)
    assert adulto.representante_id is None
    assert adulto.telefono == "0990000099"
    usuario = db_session.query(Usuario).filter_by(persona_id=adulto.id).one()
    assert usuario.correo_verificado is True


# --- Runtime: login real del adulto con la cuenta establecida ---------------

def test_runtime_el_adulto_puede_loguearse_con_las_credenciales_establecidas(db_session):
    """Cierre del escenario de runtime de PR 2: después de la salida, el
    adulto entra al portal con las credenciales que el administrador le
    estableció en el mostrador -- login REAL (bcrypt + sesión + tokens) sobre
    la cuenta que creó el comando. Sin la independencia previa no habría
    cuenta: este es el"portal accessible" que el flujo promete."""
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    _independizar(db_session, admin, adulto)

    from app.servicios_negocio.auth_servicio import AuthServicio

    sesion = AuthServicio(db_session).login(
        "carlos.nuevo@test.com", "clave-segura-123",
    )
    assert sesion["token_type"] == "bearer"
    assert sesion["access_token"]
    assert "refresh_token" in sesion


# --- Clave de idempotencia obligatoria ---------------------------------------

def test_sin_clave_de_idempotencia_rechazado(db_session):
    admin = _admin(db_session)
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    with pytest.raises(OperacionInvalida, match="Idempotency-Key"):
        _independizar(db_session, admin, adulto, clave="")


# --- Endpoint: solo administrador presencial --------------------------------

def test_endpoint_exige_rol_administrador(client_sin_permisos, db_session):
    """El propio adulto (o cualquier no-admin) ya NO puede independizarse:
    403. La puerta de autoservicio se jubiló con este comando."""
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    resp = client_sin_permisos.post(
        f"/api/v1/personas/{adulto.id}/independizar",
        json={"correo": "carlos.nuevo@test.com", "contrasenia": "clave-segura-123",
              "evidencia_identidad": "x"},
        headers={"Idempotency-Key": CLAVE_COMANDO},
    )
    assert resp.status_code == 403


def test_endpoint_admin_completa_sin_token_en_la_respuesta(client, db_session):
    """El administrador (persona_id=1 del token de pruebas) ejecuta el
    comando: 200, vínculo cortado, y la respuesta JAMÁS lleva tokens."""
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    resp = client.post(
        f"/api/v1/personas/{adulto.id}/independizar",
        json={"correo": "carlos.nuevo@test.com", "contrasenia": "clave-segura-123",
              "evidencia_identidad": "cédula verificada en mostrador"},
        headers={"Idempotency-Key": CLAVE_COMANDO},
    )
    assert resp.status_code == 200
    cuerpo = resp.json()
    assert cuerpo["persona_id"] == adulto.id
    assert cuerpo["representante_anterior_id"] == rep.id
    assert cuerpo["cuenta_creada"] is True
    assert "access_token" not in cuerpo
    assert "refresh_token" not in cuerpo
    db_session.refresh(adulto)
    assert adulto.representante_id is None


def test_endpoint_sin_clave_de_idempotencia_rechazado(client, db_session):
    rep, _ = _representante(db_session)
    adulto = _representado_adulto(db_session, rep.id)

    resp = client.post(
        f"/api/v1/personas/{adulto.id}/independizar",
        json={"correo": "carlos.nuevo@test.com", "contrasenia": "clave-segura-123",
              "evidencia_identidad": "x"},
    )
    assert resp.status_code == 400


def test_endpoint_menor_rechazado_y_vinculo_intacto(client, db_session):
    rep, _ = _representante(db_session)
    menor = _representado_menor(db_session, rep.id)

    resp = client.post(
        f"/api/v1/personas/{menor.id}/independizar",
        json={"correo": "lucia@test.com", "contrasenia": "clave-segura-123",
              "evidencia_identidad": "x"},
        headers={"Idempotency-Key": CLAVE_COMANDO},
    )
    assert resp.status_code == 400
    db_session.refresh(menor)
    assert menor.representante_id == rep.id


def test_endpoint_persona_inexistente_404(client, db_session):
    resp = client.post(
        "/api/v1/personas/999999/independizar",
        json={"correo": "x@test.com", "contrasenia": "clave-segura-123",
              "evidencia_identidad": "x"},
        headers={"Idempotency-Key": CLAVE_COMANDO},
    )
    assert resp.status_code == 404


# --- DTO del comando ---------------------------------------------------------

def test_dto_exige_correo_contrasenia_y_evidencia():
    comando = IndependizarDTO(
        correo="Carlos@Test.com ", contrasenia="clave-segura-123",
        evidencia_identidad="cédula verificada",
    )
    assert comando.correo == "carlos@test.com"  # normalizado

    with pytest.raises(Exception):
        IndependizarDTO(contrasenia="clave-segura-123")  # forma vieja: solo contraseña
    with pytest.raises(Exception):
        IndependizarDTO(correo="x@test.com", contrasenia="clave-segura-123")  # sin evidencia
    with pytest.raises(Exception):
        IndependizarDTO(correo="x@test.com", contrasenia="corta",
                        evidencia_identidad="x")  # contraseña inválida
