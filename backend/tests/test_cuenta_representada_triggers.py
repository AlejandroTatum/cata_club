"""Candado de base para la cuenta de un representado (issue #1137, Fase 4).

Invariante B: una persona con `Persona.representante_id` no nulo nunca tiene
una fila en `usuario`. Las Fases 1-3 cerraron cada camino de aplicación que
podía violarlo; esta suite demuestra que la BASE es la garantía final: SQL
crudo que bypasea la aplicación choca contra los dos triggers de la
migración `j1142ctarep` (uno por tabla y por dirección de la escritura),
serializados por el mismo mecanismo de mutex de fila que
`g1139repmenor`/`i1141relinteg` usan para el invariante A.
"""
import threading
import time
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona, Usuario


def _sembrar_persona(db, seed, fnac, rep_id=None, activo=True):
    persona = Persona(
        nombres="Ana", apellidos="Torres", cedula=cedula_valida(seed),
        fecha_nacimiento=fnac, telefono="0991234567", activo=activo,
        representante_id=rep_id,
    )
    db.add(persona)
    db.flush()
    return persona


def _sembrar_cuenta(db, persona_id, correo):
    cuenta = Usuario(correo=correo, contrasenia="hash", persona_id=persona_id)
    db.add(cuenta)
    db.flush()
    return cuenta


def _liquidar_diferidos(db):
    """Fuerza la evaluación de los `CONSTRAINT TRIGGER ... DEFERRED`
    pendientes AHORA, contra el estado actual (correcto en este punto de la
    siembra). Sin esto, el chequeo de sembrar una cuenta sana quedaría
    pendiente hasta el `SET CONSTRAINTS` del propio `_ejecutar_y_preservar`
    y se re-evaluaría ahí con el estado YA atacado -- confundiendo cuál de
    los dos triggers rechazó qué."""
    db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


def _ejecutar_y_preservar(db, sql, params, sondeo):
    """Corre una escritura cruda que DEBE ser rechazada y verifica que el
    grafo quedó intacto (el escenario "la base rechaza y no cambia nada").
    Mismo criterio que `test_representacion_triggers.py`: el rechazo va
    dentro de un SAVEPOINT propio porque Postgres aborta la transacción al
    dispararse el trigger.

    `SET CONSTRAINTS ALL IMMEDIATE` fuerza la evaluación de los dos
    `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` de la migración:
    diferidos, solo se evalúan en el `COMMIT` real de la transacción, y
    `db_session` nunca comitea (aísla con `rollback()` en el teardown) --
    sin este forzado, la escritura ofensiva pasaría en silencio y el
    `SAVEPOINT` se liberaría sin que el trigger llegara a correr."""
    antes = db.execute(text(sondeo)).all()
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text(sql), params)
        db.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    assert db.execute(text(sondeo)).all() == antes


# --- SQL crudo: la cuenta no puede llegar a un representado -----------------

def test_sql_directo_rechaza_el_alta_de_cuenta_para_un_representado(db_session):
    rep = _sembrar_persona(db_session, 700, date(1990, 1, 1))
    menor = _sembrar_persona(db_session, 701, date(2020, 1, 1), rep_id=rep.id)
    _ejecutar_y_preservar(
        db_session,
        "INSERT INTO usuario (correo, contrasenia, persona_id, fecha_creacion,"
        " version_contrasenia, activo) VALUES (:correo, 'hash', :pid, now(),"
        " 1, true)",
        {"correo": "cuenta701@cataclub.test", "pid": menor.id},
        "SELECT id, persona_id FROM usuario ORDER BY id",
    )


def test_sql_directo_rechaza_reapuntar_una_cuenta_a_un_representado(db_session):
    rep = _sembrar_persona(db_session, 710, date(1990, 1, 1))
    otro = _sembrar_persona(db_session, 711, date(1992, 1, 1))
    cuenta = _sembrar_cuenta(db_session, otro.id, "cuenta711@cataclub.test")
    menor = _sembrar_persona(db_session, 712, date(2020, 1, 1), rep_id=rep.id)
    _ejecutar_y_preservar(
        db_session,
        "UPDATE usuario SET persona_id = :pid WHERE id = :uid",
        {"pid": menor.id, "uid": cuenta.id},
        "SELECT id, persona_id FROM usuario ORDER BY id",
    )


