"""
Guard de índices para las consultas REALES del sistema (issue #811): los
filtros y ordenamientos compuestos que ya corren en repositorios y tareas
Celery, que un índice de una sola columna no puede servir completo.

POR QUÉ CONTRA POSTGRES Y NO CONTRA `Base.metadata`
---------------------------------------------------
`test_indices_fk.py` ya cubre el ángulo declarativo: lee `Base.metadata` sin
conexión y verifica que cada FK esté declarada con cobertura. Ese guard NO
puede distinguir "alguien escribió un `Index(...)` en `modelos.py`" de "el
índice existe en la base": son dos hechos distintos, y el segundo es el que
hace rápida una consulta. Un `Index` declarado sin su migración
correspondiente deja `test_indices_fk.py` en verde y la producción con
sequential scans.

Por eso este archivo consulta el catálogo REAL de Postgres (`pg_index`,
`pg_class`, `pg_attribute`) sobre el esquema que `esquema_migrado` construyó
corriendo `alembic upgrade head` de verdad. Lo que se afirma acá es que la
MIGRACIÓN produjo el índice, no que alguien lo declaró. No se duplica el
criterio de `test_indices_fk.py`; se prueba el eslabón que ese guard no
alcanza.

EL ORDEN DE LAS COLUMNAS ES LA SUSTANCIA
----------------------------------------
Un índice sobre `(fecha_registro, estado_pago)` NO es el mismo índice que uno
sobre `(estado_pago, fecha_registro)`: el segundo sirve una igualdad por
estado más un rango/orden por fecha; el primero no. Por eso el helper
reconstruye el orden desde la ordinalidad de `pg_index.indkey` y las
aserciones comparan tuplas ordenadas, no conjuntos.

No se pide `DESC` explícito en ninguna declaración: un btree se recorre para
atrás igual de barato, así que un índice ASC sirve un `ORDER BY ... DESC`.

JUSTIFICACIÓN DE CADA ÍNDICE (consulta concreta, archivo:línea)
---------------------------------------------------------------
Cada entrada de `_INDICES_REQUERIDOS` lleva la cita de la consulta que la
motiva. Un índice sin consulta que lo use es costo de escritura sin
beneficio de lectura; si alguna de esas consultas desaparece, el índice
correspondiente se retira junto con ella.
"""
from typing import Optional

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session


# Marcador para una posición de índice que NO es una columna concreta sino una
# expresión (`pg_index.indkey` la representa con `attnum = 0`). Se conserva la
# posición en vez de descartarla para que un índice funcional nunca se
# confunda con uno de columnas -- ninguna tupla requerida puede contener esto.
_EXPRESION = "<expresión>"


