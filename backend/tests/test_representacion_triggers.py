"""Defensa de base para la relación de representación (PR 4, #1133).

El validador compartido de `RelacionRepresentacionServicio` es el camino de
error legible; esta suite demuestra que la BASE es la garantía final: SQL
crudo que bypasea la aplicación choca contra los triggers de la migración
`i1141relinteg` (auto-referencia, ciclos, alta o re-enlace de adulto, alcance del
destino y teléfonos) y contra `ck_persona_representante_no_autoreferencia`,
todo serializado por el mutex documentado del grafo.

Los teléfonos sembrados por ORM ya son válidos (`@validates`); los que esta
suite necesita INVÁLIDOS se siembran por SQL crudo a propósito.

PR 4a ancla los nombres con literales locales: el módulo de dominio
(`app/dominio/representados_alcanzables.py`) recién en PR 4b los adopta como
constantes compartidas (`MUTEX_GRAFO_REPRESENTACION`,
`TRIGGER_RELACION_REPRESENTACION`) y esta suite pasa a importarlas de ahí.
"""
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import Persona, Usuario

# Mismos literales que la migración `i1141relinteg` instala; PR 4b los mueve a
# constantes de dominio con el mismo criterio de `TRIGGER_ROL_UNICO`.
TRIGGER_RELACION_REPRESENTACION = "trg_relacion_representacion_valida"
MUTEX_GRAFO_REPRESENTACION = 7113911370001

TELEFONO_VALIDO = "0991234567"


def _sembrar(db, seed, fnac, rep_id=None, activo=True, cuenta=None,
             telefono=TELEFONO_VALIDO, por_sql=False):
    """Siembra una persona y, opcionalmente, su cuenta (`None`, True o False).
    `por_sql=True` salta los `@validates` del ORM: es la puerta que usa un
    bypasseo real (y la única forma de sembrar un teléfono inválido)."""
    if por_sql:
        db.execute(text(
            "INSERT INTO persona (nombres, apellidos, cedula, fecha_nacimiento,"
            " telefono, activo, representante_id, fecha_registro) VALUES"
            " ('Ana', 'SQL', :ced, CAST(:fnac AS date), :tel, :activo, :rep,"
            " now())"
        ), {"ced": cedula_valida(seed), "fnac": fnac.isoformat(),
            "tel": telefono, "activo": activo, "rep": rep_id})
        persona = db.query(Persona).filter_by(cedula=cedula_valida(seed)).one()
    else:
        persona = Persona(
            nombres="Ana", apellidos="Torres", cedula=cedula_valida(seed),
            fecha_nacimiento=fnac, telefono=telefono, activo=activo,
            representante_id=rep_id,
        )
        db.add(persona)
        db.flush()
    if cuenta is not None:
        db.add(Usuario(
            correo=f"cuenta{persona.id}@cataclub.test", contrasenia="hash",
            persona_id=persona.id, activo=cuenta,
        ))
        db.flush()
    return persona


def _id_de(db, cedula_seed):
    return db.query(Persona.id).filter_by(cedula=cedula_valida(cedula_seed)).scalar()


def _ejecutar_y_preservar(db, sql, params, sondeo):
    """Corre una escritura cruda que DEBE ser rechazada y verifica que el
    grafo quedó intacto (el escenario "la base rechaza y no cambia nada").

    El rechazo va dentro de un SAVEPOINT propio (`begin_nested`): Postgres
    aborta la transacción al dispararse el trigger, y sin el savepoint el
    `rollback()` se llevaría también a los datos sembrados por el test -- el
    aislamiento de la suite es una transacción externa que se revierte al
    final (conftest), no un commit intermedio. El orden de salida de los dos
    managers (savepoint primero, `pytest.raises` después) garantiza que el
    savepoint absorba el error ANTES de que `pytest.raises` lo capture."""
    antes = db.execute(text(sondeo)).all()
    with pytest.raises(DBAPIError), db.begin_nested():
        db.execute(text(sql), params)
    assert db.execute(text(sondeo)).all() == antes


# --- El candado de auto-referencia: CHECK propio, NOT VALID ------------------