def test_sql_directo_rechaza_vincular_un_representante_a_quien_ya_tiene_cuenta(
    db_session,
):
    """El destino tiene que ser MENOR (el candado de `i1141relinteg` ya
    rechaza vincular a un adulto por edad, sin llegar a evaluar este
    candado): una cuenta de menor sembrada por SQL crudo -- nada distinto lo
    impide hoy -- es exactamente el bypass que el invariante B cierra."""
    rep = _sembrar_persona(db_session, 720, date(1990, 1, 1))
    menor = _sembrar_persona(db_session, 721, date(2020, 1, 1))
    _sembrar_cuenta(db_session, menor.id, "cuenta721@cataclub.test")
    # Liquida el candado diferido de la cuenta recién sembrada MIENTRAS
    # `menor` todavía no tiene representante: si quedara pendiente, el
    # `SET CONSTRAINTS` de `_ejecutar_y_preservar` lo re-evaluaría contra el
    # estado YA atacado (representante_id seteado) y el rechazo saldría del
    # trigger de `usuario`, no del de `persona` que este test ejercita.
    _liquidar_diferidos(db_session)
    _ejecutar_y_preservar(
        db_session,
        "UPDATE persona SET representante_id = :destino WHERE id = :pid",
        {"destino": rep.id, "pid": menor.id},
        "SELECT id, representante_id FROM persona ORDER BY id",
    )


def test_una_cuenta_normal_y_un_vinculo_normal_siguen_funcionando(db_session):
    """El candado no frena el camino sano: un adulto con cuenta propia sin
    representante, y un menor vinculado sin cuenta propia."""
    adulto = _sembrar_persona(db_session, 730, date(1990, 1, 1))
    _sembrar_cuenta(db_session, adulto.id, "cuenta730@cataclub.test")
    rep = _sembrar_persona(db_session, 731, date(1985, 1, 1))
    menor = _sembrar_persona(db_session, 732, date(2020, 1, 1), rep_id=rep.id)

    assert db_session.execute(text(
        "SELECT persona_id FROM usuario WHERE persona_id = :pid"
    ), {"pid": adulto.id}).scalar() == adulto.id
    assert menor.representante_id == rep.id


# --- El guard previo al `upgrade()` -----------------------------------------

REVISION_ANTERIOR = "i1141relinteg"
REVISION_CANDADO = "j1142ctarep"

SQL_TRIGGERS = (
    "SELECT tgname FROM pg_trigger WHERE tgrelid IN"
    " ('usuario'::regclass, 'persona'::regclass) AND NOT tgisinternal"
    " AND tgname IN ('trg_usuario_bloquea_cuenta_de_representado',"
    " 'trg_persona_bloquea_vinculo_con_cuenta') ORDER BY tgname"
)


def _sembrar_par_legado(arnes):
    """Un representante, su representado y la cuenta del representado --
    exactamente el par que el invariante B prohíbe -- sembrado con SQL
    crudo (el ORM describe el esquema de HOY, no el de la revisión bajo
    prueba). El representado se vincula siendo MENOR y envejece en el
    sitio: el candado de relación de `i1141relinteg`, ya activo en
    `REVISION_ANTERIOR`, rechaza el alta cruda de un adulto ya vinculado, así
    que una fila legada real solo puede llegar a la base por ese camino."""
    arnes.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo) VALUES"
        " (1, 'Rep', 'Legado', '1710034065', DATE '1990-01-01', '0991234567',"
        " TIMESTAMPTZ '2024-03-01 12:00:00+00', true)"
    )
    arnes.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo, representante_id) VALUES"
        " (2, 'Representado', 'Legado', '1710034073', DATE '2015-01-01',"
        " '0991234568', TIMESTAMPTZ '2024-03-01 12:00:00+00', true, 1)"
    )
    arnes.ejecutar(
        "UPDATE persona SET fecha_nacimiento = DATE '1995-01-01' WHERE id = 2"
    )
    arnes.ejecutar(
        "INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,"
        " version_contrasenia, activo, version_sesion, persona_id) VALUES"
        " (1, 'legado@cataclub.test', 'hash',"
        " TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, true, 5, 2)"
    )


def test_el_guard_aborta_sobre_un_par_legado_y_no_instala_nada(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_par_legado(arnes_migracion)

    with pytest.raises(RuntimeError, match=r"hay 1 personas representadas"):
        arnes_migracion.migrar(REVISION_CANDADO)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_TRIGGERS) == []


