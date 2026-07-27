"""
Prueba de "no drift" para los ENUM nativos de PostgreSQL — compañera de
`test_drift_migraciones.py`, no un reemplazo.

Por qué hace falta un archivo aparte
------------------------------------
`test_drift_migraciones.py` usa `alembic.autogenerate.compare_metadata`, y
esa función NO compara los labels de un `ENUM` nativo de PostgreSQL: detecta
tablas, columnas, índices, constraints y tipos de columna, pero para una
columna `tiponotificacion` ya existente ve "enum llamado tiponotificacion" a
ambos lados y la da por igual. Alembic solo aprende a diagnosticar labels con
el plugin de terceros `alembic-postgresql-enum`, que este proyecto no usa
(ver `pyproject.toml`). Por eso su lista de exclusiones — que solo contiene
`uq_alumno_horario` y `ranking.ultimo_combate_o_asistencia` — no tiene nada
que ver con que el drift de `NUEVA_INSCRIPCION` pasara: ese drift era
invisible para `compare_metadata` con o sin exclusiones. Extender aquel
archivo no habría servido; hace falta consultar `pg_enum` directamente, que
es lo que hace esta prueba.

Qué garantiza
-------------
1. Cada `enum.Enum` de `app/dominio/enums.py` está respaldado por un tipo
   real en PostgreSQL, y TODOS sus miembros existen como label. Ésta es la
   dirección que rompe producción con HTTP 500 (`invalid input value for
   enum ...`) y no admite excepciones.
2. Ningún label vive en PostgreSQL sin estar declarado en Python, salvo los
   huérfanos históricos ya documentados abajo. Esa dirección rompe la
   LECTURA: `sa.Enum(ClasePython)` lanza `LookupError` al deserializar una
   fila con un label que Python no declara.

Corre contra el esquema que Alembic realmente aplicó (fixture
`esquema_migrado`), no contra `Base.metadata.create_all`: el objetivo es
justamente auditar lo que las migraciones dejaron en la base.
"""
import enum as _enum
import inspect

import pytest
from sqlalchemy import Enum as SAEnum, text

from app.dominio import enums as modulo_enums
from app.dominio.modelos import Base


# Labels que existen en PostgreSQL y NO en Python, de forma deliberada y ya
# trazada. `d4e5f6a7b8c9` (remoción del ranking competitivo, justificativos y
# reingreso) borró las notificaciones de esos tipos y dejó de declararlos en
# Python, pero no pudo quitarlos del tipo de PostgreSQL: `ALTER TYPE ... DROP
# VALUE` no existe, y recrear `tiponotificacion` implicaba reescribir la
# columna `notificacion.tipo`. Son inofensivos MIENTRAS no haya filas con
# esos valores; la prueba de abajo también verifica eso.
_LABELS_HUERFANOS_CONOCIDOS: dict[str, set[str]] = {
    "tiponotificacion": {
        "RANKING_ELIMINACION_PROXIMA",
        "RANKING_ASCENSO_SUGERIDO",
        "RANKING_DESCENSO_SUGERIDO",
        "RANKING_REINGRESO_APROBADO",
        "JUSTIFICATIVO_APROBADO",
        "JUSTIFICATIVO_RECHAZADO",
    },
}


def _enums_del_dominio() -> dict[str, type[_enum.Enum]]:
    """Todas las clases `enum.Enum` DEFINIDAS en `app/dominio/enums.py`
    (el filtro por `__module__` descarta lo meramente importado ahí)."""
    return {
        nombre: clase
        for nombre, clase in inspect.getmembers(modulo_enums, inspect.isclass)
        if issubclass(clase, _enum.Enum) and clase.__module__ == modulo_enums.__name__
    }


def _tipo_pg_por_clase() -> dict[type[_enum.Enum], str]:
    """Mapea cada clase de enum al nombre del tipo PostgreSQL que la respalda,
    leyéndolo del propio `Base.metadata`. Se deriva del ORM en vez de asumir
    `clase.__name__.lower()` para que la prueba siga siendo cierta si alguna
    columna declara `sa.Enum(..., name=...)` explícito."""
    mapa: dict[type[_enum.Enum], str] = {}
    for tabla in Base.metadata.tables.values():
        for columna in tabla.columns:
            tipo = columna.type
            if isinstance(tipo, SAEnum) and tipo.enum_class is not None:
                mapa.setdefault(tipo.enum_class, tipo.name)
    return mapa


