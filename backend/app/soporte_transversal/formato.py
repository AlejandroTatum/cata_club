"""Formato de cantidades para textos que ve el usuario (correos, PDF)."""
from decimal import Decimal


def formatear_monto_usd(monto: Decimal | float | int) -> str:
    """`Decimal("40")` -> `$40,00`; coma decimal y punto de miles (es-EC)."""
    entero_y_decimales = f"{Decimal(monto):,.2f}"
    return "$" + entero_y_decimales.replace(",", "_").replace(".", ",").replace("_", ".")
