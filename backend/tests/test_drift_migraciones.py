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


# Drift preexistente y ya documentado — no introducido por este cambio ni
# por el harness de Postgres. La migración `644d352bf590` (ver su docstring,
# líneas 16-21) ya corrió `alembic revision --autogenerate` y encontró este
# mismo par de diferencias, y las excluyó deliberadamente de ese slice
# quirúrgico por no estar relacionadas. Este PR (production-readiness /
# test-database-foundation) tampoco es el lugar para resolverlas: decidir
# si `uq_alumno_horario` debe re-agregarse al modelo o eliminarse de la BD
# es una decisión de producto/dominio (¿puede una persona tener más de una
# fila `alumno_horario` para el mismo horario?), no un efecto colateral de
# construir un harness de tests. Se filtran explícitamente, por nombre, para
# que esta prueba SÍ proteja contra cualquier drift NUEVO sin bloquearse en
# uno ya conocido y trazado.
_DRIFT_PREEXISTENTE_CONOCIDO = {
    ("remove_constraint", "uq_alumno_horario"),
    ("remove_column", "ranking", "ultimo_combate_o_asistencia"),
}


def _clave(diferencia: tuple) -> tuple:
    tipo = diferencia[0]
    if tipo == "remove_constraint":
        return (tipo, diferencia[1].name)
    if tipo == "remove_column":
        return (tipo, diferencia[2], diferencia[3].name)
    return diferencia


def test_no_hay_drift_entre_modelos_y_migraciones(motor_test, esquema_migrado):
    with motor_test.connect() as conexion:
        contexto = MigrationContext.configure(conexion)
        diferencias = compare_metadata(contexto, Base.metadata)

    diferencias_nuevas = [
        d for d in diferencias if _clave(d) not in _DRIFT_PREEXISTENTE_CONOCIDO
    ]

    assert diferencias_nuevas == [], (
        "El esquema migrado (alembic upgrade head) difiere de Base.metadata "
        "más allá del drift preexistente ya conocido: falta una migración, "
        "o el modelo ORM quedó desalineado del esquema real. Diferencias "
        f"nuevas detectadas: {diferencias_nuevas}"
    )