def test_la_auto_referencia_tiene_check_propio_aun_no_validado(db_session):
    """El CHECK `ck_persona_representante_no_autoreferencia` existe y nace
    NOT VALID: su validación recién puede correr cuando el inventario de
    remediación (PR 7) demuestre que no queda ninguna auto-referencia."""
    fila = db_session.execute(text(
        "SELECT convalidated FROM pg_constraint WHERE conname ="
        " 'ck_persona_representante_no_autoreferencia'"
    )).scalar()
    assert fila is False


# --- SQL crudo: auto-referencia, ciclos y adulto re-enlazado -----------------

@pytest.mark.parametrize("modo", ["update", "insert"])
def test_sql_directo_rechaza_auto_referencia(db_session, modo):
    rep = _sembrar(db_session, 410, date(1990, 1, 1))
    menor = _sembrar(db_session, 411, date(2020, 1, 1), rep_id=rep.id)
    if modo == "update":
        _ejecutar_y_preservar(
            db_session,
            "UPDATE persona SET representante_id = id WHERE id = :pid",
            {"pid": menor.id},
            "SELECT id, representante_id FROM persona ORDER BY id",
        )
    else:
        _ejecutar_y_preservar(
            db_session,
            "INSERT INTO persona (id, nombres, apellidos, cedula,"
            " fecha_nacimiento, telefono, activo, representante_id,"
            " fecha_registro) VALUES (900001, 'Yo', 'Mismo', :ced,"
            " CAST('2018-01-01' AS date), :tel, true, 900001, now())",
            {"ced": cedula_valida(412), "tel": TELEFONO_VALIDO},
            "SELECT id, representante_id FROM persona ORDER BY id",
        )


def test_sql_directo_rechaza_ciclo_de_dos_y_de_tres(db_session):
    """Cerrar un ciclo (el destino ya es descendiente del objetivo) se
    rechaza aunque las dos puntas sean menores: la edad del DESTINO no la
    defiende la base (eso es invarianta de servicio), la del objetivo sí."""
    ana = _sembrar(db_session, 420, date(2020, 1, 1))
    bea = _sembrar(db_session, 421, date(2020, 2, 1), rep_id=ana.id)
    _ejecutar_y_preservar(
        db_session,
        "UPDATE persona SET representante_id = :destino WHERE id = :pid",
        {"destino": bea.id, "pid": ana.id},
        "SELECT id, representante_id FROM persona ORDER BY id",
    )
    # Ciclo de tres: caro -> bea -> ana; cerrar bea -> caro.
    caro = _sembrar(db_session, 422, date(2020, 3, 1), rep_id=bea.id)
    _ejecutar_y_preservar(
        db_session,
        "UPDATE persona SET representante_id = :destino WHERE id = :pid",
        {"destino": caro.id, "pid": bea.id},
        "SELECT id, representante_id FROM persona ORDER BY id",
    )


def test_sql_directo_rechaza_reenlazar_a_un_adulto(db_session):
    """Un adulto vinculado (fila legada) no puede RE-enlazarse a otro
    representante: el trigger solo admite el camino de desvinculación."""
    viejo = _sembrar(db_session, 430, date(1990, 1, 1), cuenta=True)
    otro = _sembrar(db_session, 431, date(1992, 1, 1), cuenta=True)
    # Fila legada: se vinculó siendo MENOR y envejeció en el sitio (el candado
    # ya no admite el alta cruda de un adulto, ver el test de abajo).
    adulto = _sembrar(db_session, 432, date(2020, 1, 1), rep_id=viejo.id)
    db_session.execute(text(
        "UPDATE persona SET fecha_nacimiento = CAST('2000-01-01' AS date)"
        " WHERE id = :pid"
    ), {"pid": adulto.id})
    db_session.flush()
    _ejecutar_y_preservar(
        db_session,
        "UPDATE persona SET representante_id = :destino WHERE id = :pid",
        {"destino": otro.id, "pid": adulto.id},
        "SELECT id, representante_id FROM persona ORDER BY id",
    )


def test_sql_directo_rechaza_el_alta_de_un_adulto(db_session):
    """El ALTA directa de un adulto (vínculo previo NULL) también la rechaza la
    base: el invariante de edad no depende de que ya existiera vínculo."""
    rep = _sembrar(db_session, 435, date(1990, 1, 1), cuenta=True)
    adulto = _sembrar(db_session, 436, date(1995, 1, 1))
    _ejecutar_y_preservar(
        db_session,
        "UPDATE persona SET representante_id = :destino WHERE id = :pid",
        {"destino": rep.id, "pid": adulto.id},
        "SELECT id, representante_id FROM persona ORDER BY id",
    )


