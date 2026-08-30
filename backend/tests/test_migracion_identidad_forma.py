"""
Pruebas de la migración `f1a7ident828` (forma de cédula y teléfono en la
base, issue #828) mediante el arnés de migraciones.

Por qué el arnés y no `migraciones-desde-cero`: ese job y la fixture
`esquema_migrado` solo demuestran que `alembic upgrade head` corre contra una
base VACÍA. Agregar un `CHECK` es exactamente la operación cuyo riesgo vive
en la base que YA tiene filas, y ese riesgo tiene DOS caras, no una:
Postgres recorre la tabla y ABORTA la migración si alguna fila no cumple, y
-- la que es fácil pasar por alto -- una vez puesto, el CHECK se reevalúa
contra la fila NUEVA COMPLETA en cada UPDATE posterior, así que una fila que
no lo cumple queda CONGELADA contra toda escritura, incluso una que no toque
la columna del constraint. `NOT VALID` solo evita la primera cara; contra la
segunda no hace nada.

Ese es el motivo por el que `persona.telefono` NO lleva constraint en la
base: staging tiene una fila de bootstrap con `telefono = '0000000000'` (el
default del `crear_primer_admin.py` anterior a este cambio), diez dígitos
que no empiezan en `09` y por lo tanto no son ni celular ni fijo. Con
cualquier CHECK sobre esa columna, cambiarle el nombre a ese administrador
tira `IntegrityError` -> HTTP 500.

Se verifica, sobre datos preexistentes, que:
  1. Los constraints no existían antes de la migración (ancla).
  2. La migración APLICA con la fila legacy de staging ya en la tabla, y esa
     fila sobrevive intacta.
  3. La fila legacy SIGUE SIENDO EDITABLE en sus otras columnas -- el
     candado de regresión del párrafo de arriba.
  4. Los tres constraints que sí existen quedan VALIDADOS, y sobre
     `persona.telefono` no hay ninguno: la asimetría es deliberada y se
     afirma contra `pg_constraint`, no se supone.
  5. Los constraints rechazan toda escritura NUEVA que los viole.
  6. El `downgrade()` es real y la ida y vuelta no rompe nada.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "d4f8c2a6b0e3"
REVISION_IDENTIDAD = "f1a7ident828"

# `ck_persona_telefono_forma` sigue en la lista A PROPÓSITO aunque la
# migración ya no lo cree: así la consulta lo devolvería si alguien lo
# reintrodujera, y el test que espera exactamente tres filas se pondría rojo.
_NOMBRES_CONSTRAINTS = (
    "ck_persona_cedula_forma",
    "ck_persona_telefono_forma",
    "ck_persona_telefono_contacto_forma",
    "ck_ficha_medica_telefono_emergencia_forma",
)

SQL_CONSTRAINTS = (
    "SELECT conname, convalidated FROM pg_constraint "
    "WHERE conname IN ("
    + ", ".join(f"'{nombre}'" for nombre in _NOMBRES_CONSTRAINTS)
    + ") ORDER BY conname"
)


def _sembrar_filas_legacy(arnes: ArnesMigracion) -> None:
    """Siembra con SQL crudo (nunca vía el ORM: el ORM de HOY ya rechaza esta
    fila, que es justamente el punto) el estado real de staging: un
    administrador de bootstrap con el teléfono placeholder `0000000000`."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, activo, fecha_registro)
        VALUES
          (1, 'Admin', 'Bootstrap', '1710034065', DATE '1990-01-01',
           '0000000000', true, TIMESTAMPTZ '2024-03-01 12:00:00+00'),
          (2, 'Ana', 'Torres', '1710034073', DATE '1990-01-01',
           '0991234567', true, TIMESTAMPTZ '2024-04-01 12:00:00+00')
        """
    )


def test_los_constraints_no_existian_antes_de_la_migracion(arnes_migracion):
    """Ancla: si dejara de pasar sin la migración, los constraints habrían
    llegado al esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_CONSTRAINTS) == []


def test_la_migracion_aplica_con_la_fila_legacy_de_staging(arnes_migracion):
    """El caso que `migraciones-desde-cero` NO puede detectar: con la fila de
    `0000000000` ya en la tabla, un CHECK validado sobre `persona.telefono`
    haría abortar el deploy al recorrerla. No hay tal CHECK, así que la
    migración aplica y la fila queda intacta -- byte por byte: esta
    migración no reescribe ni normaliza ningún dato."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)

    arnes_migracion.migrar(REVISION_IDENTIDAD)

    assert arnes_migracion.consultar(
        "SELECT id, cedula, telefono FROM persona ORDER BY id"
    ) == [
        (1, "1710034065", "0000000000"),
        (2, "1710034073", "0991234567"),
    ]
    assert arnes_migracion.revision_actual() == REVISION_IDENTIDAD


def test_los_tres_constraints_quedan_validados(arnes_migracion):
    """Los tres que existen quedan VALIDADOS -- ninguno nace `NOT VALID`.

    `cedula` porque se pasaron las filas de staging y QA por el
    `es_cedula_valida` real sin una sola violación; `telefono_contacto` y
    `telefono_emergencia` porque no tienen filas no nulas que puedan
    violarlos. Validado es una garantía estrictamente más fuerte que
    `NOT VALID`, y ninguno de los tres puede abortar ni congelar nada."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)

    arnes_migracion.migrar(REVISION_IDENTIDAD)

    assert arnes_migracion.consultar(SQL_CONSTRAINTS) == [
        ("ck_ficha_medica_telefono_emergencia_forma", True),
        ("ck_persona_cedula_forma", True),
        ("ck_persona_telefono_contacto_forma", True),
    ]


