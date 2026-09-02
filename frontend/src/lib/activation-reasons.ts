/**
 * Activation gating helpers for the /login/activacion page.
 *
 * Issue #940: the gate DECISION belongs to the backend (`activacion_completa`,
 * the same claim the login/refresh tokens carry — see
 * `GestorAutenticacion.puede_acceder_modulos`). `correoVerificado` and
 * `altaPresencialCompletada` are only the two raw facts behind it, kept here
 * to say WHICH step is still pending — they must never be recombined into a
 * second gate decision. `isActivationComplete` reads the backend's decision;
 * `activationPendingReasons` reports the outstanding conditions so UI copy
 * and tests can react to the precise combination. Omitted fields count as
 * complete for pre-#858 (facts) / pre-#940 (decision) sessions.
 */
import type { AuthSession } from "@/services/auth";

export type ActivationSession = AuthSession & {
  correoVerificado?: boolean;
  altaPresencialCompletada?: boolean;
  activacionCompleta?: boolean;
};

/** The one gate decision — never re-derive it from the two facts elsewhere. */
export function isActivationComplete(session: ActivationSession): boolean {
  return session.activacionCompleta ?? (session.correoVerificado !== false && session.altaPresencialCompletada !== false);
}

export function activationPendingReasons(session: ActivationSession): string[] {
  const reasons: string[] = [];
  if (session.correoVerificado === false) reasons.push("correo");
  if (session.altaPresencialCompletada === false) reasons.push("inscripcion");
  return reasons;
}
