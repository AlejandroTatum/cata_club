"""
Candado del issue #828: la identidad de una `Persona` se valida en el
MODELO, no solo en el DTO.

`es_cedula_valida` y `es_telefono_valido` viven en `app/dominio/` desde el
PR 4b, pero hasta este cambio su único invocador eran los validadores
Pydantic de `presentacion/schemas/validadores.py`. Cualquier escritura que
no pasara por un DTO -- un servicio que arma el ORM a mano, un script, un
seed, `PersonaRepositorio.actualizar()` con un dict crudo -- podía persistir
una cédula con dígito verificador roto o un teléfono con forma imposible.
Una regla que solo corre en la puerta de entrada no es un invariante.

Este archivo prueba las DOS capas del arreglo, por separado:

- Capa ORM (`@validates`): reusa los validadores canónicos del dominio, así
  que cubre forma + provincia + dígito verificador. Se prueba escribiendo
  por `db_session` directo, sin DTO ni endpoint (el "Candado" textual del
  issue).
- Capa base de datos (`CheckConstraint`): cubre la FORMA de `cedula`,
  `telefono_contacto` y `telefono_emergencia`, y se prueba con SQL crudo que
  esquiva el ORM por completo. Sin este segundo grupo, un `@validates` que
  alguien borre sin querer dejaría el archivo en verde.

DOS LÍMITES CONOCIDOS Y DELIBERADOS, los dos con un test que los fija:

1. El dígito verificador NO está en la base de datos. Implementarlo en
   PL/pgSQL sería una segunda copia del algoritmo en otro lenguaje, que es
   exactamente el defecto que el carril de identidad existe para borrar. Ver
   `test_sql_crudo_admite_cedula_con_forma_valida_y_verificador_roto`.
2. `persona.telefono` NO tiene CHECK en la base: su garantía es solo el
   `@validates`. Cualquier constraint sobre esa columna dejaría la fila de
   bootstrap de staging (`telefono = '0000000000'`) imposible de actualizar
   en cualquier campo, porque Postgres reevalúa el CHECK contra la fila
   nueva completa en cada UPDATE. Ver
   `test_sql_crudo_con_telefono_sin_forma_entra_porque_no_hay_check` y el
   docstring de la migración `f1a7ident828`.

Los dos huecos están escritos, no escondidos: cerrarlos rompe su test, y
romperlo tiene que ser un acto deliberado.
"""
from datetime import date

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.dominio.cedula import cedula_valida
from app.dominio.modelos import FichaMedica, Persona
from app.dominio.enums import TipoSangre
from app.infraestructura.repositorios.persona_repositorio import PersonaRepositorio

# Diez dígitos y provincia `17` (Pichincha), pero el décimo dígito NO cierra
# el módulo 10: pasa cualquier `pattern=r"^\d{10}$"` y no es una cédula.
CEDULA_VERIFICADOR_ROTO = "1710034060"
# Provincia inexistente (`99` no está en `01`-`24` ni es `30`).
CEDULA_PROVINCIA_INEXISTENTE = "9910034060"
# Ni siquiera tiene la forma: menos de diez dígitos.
CEDULA_SIN_FORMA = "12345"
CEDULA_OK = cedula_valida(828)

TELEFONO_OK = "0991234567"
# Diez dígitos que no empiezan en `09`: la fila legacy de staging.
TELEFONO_TODO_CEROS = "0000000000"
TELEFONO_CON_LETRAS = "09A1234567"


def _persona(**overrides) -> Persona:
    datos = dict(
        nombres="Ada", apellidos="Lovelace", cedula=CEDULA_OK,
        fecha_nacimiento=date(1990, 1, 1), telefono=TELEFONO_OK,
    )
    datos.update(overrides)
    return Persona(**datos)


# --- Capa ORM: cédula -------------------------------------------------------
def test_cedula_invalida_por_db_session_directo_es_rechazada(db_session):
    """El "Candado" textual del issue #828: persistir una `Persona` con
    cédula inválida por `db_session` directo, sin pasar por ningún DTO ni
    endpoint, debe ser rechazado."""
    with pytest.raises(ValueError):
        persona = _persona(cedula=CEDULA_VERIFICADOR_ROTO)
        db_session.add(persona)
        db_session.commit()

    db_session.rollback()
    assert db_session.query(Persona).filter(
        Persona.cedula == CEDULA_VERIFICADOR_ROTO
    ).first() is None


