"""La migración de unicidad case-insensitive de `usuario.correo` (issue
#1016, ADR-3/ADR-4).

Por qué existe este archivo aparte de `test_indices_consultas_reales.py`:
ese guard verifica el ESTADO final (el índice único existe en el catálogo
de una base migrada desde cero, vía la fixture `esquema_migrado`). Este
archivo verifica el COMPORTAMIENTO de la migración misma sobre datos
PREEXISTENTES -- lo que solo el arnés (`tests/arnes_migraciones.py`) puede
montar: una base con colisiones de capitalización YA sembradas, para
probar que la migración se niega a aplicarse en vez de elegir o fusionar
cuentas (ADR-4).

Regla que gobierna el legado, la parte delicada: la migración DETECTA y
ABORTA, nunca elige ni fusiona. Por eso es un índice único de verdad (no un
trigger, al revés que `e762rolunico`) -- acá SÍ es correcto que
`alembic upgrade` muera si hay duplicados: fusionar dos cuentas de socios
distintos es una decisión del dueño del club, no de un deploy automático."""
import pytest
from sqlalchemy.exc import DBAPIError

REVISION_ANTERIOR = "780ef12115e6"
REVISION_CORREO_UNICO = "d1016emailunico"

SQL_INDICE = (
    "SELECT indexrelid::regclass::text, indisunique FROM pg_index "
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

def test_migracion_refuse_con_duplicados_de_capitalizacion(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "Ana@Ejemplo.test")
    _sembrar_cuenta(arnes_migracion, 2, "1710034073", "ana@ejemplo.test")

    with pytest.raises(Exception):
        arnes_migracion.migrar(REVISION_CORREO_UNICO)


def test_migracion_refuse_con_duplicados_de_espacios(arnes_migracion):
    """Dos correos que solo difieren por espacios alrededor pasan la
    detección actual (agrupa por `lower(correo)`, sin `btrim`) pero
    colisionan en la canonicalización (`lower(btrim(correo))`) -- deben
    quedar atrapados en el MISMO paso 1, con el mismo refuso limpio que un
    duplicado de capitalización, no fallar más adelante contra el
    `unique=True` case-sensitive de la columna."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "espacios@ejemplo.test")
    _sembrar_cuenta(arnes_migracion, 2, "1710034073", " espacios@ejemplo.test")

    with pytest.raises(RuntimeError, match="ABORTADA"):
        arnes_migracion.migrar(REVISION_CORREO_UNICO)


def test_migracion_no_deja_nada_a_medio_aplicar_al_abortar(arnes_migracion):
    """ADR-4: detectar/abortar, canonicalizar y crear el índice único viven
    en LA MISMA transacción DDL de Postgres -- un aborto no puede dejar
    filas ya canonicalizadas sin la protección del índice."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "Ana@Ejemplo.test")
    _sembrar_cuenta(arnes_migracion, 2, "1710034073", "ana@ejemplo.test")

    with pytest.raises(Exception):
        arnes_migracion.migrar(REVISION_CORREO_UNICO)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    # Ninguna fila fue canonicalizada -- el UPDATE nunca llegó a comitear.
    assert arnes_migracion.consultar(
        "SELECT correo FROM usuario ORDER BY id"
    ) == [("Ana@Ejemplo.test",), ("ana@ejemplo.test",)]
    # El índice sigue siendo el viejo, no único.
    assert arnes_migracion.consultar(SQL_INDICE) == [
        ("ix_usuario_correo_lower", False)
    ]


# --- La migración avanza sobre una base sin colisiones -----------------------

def test_migracion_crea_el_indice_unico_sin_duplicados(arnes_migracion):
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "una@ejemplo.test")
    _sembrar_cuenta(arnes_migracion, 2, "1710034073", "otra@ejemplo.test")

    arnes_migracion.migrar(REVISION_CORREO_UNICO)

    assert arnes_migracion.revision_actual() == REVISION_CORREO_UNICO
    assert arnes_migracion.consultar(SQL_INDICE) == [
        ("ix_usuario_correo_lower", True)
    ]


def test_migracion_canonicaliza_correos_legados(arnes_migracion):
    """Filas legadas con espacios/mayúsculas quedan escritas en la MISMA
    forma que `CorreoValidado` produce de acá en más (strip + minúsculas),
    así el índice único no rechaza a la fila legada contra sí misma."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "  Legado@Ejemplo.TEST  ")

    arnes_migracion.migrar(REVISION_CORREO_UNICO)

    assert arnes_migracion.consultar(
        "SELECT correo FROM usuario WHERE id = 1"
    ) == [("legado@ejemplo.test",)]


def test_postgres_rechaza_un_segundo_correo_variante_tras_migrar(arnes_migracion):
    """El índice único de verdad, ejercitado directo contra Postgres: sin
    pasar por ningún servicio."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "unica@ejemplo.test")
    arnes_migracion.migrar(REVISION_CORREO_UNICO)

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
            VALUES (2, 'UNICA@Ejemplo.test', 'hash',
                    TIMESTAMPTZ '2024-03-01 12:00:00+00', 1, TRUE, 5, 2);
            """
        )


# --- Downgrade ----------------------------------------------------------------

def test_downgrade_recrea_el_indice_no_unico_y_conserva_lo_canonicalizado(arnes_migracion):
    """Precedente exacto: `780ef12115e6`. Los valores canonicalizados NO se
    revierten -- la búsqueda ya es case-insensitive, así que siguen siendo
    resolubles; deshacer la canonicalización no restauraría ningún dato que
    la fila no tuviera ya."""
    arnes_migracion.preparar(REVISION_ANTERIOR)
    _sembrar_cuenta(arnes_migracion, 1, "1710034065", "  Legado@Ejemplo.TEST  ")
    arnes_migracion.migrar(REVISION_CORREO_UNICO)

    arnes_migracion.revertir(REVISION_ANTERIOR)

    assert arnes_migracion.revision_actual() == REVISION_ANTERIOR
    assert arnes_migracion.consultar(SQL_INDICE) == [
        ("ix_usuario_correo_lower", False)
    ]
    assert arnes_migracion.consultar(
        "SELECT correo FROM usuario WHERE id = 1"
    ) == [("legado@ejemplo.test",)]
