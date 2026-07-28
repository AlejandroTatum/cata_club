"""
Pruebas de la migración `f2a8c31d9b64` (agrega `persona.activo`) mediante el
arnés de migraciones.

Por qué el arnés y no la suite normal: el job `migraciones-desde-cero` de CI y
la fixture `esquema_migrado` solo demuestran que `alembic upgrade head` corre
contra una base VACÍA. Un `ADD COLUMN ... NOT NULL` es exactamente la
operación cuyo riesgo vive en la base que YA tiene filas: sin `server_default`
falla en el acto ("column contains null values") y, si alguien la declarara
nullable, las personas existentes quedarían en un tercer estado sin
significado en vez de activas.

Se verifica, sobre datos preexistentes, que:
  1. La columna no existía antes de la migración (ancla).
  2. Las personas que ya vivían en la base quedan ACTIVAS y con todos sus
     demás datos intactos.
  3. El `downgrade()` es real: revierte la columna y la ida y vuelta
     `upgrade -> downgrade -> upgrade` no rompe nada.
"""
from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "c9e4b1d78f30"
REVISION_ACTIVO = "f2a8c31d9b64"

SQL_COLUMNA = (
    "SELECT column_name, is_nullable, column_default FROM information_schema.columns "
    "WHERE table_name = 'persona' AND column_name = 'activo'"
)


def _sembrar_personas(arnes: ArnesMigracion) -> None:
    """Siembra con SQL crudo (nunca vía el ORM: el ORM describe el esquema de
    HOY, no el de la revisión bajo prueba) las filas que ya viven en
    producción."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro)
        VALUES
          (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
           '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00'),
          (2, 'Beto', 'Salas', '1710034073', DATE '2012-06-10',
           '0997654321', TIMESTAMPTZ '2024-04-01 12:00:00+00')
        """
    )


def test_la_columna_no_existia_antes_de_la_migracion(arnes_migracion):
    """Ancla: si esta prueba dejara de fallar sin la migración, querría decir
    que la columna llegó al esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_COLUMNA) == []


def test_las_personas_preexistentes_quedan_activas(arnes_migracion):
    """El caso que `migraciones-desde-cero` no puede detectar: la migración
    corre sobre filas que ya existían y todas deben quedar ACTIVAS, con el
    resto de sus datos intacto."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_personas(arnes_migracion)

    arnes_migracion.migrar(REVISION_ACTIVO)

    assert arnes_migracion.consultar(
        "SELECT id, nombres, cedula, activo FROM persona ORDER BY id"
    ) == [
        (1, "Ana", "1710034065", True),
        (2, "Beto", "1710034073", True),
    ]
    assert arnes_migracion.revision_actual() == REVISION_ACTIVO


def test_la_columna_queda_not_null_y_sin_default_de_esquema(arnes_migracion):
    """El `server_default` es andamiaje del backfill, no parte del contrato:
    se retira para que el único default vivo sea el del ORM (`default=True`),
    igual que en `Usuario.activo`. Si quedara, `test_drift_migraciones.py`
    seguiría en verde pero el esquema tendría dos fuentes de verdad."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_personas(arnes_migracion)

    arnes_migracion.migrar(REVISION_ACTIVO)

    assert arnes_migracion.consultar(SQL_COLUMNA) == [("activo", "NO", None)]


def test_downgrade_y_upgrade_hacen_ida_y_vuelta(arnes_migracion):
    """`downgrade()` es real, no un `pass`: quita la columna y deja la base en
    un estado desde el que `upgrade` vuelve a funcionar sobre las mismas
    filas."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_personas(arnes_migracion)
    arnes_migracion.migrar(REVISION_ACTIVO)

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_COLUMNA) == []
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR

    arnes_migracion.migrar(REVISION_ACTIVO)
    assert arnes_migracion.consultar(
        "SELECT id, activo FROM persona ORDER BY id"
    ) == [(1, True), (2, True)]
