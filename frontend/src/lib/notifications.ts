import type { Notificacion } from "@/types/domain";

/**
 * Backend regularization notices reuse the PAGO_APROBADO type (it is a DB
 * enum; a new value would need a migration) and open their message with this
 * prefix. Keep in sync with `PagoServicio._notificar_regularizacion` in
 * backend/app/servicios_negocio/membresia_pago_servicio.py.
 */
export const REGULARIZACION_PREFIX = "Deuda regularizada: ";
export const REGULARIZACION_TITLE = "Deuda regularizada";

// Representative feed rows arrive as "Para <name>: <message>" (added on read).
const REPRESENTATIVE_PREFIX = /^(Para [^:]+: )?/;

/**
 * Returns the title/body override for a regularization notice, or `null`
 * for any other notification.
 */
export function regularizacionDisplay(
  n: Pick<Notificacion, "tipo" | "mensaje">,
): { title: string; body: string } | null {
  if (n.tipo !== "PAGO_APROBADO") return null;
  const para = n.mensaje.match(REPRESENTATIVE_PREFIX)?.[1] ?? "";
  const rest = n.mensaje.slice(para.length);
  if (!rest.startsWith(REGULARIZACION_PREFIX)) return null;
  const text = rest.slice(REGULARIZACION_PREFIX.length);
  return {
    title: REGULARIZACION_TITLE,
    body: `${para}${text.charAt(0).toUpperCase()}${text.slice(1)}`,
  };
}