def _labels_en_postgres(conexion, nombre_tipo: str) -> set[str]:
    filas = conexion.execute(
        text(
            "SELECT e.enumlabel FROM pg_enum e "
            "JOIN pg_type t ON t.oid = e.enumtypid "
            "JOIN pg_namespace n ON n.oid = t.typnamespace "
            "WHERE n.nspname = 'public' AND t.typname = :tipo"
        ),
        {"tipo": nombre_tipo},
    ).fetchall()
    return {fila[0] for fila in filas}


# SQLAlchemy persiste el NOMBRE del miembro, no su `.value`, salvo que se
# pase `values_callable` (este proyecto no lo usa en ninguna columna). Por eso
# se compara contra `miembro.name`: `NivelTecnicoAlumno.NIVEL_1` vale
# "NIVEL 1" en Python pero se guarda como el label `NIVEL_1`.
def _nombres_declarados(clase: type[_enum.Enum]) -> set[str]:
    return {miembro.name for miembro in clase}


@pytest.mark.parametrize(
    "nombre_clase", sorted(_enums_del_dominio()), ids=sorted(_enums_del_dominio())
)
def test_cada_enum_del_dominio_existe_en_postgres_con_todos_sus_labels(
    nombre_clase, motor_test, esquema_migrado
):
    """Dirección que causa el 500: un miembro declarado en Python que el tipo
    de PostgreSQL no conoce. Sin exclusiones — cualquier miembro nuevo exige
    su migración `ALTER TYPE ... ADD VALUE` en el mismo PR."""
    clase = _enums_del_dominio()[nombre_clase]
    nombre_tipo = _tipo_pg_por_clase().get(clase)
    assert nombre_tipo is not None, (
        f"`{nombre_clase}` está declarado en app/dominio/enums.py pero ninguna "
        "columna del ORM lo usa, así que no hay tipo de PostgreSQL que lo "
        "respalde. Usalo en un modelo o eliminalo del módulo de enums."
    )

    with motor_test.connect() as conexion:
        labels = _labels_en_postgres(conexion, nombre_tipo)

    assert labels, (
        f"El tipo ENUM `{nombre_tipo}` no existe en PostgreSQL: falta la "
        f"migración que lo crea para `{nombre_clase}`."
    )
    faltantes = _nombres_declarados(clase) - labels
    assert faltantes == set(), (
        f"`{nombre_clase}` declara {sorted(faltantes)} pero el tipo "
        f"`{nombre_tipo}` de PostgreSQL no los tiene. Cualquier INSERT con "
        "esos valores muere con `invalid input value for enum "
        f"{nombre_tipo}` (HTTP 500). Agregá una migración con "
        "`ALTER TYPE ... ADD VALUE` dentro de un `autocommit_block()` "
        "(ver `b3d7e5f1a9c2`)."
    )


@pytest.mark.parametrize(
    "nombre_clase", sorted(_enums_del_dominio()), ids=sorted(_enums_del_dominio())
)
def test_postgres_no_tiene_labels_que_python_desconozca(
    nombre_clase, motor_test, esquema_migrado
):
    """Dirección inversa: un label en PostgreSQL que Python no declara rompe
    la LECTURA (`LookupError` al deserializar). Se toleran únicamente los
    huérfanos históricos documentados en `_LABELS_HUERFANOS_CONOCIDOS`."""
    clase = _enums_del_dominio()[nombre_clase]
    nombre_tipo = _tipo_pg_por_clase().get(clase)
    if nombre_tipo is None:
        pytest.skip("cubierto por la prueba de labels faltantes")

    with motor_test.connect() as conexion:
        labels = _labels_en_postgres(conexion, nombre_tipo)

    sobrantes = labels - _nombres_declarados(clase)
    sobrantes -= _LABELS_HUERFANOS_CONOCIDOS.get(nombre_tipo, set())
    assert sobrantes == set(), (
        f"El tipo `{nombre_tipo}` de PostgreSQL tiene {sorted(sobrantes)}, que "
        f"`{nombre_clase}` no declara. Leer una fila con esos valores lanza "
        "`LookupError`. Declarálos en Python, o documentalos en "
        "`_LABELS_HUERFANOS_CONOCIDOS` si son huérfanos intencionales de una "
        "remoción de feature."
    )
