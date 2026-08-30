"""
Pruebas de la migración `f1a7ident828` (forma de cédula y teléfono en la
base, issue #828) mediante el arnés de migraciones.

Por qué el arnés y no `migraciones-desde-cero`: ese job y la fixture
`esquema_migrado` solo demuestran que `alembic upgrade head` corre contra una
base VACÍA. Agregar un `CHECK` es exactamente la operación cuyo riesgo vive
en la base que YA tiene filas -- Postgres recorre la tabla y ABORTA la
migración si alguna fila no cumple. Ese es el motivo, y el único motivo, por
el que los tres constraints de teléfono nacen `NOT VALID`: staging tiene hoy
una fila de bootstrap con `telefono = '0000000000'` (el default del
`crear_primer_admin.py` anterior a este cambio), que son diez dígitos que no
empiezan en `09` y por lo tanto no son ni celular ni fijo.

Se verifica, sobre datos preexistentes, que:
  1. Los constraints no existían antes de la migración (ancla).
  2. La migración APLICA con la fila legacy de staging ya en la tabla, y esa
     fila sobrevive intacta.
  3. Aun así, el `CHECK NOT VALID` rechaza toda escritura NUEVA -- que es la
     garantía que pide el issue.
  4. El de cédula queda VALIDADO (recorrió la tabla) y los de teléfono no:
     la asimetría es deliberada y queda escrita, no supuesta.
  5. El `downgrade()` es real y la ida y vuelta no rompe nada.
"""
import pytest
from sqlalchemy.exc import IntegrityError

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "d4f8c2a6b0e3"
REVISION_IDENTIDAD = "f1a7ident828"

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
    `0000000000` ya en la tabla, un CHECK validado sobre el teléfono haría
    abortar el deploy. `NOT VALID` lo evita y la fila queda intacta."""
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


def test_solo_el_de_cedula_queda_validado(arnes_migracion):
    """La asimetría es la decisión de diseño, así que se afirma en vez de
    quedar solo en el docstring de la migración: `convalidated = True` para la
    cédula (recorrió la tabla y no encontró violaciones, medido en staging y
    QA) y `False` para los tres de teléfono."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)

    arnes_migracion.migrar(REVISION_IDENTIDAD)

    assert arnes_migracion.consultar(SQL_CONSTRAINTS) == [
        ("ck_ficha_medica_telefono_emergencia_forma", False),
        ("ck_persona_cedula_forma", True),
        ("ck_persona_telefono_contacto_forma", False),
        ("ck_persona_telefono_forma", False),
    ]


def test_not_valid_no_afloja_las_escrituras_nuevas(arnes_migracion):
    """`NOT VALID` significa "no revalides lo viejo", NUNCA "no valides lo
    nuevo": Postgres aplica el constraint a todo INSERT y UPDATE posterior.
    Sin este test, `NOT VALID` sería indistinguible de no tener constraint."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)
    arnes_migracion.migrar(REVISION_IDENTIDAD)

    with pytest.raises(IntegrityError):
        arnes_migracion.ejecutar(
            "INSERT INTO persona (id, nombres, apellidos, cedula, "
            "fecha_nacimiento, telefono, activo, fecha_registro) VALUES "
            "(3, 'Nuevo', 'Malo', '1710034081', DATE '1990-01-01', "
            "'0000000000', true, now())"
        )


def test_downgrade_y_upgrade_hacen_ida_y_vuelta(arnes_migracion):
    """`downgrade()` es real, no un `pass`: quita los cuatro constraints y
    deja la base en un estado desde el que `upgrade` vuelve a funcionar sobre
    las mismas filas."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas_legacy(arnes_migracion)
    arnes_migracion.migrar(REVISION_IDENTIDAD)

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_CONSTRAINTS) == []

    arnes_migracion.migrar(REVISION_IDENTIDAD)
    assert len(arnes_migracion.consultar(SQL_CONSTRAINTS)) == 4
    assert arnes_migracion.consultar("SELECT count(*) FROM persona") == [(2,)]
