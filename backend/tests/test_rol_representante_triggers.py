"""Candado de base para el rol del representante (issue #1133, decisión del
dueño de 2026-09-11: "solo una cuenta con rol REPRESENTANTE puede
representar"). Instalado por `k1143rolrep`.

Mismo criterio de `test_cuenta_representada_triggers.py`: SQL crudo que
bypasea la aplicación choca contra los dos triggers de la migración (uno por
dirección de la escritura), y el diferido de `persona` se prueba con
`SET CONSTRAINTS ALL IMMEDIATE` sobre `db_session` (que nunca comitea de
verdad) o con un commit real (`motor_test`) para el escenario que espeja el
orden de `EnrollmentServicio.enroll`.

Alcance deliberadamente parcial: una persona SIN cuenta propia (tutor cargado
a mano) sigue permitida como destino -- ver el docstring de la migración y el
PR de este cambio para el punto que queda pendiente de confirmación."""
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.dominio.cedula import cedula_valida
from app.dominio.enums import TipoRol
from app.dominio.modelos import Persona, Rol, Usuario
from app.infraestructura.repositorios.rol_repositorio import RolRepositorio


def _sembrar_persona(db, seed, fnac, rep_id=None, activo=True):
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula_valida(seed),
        fecha_nacimiento=fnac, telefono="0991234567", activo=activo,
        representante_id=rep_id,
    )
    db.add(persona)
    db.flush()
    return persona


def _sembrar_cuenta_con_rol(db, persona_id, correo, tipo_rol=TipoRol.REPRESENTANTE):
    cuenta = Usuario(correo=correo, contrasenia="hash", persona_id=persona_id)
    db.add(cuenta)
    db.flush()
    rol = RolRepositorio(db).obtener_o_crear(tipo_rol)
    cuenta.roles.append(rol)
    db.flush()
    return cuenta


def _liquidar_diferidos(db):
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


def _ejecutar_y_preservar(db, sql, params, sondeo):
    antes = db.execute(text(sondeo)).all()
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text(sql), params)
        db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    assert db.execute(text(sondeo)).all() == antes


# --- El destino con cuenta necesita el rol REPRESENTANTE ---------------------

def test_sql_directo_rechaza_vincular_a_una_cuenta_sin_el_rol(db_session):
    entrenador = _sembrar_persona(db_session, 900, date(1990, 1, 1))
    _sembrar_cuenta_con_rol(db_session, entrenador.id, "entrenador900@cataclub.test", TipoRol.ENTRENADOR)
    menor = _sembrar_persona(db_session, 901, date(2015, 1, 1))
    _ejecutar_y_preservar(
        db_session,
        "UPDATE persona SET representante_id = :rep WHERE id = :pid",
        {"rep": entrenador.id, "pid": menor.id},
        "SELECT id, representante_id FROM persona ORDER BY id",
    )


def test_sql_directo_permite_vincular_a_una_cuenta_con_el_rol(db_session):
    rep = _sembrar_persona(db_session, 910, date(1990, 1, 1))
    _sembrar_cuenta_con_rol(db_session, rep.id, "rep910@cataclub.test")
    menor = _sembrar_persona(db_session, 911, date(2015, 1, 1))

    db_session.execute(text(
        "UPDATE persona SET representante_id = :rep WHERE id = :pid"
    ), {"rep": rep.id, "pid": menor.id})
    _liquidar_diferidos(db_session)

    assert db_session.execute(text(
        "SELECT representante_id FROM persona WHERE id = :pid"
    ), {"pid": menor.id}).scalar() == rep.id


