"""La migración que alinea el índice único y el predicado de
`usuario.correo` con `btrim` (issue #1023, migración `f1023correobtrim`).

Mismo motivo que `test_migracion_correo_unico.py` para existir aparte de
`test_indices_consultas_reales.py`: ese guard verifica el ESTADO final del
catálogo (la fixture `esquema_migrado`, ya al HEAD); este archivo verifica
el COMPORTAMIENTO de la migración sobre datos PREEXISTENTES, sembrados vía
el arnés (`tests/arnes_migraciones.py`) en la revisión anterior
(`d1016emailunico`), donde el índice único todavía es solo sobre
`lower(correo)` -- sin `btrim` -- y dos correos que difieren únicamente
por espacios al borde pueden convivir.

Mismo criterio ADR-4 que `d1016emailunico`: la migración DETECTA y ABORTA
ante una colisión preexistente, nunca elige ni fusiona cuentas."""
import pytest
from sqlalchemy.exc import DBAPIError

REVISION_ANTERIOR = "d1016emailunico"
REVISION_CORREO_BTRIM = "f1023correobtrim"

SQL_INDICE = (
    "SELECT indexrelid::regclass::text, indisunique, "
    "pg_get_indexdef(indexrelid) AS definicion "
    "FROM pg_index "
    "WHERE indrelid = 'usuario'::regclass "
    "AND indexrelid::regclass::text = 'ix_usuario_correo_lower'"
)


def _sembrar_cuenta(arnes, id_: int, cedula: str, correo: str) -> None:
    arnes.ejecutar(
        """
        INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                             telefono, fecha_registro, activo)
        VALUES (:id, 'Ana', 'Torres', :cedula, DATE '1990-01-01',
                '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE)
        """,
        id=id_, cedula=cedula,
    )
    arnes.ejecutar(
        """
        INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,
                             version_contrasenia, activo, version_sesion,
                             persona_id)
        VALUES (:id, :correo, 'hash',
                TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, TRUE, 5, :id)
        """,
        id=id_, correo=correo,
    )


# --- La migración se niega ante duplicados preexistentes --------------------

def test_migracion_refuse_con_duplicados_de_espacios(arnes_migracion):
    """En `d1016emailunico` el índice único es solo sobre `lower(correo)`:
    dos correos que difieren únicamente por espacios al borde pasan ese
    índice pero colisionan bajo `lower(btrim(correo))`, la clave que esta
    migración usa tanto para detectar como para canonicalizar."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "espacios@ejemplo.test")
    _sembrar_cuenta(arnes_migracion, 2, "1710034073", " espacios@ejemplo.test ")

    with pytest.raises(RuntimeError, match="ABORTADA"):
        arnes_migracion.migrar(REVISION_CORREO_BTRIM)


def test_migracion_no_deja_nada_a_medio_aplicar_al_abortar(arnes_migracion):
    """ADR-4: detectar/abortar, canonicalizar y recrear el índice viven en
    LA MISMA transacción DDL -- un aborto no puede dejar filas ya
    canonicalizadas sin el índice viejo (sobre `lower(correo)`) protegiendo
    la unicidad que sí valía en esta revisión."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "espacios@ejemplo.test")
    _sembrar_cuenta(arnes_migracion, 2, "1710034073", " espacios@ejemplo.test ")

    with pytest.raises(RuntimeError, match="ABORTADA"):
        arnes_migracion.migrar(REVISION_CORREO_BTRIM)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(
        "SELECT correo FROM usuario ORDER BY id"
    ) == [("espacios@ejemplo.test",), (" espacios@ejemplo.test ",)]
    definicion = arnes_migracion.consultar(SQL_INDICE)[0][2]
    assert "btrim" not in definicion


# --- La migración avanza sobre una base sin colisiones -----------------------

def test_migracion_recrea_el_indice_sobre_lower_btrim_sin_duplicados(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "una@ejemplo.test")
    _sembrar_cuenta(arnes_migracion, 2, "1710034073", "otra@ejemplo.test")

    arnes_migracion.migrar(REVISION_CORREO_BTRIM)

    assert arnes_migracion.revision_actual() == REVISION_CORREO_BTRIM
    _nombre, unico, definicion = arnes_migracion.consultar(SQL_INDICE)[0]
    assert unico is True
    # La expresión REAL del catálogo, no la declarada en `Base.metadata`:
    # `pg_get_indexdef` es lo único que prueba que Postgres, no solo el
    # ORM, ve `btrim` en la definición del índice.
    assert "btrim" in definicion


def test_migracion_canonicaliza_espacios_legados(arnes_migracion):
    """Una fila legada con espacios al borde -- alcanzable únicamente por
    una escritura fuera de `CorreoValidado` -- queda escrita en la MISMA
    forma que el predicado de `obtener_por_correo` espera."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "  Legado@Ejemplo.TEST  ")

    arnes_migracion.migrar(REVISION_CORREO_BTRIM)

    assert arnes_migracion.consultar(
        "SELECT correo FROM usuario WHERE id = 1"
    ) == [("legado@ejemplo.test",)]


def test_postgres_rechaza_un_segundo_correo_con_espacios_tras_migrar(arnes_migracion):
    """El índice único de verdad, ejercitado directo contra Postgres: la
    colisión que `test_detecta_colision_solo_por_espacios` (en
    `test_auditar_colisiones_correo.py`) todavía podía sembrar en
    `d1016emailunico` ya no puede escribirse en una base migrada a
    `f1023correobtrim`."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "unica@ejemplo.test")
    arnes_migracion.migrar(REVISION_CORREO_BTRIM)

    with pytest.raises(DBAPIError):
        arnes_migracion.ejecutar(
            """
            INSERT INTO persona (id, nombres, apellidos, cedula, fecha_nacimiento,
                                 telefono, fecha_registro, activo)
            VALUES (2, 'Otra', 'Persona', '1710034073', DATE '1990-01-01',
                    '0991234567', TIMESTAMPTZ '2024-03-01 12:00:00+00', TRUE);
            INSERT INTO usuario (id, correo, contrasenia, fecha_creacion,
                                 version_contrasenia, activo, version_sesion,
                                 persona_id)
            VALUES (2, ' Unica@Ejemplo.test ', 'hash',
                    TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, TRUE, 5, 2);
            """
        )


# --- Downgrade ----------------------------------------------------------------

def test_downgrade_recrea_el_indice_sin_btrim_y_conserva_lo_canonicalizado(arnes_migracion):
    """Precedente exacto: `d1016emailunico`. Los valores canonicalizados NO
    se revierten -- la búsqueda ya resuelve por `lower(btrim(...))` en
    cualquiera de las dos revisiones, así que siguen siendo resolubles."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "  Legado@Ejemplo.TEST  ")
    arnes_migracion.migrar(REVISION_CORREO_BTRIM)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    _nombre, unico, definicion = arnes_migracion.consultar(SQL_INDICE)[0]
    assert unico is True
    assert "btrim" not in definicion
    assert arnes_migracion.consultar(
        "SELECT correo FROM usuario WHERE id = 1"
    ) == [("legado@ejemplo.test",)]
