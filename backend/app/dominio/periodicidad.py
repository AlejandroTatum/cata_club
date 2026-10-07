"""Periodicidad de una tarifa.

Vive fuera de `enums.py` a propósito: no respalda un tipo enum de Postgres
(la columna es VARCHAR + CHECK, ver la migración `y1tarifaperiodicidad`) y
`enums.py` es el inventario que los gates de paridad BFF/enum recorren.
"""
import enum


class PeriodicidadTarifa(str, enum.Enum):
    """Cada cuánto se paga una tarifa y cuánta cobertura compra un pago.

    MENSUAL (por defecto, toda tarifa previa): meses calendario, con deuda y
    mora. SEMANAL: un pago cubre 7 días. DIARIA ("paga por día suelto"): un
    pago cubre solo el día pagado. SEMANAL/DIARIA nunca acumulan deuda.
    """
    MENSUAL = "MENSUAL"
    SEMANAL = "SEMANAL"
    DIARIA = "DIARIA"
