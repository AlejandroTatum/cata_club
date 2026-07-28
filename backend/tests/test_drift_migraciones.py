"""
Prueba de "no drift" (REQ-TEST-1, decisión de diseño 1.2, sdd/production-
readiness): el `Base.metadata` del ORM y el esquema realmente aplicado por
Alembic deben coincidir. Existe para atrapar en CI el tipo exacto de
regresión registrada en Engram #3842: `Usuario.version_contrasenia` y la
tabla `cierre_mensual_ranking` llegaron a vivir en los modelos sin ninguna
migración que las creara.

Requiere Postgres real (`conftest.py` ya lo exige de forma incondicional
para toda la suite, ver `TEST_DATABASE_URL`).
"""
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext

from app.dominio.modelos import Base


# Sin exclusiones, a propósito. Esta prueba llevaba una lista blanca con
# los dos únicos casos de drift preexistente (`uq_alumno_horario` y
# `ranking.ultimo_combate_o_asistencia`); ambos quedaron resueltos: el
# constraint se declaró en `AlumnoHorario` (la base ya lo tenía desde
# `b2c3d4e5f6a7`, no hizo falta migración) y la columna muerta la elimina
# `c9e4b1d78f30`. Se borró también la maquinaria de filtrado: un conjunto
# vacío es código muerto, y mantenerlo invitaba a registrar drift nuevo ahí
# en vez de arreglarlo. Si algún día apareciera una diferencia realmente
# inevitable, agregar el filtro de vuelta es trivial y obliga a justificarlo
# en ese momento.
def test_no_hay_drift_entre_modelos_y_migraciones(motor_test, esquema_migrado):
    with motor_test.connect() as conexion:
        contexto = MigrationContext.configure(conexion)
        diferencias = compare_metadata(contexto, Base.metadata)

    assert diferencias == [], (
        "El esquema migrado (alembic upgrade head) difiere de Base.metadata: "
        "falta una migración, o el modelo ORM quedó desalineado del esquema "
        f"real. Diferencias detectadas: {diferencias}"
    )
