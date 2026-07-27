"""Verifica que `ALTER SEQUENCE ... RESTART` sea transaccional en Postgres.

Este es el supuesto que sostiene el aislamiento por test del harness
(`conftest._reiniciar_secuencias`): cada test resetea las secuencias a 1
DENTRO de la transaccion externa que `db_session` revierte al terminar. Si
el RESTART no se deshiciera con el ROLLBACK, la secuencia quedaria pegada en
un valor alto despues de cada test y todos los tests que hardcodean ids bajos
(p.ej. `"persona_id": 1` en `conftest.py`) romperian de forma masiva.

Postgres NO revierte `nextval()`/`setval()` por diseno -- garantiza unicidad
entre transacciones concurrentes aunque una aborte. `ALTER SEQUENCE` es la
excepcion: es DDL y participa de la transaccion. Esa asimetria es facil de
confundir, y es exactamente de lo que depende el harness, asi que se verifica
en cada corrida en lugar de darse por sabida.
"""
from sqlalchemy import text


def test_alter_sequence_restart_se_revierte_con_rollback(motor_test):
    """RESTART + nextval + ROLLBACK deja la secuencia como estaba antes.

    Imita el ciclo SAVEPOINT/RELEASE que produce
    `Session(bind=conexion, join_transaction_mode="create_savepoint")` cada vez
    que un repositorio llama `session.commit()` internamente -- el patron real
    que atraviesan los tests, no una version simplificada.
    """
    with motor_test.connect() as conexion:
        # Tabla y secuencia temporales: viven solo en esta conexion y Postgres
        # las descarta al cerrarla. Nombres literales (no interpolados) para no
        # construir SQL por concatenacion.
        conexion.execute(
            text("CREATE TEMPORARY TABLE spike_secuencia (id integer PRIMARY KEY, nombre text)")
        )
        conexion.execute(
            text("CREATE TEMPORARY SEQUENCE spike_secuencia_seq OWNED BY spike_secuencia.id")
        )
        conexion.execute(
            text(
                "INSERT INTO spike_secuencia (id, nombre) VALUES "
                "(nextval('spike_secuencia_seq'), 'a'), "
                "(nextval('spike_secuencia_seq'), 'b'), "
                "(nextval('spike_secuencia_seq'), 'c')"
            )
        )
        # Vaciar la tabla SIN tocar la secuencia: `TRUNCATE` a secas no reinicia
        # la secuencia (solo lo haria `TRUNCATE ... RESTART IDENTITY`). Esa es
        # justo la linea base que hace falta -- 0 filas con la secuencia en 3 --
        # y ademas evita que el `nextval` posterior al RESTART choque contra el
        # id=1 que ya existiria.
        conexion.execute(text("TRUNCATE spike_secuencia"))
        conexion.commit()

        def estado_secuencia() -> tuple[int, bool]:
            fila = conexion.execute(
                text("SELECT last_value, is_called FROM spike_secuencia_seq")
            ).one()
            return fila[0], fila[1]

        assert estado_secuencia() == (3, True), "linea base: la secuencia avanzo a 3"

        # --- Transaccion externa, la que `db_session` revierte al final ---
        conexion.execute(text("ALTER SEQUENCE spike_secuencia_seq RESTART WITH 1"))
        assert estado_secuencia() == (1, False), "el RESTART se ve dentro de la transaccion"

        conexion.execute(text("SAVEPOINT sp_commit_1"))
        conexion.execute(
            text(
                "INSERT INTO spike_secuencia (id, nombre) "
                "VALUES (nextval('spike_secuencia_seq'), 'commit_1')"
            )
        )
        conexion.execute(text("RELEASE SAVEPOINT sp_commit_1"))

        conexion.execute(text("SAVEPOINT sp_commit_2"))
        conexion.execute(
            text(
                "INSERT INTO spike_secuencia (id, nombre) "
                "VALUES (nextval('spike_secuencia_seq'), 'commit_2')"
            )
        )
        conexion.execute(text("RELEASE SAVEPOINT sp_commit_2"))

        assert estado_secuencia() == (2, True), "nextval avanzo desde el valor reseteado"

        conexion.rollback()

        # --- Lo que realmente importa para el harness ---
        assert estado_secuencia() == (3, True), (
            "ALTER SEQUENCE RESTART NO se revirtio con el ROLLBACK: el aislamiento "
            "por test de conftest._reiniciar_secuencias deja de ser valido y los "
            "tests que hardcodean ids bajos van a romper de forma intermitente"
        )
        filas = conexion.execute(text("SELECT count(*) FROM spike_secuencia")).scalar_one()
        assert filas == 0, "las filas insertadas dentro de la transaccion tambien se revirtieron"
