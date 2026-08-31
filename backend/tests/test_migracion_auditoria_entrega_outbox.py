"""
Pruebas de `a839entrega` (auditoría del paso de entrega de los outbox).

Por qué el arnés y no la suite normal: el job `migraciones-desde-cero` de CI
y la fixture `esquema_migrado` solo demuestran que `alembic upgrade head`
corre contra una base VACÍA. El riesgo de esta revisión vive en la base que
YA tiene filas -- staging y producción tienen recuperaciones y verificaciones
en vuelo -- y en que el despliegue es expand-only: la migración se aplica
ANTES que la aplicación, así que durante un rato el código viejo (el que no
conoce estas columnas) corre contra el esquema nuevo.

Lo que se verifica sobre datos preexistentes:
  1. Las seis columnas no existían antes (ancla contra drift).
  2. Las filas de outbox que ya vivían en la base sobreviven intactas, con su
     `status`, sus `attempts` y su `expires_at` sin tocar. Una fila
     `PENDIENTE` corrompida acá es un enlace de acceso que nunca llega.
  3. Las columnas nuevas quedan NULL en esas filas y sin `column_default`: la
     migración no hace backfill ni ningún otro DML, que es lo que la vuelve
     segura de aplicar antes que la aplicación.
  4. El código viejo sigue pudiendo insertar: un `INSERT` que no menciona las
     columnas nuevas funciona.
  5. El `downgrade()` es real, y la ida y vuelta no pierde filas.
"""
from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "b8e5smtp837"
REVISION_AUDITORIA = "a839entrega"

TABLAS = ("recuperacion_outbox", "verificacion_correo_outbox")
COLUMNAS_NUEVAS = (
    "entregas_intentadas",
    "entrega_iniciada_at",
    "entrega_resuelta_at",
)


def _sembrar_outbox_en_vuelo(arnes: ArnesMigracion) -> None:
    """Dos colas con filas como las que hay en producción en cualquier
    momento dado: una esperando su turno y otra ya reclamada por un worker."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Marcela', 'Vega', '1710034065', DATE '1985-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, persona_id, fecha_creacion,
                             version_contrasenia, activo, version_sesion)
        VALUES (1, 'marcela@cataclub.test', 'hash', 1,
                TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, TRUE, 1)
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO recuperacion_outbox
            (id, usuario_id, status, attempts, next_attempt_at, created_at,
             expires_at)
        VALUES (1, 1, 'PENDIENTE', 2, TIMESTAMPTZ '2026-08-30 10:00:00+00',
                TIMESTAMPTZ '2026-08-30 09:00:00+00',
                TIMESTAMPTZ '2026-08-31 09:00:00+00')
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO verificacion_correo_outbox
            (id, usuario_id, status, attempts, next_attempt_at, created_at,
             claimed_at, expires_at)
        VALUES (1, 1, 'ENVIANDO', 1, TIMESTAMPTZ '2026-08-30 10:00:00+00',
                TIMESTAMPTZ '2026-08-30 09:00:00+00',
                TIMESTAMPTZ '2026-08-30 10:01:00+00',
                TIMESTAMPTZ '2026-08-31 09:00:00+00')
        """
    )


def test_las_columnas_de_auditoria_no_existian_antes(arnes_migracion: ArnesMigracion):
    """Ancla: si alguna ya existiera, la migración estaría documentando algo
    que no crea, y el drift viviría en otro lado."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    for tabla in TABLAS:
        for columna in COLUMNAS_NUEVAS:
            assert arnes_migracion.tipo_de_columna(tabla, columna) is None


def test_las_filas_en_vuelo_sobreviven_intactas(arnes_migracion: ArnesMigracion):
    """Una fila `PENDIENTE` corrompida acá es un enlace de acceso que nunca
    llega; una `ENVIANDO` que pierda su `claimed_at` deja de ser reclamable
    por vencimiento de lease."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_outbox_en_vuelo(arnes_migracion)

    arnes_migracion.migrar(REVISION_AUDITORIA)

    assert arnes_migracion.consultar(
        "SELECT status, attempts, expires_at FROM recuperacion_outbox WHERE id = 1"
    ) == arnes_migracion.consultar(
        "SELECT 'PENDIENTE', 2, TIMESTAMPTZ '2026-08-31 09:00:00+00'"
    )
    assert arnes_migracion.consultar(
        "SELECT status, attempts, claimed_at FROM verificacion_correo_outbox WHERE id = 1"
    ) == arnes_migracion.consultar(
        "SELECT 'ENVIANDO', 1, TIMESTAMPTZ '2026-08-30 10:01:00+00'"
    )


