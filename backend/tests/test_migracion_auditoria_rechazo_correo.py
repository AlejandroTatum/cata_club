"""
Pruebas de la migración `b8e5smtp837` (agrega `notificacion.
last_error_redacted`, issue #837) mediante el arnés de migraciones.

El job `migraciones-desde-cero` de CI y la fixture `esquema_migrado` prueban
`alembic upgrade head` sobre una base VACÍA. Lo que no pueden mostrar es lo
que decide si esta migración es segura para staging: que corra sobre una tabla
`notificacion` que YA TIENE FILAS sin tocar ninguna, y que las notificaciones
existentes queden con `last_error_redacted` en NULL -- que es exactamente lo
que significa "a esta nadie le rechazó el correo".
"""
from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "f1a7ident828"
REVISION_AUDITORIA = "b8e5smtp837"

SQL_COLUMNA = (
    "SELECT column_name, is_nullable, column_default, character_maximum_length "
    "FROM information_schema.columns "
    "WHERE table_name = 'notificacion' AND column_name = 'last_error_redacted'"
)


def _sembrar_notificaciones(arnes: ArnesMigracion) -> None:
    """Siembra con SQL crudo (nunca vía el ORM: el ORM describe el esquema de
    HOY, que ya incluye la columna nueva) las filas que ya viven en
    producción."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, activo, fecha_registro)
        VALUES
          (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
           '0991234567', true, TIMESTAMPTZ '2024-03-01 12:00:00+00')
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO notificacion (id, tipo, mensaje, leida, fecha_creacion,
                                  entidad_relacionada_id, persona_id)
        VALUES
          (1, 'MIEMBRESIA_VENCIMIENTO_PROXIMO', 'Su membresía vence el 01/01/2026.',
           false, TIMESTAMPTZ '2026-01-01 12:00:00+00', 7, 1),
          (2, 'PAGO_APROBADO', 'Tu pago fue aprobado.',
           true, TIMESTAMPTZ '2026-01-02 12:00:00+00', NULL, 1)
        """
    )


def test_la_columna_no_existia_antes_de_la_migracion(arnes_migracion):
    """Ancla: si esta prueba dejara de fallar sin la migración, la columna
    habría llegado al esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_COLUMNA) == []


def test_es_expand_only_sobre_notificaciones_existentes(arnes_migracion):
    """Compatible hacia atrás: columna NULLABLE, sin `server_default` y sin
    ningún DML. Las notificaciones que ya existían quedan intactas y con
    `last_error_redacted` en NULL, que es lo que corresponde -- a ninguna le
    rechazaron el correo. Que sea nullable y sin default es lo que permite
    desplegar la migración ANTES que la aplicación en staging: el código
    anterior no menciona la columna y sigue insertando igual."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificaciones(arnes_migracion)

    arnes_migracion.migrar(REVISION_AUDITORIA)

    assert arnes_migracion.consultar(SQL_COLUMNA) == [
        ("last_error_redacted", "YES", None, 500)
    ]
    assert arnes_migracion.consultar(
        "SELECT id, mensaje, leida, entidad_relacionada_id, last_error_redacted "
        "FROM notificacion ORDER BY id"
    ) == [
        (1, "Su membresía vence el 01/01/2026.", False, 7, None),
        (2, "Tu pago fue aprobado.", True, None, None),
    ]
    assert arnes_migracion.revision_actual() == REVISION_AUDITORIA


def test_la_columna_acepta_el_texto_de_auditoria(arnes_migracion):
    """La columna sirve para lo que se creó: guardar el error del proveedor ya
    redactado, con el código SMTP que distingue "esa dirección no existe" de
    "el buzón estaba lleno"."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificaciones(arnes_migracion)
    arnes_migracion.migrar(REVISION_AUDITORIA)

    arnes_migracion.ejecutar(
        "UPDATE notificacion SET last_error_redacted = "
        "'socio@example.com: 550 no such user' WHERE id = 1"
    )

    assert arnes_migracion.consultar(
        "SELECT last_error_redacted FROM notificacion WHERE id = 1"
    ) == [("socio@example.com: 550 no such user",)]


def test_downgrade_y_upgrade_hacen_ida_y_vuelta(arnes_migracion):
    """`downgrade()` es real, no un `pass`: quita la columna y deja la base en
    un estado desde el que `upgrade` vuelve a funcionar sobre las mismas
    filas."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_notificaciones(arnes_migracion)
    arnes_migracion.migrar(REVISION_AUDITORIA)

    arnes_migracion.revertir(REVISION_ANTERIOR)
    assert arnes_migracion.consultar(SQL_COLUMNA) == []
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR

    arnes_migracion.migrar(REVISION_AUDITORIA)
    assert arnes_migracion.consultar(
        "SELECT id, last_error_redacted FROM notificacion ORDER BY id"
    ) == [(1, None), (2, None)]


# La cabeza única no se afirma acá: ya la fija `tests/test_alembic_cabeza_
# unica.py` en la raíz del repo (`make test-root`), que corre sobre TODAS las
# revisiones y no solo sobre esta.
