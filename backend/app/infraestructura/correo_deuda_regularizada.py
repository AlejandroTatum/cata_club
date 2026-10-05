"""Correo de "Deuda regularizada" (QA owner R2, T6).

Vive aparte de `ServicioNotificaciones.enviar_pago_aprobado` a propósito: una
regularización la hace el club sobre deuda vieja, así que el aviso no puede
decir "Pago aprobado". Reusa el layout de marca y el envío del servicio.
"""
from datetime import date
from decimal import Decimal
from typing import Optional

from app.infraestructura.notificaciones_servicio import ServicioNotificaciones
from app.infraestructura.plantillas_correo import construir_correo
from app.soporte_transversal.formato import formatear_monto_usd

ASUNTO_DEUDA_REGULARIZADA = "Cata Club | Deuda regularizada"


def enviar_deuda_regularizada(
    servicio: ServicioNotificaciones,
    *,
    correo: str,
    nombre: Optional[str],
    monto: Decimal,
    vigente_hasta: date,
    nombre_alumno: Optional[str] = None,
) -> None:
    alumno = (nombre_alumno or "").strip()
    vigencia = vigente_hasta.strftime("%d/%m/%Y")
    parrafo = (
        f"El club regularizó la deuda de {alumno} por {formatear_monto_usd(monto)}. "
        f"Su cobertura está al día hasta el {vigencia}."
        if alumno
        else f"El club regularizó tu deuda por {formatear_monto_usd(monto)}. "
        f"Tu cobertura está al día hasta el {vigencia}."
    )
    filas = [("Jugador", alumno)] if alumno else []
    filas += [("Monto", formatear_monto_usd(monto)), ("Vigente hasta", vigencia)]
    texto, html = construir_correo(
        titulo="Deuda regularizada",
        preheader="El club regularizó la deuda de tu membresía.",
        saludo=f"Hola {nombre}," if nombre else "Hola,",
        parrafos=(parrafo,),
        filas=filas,
        chip=("Regularizada", "exito"),
        cta_etiqueta="Ver mis pagos",
        cta_url=f"{servicio._frontend_url}/student/payments",
    )
    servicio.enviar_correo(
        destinatario=correo, asunto=ASUNTO_DEUDA_REGULARIZADA,
        cuerpo_texto=texto, cuerpo_html=html,
    )
