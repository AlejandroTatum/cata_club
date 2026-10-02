"""Migración `t1314metricas` (issue #1314): actividad diaria por usuario,
`usuario.ultimo_acceso` y la tabla de instantáneas de métricas.

Se ejercita con el arnés de migraciones: sobre la revisión anterior las
piezas NO existen (ancla), tras migrar existen con el contrato que usan el
registro de actividad y el colector, y `downgrade` las retira sin tocar el
resto del esquema ni los usuarios ya existentes.
"""
from tests.arnes_migraciones import ArnesMigracion

REVISION_ANTERIOR = "r1401reporte"
REVISION_METRICAS = "t1314metricas"

SQL_TABLA = (
    "SELECT count(*) FROM information_schema.tables "
    "WHERE table_schema = 'public' AND table_name = :tabla"
)


def _existe_tabla(arnes: ArnesMigracion, tabla: str) -> bool:
    return arnes.consultar(SQL_TABLA, tabla=tabla)[0][0] == 1


def _sembrar_usuario(arnes: ArnesMigracion) -> None:
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (1, 'Ana', 'Torres', '1710034065', DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """
    )
    arnes.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,
                             version_contrasenia, activo, correo_verificado,
                             version_sesion, persona_id)
        VALUES (1, 'ana@club.test', 'hash', TIMESTAMPTZ '2024-03-01 12:00:00+00',
                1, TRUE, TRUE, 1, 1)
        """
    )


def test_las_piezas_no_existen_antes_de_la_migracion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert not _existe_tabla(arnes_migracion, "actividad_usuario")
    assert not _existe_tabla(arnes_migracion, "metrica_instantanea")
    assert arnes_migracion.tipo_de_columna("usuario", "ultimo_acceso") is None


def test_upgrade_crea_las_tablas_y_la_columna_sin_perder_usuarios(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_usuario(arnes_migracion)

    arnes_migracion.migrar(REVISION_METRICAS)

    assert arnes_migracion.revision_actual() == REVISION_METRICAS
    assert _existe_tabla(arnes_migracion, "actividad_usuario")
    assert _existe_tabla(arnes_migracion, "metrica_instantanea")
    assert arnes_migracion.tipo_de_columna("usuario", "ultimo_acceso") == "timestamp with time zone"
    # El usuario previo sobrevive y su último acceso arranca desconocido.
    assert arnes_migracion.consultar("SELECT correo, ultimo_acceso FROM usuario") == [
        ("ana@club.test", None)
    ]


def test_actividad_usuario_es_unica_por_usuario_dia_y_franja(arnes_migracion):
    arnes_migracion.preparar(REVISION_METRICAS)
    _sembrar_usuario(arnes_migracion)
    insertar = (
        "INSERT INTO actividad_usuario (usuario_id, fecha, franja) "
        "VALUES (1, DATE '2026-10-01', 7) ON CONFLICT DO NOTHING"
    )

    arnes_migracion.ejecutar(insertar)
    arnes_migracion.ejecutar(insertar)  # idempotente: no duplica ni falla
    arnes_migracion.ejecutar(
        "INSERT INTO actividad_usuario (usuario_id, fecha, franja) "
        "VALUES (1, DATE '2026-10-01', 8)"
    )

    assert arnes_migracion.consultar(
        "SELECT franja FROM actividad_usuario ORDER BY franja"
    ) == [(7,), (8,)]


def test_actividad_usuario_se_va_con_el_usuario(arnes_migracion):
    arnes_migracion.preparar(REVISION_METRICAS)
    _sembrar_usuario(arnes_migracion)
    arnes_migracion.ejecutar(
        "INSERT INTO actividad_usuario (usuario_id, fecha, franja) "
        "VALUES (1, DATE '2026-10-01', 7)"
    )

    arnes_migracion.ejecutar("DELETE FROM usuario WHERE id = 1")

    assert arnes_migracion.consultar("SELECT count(*) FROM actividad_usuario") == [(0,)]


def test_downgrade_retira_las_piezas_y_conserva_el_resto(arnes_migracion):
    arnes_migracion.preparar(REVISION_METRICAS)
    _sembrar_usuario(arnes_migracion)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert not _existe_tabla(arnes_migracion, "actividad_usuario")
    assert not _existe_tabla(arnes_migracion, "metrica_instantanea")
    assert arnes_migracion.tipo_de_columna("usuario", "ultimo_acceso") is None
    assert arnes_migracion.consultar("SELECT correo FROM usuario") == [("ana@club.test",)]
