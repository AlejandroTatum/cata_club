"""
Pruebas del propio arnés de migraciones (`arnes_migraciones.py`).

Por qué existe este archivo: el job `migraciones-desde-cero` de CI solo
demuestra que `alembic upgrade head` corre contra una base VACÍA. Nada
demostraba que una migración fuera segura contra una base que YA tiene
filas — que es justo el caso peligroso (`ALTER TYPE`, `ALTER COLUMN`,
`ADD COLUMN NOT NULL`, backfills). El arnés cubre ese hueco y estas pruebas
verifican que el arnés hace lo que promete antes de que otras pruebas se
apoyen en él.

Se ejercita una migración REAL ya existente (`644d352bf590`, que agrega
`usuario.version_sesion NOT NULL` con `server_default='1'`) sobre filas
preexistentes: es exactamente el patrón que el arnés debe poder probar.
"""
from datetime import datetime

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "a1b2c3d4e5f6"
REVISION_VERSION_SESION = "644d352bf590"


def _sembrar_usuario(arnes: ArnesMigracion) -> None:
    """Inserta una persona y su usuario con SQL crudo (nunca el ORM: el ORM
    describe el esquema de HOY, no el de la revisión bajo prueba)."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMP '2024-03-01 12:00:00')
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,
                             persona_id, version_contrasenia, activo)
        VALUES (1, 'ana@cataclub.test', 'hash',
                TIMESTAMP '2024-03-01 12:00:00', 1, 0, true)
        """
    )


def test_arnes_ejercita_triggers_de_inmutabilidad_y_downgrade(arnes_migracion):
    arnes_migracion.preparar("a15b7c9d3e21")
    arnes_migracion.migrar("c556legal01")
    assert arnes_migracion.consultar(
        "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal "
        "AND tgname IN ('trg_consentimiento_legal_inmutable', "
        "'trg_revocacion_consentimiento_legal_inmutable') ORDER BY tgname"
    ) == [
        ("trg_consentimiento_legal_inmutable",),
        ("trg_revocacion_consentimiento_legal_inmutable",),
    ]
    arnes_migracion.revertir("a15b7c9d3e21")
    assert arnes_migracion.consultar(
        "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal "
        "AND tgname IN ('trg_consentimiento_legal_inmutable', "
        "'trg_revocacion_consentimiento_legal_inmutable')"
    ) == []


def test_arnes_deja_la_base_en_la_revision_pedida(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.tipo_de_columna("usuario", "version_sesion") is None


def test_arnes_migra_datos_preexistentes_sin_perderlos(arnes_migracion):
    """El caso que `migraciones-desde-cero` no puede detectar: la migración
    corre sobre filas que ya existían, y esas filas deben sobrevivir."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_usuario(arnes_migracion)

    arnes_migracion.migrar(REVISION_VERSION_SESION)

    filas = arnes_migracion.consultar(
        "SELECT correo, fecha_creacion, version_sesion FROM usuario ORDER BY id"
    )
    assert filas == [("ana@cataclub.test", datetime(2024, 3, 1, 12, 0), 1)]
    assert arnes_migracion.revision_actual() == REVISION_VERSION_SESION


def test_arnes_revierte_la_migracion(arnes_migracion):
    """El repositorio implementa `downgrade()` en sus migraciones; el arnés
    debe poder ejercitarlo para que un rollback de producción no sea la
    primera vez que ese código corre."""
    arnes_migracion.preparar(REVISION_VERSION_SESION)
    _sembrar_usuario(arnes_migracion)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.tipo_de_columna("usuario", "version_sesion") is None
    assert arnes_migracion.consultar("SELECT correo FROM usuario") == [
        ("ana@cataclub.test",)
    ]


def test_cada_prueba_recibe_una_base_limpia(arnes_migracion):
    """`preparar()` debe borrar el esquema anterior: si no, las filas
    sembradas por otra prueba contaminarían los asserts de esta."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar("SELECT count(*) FROM usuario") == [(0,)]


def test_arnes_no_toca_la_base_de_la_suite(arnes_migracion, motor_test):
    """Garantía de aislamiento: el arnés crea y destruye su PROPIA base de
    datos. Si compartiera la base de la suite, su `DROP SCHEMA` borraría el
    esquema que `esquema_migrado` (scope=session) creó una sola vez y todas
    las demás pruebas se caerían."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.motor.url.database != motor_test.url.database


# --- La migración `qcatvis` (categoria_horario.visible_en_landing) -------

REVISION_PREVIA_VISIBLE = "5b09fde49560"
REVISION_VISIBLE = "qcatvis"


def _sembrar_categoria(arnes: ArnesMigracion) -> None:
    """Inserta una categoría con SQL crudo del esquema PREVIO (sin la
    columna nueva): el caso real que la migración encuentra en producción
    -- filas que ya existían antes del ADD COLUMN."""
    arnes.ejecutar(
        """
        INSERT INTO categoria_horario (codigo, label, edades, hora_inicio, hora_fin)
        VALUES ('PREINFANTIL', 'Preinfantil', NULL, TIME '15:00', TIME '16:00')
        """
    )


def test_visible_en_landing_backfillean_true_y_deja_el_default_en_el_orm(arnes_migracion):
    """La migración es hacia atrás compatible por construcción: toda fila
    preexistente sale publicada (TRUE) -- ningún despliegue deja la landing
    con menos categorías de las que tenía. Y el patrón `f2a8c31d9b64` se
    respeta: el `server_default` solo existe para el backfill; después se
    retira para que el único default vivo sea el del ORM."""
    arnes_migracion.preparar(REVISION_PREVIA_VISIBLE)
    assert arnes_migracion.tipo_de_columna("categoria_horario", "visible_en_landing") is None

    _sembrar_categoria(arnes_migracion)
    arnes_migracion.migrar(REVISION_VISIBLE)

    assert arnes_migracion.tipo_de_columna("categoria_horario", "visible_en_landing") == "boolean"
    assert arnes_migracion.consultar(
        "SELECT codigo, visible_en_landing FROM categoria_horario ORDER BY codigo"
    ) == [("PREINFANTIL", True)]
    assert arnes_migracion.consultar(
        "SELECT column_default FROM information_schema.columns "
        "WHERE table_name = 'categoria_horario' AND column_name = 'visible_en_landing'"
    ) == [(None,)]
    assert arnes_migracion.revision_actual() == REVISION_VISIBLE

    arnes_migracion.revertir(REVISION_PREVIA_VISIBLE)
    assert arnes_migracion.tipo_de_columna("categoria_horario", "visible_en_landing") is None
    # La fila sobrevive al rollback: la columna era publicación, no datos.
    assert arnes_migracion.consultar("SELECT codigo FROM categoria_horario") == [
        ("PREINFANTIL",)
    ]