def test_sql_directo_permite_vincular_a_una_persona_sin_cuenta_propia(db_session):
    """Fuera del alcance de este candado (ver docstring de la migración):
    un tutor cargado a mano, sin cuenta, sigue funcionando igual que antes."""
    tutor_sin_cuenta = _sembrar_persona(db_session, 920, date(1990, 1, 1))
    menor = _sembrar_persona(db_session, 921, date(2015, 1, 1))

    db_session.execute(text(
        "UPDATE persona SET representante_id = :rep WHERE id = :pid"
    ), {"rep": tutor_sin_cuenta.id, "pid": menor.id})
    _liquidar_diferidos(db_session)

    assert db_session.execute(text(
        "SELECT representante_id FROM persona WHERE id = :pid"
    ), {"pid": menor.id}).scalar() == tutor_sin_cuenta.id


def test_una_escritura_que_no_cambia_el_vinculo_no_reevalua_nada(db_session):
    """Con el vínculo YA establecido (rep con rol, menor activo), el
    representante pierde el rol una vez que `menor` se da de baja (el
    candado inverso solo protege ACTIVOS). Reescribir `representante_id` con
    el MISMO valor no debe reevaluar nada -- si lo hiciera, fallaría contra
    la cuenta que ya no tiene el rol. Re-vincular de VERDAD (un valor
    distinto, aunque termine siendo el mismo id) sí debe fallar: eso prueba
    que el corto-circuito es sobre el CAMBIO, no una laguna general."""
    rep = _sembrar_persona(db_session, 930, date(1990, 1, 1))
    cuenta = _sembrar_cuenta_con_rol(db_session, rep.id, "rep930@cataclub.test")
    menor = _sembrar_persona(db_session, 931, date(2015, 1, 1), rep_id=rep.id)
    _liquidar_diferidos(db_session)

    db_session.execute(text(
        "UPDATE persona SET activo = false WHERE id = :pid"
    ), {"pid": menor.id})
    rol_id = db_session.query(Rol.id).filter_by(tipo_rol=TipoRol.REPRESENTANTE).scalar()
    db_session.execute(text(
        "DELETE FROM usuario_rol WHERE usuario_id = :uid AND rol_id = :rid"
    ), {"uid": cuenta.id, "rid": rol_id})

    # Corto-circuito: reescribir `representante_id` con el MISMO valor no
    # reevalúa nada, aunque `rep` ya no tenga el rol.
    db_session.execute(text(
        "UPDATE persona SET representante_id = representante_id WHERE id = :pid"
    ), {"pid": menor.id})
    _liquidar_diferidos(db_session)
    assert db_session.execute(text(
        "SELECT representante_id FROM persona WHERE id = :pid"
    ), {"pid": menor.id}).scalar() == rep.id

    # Re-vincular de VERDAD (desvincular y volver a apuntar) SÍ reevalúa, y
    # ahora `rep` no tiene el rol: se rechaza.
    with pytest.raises(DBAPIError, match="no tiene el rol REPRESENTANTE"):
        with db_session.begin_nested():
            db_session.execute(text(
                "UPDATE persona SET representante_id = NULL WHERE id = :pid"
            ), {"pid": menor.id})
            db_session.execute(text(
                "UPDATE persona SET representante_id = :rep WHERE id = :pid"
            ), {"rep": rep.id, "pid": menor.id})
            db_session.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


# --- El diferido tolera el orden real de EnrollmentServicio.enroll ----------