def test_el_guard_pasa_sobre_una_base_limpia(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    arnes_migracion.migrar(REVISION_CANDADO)

    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert arnes_migracion.consultar(SQL_TRIGGERS) == [
        ("trg_persona_bloquea_vinculo_con_cuenta",),
        ("trg_usuario_bloquea_cuenta_de_representado",),
    ]


# --- El `downgrade()`/`upgrade()` hacen ida y vuelta -------------------------

def test_el_round_trip_downgrade_upgrade_restaura_el_candado(arnes_migracion):
    """Mismo criterio que `test_representados_alcanzables.py` para
    `i1141relinteg`: `REVISION_CANDADO -> REVISION_ANTERIOR -> REVISION_CANDADO`,
    verificando que el candado reinstalado vuelve a rechazar el mismo alta
    cruda. Se ancla en `REVISION_CANDADO`, no en `"head"`: una migración
    posterior (`k1143rolrep`, issue #1133) agrega candados propios que no
    son parte de lo que ESTE test verifica."""
    arnes_migracion.preparar(REVISION_CANDADO)
    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert arnes_migracion.consultar(SQL_TRIGGERS) == [
        ("trg_persona_bloquea_vinculo_con_cuenta",),
        ("trg_usuario_bloquea_cuenta_de_representado",),
    ]

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_TRIGGERS) == []

    arnes_migracion.migrar(REVISION_CANDADO)
    assert arnes_migracion.revision_actual() == REVISION_CANDADO
    assert arnes_migracion.consultar(SQL_TRIGGERS) == [
        ("trg_persona_bloquea_vinculo_con_cuenta",),
        ("trg_usuario_bloquea_cuenta_de_representado",),
    ]

    # Reinstalado, el candado vuelve a rechazar el mismo alta cruda.
    arnes_migracion.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo) VALUES"
        " (100, 'Rep', 'Vuelta', '1710034099', DATE '1990-01-01',"
        " '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', true)"
    )
    arnes_migracion.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, fecha_registro, activo, representante_id) VALUES"
        " (101, 'Menor', 'Vuelta', '1710034107', DATE '2020-01-01',"
        " '0991234568', TIMESTAMPTZ '2024-03-01 12:00:00+00', true, 100)"
    )
    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar(
            "INSERT INTO usuario (correo, contrasenia, persona_id)"
            " VALUES ('vuelta@cataclub.test', 'hash', 101)"
        )


# --- El diferido tolera la reordenación legítima dentro de UN commit --------

def _limpiar_conc(motor_test, correos, cedulas):
    """Limpieza en una sesión FRESCA (mismo criterio que `escenario_ultimo_admin`
    en `test_invariantes_constraints.py`): la sesión del test puede haber
    quedado en una transacción abortada si el escenario fue el de RED."""
    limpieza = Session(bind=motor_test)
    try:
        if correos:
            limpieza.execute(text(
                "DELETE FROM usuario WHERE correo = ANY(:correos)"
            ), {"correos": list(correos)})
        if cedulas:
            limpieza.execute(text(
                "DELETE FROM persona WHERE cedula = ANY(:cedulas)"
            ), {"cedulas": list(cedulas)})
        limpieza.commit()
    finally:
        limpieza.close()


def test_diferido_permite_credenciales_y_desvinculo_en_el_mismo_commit(motor_test):
    """Espeja `RelacionRepresentacionServicio.independizar_presencial` (PR 3,
    #1137): dentro de UNA transacción real, insertar la cuenta MIENTRAS
    `representante_id` sigue seteado y recién después cortar el vínculo, con
    un solo `COMMIT` al final. `DEFERRABLE INITIALLY DEFERRED` evalúa el
    estado FINAL de la transacción, no el intermedio -- por eso este orden,
    que un trigger `BEFORE` inmediato rechazaría, tiene que pasar."""
    correo = "fixup741@cataclub.test"
    cedulas = (cedula_valida(740), cedula_valida(741))
    sesion = Session(bind=motor_test)
    try:
        rep = Persona(
            nombres="Rep", apellidos="Fixup", cedula=cedulas[0],
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567", activo=True,
        )
        sesion.add(rep)
        sesion.flush()
        adulto = Persona(
            nombres="Hijo", apellidos="Fixup", cedula=cedulas[1],
            fecha_nacimiento=date(2015, 1, 1), telefono="0991234567", activo=True,
            representante_id=rep.id,
        )
        sesion.add(adulto)
        sesion.flush()
        sesion.commit()
        adulto_id = adulto.id
        # Fila legada: se vincula siendo MENOR y envejece en el sitio -- el
        # candado de `i1141relinteg` ya rechaza el alta cruda de un adulto
        # vinculado (mismo criterio que `_sembrar_par_legado` más arriba).
        sesion.execute(text(
            "UPDATE persona SET fecha_nacimiento = DATE '2000-01-01' WHERE id = :pid"
        ), {"pid": adulto_id})
        sesion.flush()

        # Paso 4 de `independizar_presencial`: la cuenta nace con el vínculo
        # TODAVÍA vivo.
        sesion.execute(text(
            "INSERT INTO usuario (correo, contrasenia, persona_id, fecha_creacion,"
            " version_contrasenia, activo) VALUES (:correo, 'hash', :pid, now(),"
            " 1, true)"
        ), {"correo": correo, "pid": adulto_id})
        # Paso 6: recién ahora se corta el vínculo.
        sesion.execute(text(
            "UPDATE persona SET representante_id = NULL WHERE id = :pid"
        ), {"pid": adulto_id})
        # Paso 9: el ÚNICO commit -- acá disparan los dos diferidos, contra
        # el estado FINAL (sin vínculo), que es el que tiene que pasar.
        sesion.commit()

        assert sesion.execute(text(
            "SELECT representante_id FROM persona WHERE id = :pid"
        ), {"pid": adulto_id}).scalar() is None
        assert sesion.execute(text(
            "SELECT correo FROM usuario WHERE persona_id = :pid"
        ), {"pid": adulto_id}).scalar() == correo
    finally:
        sesion.rollback()
        sesion.close()
        _limpiar_conc(motor_test, [correo], cedulas)


