from fastapi import HTTPException, status

# Compartido por `asistencias_router.py`, `personas_router.py` y
# `membresias_pagos_router.py`: los tres reportes "todo en una respuesta"
# (sin paginar, el frontend pagina client-side) necesitan el MISMO
# guardarraíl -- 422 con el número real, nunca un truncado silencioso a las
# primeras N filas (issue #121, replicado en asistencias/personas por #812).
# Vive acá, y no en `membresias_pagos_router.py` (donde nació), para que un
# tercer router no tenga que importar de un segundo solo para reusar cuatro
# líneas.
#
# QA4 PERF-11: el tope de filas es UNO para los tres reportes. Con ~380 bytes
# por fila, 5000 filas son ~2 MB de JSON (y un PDF de varios segundos en el
# único worker); 10000 duplicaba ambos sin que ningún rango real del club se
# acercara. Se rechaza en vez de paginar porque el reporte es un documento
# (PDF / Excel con el rango completo): truncarlo en silencio sería peor.

LIMITE_MAXIMO_FILAS_REPORTE = 5000


def exigir_tope_reporte(total: int, limite: int, unidad: str) -> None:
    """Rechaza con 422 si el `total` filtrado de un reporte supera su
    `limite`. `unidad` es el sustantivo que completa el mensaje ("pagos",
    "asistencias", "personas")."""
    if total > limite:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"El reporte tiene {total} {unidad} y el límite máximo es "
                f"{limite}. Reduzca el rango de fechas para continuar."
            ),
        )