def _limpiar(motor, correos, cedulas):
    limpieza = Session(bind=motor)
    try:
        if cedulas:
            # Desactivar ANTES de desvincular: `i1141relinteg` protege a un
            # menor ACTIVO sin representante, y el candado inverso de esta
            # migración protege un rol REPRESENTANTE mientras represente a
            # alguien ACTIVO -- dar de baja primero libera las dos puertas.
            limpieza.execute(text(
                "UPDATE persona SET activo = false WHERE cedula = ANY(:c)"
            ), {"c": list(cedulas)})
            limpieza.execute(text(
                "UPDATE persona SET representante_id = NULL WHERE cedula = ANY(:c)"
            ), {"c": list(cedulas)})
        if correos:
            limpieza.execute(text(
                "DELETE FROM usuario_rol WHERE usuario_id IN"
                " (SELECT id FROM usuario WHERE correo = ANY(:c))"
            ), {"c": list(correos)})
            limpieza.execute(text("DELETE FROM usuario WHERE correo = ANY(:c)"), {"c": list(correos)})
            # `rol` es un catálogo real, COMITEADO (a diferencia de todo lo
            # demás en esta suite, que vive en un SAVEPOINT que nunca
            # comitea): sin este borrado huérfano, la fila REPRESENTANTE que
            # este test creó de verdad sobrevive con un id fijo, y
            # `_reiniciar_secuencias` (conftest, reinicia TODAS las
            # secuencias a 1 en cada test con `db_session`) hace que el
            # siguiente `obtener_o_crear` de OTRO rol choque contra esa fila
            # real.
            limpieza.execute(text(
                "DELETE FROM rol r WHERE NOT EXISTS ("
                "SELECT 1 FROM usuario_rol ur WHERE ur.rol_id = r.id)"
            ))
        if cedulas:
            limpieza.execute(text("DELETE FROM persona WHERE cedula = ANY(:c)"), {"c": list(cedulas)})
        limpieza.commit()
    finally:
        limpieza.close()


def test_diferido_permite_el_orden_de_enrollment_en_un_solo_commit(motor_test):
    """Espeja `EnrollmentServicio.enroll`: la Persona del alumno se inserta
    con `representante_id` YA seteado, y la cuenta + rol del representante
    se crean DESPUÉS, todo en la MISMA transacción con un solo `COMMIT`."""
    correo = "rep941@cataclub.test"
    cedulas = (cedula_valida(940), cedula_valida(941))
    sesion = Session(bind=motor_test)
    try:
        rep = Persona(
            nombres="Rep", apellidos="Enroll", cedula=cedulas[0],
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567", activo=True,
        )
        sesion.add(rep)
        sesion.flush()
        alumno = Persona(
            nombres="Hijo", apellidos="Enroll", cedula=cedulas[1],
            fecha_nacimiento=date(2015, 1, 1), telefono="0991234567", activo=True,
            representante_id=rep.id,
        )
        sesion.add(alumno)
        sesion.flush()

        cuenta = Usuario(correo=correo, contrasenia="hash", persona_id=rep.id)
        sesion.add(cuenta)
        sesion.flush()
        rol = RolRepositorio(sesion).obtener_o_crear(TipoRol.REPRESENTANTE)
        cuenta.roles.append(rol)
        sesion.flush()

        sesion.commit()

        assert sesion.execute(text(
            "SELECT representante_id FROM persona WHERE cedula = :c"
        ), {"c": cedulas[1]}).scalar() == rep.id
    finally:
        sesion.rollback()
        sesion.close()
        _limpiar(motor_test, [correo], cedulas)


def test_diferido_rechaza_si_el_rol_nunca_se_otorga(motor_test):
    """Mismo orden que arriba, pero la cuenta del representante NUNCA recibe
    el rol REPRESENTANTE: el diferido rechaza al COMMIT, contra el estado
    final."""
    correo = "rep951@cataclub.test"
    cedulas = (cedula_valida(950), cedula_valida(951))
    sesion = Session(bind=motor_test)
    try:
        rep = Persona(
            nombres="Rep", apellidos="SinRol", cedula=cedulas[0],
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567", activo=True,
        )
        sesion.add(rep)
        sesion.flush()
        alumno = Persona(
            nombres="Hijo", apellidos="SinRol", cedula=cedulas[1],
            fecha_nacimiento=date(2015, 1, 1), telefono="0991234567", activo=True,
            representante_id=rep.id,
        )
        sesion.add(alumno)
        sesion.flush()

        # La cuenta se crea, pero SIN rol: el candado debe rechazar el commit.
        cuenta = Usuario(correo=correo, contrasenia="hash", persona_id=rep.id)
        sesion.add(cuenta)
        sesion.flush()

        with pytest.raises(DBAPIError, match="no tiene el rol REPRESENTANTE"):
            sesion.commit()
    finally:
        sesion.rollback()
        sesion.close()
        _limpiar(motor_test, [correo], cedulas)