def test_cedula_con_provincia_inexistente_es_rechazada(db_session):
    with pytest.raises(ValueError):
        db_session.add(_persona(cedula=CEDULA_PROVINCIA_INEXISTENTE))
        db_session.commit()
    db_session.rollback()


def test_cedula_sin_forma_es_rechazada(db_session):
    with pytest.raises(ValueError):
        db_session.add(_persona(cedula=CEDULA_SIN_FORMA))
        db_session.commit()
    db_session.rollback()


def test_cedula_vacia_es_rechazada(db_session):
    """A diferencia del teléfono, la cédula NO tolera `""`: es NOT NULL y
    única, y una cédula vacía no representa ninguna persona."""
    with pytest.raises(ValueError):
        db_session.add(_persona(cedula=""))
        db_session.commit()
    db_session.rollback()


# --- Capa ORM: teléfono -----------------------------------------------------
def test_telefono_invalido_por_db_session_directo_es_rechazado(db_session):
    """Mismo candado que la cédula, para `persona.telefono` -- y para esta
    columna es el ÚNICO: es la única de las cuatro sin CHECK en la base
    (ver `test_sql_crudo_con_telefono_sin_forma_entra_porque_no_hay_check` y
    el docstring de la migración `f1a7ident828`). Si alguien borra el
    `@validates` de `telefono`, no queda ninguna otra red: este test es la
    que tiene que ponerse roja."""
    with pytest.raises(ValueError):
        db_session.add(_persona(telefono=TELEFONO_TODO_CEROS))
        db_session.commit()

    db_session.rollback()
    assert db_session.query(Persona).filter(
        Persona.telefono == TELEFONO_TODO_CEROS
    ).first() is None


def test_telefono_con_letras_es_rechazado(db_session):
    with pytest.raises(ValueError):
        db_session.add(_persona(telefono=TELEFONO_CON_LETRAS))
        db_session.commit()
    db_session.rollback()


def test_telefono_contacto_invalido_es_rechazado(db_session):
    with pytest.raises(ValueError):
        db_session.add(_persona(telefono_contacto="123"))
        db_session.commit()
    db_session.rollback()


# --- Capa ORM: lo que SÍ tiene que entrar -----------------------------------
def test_persona_valida_persiste(db_session):
    persona = _persona(telefono_contacto="022345678")
    db_session.add(persona)
    db_session.commit()

    guardada = db_session.query(Persona).filter(Persona.cedula == CEDULA_OK).one()
    assert guardada.telefono == TELEFONO_OK
    assert guardada.telefono_contacto == "022345678"


def test_telefono_contacto_acepta_none(db_session):
    db_session.add(_persona(telefono_contacto=None))
    db_session.commit()
    assert db_session.query(Persona).filter(Persona.cedula == CEDULA_OK).one().telefono_contacto is None


def test_telefono_acepta_cadena_vacia(db_session):
    """`""` significa "sin teléfono", no "teléfono inválido".

    `tests/test_auth_perfil_propio.py::test_auth_me_telefono_vacio_si_persona_sin_telefono`
    construye a propósito una `Persona` con `telefono=""` y afirma que
    `/auth/me` devuelve la cadena vacía. Es comportamiento vigente, así que
    el invariante tolera la ausencia en las columnas de teléfono en vez de
    reescribir ese contrato."""
    db_session.add(_persona(telefono="", telefono_contacto=""))
    db_session.commit()

    guardada = db_session.query(Persona).filter(Persona.cedula == CEDULA_OK).one()
    assert guardada.telefono == ""
    assert guardada.telefono_contacto == ""


# --- Capa ORM: caminos de UPDATE -------------------------------------------
def test_update_directo_no_puede_introducir_cedula_invalida(db_session):
    persona = _persona()
    db_session.add(persona)
    db_session.commit()

    with pytest.raises(ValueError):
        persona.cedula = CEDULA_VERIFICADOR_ROTO

    db_session.rollback()
    assert db_session.query(Persona).filter(Persona.cedula == CEDULA_OK).one() is not None


