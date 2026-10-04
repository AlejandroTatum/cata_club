"""ENT-23 (QA4): la migración `c1asisnojust` quita JUSTIFICADO del enum
PostgreSQL `estadoasistencia` y convierte las filas existentes a AUSENTE.

Se prueba con el arnés porque lo riesgoso es la base que YA tiene filas:
recrear el tipo (`RENAME` + `CREATE TYPE` + `ALTER COLUMN ... USING`) en las
DOS columnas que lo usan (`asistencia.estado` y
`correccion_asistencia.estado_anterior`) no puede perder ni corromper datos.
"""
from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "v1retiretarifa"
REVISION_NUEVA = "c1asisnojust"

SQL_LABELS = (
    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
    "WHERE t.typname = 'estadoasistencia' ORDER BY e.enumsortorder"
)


def _sembrar(arnes: ArnesMigracion) -> None:
    """Un alumno, un horario y una asistencia por estado (incluido
    JUSTIFICADO), más una corrección cuyo estado anterior era JUSTIFICADO."""
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        "INSERT INTO categoria_horario (codigo, label, hora_inicio, hora_fin, visible_en_landing) "
        "VALUES ('JUVENIL', 'Juvenil', TIME '15:00', TIME '16:00', TRUE)"
    )
    arnes.ejecutar(
        "INSERT INTO horario_entrenamiento (id, categoria, dia_semana, hora_inicio, hora_fin) "
        "VALUES (1, 'JUVENIL', 'LUNES', TIME '15:00', TIME '16:00')"
    )
    estados = ["PRESENTE", "AUSENTE", "ATRASADO", "JUSTIFICADO", "ENFERMO", "COMPETENCIA"]
    for i, estado in enumerate(estados, start=1):
        arnes.ejecutar(
            """
            INSERT INTO asistencia (id, fecha_entrenamiento, fecha_registro, estado,
                                    persona_id, horario_id, requiere_revision)
            VALUES (:id, DATE '2024-03-04' + CAST(:dia AS integer), TIMESTAMPTZ '2024-03-05 12:00:00+00',
                    CAST(:estado AS estadoasistencia), 1, 1, false)
            """,
            id=i, dia=i * 7, estado=estado,
        )
    arnes.ejecutar(
        """
        INSERT INTO asistencia_correccion (id, asistencia_id, corregido_por_id,
                                           corregido_en, motivo, estado_anterior)
        VALUES (1, 1, 1, TIMESTAMPTZ '2024-03-06 12:00:00+00', 'error',
                CAST('JUSTIFICADO' AS estadoasistencia))
        """
    )


def test_justificado_existia_antes_de_la_migracion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    labels = [fila[0] for fila in arnes_migracion.consultar(SQL_LABELS)]
    assert "JUSTIFICADO" in labels


def test_las_filas_justificadas_pasan_a_ausente_y_el_resto_se_conserva(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar(arnes_migracion)

    arnes_migracion.migrar(REVISION_NUEVA)

    assert arnes_migracion.consultar(
        "SELECT id, estado::text FROM asistencia ORDER BY id"
    ) == [
        (1, "PRESENTE"), (2, "AUSENTE"), (3, "ATRASADO"),
        (4, "AUSENTE"), (5, "ENFERMO"), (6, "COMPETENCIA"),
    ]
    assert arnes_migracion.consultar(
        "SELECT estado_anterior::text FROM asistencia_correccion"
    ) == [("AUSENTE",)]
    assert arnes_migracion.revision_actual() == REVISION_NUEVA


def test_el_label_justificado_desaparece_del_tipo(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    arnes_migracion.migrar(REVISION_NUEVA)

    labels = [fila[0] for fila in arnes_migracion.consultar(SQL_LABELS)]
    assert labels == ["PRESENTE", "AUSENTE", "ATRASADO", "ENFERMO", "COMPETENCIA"]


def test_downgrade_restaura_el_label_sin_tocar_las_filas(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar(arnes_migracion)
    arnes_migracion.migrar(REVISION_NUEVA)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    labels = [fila[0] for fila in arnes_migracion.consultar(SQL_LABELS)]
    assert "JUSTIFICADO" in labels
    # Las filas ya convertidas siguen siendo AUSENTE: el dato original no se
    # puede reconstruir (decisión del dueño: no había marcas que migrar).
    assert arnes_migracion.consultar(
        "SELECT estado::text FROM asistencia WHERE id = 4"
    ) == [("AUSENTE",)]
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
