"""
Guard permanente de cobertura de índices para columnas FK
(sdd/database-index-coverage). Inspecciona `Base.metadata` directamente --
sin conexión a Postgres, sin fixtures de base de datos -- y falla si alguna
columna FK no está cubierta por un constraint/índice utilizable en la
posición más a la izquierda.

CERO exclusiones: no hay allowlist ni mecanismo de excepción documentada --
una FK sin cobertura es una aserción que falla, no algo que se pueda
suprimir (mismo criterio que `test_drift_migraciones.py`, cuyo comentario
:18-27 llama a una allowlist vacía "código muerto").
"""
from sqlalchemy import Column, Index, UniqueConstraint
from sqlalchemy.sql.schema import Table

from app.dominio.modelos import Base


def _primer_nombre_columna_real(expresiones) -> str | None:
    """Nombre de la primera `Column` real de una colección ORDENADA de
    expresiones (columnas de un constraint, o `Index.expressions`). Una
    expresión funcional en la primera posición no cubre ninguna columna
    concreta -- solo importa la posición más a la izquierda."""
    primera = next(iter(expresiones), None)
    return primera.name if isinstance(primera, Column) else None


def _es_indice_parcial(indice: Index) -> bool:
    """Un índice PARCIAL (con `postgresql_where`) solo cubre las filas que
    matchean su predicado, no lookups generales sobre la columna -- no
    cuenta como cobertura (decisión explícita de
    sdd/database-index-coverage/design: sin este filtro,
    `uq_membresia_activa_por_persona` y `uq_pago_pendiente_por_membresia`
    volverían opcionales los índices completos que el guard debe exigir)."""
    where = indice.dialect_kwargs.get("postgresql_where")
    if where is None:
        where = indice.dialect_options.get("postgresql", {}).get("where")
    return where is not None


def _columnas_cubiertas(tabla: Table) -> set[str]:
    """Nombres de columna que ocupan la posición más a la izquierda de al
    menos una PrimaryKeyConstraint, UniqueConstraint, o Index no parcial de
    la tabla."""
    cubiertas: set[str] = set()

    columna_pk = _primer_nombre_columna_real(tabla.primary_key.columns)
    if columna_pk:
        cubiertas.add(columna_pk)

    for constraint in tabla.constraints:
        if isinstance(constraint, UniqueConstraint):
            columna = _primer_nombre_columna_real(constraint.columns)
            if columna:
                cubiertas.add(columna)

    for indice in tabla.indexes:
        if _es_indice_parcial(indice):
            continue
        columna = _primer_nombre_columna_real(indice.expressions)
        if columna:
            cubiertas.add(columna)

    return cubiertas


def test_toda_fk_tiene_cobertura_de_indice():
    """Cada columna local de cada `ForeignKeyConstraint` de `Base.metadata`
    debe ser la columna más a la izquierda de al menos una PK,
    UniqueConstraint, o Index no parcial de su tabla. Sin excepciones: se
    recolectan TODAS las violaciones antes de fallar, nunca fail-fast."""
    violaciones: list[str] = []

    for tabla in Base.metadata.tables.values():
        cubiertas = _columnas_cubiertas(tabla)
        for fk_constraint in tabla.foreign_key_constraints:
            columna_fk = fk_constraint.column_keys[0]
            if columna_fk not in cubiertas:
                violaciones.append(f"{tabla.name}.{columna_fk}")

    assert not violaciones, (
        f"FKs sin cobertura de índice ({len(violaciones)}):\n"
        + "\n".join(
            f"  - {violacion} -> agregar Index(\"ix_{violacion.replace('.', '_')}\", "
            f"\"{violacion.split('.')[-1]}\") al __table_args__"
            for violacion in violaciones
        )
        + "\nAgregá cada Index al __table_args__ de la clase y creá la migración."
    )