def test_persona_telefono_no_tiene_ningun_check_en_la_base(arnes_migracion):
    """La ausencia se afirma, no se deduce de que el test de arriba no lo
    liste. Se pregunta a `pg_constraint` por TODO CHECK que toque la columna
    `persona.telefono`, sin depender del nombre que alguien le ponga.

    Es la contracara del candado de regresión: `persona.telefono` queda con
    su garantía en el ORM (`@validates`) y sin ninguna en la base, porque
    ponerle una congelaría la fila de bootstrap de staging. Volver a
    agregarla tiene que ser un acto deliberado que rompa este test, no un
    descuido que rompa staging."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)

    arnes_migracion.migrar(REVISION_IDENTIDAD)

    assert arnes_migracion.consultar(
        """
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.conrelid = 'persona'::regclass
          AND c.contype = 'c'
          AND a.attname = 'telefono'
        """
    ) == []


def test_la_fila_legacy_sigue_siendo_editable_en_sus_otros_campos(arnes_migracion):
    """CANDADO DE REGRESIÓN (la razón por la que `persona.telefono` no lleva
    CHECK).

    Postgres reevalúa un CHECK contra la fila NUEVA COMPLETA en cada UPDATE,
    sin importar si el constraint está `convalidated` o no: `NOT VALID` solo
    saltea el recorrido inicial de la tabla. Con un CHECK sobre
    `persona.telefono`, el administrador de bootstrap de staging no podía
    cambiar NI SU NOMBRE -- `UPDATE persona SET nombres = ...` arrastra el
    `telefono = '0000000000'` a la revalidación y Postgres lo rechaza. La
    fila quedaba congelada contra toda escritura y el error salía como un
    `IntegrityError` sin atrapar, es decir HTTP 500.

    Este test es esa escritura exacta. Si alguien vuelve a poner un CHECK
    sobre `persona.telefono` -- validado o `NOT VALID`, da igual -- este
    test se pone rojo."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)
    arnes_migracion.migrar(REVISION_IDENTIDAD)

    arnes_migracion.ejecutar(
        "UPDATE persona SET nombres = 'Administrador' WHERE id = 1"
    )

    assert arnes_migracion.consultar(
        "SELECT nombres, telefono FROM persona WHERE id = 1"
    ) == [("Administrador", "0000000000")]


def test_los_constraints_rechazan_las_escrituras_nuevas(arnes_migracion):
    """Sin este test, un constraint sería indistinguible de no tenerlo.

    Se prueba con `telefono_contacto`, que es una de las columnas que SÍ
    quedó con CHECK: el mismo `0000000000` que la fila legacy tolera en
    `telefono` (columna sin constraint) es rechazado acá."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)
    arnes_migracion.migrar(REVISION_IDENTIDAD)

    with pytest.raises(
        IntegrityError, match="ck_persona_telefono_contacto_forma"
    ):
        arnes_migracion.ejecutar(
            "INSERT INTO persona (id, nombres, apellidos, cedula, "
            "fecha_nacimiento, telefono, telefono_contacto, activo, "
            "fecha_registro) VALUES "
            "(3, 'Nuevo', 'Malo', '1710034081', DATE '1990-01-01', "
            "'0991234567', '0000000000', true, now())"
        )


def test_la_cedula_sin_forma_es_rechazada_en_escrituras_nuevas(arnes_migracion):
    """El constraint de cédula muerde igual que el de teléfono. Antes esto
    quedaba implícito en el test de teléfono; acá se afirma por separado y
    nombrando el constraint que debe disparar."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)
    arnes_migracion.migrar(REVISION_IDENTIDAD)

    with pytest.raises(IntegrityError, match="ck_persona_cedula_forma"):
        arnes_migracion.ejecutar(
            "INSERT INTO persona (id, nombres, apellidos, cedula, "
            "fecha_nacimiento, telefono, activo, fecha_registro) VALUES "
            "(4, 'Nuevo', 'Malo', '9910034060', DATE '1990-01-01', "
            "'0991234567', true, now())"
        )


def test_downgrade_y_upgrade_hacen_ida_y_vuelta(arnes_migracion):
    """`downgrade()` es real, no un `pass`: quita los tres constraints y
    deja la base en un estado desde el que `upgrade` vuelve a funcionar sobre
    las mismas filas."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)
    arnes_migracion.migrar(REVISION_IDENTIDAD)

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_CONSTRAINTS) == []

    arnes_migracion.migrar(REVISION_IDENTIDAD)
    assert len(arnes_migracion.consultar(SQL_CONSTRAINTS)) == 3
    assert arnes_migracion.consultar("SELECT count(*) FROM persona") == [(2,)]