def test_sql_directo_rechaza_el_alta_cruda_de_un_adulto(db_session):
    """El `INSERT` crudo de un adulto ya vinculado también choca contra la base:
    el invariante de edad no depende de que el vínculo llegue por `UPDATE`.
    Antes esta puerta quedaba abierta (solo la cerraba el camino de servicio);
    el candado ahora es total en la base, como exige `design.md`. La fila legada
    real se siembra envejeciendo en el sitio al representado, que es como llega
    a la base sin pasar por un alta de adulto."""
    rep = _sembrar(db_session, 440, date(1990, 1, 1), cuenta=True)
    _ejecutar_y_preservar(
        db_session,
        "INSERT INTO persona (nombres, apellidos, cedula, fecha_nacimiento,"
        " telefono, activo, representante_id, fecha_registro) VALUES ('Ana',"
        " 'SQL', :ced, CAST('1995-01-01' AS date), :tel, true, :rep, now())",
        {"ced": cedula_valida(441), "tel": TELEFONO_VALIDO, "rep": rep.id},
        "SELECT id, representante_id FROM persona ORDER BY id",
    )


def test_envejecido_en_sitio_puede_editar_y_desvincularse(db_session):
    """El menor que cumplió 18 vinculado sigue vinculado: el trigger no
    reevalúa por paso del tiempo (`IS NOT DISTINCT FROM` + alcance por
    columnas). Editar campos ajenos al vínculo no toca el candado, y la
    desvinculación de adulto ya es libre (camino de independencia)."""
    rep = _sembrar(db_session, 450, date(1990, 1, 1))
    menor = _sembrar(db_session, 451, date(2020, 1, 1), rep_id=rep.id)
    db_session.execute(text(
        "UPDATE persona SET fecha_nacimiento = CAST('2005-01-01' AS date)"
        " WHERE id = :pid"
    ), {"pid": menor.id})
    db_session.execute(text(
        "UPDATE persona SET nombres = 'Otro' WHERE id = :pid"
    ), {"pid": menor.id})
    db_session.execute(text(
        "UPDATE persona SET representante_id = NULL WHERE id = :pid"
    ), {"pid": menor.id})
    db_session.flush()


# --- Desvinculación de menores: activo protegido, inactivo libre -------------

@pytest.mark.parametrize("activo,debe_rechazar", [
    (True, True),    # menor activo: nadie lo deja sin representante
    (False, False),  # menor con baja lógica: el invariante no lo cubre
])
def test_sql_directo_desvinculacion_de_menor(db_session, activo, debe_rechazar):
    rep = _sembrar(db_session, 460, date(1990, 1, 1))
    menor = _sembrar(db_session, 461, date(2020, 1, 1), rep_id=rep.id,
                     activo=activo)
    if debe_rechazar:
        _ejecutar_y_preservar(
            db_session,
            "UPDATE persona SET representante_id = NULL WHERE id = :pid",
            {"pid": menor.id},
            "SELECT id, representante_id, activo FROM persona ORDER BY id",
        )
    else:
        db_session.execute(text(
            "UPDATE persona SET representante_id = NULL WHERE id = :pid"
        ), {"pid": menor.id})
        db_session.flush()


# --- El destino: cuenta alcanzable y teléfono válido --------------------------

@pytest.mark.parametrize("por_sql", [False, True], ids=["update", "insert"])
def test_sql_directo_rechaza_destino_con_cuenta_inactiva(db_session, por_sql):
    destino = _sembrar(db_session, 470, date(1990, 1, 1), cuenta=False)
    if por_sql:
        _ejecutar_y_preservar(
            db_session,
            "INSERT INTO persona (nombres, apellidos, cedula, fecha_nacimiento,"
            " telefono, activo, representante_id, fecha_registro) VALUES"
            " ('Nueva', 'SQL', :ced, CAST('2018-01-01' AS date), :tel, true,"
            " :rep, now())",
            {"ced": cedula_valida(471), "tel": TELEFONO_VALIDO,
             "rep": destino.id},
            "SELECT id, representante_id FROM persona ORDER BY id",
        )
    else:
        menor = _sembrar(db_session, 472, date(2020, 1, 1))
        _ejecutar_y_preservar(
            db_session,
            "UPDATE persona SET representante_id = :destino WHERE id = :pid",
            {"destino": destino.id, "pid": menor.id},
            "SELECT id, representante_id FROM persona ORDER BY id",
        )


