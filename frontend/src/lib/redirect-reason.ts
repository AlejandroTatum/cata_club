/**
 * `?motivo=` — the one mechanism that names WHY an involuntary redirect
 * landed on `/login`, so that page can say something instead of bouncing
 * silently.
 *
 * Issue #1057: two mechanisms used to coexist for the same family of case —
 * `ProtectedRoute`'s `?motivo=sesion-expirada` (#353) and a toast `/login/
 * activacion` fired on its own when the person's session ended mid-request
 * (#1045). The toast existed only because `login/page.tsx` — the file that
 * owns this query param — was reserved by parallel work (#1044) at the time;
 * it was never a case the param mechanism couldn't cover. A toast also loses
 * the message on a full page reload, where a query param survives; the param
 * wins on both counts, so the toast is retired in favour of it here, and
 * both the URL a producer builds and the sentence `/login` shows for it are
 * written once, in this file, instead of copied at each call site.
 */
import { STATUS_MESSAGES } from "@/lib/error-message";

export type RedirectReason = "sesion-expirada" | "correo-verificado";

/** Every known reason `/login` can be told about, and the sentence it shows for each. */
export const REDIRECT_REASON_MESSAGES: Readonly<Record<RedirectReason, string>> = {
  // Issue #353 — an involuntary session loss (a refresh-and-retry that
  // ultimately failed), reusing the same sentence the rest of the app shows
  // for an expired session rather than inventing a new one here.
  "sesion-expirada": STATUS_MESSAGES[401],
  // Issue #1045/#1057 — the verification succeeded in the backend at the
  // exact moment the person's own session ended, folded in from the toast
  // that used to carry this text.
  "correo-verificado": "Su correo quedó verificado. Vuelva a iniciar sesión para continuar.",
};

/** Appends the reason to `route` the same way every producer must. */
export function withRedirectReason(route: string, reason: RedirectReason): string {
  return `${route}?motivo=${reason}`;
}

/** Narrows a raw `searchParams.get("motivo")` read into a known `RedirectReason`, or `null`. */
export function redirectReasonFrom(motivo: string | null): RedirectReason | null {
  return motivo !== null && motivo in REDIRECT_REASON_MESSAGES ? (motivo as RedirectReason) : null;
}