def test_persona_repositorio_actualizar_no_puede_introducir_cedula_invalida(db_session):
    """`PersonaRepositorio.actualizar()` recorre un dict crudo con `setattr`
    (persona_repositorio.py) -- es la superficie genérica por la que se cuela
    cualquier campo, sin que el repositorio sepa cuál está escribiendo."""
    persona = _persona()
    db_session.add(persona)
    db_session.commit()
    repo = PersonaRepositorio(db_session)

    with pytest.raises(ValueError):
        repo.actualizar(persona, {"cedula": CEDULA_VERIFICADOR_ROTO})

    db_session.rollback()
    assert db_session.query(Persona).filter(Persona.cedula == CEDULA_OK).one() is not None


def test_persona_repositorio_actualizar_no_puede_introducir_telefono_invalido(db_session):
    persona = _persona()
    db_session.add(persona)
    db_session.commit()
    repo = PersonaRepositorio(db_session)

    with pytest.raises(ValueError):
        repo.actualizar(persona, {"telefono": TELEFONO_TODO_CEROS})

    db_session.rollback()
    assert db_session.query(Persona).filter(Persona.cedula == CEDULA_OK).one().telefono == TELEFONO_OK


def test_persona_repositorio_actualizar_admite_valores_validos(db_session):
    persona = _persona()
    db_session.add(persona)
    db_session.commit()
    repo = PersonaRepositorio(db_session)

    repo.actualizar(persona, {"telefono": "0987654321", "telefono_contacto": None})

    assert db_session.query(Persona).filter(Persona.cedula == CEDULA_OK).one().telefono == "0987654321"


# --- Capa ORM: ficha médica -------------------------------------------------
def _ficha(db_session, telefono_emergencia, secuencia: int = 828):
    persona = _persona(cedula=cedula_valida(secuencia))
    db_session.add(persona)
    db_session.flush()
    return FichaMedica(
        tipo_sangre=TipoSangre.O_POSITIVO, persona_id=persona.id,
        contacto_emergencia="Mamá", telefono_emergencia=telefono_emergencia,
    )


def test_telefono_emergencia_invalido_es_rechazado(db_session):
    with pytest.raises(ValueError):
        db_session.add(_ficha(db_session, "123456"))
        db_session.commit()
    db_session.rollback()


def test_telefono_emergencia_acepta_none_y_vacio(db_session):
    db_session.add(_ficha(db_session, None, secuencia=828))
    db_session.add(_ficha(db_session, "", secuencia=829))
    db_session.commit()

    guardadas = {f.telefono_emergencia for f in db_session.query(FichaMedica).all()}
    assert guardadas == {None, ""}


def test_telefono_emergencia_valido_persiste(db_session):
    db_session.add(_ficha(db_session, "0998877665"))
    db_session.commit()
    assert db_session.query(FichaMedica).one().telefono_emergencia == "0998877665"


# --- Salud de la sesión tras un rechazo -------------------------------------
def test_la_sesion_sigue_usable_despues_de_un_rechazo(db_session):
    """Un rechazo en `@validates` ocurre ANTES del INSERT, así que no
    envenena la transacción: tras el `rollback()` la misma sesión tiene que
    poder escribir y leer normalmente."""
    with pytest.raises(ValueError):
        db_session.add(_persona(cedula=CEDULA_VERIFICADOR_ROTO))
        db_session.commit()
    db_session.rollback()

    db_session.add(_persona(cedula=cedula_valida(829)))
    db_session.commit()

    assert db_session.query(Persona).count() == 1
    assert db_session.query(Persona).filter(
        Persona.cedula == CEDULA_VERIFICADOR_ROTO
    ).first() is None


# --- Capa base de datos: el CHECK muerde sin ORM ----------------------------
_INSERT_CRUDO = text(
    "INSERT INTO persona (nombres, apellidos, cedula, fecha_nacimiento, "
    "telefono, telefono_contacto, activo, fecha_registro) VALUES "
    "(:nombres, :apellidos, :cedula, :fecha_nacimiento, :telefono, "
    ":telefono_contacto, true, now())"
)


def _insertar_crudo(
    db_session, cedula: str, telefono: str, telefono_contacto: str | None = None
) -> None:
    """INSERT por SQL crudo: no pasa por el mapper, así que ningún
    `@validates` puede intervenir. Lo único que puede rechazarlo es la base
    de datos."""
    db_session.execute(_INSERT_CRUDO, {
        "nombres": "Raw", "apellidos": "Sql", "cedula": cedula,
        "fecha_nacimiento": date(1990, 1, 1), "telefono": telefono,
        "telefono_contacto": telefono_contacto,
    })