# (tabla, nombre, columnas en orden). Cada índice cita la consulta que lo
# justifica; el orden de las columnas es parte de la aserción.
_INDICES_REQUERIDOS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    # `pago_repositorio.py` `listar` (:94-102) y `contar` (:126-134), la cola
    # de validación del administrador: igualdad OPCIONAL por `estado_pago`,
    # rango OPCIONAL sobre `fecha_registro` y `ORDER BY fecha_registro DESC`.
    # Con `estado_pago` fijo, el índice entrega las filas ya ordenadas por
    # fecha, así que sirve el rango y el orden sin sort aparte.
    ("pago", "ix_pago_estado_fecha_registro", ("estado_pago", "fecha_registro")),
    # `pago_repositorio.py` `listar_por_persona` (:111-115): igualdad por
    # `persona_id` más `ORDER BY fecha_registro DESC`. Reemplaza a
    # `ix_pago_persona_id`, que servía el filtro pero dejaba el sort suelto.
    ("pago", "ix_pago_persona_fecha_registro", ("persona_id", "fecha_registro")),
    # Dos consumidores, un solo índice:
    # - `vencimientos_tareas.py` (:71-78): `MAX(fecha_fin) GROUP BY
    #   membresia_id` sobre los pagos APROBADOS.
    # - `alertas_tareas.py` (:461-474): esto NO es el mismo `GROUP BY`. Es
    #   `ROW_NUMBER() OVER (PARTITION BY membresia_id ORDER BY fecha_fin DESC,
    #   id DESC)`. El índice igual lo sirve: recorriéndolo con `estado_pago`
    #   fijo, las filas salen ya ordenadas por `(membresia_id, fecha_fin)`,
    #   que es exactamente la partición y el orden que la ventana necesita.
    (
        "pago",
        "ix_pago_estado_membresia_fecha_fin",
        ("estado_pago", "membresia_id", "fecha_fin"),
    ),
    # `alertas_tareas.py` (:99-110), aviso de vencimiento próximo: igualdad
    # por `estado_pago` APROBADO más rango sobre `fecha_fin` (entre hoy y la
    # fecha objetivo).
    ("pago", "ix_pago_estado_fecha_fin", ("estado_pago", "fecha_fin")),
    # `comprobante_tareas.py` (:166-176), reconciliación de comprobantes:
    # igualdad por `estado_pago` APROBADO, `fecha_validacion IS NOT NULL` y
    # `fecha_validacion < limite`.
    (
        "pago",
        "ix_pago_estado_fecha_validacion",
        ("estado_pago", "fecha_validacion"),
    ),
    # `notificacion_repositorio.py` `listar_por_persona` (:22-26): igualdad
    # por `persona_id` más `ORDER BY fecha_creacion DESC, id DESC`.
    # El sitio de llamada emparentado es
    # `app/servicios_negocio/notificacion_servicio.py` (:83-87) -- la ruta
    # `app/servicios/...` que cita el issue no existe. Ahí el filtro es
    # `persona_id.in_(...)`, así que el índice acelera la búsqueda de cada
    # valor pero NO devuelve gratis un resultado globalmente ordenado: con
    # varios `persona_id` Postgres igual tiene que combinar y ordenar.
    (
        "notificacion",
        "ix_notificacion_persona_fecha_creacion",
        ("persona_id", "fecha_creacion"),
    ),
    # `asistencia_repositorio.py` `listar_por_persona` (:142-143) y
    # `_query_reporte` (:205-210): igualdad por `persona_id` combinada con el
    # rango opcional sobre `fecha_entrenamiento`.
    (
        "asistencia",
        "ix_asistencia_persona_fecha_entrenamiento",
        ("persona_id", "fecha_entrenamiento"),
    ),
    # `asistencia_repositorio.py` `_query_reporte` (:203-210), rama
    # `horario_id`: es un filtro opcional INDEPENDIENTE del de `persona_id`
    # (se combinan con AND junto al rango de fechas), así que necesita su
    # propio compuesto -- el de `persona_id` no lo cubre.
    (
        "asistencia",
        "ix_asistencia_horario_fecha_entrenamiento",
        ("horario_id", "fecha_entrenamiento"),
    ),
    # `persona_repositorio.py` `listar_nuevas_por_periodo` (:111-115),
    # E04-RF014: rango sobre `fecha_registro` por sus dos extremos más
    # `ORDER BY fecha_registro ASC`. Una sola columna alcanza: no hay
    # igualdad previa que anteponer.
    ("persona", "ix_persona_fecha_registro", ("fecha_registro",)),
    # Issue #827: `usuario_ficha_repositorio.py` `obtener_por_correo` (:73-78)
    # filtra `func.lower(correo) = ?`, no `correo`. Corre en CADA petición
    # autenticada (`GestorAutenticacion.decodificar_token`) y en cada login,
    # así que necesita un índice FUNCIONAL sobre la misma expresión -- el
    # unique implícito de la columna es sensible a mayúsculas y no la sirve.
    ("usuario", "ix_usuario_correo_lower", (_EXPRESION,)),
)