# --- El lado inverso: quitar el rol mientras se representa a alguien -------

def test_no_se_puede_quitar_el_rol_mientras_representa_a_un_activo(db_session):
    rep = _sembrar_persona(db_session, 960, date(1990, 1, 1))
    cuenta = _sembrar_cuenta_con_rol(db_session, rep.id, "rep960@cataclub.test")
    _sembrar_persona(db_session, 961, date(2015, 1, 1), rep_id=rep.id)
    _liquidar_diferidos(db_session)

    rol_id = db_session.query(Rol.id).filter_by(tipo_rol=TipoRol.REPRESENTANTE).scalar()
    with pytest.raises(DBAPIError, match="todavía representa"):
        with db_session.begin_nested():
            db_session.execute(text(
                "DELETE FROM usuario_rol WHERE usuario_id = :uid AND rol_id = :rid"
            ), {"uid": cuenta.id, "rid": rol_id})

    assert db_session.execute(text(
        "SELECT count(*) FROM usuario_rol WHERE usuario_id = :uid"
    ), {"uid": cuenta.id}).scalar() == 1


def test_se_puede_quitar_el_rol_sin_representados_activos(db_session):
    rep = _sembrar_persona(db_session, 970, date(1990, 1, 1))
    cuenta = _sembrar_cuenta_con_rol(db_session, rep.id, "rep970@cataclub.test")
    _liquidar_diferidos(db_session)

    rol_id = db_session.query(Rol.id).filter_by(tipo_rol=TipoRol.REPRESENTANTE).scalar()
    db_session.execute(text(
        "DELETE FROM usuario_rol WHERE usuario_id = :uid AND rol_id = :rid"
    ), {"uid": cuenta.id, "rid": rol_id})

    assert db_session.execute(text(
        "SELECT count(*) FROM usuario_rol WHERE usuario_id = :uid"
    ), {"uid": cuenta.id}).scalar() == 0


def test_se_puede_quitar_el_rol_si_el_representado_esta_dado_de_baja(db_session):
    """El invariante protege ACCESO: un representado inactivo (baja lógica)
    no necesita que su representante conserve el rol."""
    rep = _sembrar_persona(db_session, 980, date(1990, 1, 1))
    cuenta = _sembrar_cuenta_con_rol(db_session, rep.id, "rep980@cataclub.test")
    _sembrar_persona(db_session, 981, date(2015, 1, 1), rep_id=rep.id, activo=False)
    _liquidar_diferidos(db_session)

    rol_id = db_session.query(Rol.id).filter_by(tipo_rol=TipoRol.REPRESENTANTE).scalar()
    db_session.execute(text(
        "DELETE FROM usuario_rol WHERE usuario_id = :uid AND rol_id = :rid"
    ), {"uid": cuenta.id, "rid": rol_id})

    assert db_session.execute(text(
        "SELECT count(*) FROM usuario_rol WHERE usuario_id = :uid"
    ), {"uid": cuenta.id}).scalar() == 0


def test_quitar_un_rol_distinto_de_representante_no_pasa_por_el_candado(db_session):
    entrenador = _sembrar_persona(db_session, 990, date(1990, 1, 1))
    cuenta = _sembrar_cuenta_con_rol(db_session, entrenador.id, "ent990@cataclub.test", TipoRol.ENTRENADOR)
    _liquidar_diferidos(db_session)

    rol_id = db_session.query(Rol.id).filter_by(tipo_rol=TipoRol.ENTRENADOR).scalar()
    db_session.execute(text(
        "DELETE FROM usuario_rol WHERE usuario_id = :uid AND rol_id = :rid"
    ), {"uid": cuenta.id, "rid": rol_id})

    assert db_session.execute(text(
        "SELECT count(*) FROM usuario_rol WHERE usuario_id = :uid"
    ), {"uid": cuenta.id}).scalar() == 0


