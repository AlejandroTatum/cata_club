/**
 * Payment/membership status vocabulary — declared exactly once.
 *
 * The audit found the payment validation status declared THREE times: the
 * original `validationStatusStyles` in `payments/page.tsx`, a copy in
 * `reports/page.tsx` whose own comment admitted it was "copied from
 * payments/page.tsx", and a third bespoke `PagoEstadoBadge` in the student
 * portal that invented `bg-emerald-50 text-emerald-700` — a green that is not
 * the state token, on the one screen a parent actually reads.
 *
 * Three declarations of one concept is three chances to drift, and it had
 * already drifted. So: one tone, one label, one place. Everything renders
 * through the `Badge` primitive, which is where colour is allowed to live.
 *
 * The domain speaks two dialects for the same three states — `ValidationStatus`
 * (admin-facing, from `/pagos/validaciones`) and `EstadoPago` (raw backend, on
 * `PagoPersona`). Rather than pick a winner and rename a domain type in what is
 * a consistency pass, both map onto the same tone/label pair below.
 */

import type { BadgeTone } from "@/components/ui/Badge";
import type { ValidationStatus, MembershipStatus } from "@/services/api";

/** Raw backend payment state, as carried on `PagoPersona.estadoPago`. */
export type EstadoPago = "PENDIENTE_VALIDACION" | "APROBADO" | "RECHAZADO";

/**
 * Tone per validation status.
 *
 * `pendiente` is `warn`, never the old `bg-amber-900/20 text-amber-400` — that
 * pair is a dark-theme leftover and it was stranded on a light card, which is
 * why the "Pendiente" payment badge was the least legible thing on the page a
 * parent visits precisely to find out whether their payment went through.
 */
export const VALIDATION_STATUS_TONES: Record<ValidationStatus, BadgeTone> = {
  pendiente: "warn",
  validado: "ok",
  rechazado: "bad",
};

export const VALIDATION_STATUS_LABELS: Record<ValidationStatus, string> = {
  pendiente: "Pendiente",
  validado: "Validado",
  rechazado: "Rechazado",
};

/** `EstadoPago` → `ValidationStatus`, so both dialects share one vocabulary. */
export const ESTADO_PAGO_TO_VALIDATION_STATUS: Record<EstadoPago, ValidationStatus> = {
  PENDIENTE_VALIDACION: "pendiente",
  APROBADO: "validado",
  RECHAZADO: "rechazado",
};

/**
 * Resolve a raw `estadoPago` to its validation status.
 *
 * Falls back to `pendiente` for an unrecognised runtime value: an unknown
 * payment state is one nobody has confirmed, and showing it as approved would
 * be the one genuinely dangerous guess.
 */
export function toValidationStatus(estadoPago: string): ValidationStatus {
  return ESTADO_PAGO_TO_VALIDATION_STATUS[estadoPago as EstadoPago] ?? "pendiente";
}

/**
 * The filter options for payment state, shared by the `/payments` filter pills
 * and the `/reports` pagos filter. Labels were already identical by copy; now
 * they are identical by construction.
 *
 * `value` is the raw `EstadoPago` because that is what both endpoints take;
 * the empty value means "no filter".
 */
export const PAGOS_ESTADO_OPTIONS: { value: "" | EstadoPago; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "PENDIENTE_VALIDACION", label: "Pendientes" },
  { value: "APROBADO", label: "Validados" },
  { value: "RECHAZADO", label: "Rechazados" },
];

/**
 * Membership status — same treatment, one declaration.
 *
 * `suspendida` keeps the `bad` tone it had as `badge-error`. Amber would read
 * better to me, but re-toning a state is a meaning change and this is a
 * consistency pass: the job is to stop the same state rendering four ways, not
 * to re-decide what the state means.
 */
export const MEMBERSHIP_STATUS_TONES: Record<MembershipStatus, BadgeTone> = {
  activa: "ok",
  vencida: "bad",
  suspendida: "bad",
};

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  activa: "Activa",
  vencida: "Vencida",
  suspendida: "Suspendida",
};