# --- Concurrencia real: dos conexiones, el lock de fila serializa ------------

def test_concurrencia_vinculo_abierto_bloquea_y_rechaza_la_cuenta(motor_test):
    """Análogo a `test_representacion_triggers.py::
    test_el_mutex_del_grafo_serializa_las_escrituras`, pero sobre el lock de
    FILA de este candado (no un `pg_advisory_xact_lock`): la conexión A deja
    abierto un `UPDATE persona SET representante_id = ...` sin comitear --
    esa sentencia ya tiene la fila en modo `FOR NO KEY UPDATE` desde que
    corrió, antes de que ningún trigger se dispare. La conexión B inserta una
    cuenta para ESA misma persona; su `COMMIT` dispara el diferido de
    `usuario`, que pide `FOR UPDATE` sobre la misma fila -- choca con el lock
    de A y B se bloquea de verdad. Cuando A comitea, B se desbloquea, relee
    el vínculo ya visible y su commit falla."""
    correo = "conc751@cataclub.test"
    cedulas = (cedula_valida(750), cedula_valida(751))
    sesion = Session(bind=motor_test)
    conn_a = None
    try:
        rep = Persona(
            nombres="Rep", apellidos="Conc", cedula=cedulas[0],
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567", activo=True,
        )
        sesion.add(rep)
        menor = Persona(
            nombres="Menor", apellidos="Conc", cedula=cedulas[1],
            fecha_nacimiento=date(2015, 1, 1), telefono="0991234567", activo=True,
        )
        sesion.add(menor)
        sesion.flush()
        sesion.commit()
        rep_id, menor_id = rep.id, menor.id

        conn_a = motor_test.connect()
        tx_a = conn_a.begin()
        conn_a.execute(text(
            "UPDATE persona SET representante_id = :rep WHERE id = :menor"
        ), {"rep": rep_id, "menor": menor_id})

        resultado: dict = {}
        listo = threading.Event()

        def hilo_b():
            conn_b = motor_test.connect()
            tx_b = conn_b.begin()
            try:
                # Techo determinístico: si el lock de fila no fuera EL mismo,
                # esto se cuelga en vez de fallar con un DBAPIError legible.
                conn_b.execute(text("SET lock_timeout = '4000ms'"))
                conn_b.execute(text(
                    "INSERT INTO usuario (correo, contrasenia, persona_id,"
                    " fecha_creacion, version_contrasenia, activo) VALUES"
                    " (:correo, 'hash', :menor, now(), 1, true)"
                ), {"correo": correo, "menor": menor_id})
                listo.set()
                tx_b.commit()
                resultado["ok"] = True
            except Exception as error:  # noqa: BLE001 -- el test inspecciona el fallo
                resultado["error"] = error
                tx_b.rollback()
            finally:
                conn_b.close()

        hilo = threading.Thread(target=hilo_b)
        hilo.start()
        assert listo.wait(timeout=2), "B nunca llegó a intentar el commit"
        # Ventana corta y determinística para que B entre de verdad en la
        # espera del `FOR UPDATE` antes de que A comitee.
        time.sleep(0.3)
        assert hilo.is_alive(), "B debería seguir bloqueado por el lock de fila de A"

        tx_a.commit()
        conn_a.close()
        conn_a = None

        hilo.join(timeout=10)
        assert not hilo.is_alive(), "B debería haberse desbloqueado y terminado"
        assert "error" in resultado, "el commit de B debería haber fallado"
        assert "está representada" in str(resultado["error"])

        assert sesion.execute(text(
            "SELECT representante_id FROM persona WHERE id = :pid"
        ), {"pid": menor_id}).scalar() == rep_id
        assert sesion.execute(text(
            "SELECT count(*) FROM usuario WHERE persona_id = :pid"
        ), {"pid": menor_id}).scalar() == 0
    finally:
        if conn_a is not None:
            conn_a.close()
        sesion.rollback()
        sesion.close()
        _limpiar_conc(motor_test, [correo], cedulas)


