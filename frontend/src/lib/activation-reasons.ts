/**
 * Activation gating helpers for the /login/activacion page.
 *
 * Sign-in is blocked until both conditions hold: the e-mail is verified and
 * the in-person enrollment ("alta presencial") is complete.
 * `activationPendingReasons` reports the exact outstanding conditions so UI
 * copy and tests can react to the precise combination. Omitted fields count
 * as complete for pre-#858 sessions.
 */
import type { AuthSession } from "@/services/auth";

export type ActivationSession = AuthSession & {
  correoVerificado?: boolean;
  altaPresencialCompletada?: boolean;
};

export function activationPendingReasons(session: ActivationSession): string[] {
  const reasons: string[] = [];
  if (session.correoVerificado === false) reasons.push("correo");
  if (session.altaPresencialCompletada === false) reasons.push("inscripcion");
  return reasons;
}
