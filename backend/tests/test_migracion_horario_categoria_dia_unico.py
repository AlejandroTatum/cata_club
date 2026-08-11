"""
Pruebas de la migración `b7e4a9f2c6d1` (INS-3: UNIQUE sobre
`horario_entrenamiento(categoria, dia_semana)`) mediante el arnés de
migraciones (`tests/arnes_migraciones.py`).

Lo que `migraciones-desde-cero` no puede detectar: una base que YA tiene
duplicados (categoria, dia_semana) -- el bug que esta migración cierra. A
diferencia de `c3d9f2b7a1e5` (que ante datos sucios prefiere fallar
ruidosamente), acá el dueño fijó explícitamente la regla de limpieza, así
que se verifica que:
  1. El UNIQUE no existía antes de la migración (ancla).
  2. Con datos limpios, el upgrade crea el UNIQUE y las filas sobreviven.
  3. Con un duplicado sin alumnos, el upgrade colapsa a la fila de id más
     bajo y borra la sobrante.
  4. Con un duplicado donde el mismo alumno está inscripto en AMBAS filas
     (el escenario real del bug INS-3), la fila `alumno_horario` sobrante
     se BORRA (no se re-apunta, porque chocaría con `uq_alumno_horario`) y
     el alumno queda inscripto una sola vez, vía la fila conservada.
  5. El historial de `asistencia` de la fila descartada se re-apunta a la
     conservada, no se pierde.
  6. El `downgrade()` retira el UNIQUE (sin reconstruir los duplicados).
"""
import pytest

from tests.arnes_migraciones import ArnesMigracion


REVISION_ANTERIOR = "c6b3e8f2a5d9"
REVISION_UNICIDAD = "b7e4a9f2c6d1"

SQL_CONSTRAINT = (
    "SELECT conname FROM pg_constraint WHERE conname = 'uq_horario_categoria_dia'"
)


def _sembrar_horario(
    arnes: ArnesMigracion, horario_id: int, categoria: str, dia_semana: str,
) -> None:
    arnes.ejecutar(
        """
        INSERT INTO horario_entrenamiento (id, categoria, dia_semana, hora_inicio, hora_fin)
        VALUES (:id, :categoria, CAST(:dia AS diasemana), TIME '15:00', TIME '16:00')
        """,
        id=horario_id, categoria=categoria, dia=dia_semana,
    )


def _sembrar_persona(arnes: ArnesMigracion, persona_id: int, cedula: str) -> None:
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (:id, 'Ana', 'Torres', :cedula, DATE '2010-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """,
        id=persona_id, cedula=cedula,
    )


def test_el_unique_no_existia_antes_de_la_migracion(arnes_migracion):
    """Ancla: si esta prueba dejara de fallar sin la migración, el UNIQUE
    habría llegado al esquema por otra vía (drift)."""
    arnes_migracion.preparar(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_CONSTRAINT) == []