# (tabla, nombre) de los índices que esta migración RETIRA. Cada uno quedó
# redundante porque su columna sigue siendo la más a la izquierda de otro
# índice no parcial o de un UniqueConstraint: un índice `(a, b)` sirve
# `WHERE a`, así que mantener también `(a)` es costo de escritura y espacio
# sin ninguna consulta que lo prefiera.
_INDICES_RETIRADOS: tuple[tuple[str, str], ...] = (
    # `categoria` ya es la primera columna de `uq_horario_categoria_dia`.
    ("horario_entrenamiento", "ix_horario_entrenamiento_categoria"),
    # `admin_persona_id` ya es la primera columna de
    # `uq_enrollment_notif_outbox_admin_alumno`.
    ("enrollment_notificacion_outbox", "ix_enrollment_notif_outbox_admin"),
    # Los cuatro siguientes quedan cubiertos por los compuestos nuevos.
    ("asistencia", "ix_asistencia_persona_id"),
    ("pago", "ix_pago_persona_id"),
    ("notificacion", "ix_notificacion_persona_id"),
    ("asistencia", "ix_asistencia_horario_id"),
)


# `unnest(indkey) WITH ORDINALITY` es lo que conserva el ORDEN de las columnas
# del índice; sin esa ordinalidad el resultado sería un conjunto y la
# distinción entre `(a, b)` y `(b, a)` se perdería.
#
# El `LEFT JOIN` a `pg_attribute` es deliberado: una posición de expresión
# tiene `attnum = 0` y no matchea ninguna columna. Con un JOIN interno esa
# posición desaparecería y un índice funcional se leería como si tuviera
# menos columnas de las que tiene. Se conserva como `_EXPRESION`.
#
# No se filtran los índices PARCIALES: sus nombres tienen que seguir siendo
# visibles para poder afirmar que un índice retirado ya no existe.
_CONSULTA_INDICES = text(
    """
    SELECT
        ic.relname AS indice,
        k.orden AS orden,
        COALESCE(a.attname, :expresion) AS columna
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey::smallint[]) WITH ORDINALITY AS k(attnum, orden)
    LEFT JOIN pg_attribute a
        ON a.attrelid = tc.oid AND a.attnum = k.attnum AND NOT a.attisdropped
    WHERE n.nspname = 'public' AND tc.relname = :tabla
    ORDER BY ic.relname, k.orden
    """
)


def _indices_de(db_session: Session, tabla: str) -> dict[str, tuple[str, ...]]:
    """Índices REALES de `tabla` en el catálogo de Postgres, como
    `nombre -> tupla ORDENADA de nombres de columna`.

    Incluye índices únicos y parciales (sus nombres importan para verificar
    retiros). Una posición que sea una expresión y no una columna aparece
    como `_EXPRESION`, de modo que un índice funcional jamás pueda coincidir
    por accidente con una tupla de columnas requerida."""
    filas = db_session.execute(
        _CONSULTA_INDICES, {"tabla": tabla, "expresion": _EXPRESION}
    ).all()

    columnas_por_indice: dict[str, list[str]] = {}
    for nombre_indice, _orden, columna in filas:
        columnas_por_indice.setdefault(nombre_indice, []).append(columna)

    return {nombre: tuple(columnas) for nombre, columnas in columnas_por_indice.items()}


def _describir(columnas: Optional[tuple[str, ...]]) -> str:
    return "AUSENTE" if columnas is None else f"({', '.join(columnas)})"


@pytest.mark.parametrize(
    ("tabla", "nombre", "columnas"),
    _INDICES_REQUERIDOS,
    ids=[nombre for _tabla, nombre, _columnas in _INDICES_REQUERIDOS],
)
def test_indice_de_consulta_real_existe_en_postgres(
    db_session: Session, tabla: str, nombre: str, columnas: tuple[str, ...]
):
    """El índice existe en el catálogo de Postgres CON sus columnas en el
    orden declarado. El orden no es un detalle de forma: es lo único que hace
    que el índice sirva la consulta que lo justifica."""
    reales = _indices_de(db_session, tabla)
    assert nombre in reales, (
        f"Falta el índice `{nombre}` en la tabla `{tabla}`. "
        f"Índices presentes: {sorted(reales)}. "
        "Declararlo en el `__table_args__` de `modelos.py` Y crearlo en una "
        "migración de Alembic -- declararlo solo deja este guard en rojo."
    )
    assert reales[nombre] == columnas, (
        f"El índice `{nombre}` de `{tabla}` tiene las columnas "
        f"{_describir(reales[nombre])} pero se esperaba {_describir(columnas)}. "
        "El ORDEN importa: un índice `(b, a)` no sirve la consulta que "
        "necesita `(a, b)`."
    )


