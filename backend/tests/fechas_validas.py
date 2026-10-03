"""
Fechas de sesión válidas para fixtures de asistencia.

El servicio solo acepta hoy y hasta `VENTANA_REGISTRO_ASISTENCIA_DIAS` días
atrás (hora del club), así que una fecha fija en un test envejece hasta ser
rechazada. `ultima_fecha_en` devuelve la ocurrencia más reciente de un día de
la semana dentro de esa ventana.
"""

from datetime import date, timedelta

from app.soporte_transversal.tiempo import hoy_club

DIAS = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"]


def ultima_fecha_en(dia_semana: str, dias_atras_extra: int = 0) -> date:
    """Fecha más reciente (hoy incluido) que cae en `dia_semana`, retrocediendo
    además `dias_atras_extra` semanas completas."""
    hoy = hoy_club()
    desfase = (hoy.weekday() - DIAS.index(dia_semana)) % 7
    return hoy - timedelta(days=desfase + 7 * dias_atras_extra)