@pytest.mark.parametrize("por_sql", [False, True], ids=["update", "insert"])
def test_sql_directo_rechaza_destino_con_telefono_invalido(db_session, por_sql):
    """El destino sin teléfono válido no recibe representados: la base lo
    defiende incluso cuando el sembrado bypaseó los `@validates` del ORM."""
    destino = _sembrar(db_session, 480, date(1990, 1, 1), cuenta=True,
                       telefono="123", por_sql=True)
    if por_sql:
        _ejecutar_y_preservar(
            db_session,
            "INSERT INTO persona (nombres, apellidos, cedula, fecha_nacimiento,"
            " telefono, activo, representante_id, fecha_registro) VALUES"
            " ('Nueva', 'SQL', :ced, CAST('2018-01-01' AS date), :tel, true,"
            " :rep, now())",
            {"ced": cedula_valida(481), "tel": TELEFONO_VALIDO,
             "rep": destino.id},
            "SELECT id, representante_id FROM persona ORDER BY id",
        )
    else:
        menor = _sembrar(db_session, 482, date(2020, 1, 1))
        _ejecutar_y_preservar(
            db_session,
            "UPDATE persona SET representante_id = :destino WHERE id = :pid",
            {"destino": destino.id, "pid": menor.id},
            "SELECT id, representante_id FROM persona ORDER BY id",
        )
    # Con el teléfono corregido, el mismo enlace pasa.
    db_session.execute(text(
        "UPDATE persona SET telefono = :tel WHERE id = :pid"
    ), {"tel": "0987654321", "pid": destino.id})
    menor = _sembrar(db_session, 483, date(2020, 1, 1), rep_id=destino.id)
    db_session.flush()
    assert menor.representante_id == destino.id


# --- Teléfono del representante con menores activos ---------------------------

def test_representante_con_menores_no_pone_un_telefono_invalido(db_session):
    rep = _sembrar(db_session, 490, date(1990, 1, 1), cuenta=True)
    _sembrar(db_session, 491, date(2020, 1, 1), rep_id=rep.id)
    _ejecutar_y_preservar(
        db_session,
        "UPDATE persona SET telefono = :tel WHERE id = :pid",
        {"tel": "123", "pid": rep.id},
        "SELECT id, telefono FROM persona ORDER BY id",
    )
    # Un teléfono válido distinto siempre puede cargarse.
    db_session.execute(text(
        "UPDATE persona SET telefono = :tel WHERE id = :pid"
    ), {"tel": "0987654321", "pid": rep.id})
    db_session.flush()


def test_representante_sin_menores_puede_dejar_un_telefono_invalido(db_session):
    """El safeguard del teléfono protege a los DEPENDIENTES menores activos:
    sin ellos, la persona puede guardar lo que quiera en su teléfono."""
    rep = _sembrar(db_session, 500, date(1990, 1, 1), cuenta=True)
    # Dependiente adulto por envejecimiento en el sitio: el alta cruda de un
    # adulto ya la rechaza la base, y este test necesita que NO haya menores
    # activos que disparen el safeguard del teléfono.
    dependiente = _sembrar(db_session, 501, date(2020, 1, 1), rep_id=rep.id)
    db_session.execute(text(
        "UPDATE persona SET fecha_nacimiento = CAST('2000-01-01' AS date)"
        " WHERE id = :pid"
    ), {"pid": dependiente.id})
    db_session.flush()
    db_session.execute(text(
        "UPDATE persona SET telefono = :tel WHERE id = :pid"
    ), {"tel": "123", "pid": rep.id})
    db_session.flush()