# Issue #1016 (ADR-3/ADR-4, migración `d1016emailunico`): un índice
# declarado no es un índice ÚNICO. `test_indice_de_consulta_real_existe_en_
# postgres` ya prueba que `ix_usuario_correo_lower` existe con la columna
# correcta, pero un índice funcional plano y uno único son dos hechos
# distintos para Postgres -- el primero acelera la lectura, el segundo
# además IMPIDE la carrera de dos altas con distinta capitalización de la
# MISMA dirección. Se lee `pg_index.indisunique` contra el catálogo real,
# nunca `Base.metadata` (mismo motivo que el resto de este archivo).
def test_indice_de_correo_lower_es_unico_en_postgres(db_session: Session):
    fila = db_session.execute(
        text(
            "SELECT indisunique FROM pg_index "
            "WHERE indrelid = 'usuario'::regclass "
            "AND indexrelid = 'ix_usuario_correo_lower'::regclass"
        )
    ).one_or_none()
    assert fila is not None, (
        "No se encontró `ix_usuario_correo_lower` en el catálogo de "
        "Postgres para la tabla `usuario`."
    )
    assert fila[0] is True, (
        "`ix_usuario_correo_lower` existe pero NO es único: dos cuentas "
        "cuyo correo difiera solo en mayúsculas o espacios podrían "
        "convivir. Falta aplicar la migración `d1016emailunico`."
    )


# Issue #1023 (migración `f1023correobtrim`): un índice declarado con
# `btrim` en `Base.metadata` no prueba que Postgres lo esté sirviendo --
# `test_indice_de_consulta_real_existe_en_postgres` de arriba solo verifica
# que la posición sea una expresión (`_EXPRESION`), sin comparar CUÁL. Se
# lee `pg_get_indexdef` contra el catálogo real: si el índice quedara
# declarado sobre `lower(correo)` a secas mientras el predicado de
# `obtener_por_correo` filtra por `lower(btrim(correo))`, la consulta más
# caliente del sistema dejaría de poder usarlo y caería a sequential scan
# -- exactamente la regresión que la corrección de la premisa original de
# este issue advirtió.
def test_indice_de_correo_lower_usa_btrim_en_postgres(db_session: Session):
    fila = db_session.execute(
        text(
            "SELECT pg_get_indexdef(indexrelid) FROM pg_index "
            "WHERE indrelid = 'usuario'::regclass "
            "AND indexrelid = 'ix_usuario_correo_lower'::regclass"
        )
    ).one_or_none()
    assert fila is not None, (
        "No se encontró `ix_usuario_correo_lower` en el catálogo de "
        "Postgres para la tabla `usuario`."
    )
    assert "btrim" in fila[0], (
        f"`ix_usuario_correo_lower` no usa `btrim` en su definición real "
        f"({fila[0]!r}). El predicado de `obtener_por_correo` filtra por "
        "`lower(btrim(correo))`; si el índice no comparte esa expresión "
        "exacta, Postgres no puede usarlo para esa consulta."
    )


@pytest.mark.parametrize(
    ("tabla", "nombre"),
    _INDICES_RETIRADOS,
    ids=[nombre for _tabla, nombre in _INDICES_RETIRADOS],
)
def test_indice_redundante_ya_no_existe_en_postgres(
    db_session: Session, tabla: str, nombre: str
):
    """El índice redundante fue eliminado por la migración. Su columna sigue
    cubierta por la posición más a la izquierda de otro índice no parcial o
    de un UniqueConstraint, así que `test_indices_fk.py` sigue en verde."""
    reales = _indices_de(db_session, tabla)
    assert nombre not in reales, (
        f"El índice redundante `{nombre}` sigue existiendo en `{tabla}` "
        f"con las columnas {_describir(reales[nombre])}. "
        "Su columna ya está cubierta por otro índice o constraint: "
        "eliminarlo en `modelos.py` Y en la migración."
    )