def test_sql_crudo_con_cedula_sin_forma_lo_rechaza_la_base(db_session):
    """Prueba la capa 2 con independencia de la capa 1. El `match` nombra el
    constraint: así el test prueba CUÁL compuerta disparó, y no se pone verde
    por un `IntegrityError` de otra cosa (un NOT NULL, la unicidad de
    cédula)."""
    with pytest.raises(IntegrityError, match="ck_persona_cedula_forma"):
        _insertar_crudo(db_session, CEDULA_SIN_FORMA, TELEFONO_OK)
    db_session.rollback()


def test_sql_crudo_con_cedula_de_provincia_inexistente_lo_rechaza_la_base(db_session):
    with pytest.raises(IntegrityError, match="ck_persona_cedula_forma"):
        _insertar_crudo(db_session, CEDULA_PROVINCIA_INEXISTENTE, TELEFONO_OK)
    db_session.rollback()


def test_sql_crudo_con_telefono_de_contacto_sin_forma_lo_rechaza_la_base(db_session):
    """La capa 2 del teléfono se prueba sobre `telefono_contacto`, no sobre
    `telefono`: esa última NO tiene CHECK en la base a propósito (le
    congelaría la fila de bootstrap de staging, ver el docstring de la
    migración `f1a7ident828`). Su garantía es solo el `@validates`, que se
    prueba en `test_telefono_todo_ceros_lo_rechaza_el_orm`."""
    with pytest.raises(
        IntegrityError, match="ck_persona_telefono_contacto_forma"
    ):
        _insertar_crudo(
            db_session, CEDULA_OK, TELEFONO_OK,
            telefono_contacto=TELEFONO_TODO_CEROS,
        )
    db_session.rollback()


def test_sql_crudo_con_telefono_sin_forma_entra_porque_no_hay_check(db_session):
    """HUECO DELIBERADO Y ACOTADO, escrito para que se rompa ruidosamente.

    `persona.telefono` no lleva CHECK: cualquiera sobre esa columna haría
    que la fila legacy de staging (`telefono = '0000000000'`) quedara
    imposible de actualizar en NINGÚN campo, porque Postgres reevalúa el
    CHECK contra la fila nueva completa en cada UPDATE. El precio es este:
    una escritura por SQL crudo que esquive el ORM puede meter un teléfono
    con forma imposible.

    El día que la fila legacy se corrija con el teléfono real del
    administrador y una migración agregue el constraint, este test se pone
    rojo y hay que reescribirlo a propósito -- que es exactamente lo que
    debe pasar."""
    _insertar_crudo(db_session, CEDULA_OK, TELEFONO_TODO_CEROS)

    assert db_session.execute(text(
        "SELECT telefono FROM persona WHERE cedula = :c"
    ), {"c": CEDULA_OK}).scalar() == TELEFONO_TODO_CEROS


def test_sql_crudo_con_valores_validos_entra(db_session):
    _insertar_crudo(db_session, CEDULA_OK, TELEFONO_OK)
    assert db_session.execute(text(
        "SELECT count(*) FROM persona WHERE cedula = :c"
    ), {"c": CEDULA_OK}).scalar() == 1


def test_sql_crudo_admite_cedula_con_forma_valida_y_verificador_roto(db_session):
    """HUECO RESIDUAL DOCUMENTADO, no un descuido.

    El dígito verificador NO se replica en la base: eso exigiría una
    función PL/pgSQL con el mismo algoritmo del módulo 10 en un segundo
    lenguaje. La base cubre la FORMA (diez dígitos + provincia existente) y
    el ORM cubre el verificador. Quien escriba por SQL crudo esquivando el
    ORM puede meter esta fila; ningún camino productivo lo hace.

    Este test existe para que el hueco se rompa RUIDOSAMENTE el día que
    alguien decida cerrarlo: si se agrega el verificador a la base, este
    test falla y hay que reescribirlo a propósito."""
    _insertar_crudo(db_session, CEDULA_VERIFICADOR_ROTO, TELEFONO_OK)
    assert db_session.execute(text(
        "SELECT count(*) FROM persona WHERE cedula = :c"
    ), {"c": CEDULA_VERIFICADOR_ROTO}).scalar() == 1