def test_la_migracion_no_hace_backfill_ni_deja_default(arnes_migracion: ArnesMigracion):
    """Expand-only de verdad: las filas viejas quedan en NULL y el esquema no
    trae `column_default`. NULL significa "nunca se llegó al paso de envío",
    que es lo cierto para todo lo que existía antes de la medición, y el
    código lo lee como cero."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_outbox_en_vuelo(arnes_migracion)

    arnes_migracion.migrar(REVISION_AUDITORIA)

    for tabla in TABLAS:
        assert arnes_migracion.consultar(
            f"SELECT entregas_intentadas, entrega_iniciada_at, entrega_resuelta_at "
            f"FROM {tabla} WHERE id = 1"
        ) == [(None, None, None)]
        assert arnes_migracion.consultar(
            "SELECT column_name, is_nullable, column_default "
            "FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :tabla "
            "AND column_name = ANY(:columnas) ORDER BY column_name",
            tabla=tabla,
            columnas=list(COLUMNAS_NUEVAS),
        ) == [
            ("entrega_iniciada_at", "YES", None),
            ("entrega_resuelta_at", "YES", None),
            ("entregas_intentadas", "YES", None),
        ]


def test_el_codigo_viejo_sigue_pudiendo_encolar(arnes_migracion: ArnesMigracion):
    """Durante el despliegue expand-only, la aplicación ANTERIOR corre contra
    el esquema nuevo. Un `INSERT` que no menciona las columnas nuevas -- que
    es exactamente lo que hace ese código -- tiene que seguir entrando."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_outbox_en_vuelo(arnes_migracion)
    arnes_migracion.migrar(REVISION_AUDITORIA)

    # Otra cuenta: `uq_recuperacion_outbox_usuario_activo` (índice parcial
    # único) no deja dos filas activas del mismo usuario, y esa regla no
    # cambia acá.
    arnes_migracion.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (2, 'Lucas', 'Vega', '1710034073', DATE '1990-01-01',
                '0997654321', TIMESTAMPTZ '2024-04-01 12:00:00+00', TRUE)
        """
    )
    arnes_migracion.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, persona_id, fecha_creacion,
                             version_contrasenia, activo, version_sesion)
        VALUES (2, 'lucas@cataclub.test', 'hash', 2,
                TIMESTAMPTZ '2024-04-01 12:00:00+00', 1, TRUE, 1)
        """
    )
    arnes_migracion.ejecutar(
        """
        INSERT INTO recuperacion_outbox
            (id, usuario_id, status, attempts, next_attempt_at, created_at,
             expires_at)
        VALUES (2, 2, 'PENDIENTE', 0, TIMESTAMPTZ '2026-08-30 11:00:00+00',
                TIMESTAMPTZ '2026-08-30 11:00:00+00',
                TIMESTAMPTZ '2026-08-31 11:00:00+00')
        """
    )

    assert arnes_migracion.consultar(
        "SELECT entregas_intentadas FROM recuperacion_outbox WHERE id = 2"
    ) == [(None,)]


def test_la_ida_y_vuelta_no_pierde_filas(arnes_migracion: ArnesMigracion):
    """`upgrade` -> `downgrade` -> `upgrade`. El `downgrade` retira la
    auditoría, no las colas."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_outbox_en_vuelo(arnes_migracion)

    arnes_migracion.migrar(REVISION_AUDITORIA)
    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    for tabla in TABLAS:
        for columna in COLUMNAS_NUEVAS:
            assert arnes_migracion.tipo_de_columna(tabla, columna) is None
        assert arnes_migracion.consultar(f"SELECT count(*) FROM {tabla}") == [(1,)]

    arnes_migracion.migrar(REVISION_AUDITORIA)

    assert arnes_migracion.revision_actual() == REVISION_AUDITORIA
    for tabla in TABLAS:
        assert arnes_migracion.consultar(f"SELECT count(*) FROM {tabla}") == [(1,)]
        assert (
            arnes_migracion.tipo_de_columna(tabla, "entrega_iniciada_at")
            == "timestamp with time zone"
        )