def test_upgrade_con_datos_limpios_crea_el_unique_y_conserva_las_filas(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_horario(arnes_migracion, 1, "FORMATIVO", "LUNES")
    _sembrar_horario(arnes_migracion, 2, "JUVENIL", "LUNES")

    arnes_migracion.migrar(REVISION_UNICIDAD)

    assert arnes_migracion.consultar(SQL_CONSTRAINT) == [("uq_horario_categoria_dia",)]
    assert arnes_migracion.consultar(
        "SELECT id, categoria, dia_semana FROM horario_entrenamiento ORDER BY id"
    ) == [(1, "FORMATIVO", "LUNES"), (2, "JUVENIL", "LUNES")]
    assert arnes_migracion.revision_actual() == REVISION_UNICIDAD


def test_upgrade_colapsa_duplicado_sin_alumnos_a_la_fila_de_id_mas_bajo(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_horario(arnes_migracion, 1, "FORMATIVO", "LUNES")
    _sembrar_horario(arnes_migracion, 2, "FORMATIVO", "LUNES")  # duplicado (el bug)

    arnes_migracion.migrar(REVISION_UNICIDAD)

    assert arnes_migracion.consultar(
        "SELECT id FROM horario_entrenamiento WHERE categoria = 'FORMATIVO' "
        "AND dia_semana = 'LUNES'"
    ) == [(1,)]
    assert arnes_migracion.consultar(SQL_CONSTRAINT) == [("uq_horario_categoria_dia",)]


def test_upgrade_reapunta_alumno_horario_al_conservado_si_no_colisiona(arnes_migracion):
    """Un alumno inscripto SOLO en la fila descartada se re-apunta a la
    conservada -- no pierde su inscripción."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_horario(arnes_migracion, 1, "FORMATIVO", "LUNES")
    _sembrar_horario(arnes_migracion, 2, "FORMATIVO", "LUNES")
    _sembrar_persona(arnes_migracion, 10, "1710034065")
    arnes_migracion.ejecutar(
        "INSERT INTO alumno_horario (id, persona_id, horario_id, fecha_asignacion) "
        "VALUES (100, 10, 2, TIMESTAMPTZ '2026-08-01 00:00:00+00')"
    )

    arnes_migracion.migrar(REVISION_UNICIDAD)

    assert arnes_migracion.consultar(
        "SELECT persona_id, horario_id FROM alumno_horario WHERE id = 100"
    ) == [(10, 1)]


def test_upgrade_borra_la_fila_sobrante_si_el_alumno_ya_esta_en_el_conservado(arnes_migracion):
    """El escenario real del bug INS-3: el alumno quedó inscripto en AMBAS
    filas duplicadas. Re-apuntar la sobrante chocaría con
    uq_alumno_horario(persona_id, horario_id) -- se borra en vez de
    re-apuntarse, y el alumno sigue inscripto una sola vez."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_horario(arnes_migracion, 1, "FORMATIVO", "LUNES")
    _sembrar_horario(arnes_migracion, 2, "FORMATIVO", "LUNES")
    _sembrar_persona(arnes_migracion, 10, "1710034065")
    arnes_migracion.ejecutar(
        "INSERT INTO alumno_horario (id, persona_id, horario_id, fecha_asignacion) VALUES "
        "(100, 10, 1, TIMESTAMPTZ '2026-08-01 00:00:00+00'), "
        "(101, 10, 2, TIMESTAMPTZ '2026-08-02 00:00:00+00')"
    )

    arnes_migracion.migrar(REVISION_UNICIDAD)

    assert arnes_migracion.consultar(
        "SELECT persona_id, horario_id FROM alumno_horario ORDER BY id"
    ) == [(10, 1)]


def test_upgrade_reapunta_el_historial_de_asistencia_a_la_fila_conservada(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_horario(arnes_migracion, 1, "FORMATIVO", "LUNES")
    _sembrar_horario(arnes_migracion, 2, "FORMATIVO", "LUNES")
    _sembrar_persona(arnes_migracion, 10, "1710034065")
    arnes_migracion.ejecutar(
        "INSERT INTO asistencia (id, fecha_entrenamiento, fecha_registro, estado, "
        "persona_id, horario_id) VALUES "
        "(200, DATE '2026-08-03', TIMESTAMPTZ '2026-08-03 12:00:00+00', 'PRESENTE', 10, 2)"
    )

    arnes_migracion.migrar(REVISION_UNICIDAD)

    assert arnes_migracion.consultar(
        "SELECT horario_id FROM asistencia WHERE id = 200"
    ) == [(1,)]


def test_downgrade_retira_el_unique(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_horario(arnes_migracion, 1, "FORMATIVO", "LUNES")
    arnes_migracion.migrar(REVISION_UNICIDAD)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.consultar(SQL_CONSTRAINT) == []
    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR


def test_upgrade_real_despues_de_la_limpieza_rechaza_un_nuevo_duplicado(arnes_migracion):
    """Prueba de humo del candado en sí: tras migrar, un INSERT crudo que
    repita (categoria, dia_semana) debe fallar en la base."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_horario(arnes_migracion, 1, "FORMATIVO", "LUNES")
    arnes_migracion.migrar(REVISION_UNICIDAD)

    with pytest.raises(Exception, match="uq_horario_categoria_dia"):
        arnes_migracion.ejecutar(
            "INSERT INTO horario_entrenamiento (id, categoria, dia_semana, hora_inicio, hora_fin) "
            "VALUES (99, 'FORMATIVO', CAST('LUNES' AS diasemana), TIME '15:00', TIME '16:00')"
        )
