"""
Pruebas de la migración `b3d7e5f1a9c2` (agrega `NUEVA_INSCRIPCION` al enum
PostgreSQL `tiponotificacion`) mediante el arnés de migraciones.

Por qué el arnés y no la suite normal: el job `migraciones-desde-cero` de CI
y la fixture `esquema_migrado` solo demuestran que `alembic upgrade head`
corre contra una base VACÍA. Un `ALTER TYPE ... ADD VALUE` es justamente el
tipo de operación cuyo riesgo real está en la base que YA tiene filas: si se
resolviera recreando el tipo (`RENAME TO ..._old` + `CREATE TYPE` + `ALTER
COLUMN ... USING`) en lugar de con `ADD VALUE`, un error de reescritura
perdería o corrompería notificaciones existentes sin que ninguna prueba de
base vacía lo notara.

Se verifica, sobre datos preexistentes, que:
  1. Las notificaciones que ya vivían en la base sobreviven a la migración.
  2. El label nuevo es realmente usable después de migrar (INSERT real).
  3. El label NO existía antes de la migración (la prueba fallaría en rojo
     si alguien borrara la migración y dejara el enum de Python intacto).
"""
import pytest
from sqlalchemy.exc import DataError

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "a7c1e9d4f6b2"
REVISION_NUEVA_INSCRIPCION = "b3d7e5f1a9c2"

SQL_LABELS = (
    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
    "WHERE t.typname = 'tiponotificacion' ORDER BY e.enumsortorder"
)


def _sembrar_notificaciones(arnes: ArnesMigracion) -> None:
    """Siembra una persona y dos notificaciones con SQL crudo (nunca vía el
    ORM: el ORM describe el esquema de HOY, no el de la revisión bajo
    prueba). Representan las filas que ya viven en producción."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00')
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO notificacion (id, tipo, mensaje, leida, fecha_creacion,
                                  entidad_relacionada_id, persona_id)
        VALUES
          (1, 'PAGO_APROBADO', 'Tu pago fue aprobado', false,
           TIMESTAMPTZ '2024-03-02 12:00:00+00', 7, 1),
          (2, 'MIEMBRESIA_VENCIMIENTO_PROXIMO', 'Tu membresía vence pronto',
           true, TIMESTAMPTZ '2024-03-03 12:00:00+00', 9, 1)
        """
    )


def test_label_nueva_inscripcion_no_existia_antes_de_la_migracion(arnes_migracion):
    """Ancla del defecto: en la revisión anterior el enum de PostgreSQL no
    tiene `NUEVA_INSCRIPCION`, aunque `TipoNotificacion` sí lo declara. Ese
    desfase era el 500 de la inscripción pública."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    labels = [fila[0] for fila in arnes_migracion.consultar(SQL_LABELS)]
    assert "NUEVA_INSCRIPCION" not in labels


def test_migracion_conserva_las_notificaciones_preexistentes(arnes_migracion):
    """El caso que `migraciones-desde-cero` no puede detectar: el `ALTER TYPE`
    corre sobre filas que ya existían y esas filas deben sobrevivir intactas
    (mismo tipo, mismo mensaje, mismo estado de lectura)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificaciones(arnes_migracion)

    arnes_migracion.migrar(REVISION_NUEVA_INSCRIPCION)

    filas = arnes_migracion.consultar(
        "SELECT id, tipo::text, mensaje, leida FROM notificacion ORDER BY id"
    )
    assert filas == [
        (1, "PAGO_APROBADO", "Tu pago fue aprobado", False),
        (2, "MIEMBRESIA_VENCIMIENTO_PROXIMO", "Tu membresía vence pronto", True),
    ]
    assert arnes_migracion.revision_actual() == REVISION_NUEVA_INSCRIPCION


def test_migracion_habilita_el_label_para_insertar(arnes_migracion):
    """Después de migrar, el label debe ser usable de verdad: un INSERT con
    `NUEVA_INSCRIPCION` convive con las notificaciones preexistentes."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificaciones(arnes_migracion)
    arnes_migracion.migrar(REVISION_NUEVA_INSCRIPCION)

    arnes_migracion.ejecutar(
        """
        INSERT INTO notificacion (id, tipo, mensaje, leida, fecha_creacion,
                                  entidad_relacionada_id, persona_id)
        VALUES (3, 'NUEVA_INSCRIPCION', 'Nuevo alumno inscrito', false,
                TIMESTAMPTZ '2024-03-04 12:00:00+00', 42, 1)
        """
    )

    assert arnes_migracion.consultar(
        "SELECT tipo::text FROM notificacion ORDER BY id"
    ) == [
        ("PAGO_APROBADO",),
        ("MIEMBRESIA_VENCIMIENTO_PROXIMO",),
        ("NUEVA_INSCRIPCION",),
    ]


def test_sin_la_migracion_el_insert_del_label_falla(arnes_migracion):
    """Contraprueba: sobre la revisión anterior el mismo INSERT explota con
    el error exacto que veía producción. Si esta prueba dejara de fallar,
    querría decir que el ancla de la migración ya no mide nada."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificaciones(arnes_migracion)

    with pytest.raises(DataError, match="invalid input value for enum tiponotificacion"):
        arnes_migracion.ejecutar(
            """
            INSERT INTO notificacion (id, tipo, mensaje, leida, fecha_creacion,
                                      entidad_relacionada_id, persona_id)
            VALUES (3, 'NUEVA_INSCRIPCION', 'Nuevo alumno inscrito', false,
                    TIMESTAMPTZ '2024-03-04 12:00:00+00', 42, 1)
            """
        )
