"""
Pruebas de la migración `l1207telnull` (`persona.telefono` nullable, issue
#1207) mediante el arnés de migraciones.

Por qué el arnés y no la suite normal: el job `migraciones-desde-cero` de CI y
la fixture `esquema_migrado` solo demuestran que `alembic upgrade head` corre
contra una base VACÍA. Un `ALTER COLUMN ... DROP NOT NULL` con backfill es
exactamente la operación cuyo riesgo vive en la base que YA tiene filas: hay
que demostrar que las `""` existentes (los menores representados sin celular
que dejó el alta de #1197) quedan en `NULL`, y que la fila de bootstrap de
staging (`telefono = '0000000000'`, `f1a7ident828`) no se toca -- no es una
cadena vacía.

Se verifica, sobre datos preexistentes, que:
  1. La columna era NOT NULL antes de la migración (ancla).
  2. La migración APLICA con filas preexistentes, backfillea los `""` a
     `NULL` y deja intacta la fila de bootstrap.
  3. La columna queda nullable y acepta un INSERT nuevo con `telefono = NULL`.
  4. El `downgrade()` es real: repone el NOT NULL, backfilleando `NULL` a
     `""` primero (si no, el propio `ALTER COLUMN` de la reversión abortaría
     contra las filas que la migración dejó en `NULL`), y la ida y vuelta no
     rompe nada.
"""
from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "k1143rolrep"
REVISION_NULLABLE = "l1207telnull"

SQL_COLUMNA = (
    "SELECT column_name, is_nullable FROM information_schema.columns "
    "WHERE table_name = 'persona' AND column_name = 'telefono'"
)


def _sembrar_filas(arnes: ArnesMigracion) -> None:
    """Siembra con SQL crudo (nunca vía el ORM: el ORM describe el esquema de
    HOY, no el de la revisión bajo prueba) el estado real que esta migración
    tiene que absorber: un adulto con teléfono, un menor representado sin
    celular propio (`""`, el único valor que #1197 podía dejar bajo la
    columna NOT NULL) y la fila de bootstrap de staging."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, activo, fecha_registro)
        VALUES
          (1, 'Admin', 'Bootstrap', '1710034065', DATE '1990-01-01',
           '0000000000', true, TIMESTAMPTZ '2024-03-01 12:00:00+00'),
          (2, 'Ana', 'Torres', '1710034073', DATE '1990-01-01',
           '0991234567', true, TIMESTAMPTZ '2024-04-01 12:00:00+00'),
          (3, 'Lucas', 'Torres', '1710034081', DATE '2015-05-14',
           '', true, TIMESTAMPTZ '2024-04-01 12:00:00+00')
        """
    )


def test_la_columna_era_not_null_antes_de_la_migracion(arnes_migracion):
    """Ancla: si esta prueba dejara de fallar sin la migración, querría decir
    que la columna ya era nullable por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_COLUMNA) == [("telefono", "NO")]


def test_la_migracion_aplica_y_backfillea_los_vacios_a_null(arnes_migracion):
    """El caso que `migraciones-desde-cero` no puede detectar: sobre filas
    preexistentes, el `""` de un menor representado pasa a `NULL` y todo lo
    demás -- incluida la fila de bootstrap con `0000000000` -- queda
    intacto."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas(arnes_migracion)

    arnes_migracion.migrar(REVISION_NULLABLE)

    assert arnes_migracion.consultar(
        "SELECT id, cedula, telefono FROM persona ORDER BY id"
    ) == [
        (1, "1710034065", "0000000000"),
        (2, "1710034073", "0991234567"),
        (3, "1710034081", None),
    ]
    assert arnes_migracion.revision_actual() == REVISION_NULLABLE


def test_la_columna_queda_nullable_y_acepta_null_en_escrituras_nuevas(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas(arnes_migracion)

    arnes_migracion.migrar(REVISION_NULLABLE)

    assert arnes_migracion.consultar(SQL_COLUMNA) == [("telefono", "YES")]
    arnes_migracion.ejecutar(
        "INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento, "
        "telefono, activo, fecha_registro) VALUES "
        "(4, 'Nuevo', 'Sin Tel', '1710034099', DATE '2016-01-01', "
        "NULL, true, now())"
    )
    assert arnes_migracion.consultar(
        "SELECT telefono FROM persona WHERE id = 4"
    ) == [(None,)]


def test_downgrade_y_upgrade_hacen_ida_y_vuelta(arnes_migracion):
    """`downgrade()` es real, no un `pass`: repone el NOT NULL -- backfillando
    `NULL` a `""` antes, para que el propio `ALTER COLUMN` no aborte -- y deja
    la base en un estado desde el que `upgrade` vuelve a funcionar sobre las
    mismas filas."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_filas(arnes_migracion)
    arnes_migracion.migrar(REVISION_NULLABLE)

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_COLUMNA) == [("telefono", "NO")]
    assert arnes_migracion.consultar(
        "SELECT id, telefono FROM persona ORDER BY id"
    ) == [
        (1, "0000000000"),
        (2, "0991234567"),
        (3, ""),
    ]
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR

    arnes_migracion.migrar(REVISION_NULLABLE)
    assert arnes_migracion.consultar(SQL_COLUMNA) == [("telefono", "YES")]
    assert arnes_migracion.consultar(
        "SELECT id, telefono FROM persona ORDER BY id"
    ) == [
        (1, "0000000000"),
        (2, "0991234567"),
        (3, None),
    ]