# --- El guard previo al `upgrade()` -----------------------------------------

REVISION_ANTERIOR = "j1142ctarep"
REVISION_CANDADO = "k1143rolrep"

SQL_TRIGGERS = (
    "SELECT tgname FROM pg_trigger WHERE tgrelid IN"
    " ('persona'::regclass, 'usuario_rol'::regclass) AND NOT tgisinternal"
    " AND tgname IN ('trg_persona_exige_rol_representante',"
    " 'trg_usuario_rol_exige_representados_reasignados') ORDER BY tgname"
)


def test_el_guard_aborta_sobre_un_representante_sin_rol_y_no_instala_nada(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    arnes_migracion.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo) VALUES"
        " (1, 'Rep', 'SinRol', '1710034065', DATE '1990-01-01', '0991234567',"
        " TIMESTAMPTZ '2024-03-01 12:00:00+00', true)"
    )
    arnes_migracion.ejecutar(
        "INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,"
        " version_contrasenia, activo, version_sesion, persona_id) VALUES"
        " (1, 'legado1133@cataclub.test', 'hash',"
        " TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, true, 5, 1)"
    )
    arnes_migracion.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo, representante_id) VALUES"
        " (2, 'Menor', 'SinRol', '1710034073', DATE '2015-01-01',"
        " '0991234568', TIMESTAMPTZ '2024-03-01 12:00:00+00', true, 1)"
    )

    with pytest.raises(RuntimeError, match=r"hay 1 persona\(s\) representada\(s\)"):
        arnes_migracion.migrar(REVISION_CANDADO)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_TRIGGERS) == []


def test_el_guard_pasa_sobre_una_base_limpia(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    arnes_migracion.migrar(REVISION_CANDADO)

    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert arnes_migracion.consultar(SQL_TRIGGERS) == [
        ("trg_persona_exige_rol_representante",),
        ("trg_usuario_rol_exige_representados_reasignados",),
    ]


# --- El `downgrade()`/`upgrade()` hacen ida y vuelta -------------------------

def test_el_round_trip_downgrade_upgrade_restaura_el_candado(arnes_migracion):
    arnes_migracion.preparar("head")
    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert arnes_migracion.consultar(SQL_TRIGGERS) == [
        ("trg_persona_exige_rol_representante",),
        ("trg_usuario_rol_exige_representados_reasignados",),
    ]

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_TRIGGERS) == []

    arnes_migracion.migrar(REVISION_CANDADO)
    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert arnes_migracion.consultar(SQL_TRIGGERS) == [
        ("trg_persona_exige_rol_representante",),
        ("trg_usuario_rol_exige_representados_reasignados",),
    ]


# --- El origen nuevo del ledger ----------------------------------------------

def test_el_check_de_origen_admite_alta_publica(db_session):
    """`ck_vinculacion_representante_origen` acepta el valor nuevo que usa
    `EnrollmentServicio` (issue #1133, ledger completo)."""
    from app.dominio.modelos import VinculacionRepresentante

    rep = _sembrar_persona(db_session, 995, date(1990, 1, 1))
    menor = _sembrar_persona(db_session, 996, date(2015, 1, 1), rep_id=rep.id)
    evento = VinculacionRepresentante(
        persona_id=menor.id, actor_persona_id=rep.id,
        representante_anterior_id=None, representante_nuevo_id=rep.id,
        operacion="CREACION", origen="ALTA_PUBLICA",
        idempotency_key=None, request_fingerprint=None,
    )
    db_session.add(evento)
    db_session.flush()
    assert evento.id is not None