def test_concurrencia_cuenta_abierta_y_vinculo_despues(motor_test):
    """Orden simétrico del test anterior: la conexión A inserta la cuenta
    PRIMERO y la deja abierta (sin comitear); la conexión B vincula a la
    MISMA persona con un representante y comitea.

    Acá NO hay bloqueo real, y es correcto que no lo haya: el `INSERT` de A
    solo toma, sobre la fila de `persona`, el lock `FOR KEY SHARE` que exige
    la FK `usuario.persona_id -> persona.id` -- ese modo NO choca con el
    `FOR NO KEY UPDATE` que toma el `UPDATE` de B (no toca ninguna columna de
    clave), así que B no espera nada y comitea de una, viendo (por MVCC) que
    todavía no existe ninguna cuenta para esa persona. Cuando A finalmente
    intenta comitear, su diferido relee el vínculo YA visible -- comiteado
    por B -- y lo rechaza. El invariante igual queda protegido: lo logra el
    lado que comitea SEGUNDO, no un bloqueo."""
    correo = "conc761@cataclub.test"
    cedulas = (cedula_valida(760), cedula_valida(761))
    sesion = Session(bind=motor_test)
    conn_a = None
    try:
        rep = Persona(
            nombres="Rep", apellidos="Conc2", cedula=cedulas[0],
            fecha_nacimiento=date(1990, 1, 1), telefono="0991234567", activo=True,
        )
        sesion.add(rep)
        menor = Persona(
            nombres="Menor", apellidos="Conc2", cedula=cedulas[1],
            fecha_nacimiento=date(2015, 1, 1), telefono="0991234567", activo=True,
        )
        sesion.add(menor)
        sesion.flush()
        sesion.commit()
        rep_id, menor_id = rep.id, menor.id

        conn_a = motor_test.connect()
        tx_a = conn_a.begin()
        conn_a.execute(text("SET lock_timeout = '4000ms'"))
        conn_a.execute(text(
            "INSERT INTO usuario (correo, contrasenia, persona_id, fecha_creacion,"
            " version_contrasenia, activo) VALUES (:correo, 'hash', :menor, now(),"
            " 1, true)"
        ), {"correo": correo, "menor": menor_id})

        # B vincula y comitea SIN esperar a A -- ver el docstring. Techo
        # determinístico también acá: si el análisis de arriba fuera
        # incorrecto y B SÍ quedara esperando a A, esto falla con un
        # DBAPIError legible en vez de colgar el test.
        conn_b = motor_test.connect()
        tx_b = conn_b.begin()
        conn_b.execute(text("SET lock_timeout = '4000ms'"))
        conn_b.execute(text(
            "UPDATE persona SET representante_id = :rep WHERE id = :menor"
        ), {"rep": rep_id, "menor": menor_id})
        tx_b.commit()
        conn_b.close()

        # Recién ahora A intenta comitear: su diferido ve el vínculo YA
        # comiteado por B y lo rechaza.
        with pytest.raises(DBAPIError, match="está representada"):
            tx_a.commit()
        conn_a.rollback()
        conn_a.close()
        conn_a = None

        assert sesion.execute(text(
            "SELECT representante_id FROM persona WHERE id = :pid"
        ), {"pid": menor_id}).scalar() == rep_id
        assert sesion.execute(text(
            "SELECT count(*) FROM usuario WHERE persona_id = :pid"
        ), {"pid": menor_id}).scalar() == 0
    finally:
        if conn_a is not None:
            conn_a.rollback()
            conn_a.close()
        sesion.rollback()
        sesion.close()
        _limpiar_conc(motor_test, [correo], cedulas)