def test_reescribir_el_mismo_telefono_no_pasa_por_el_guardia(db_session):
    """`IS NOT DISTINCT FROM`: reescribir el mismo valor (aunque sea feo)
    no reevalúa nada — el trigger no convierte en congelada una fila legada.
    La fila fea acá tiene un dependiente INACTIVO: con un menor ACTIVO, el
    propio safeguard del teléfono impide que la fila se vuelva fea (lo cubre
    `test_representante_con_menores_no_pone_un_telefono_invalido`), así que
    ese estado solo existe como fila legada."""
    rep = _sembrar(db_session, 510, date(1990, 1, 1), cuenta=True)
    _sembrar(db_session, 511, date(2020, 1, 1), rep_id=rep.id, activo=False)
    db_session.execute(text(
        "UPDATE persona SET telefono = :tel WHERE id = :pid"
    ), {"tel": "123", "pid": rep.id})
    db_session.flush()
    # Reescribir el MISMO valor feo no reevalúa nada.
    db_session.execute(text(
        "UPDATE persona SET telefono = :tel WHERE id = :pid"
    ), {"tel": "123", "pid": rep.id})
    db_session.flush()


def test_los_triggers_no_reevaluan_escrituras_ajenas(db_session):
    """Alcance: cambiar nombre/estado de una persona con teléfono feo y
    vínculo legado no dispara ningún candado (solo `representante_id` y
    `telefono` tienen guardia). El teléfono feo del representante acá es
    alcanzable porque su dependiente es ADULTO (el safeguard del teléfono
    solo frena con menores activos) y el vínculo se sembró ANTES de
    ensuciarlo, como lo haría una fila legada (menor vinculado que envejeció en
    el sitio: el alta cruda de un adulto ya la rechaza la base)."""
    rep = _sembrar(db_session, 520, date(1990, 1, 1), cuenta=True)
    adulto = _sembrar(db_session, 521, date(2020, 1, 1), rep_id=rep.id)
    db_session.execute(text(
        "UPDATE persona SET fecha_nacimiento = CAST('1995-01-01' AS date)"
        " WHERE id = :pid"
    ), {"pid": adulto.id})
    db_session.flush()
    db_session.execute(text(
        "UPDATE persona SET telefono = '0000000000' WHERE id = :pid"
    ), {"pid": rep.id})
    db_session.flush()
    db_session.execute(text(
        "UPDATE persona SET nombres = :nom, activo = false WHERE id = :pid"
    ), {"nom": "Editada", "pid": adulto.id})
    db_session.execute(text(
        "UPDATE persona SET nombres = 'Otro' WHERE id = :pid"
    ), {"pid": rep.id})
    db_session.flush()


# --- El mutex del grafo es el documentado ------------------------------------

def test_el_mutex_del_grafo_serializa_las_escrituras(db_session, motor_test):
    """El trigger toma `pg_advisory_xact_lock(MUTEX_GRAFO_REPRESENTACION)`:
    otra transacción que ya tenga esa llave bloquea cualquier escritura de
    `representante_id` (con lock_timeout, la cancela) — la prueba de que la
    serialización del grafo usa LA llave documentada, no otra."""
    rep = _sembrar(db_session, 530, date(1990, 1, 1), cuenta=True)
    menor = _sembrar(db_session, 531, date(2020, 1, 1))

    bloqueo = motor_test.connect()
    try:
        bloqueo.execute(text("SELECT pg_advisory_xact_lock(:k)"),
                        {"k": MUTEX_GRAFO_REPRESENTACION})
        db_session.execute(text("SET LOCAL lock_timeout = '400ms'"))
        # El rechazo va en SAVEPOINT propio (misma razón que
        # `_ejecutar_y_preservar`): sin él, el rollback mataría a los datos
        # sembrados y el "liberado el mutex pasa" de abajo sería un no-op.
        with pytest.raises(DBAPIError), db_session.begin_nested():
            db_session.execute(text(
                "UPDATE persona SET representante_id = :destino WHERE id = :pid"
            ), {"destino": rep.id, "pid": menor.id})
    finally:
        bloqueo.rollback()
        bloqueo.close()

    # Liberado el mutex, la misma escritura pasa y queda persistida.
    db_session.execute(text(
        "UPDATE persona SET representante_id = :destino WHERE id = :pid"
    ), {"destino": rep.id, "pid": menor.id})
    db_session.flush()
    assert db_session.execute(text(
        "SELECT representante_id FROM persona WHERE id = :pid"
    ), {"pid": menor.id}).scalar() == rep.id
    assert TRIGGER_RELACION_REPRESENTACION  # el nombre vive junto a la regla
