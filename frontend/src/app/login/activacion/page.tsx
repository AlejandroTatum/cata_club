"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Mail } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cambiarCorreoNoVerificado, reenviarVerificacionCorreo } from "@/services/api";
import { getDefaultRoute } from "@/lib/auth-utils";
import { isActivationComplete, type ActivationSession } from "@/lib/activation-reasons";
import { toUserMessage } from "@/lib/error-message";
import AuthShell, {
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
  AUTH_LINK_CLASSES,
  EMAIL_DELAY_SPAM_NOTICE,
} from "@/components/auth/AuthShell";
import { Button, buttonClasses } from "@/components/ui";
import { ICON } from "@/lib/icon-size";

/**
 * The subtitle for the email-verification screen (#1191, revised by #1295).
 *
 * Names the account's own address so the person can confirm they are looking
 * for the right inbox — the verification email carries a LINK, not a code,
 * so opening it (from any device) is the one thing that resolves this
 * screen. One idea only (#1295): what was sent and how long it can take,
 * through the same delay + spam-folder sentence `forgot-password` uses, so a
 * visitor checking at the 20-second mark reads it as "still on the way", not
 * "it failed". The in-person step (club/WhatsApp, first payment) no longer
 * appears here — that is what comes AFTER this screen, and already lives on
 * the enrolment screen's own `enrolmentScreenMessage` below.
 */
function emailScreenSubtitle(activation: ActivationSession): string {
  const email = activation.user.email;
  const greeting = email ? `Le enviamos un enlace a ${email}.` : "Le enviamos un enlace a su correo.";
  return `${greeting} ${EMAIL_DELAY_SPAM_NOTICE}`;
}

/**
 * The status paragraph for screen B (#1228): one copy for a first payment in
 * review, one for a rejected one (with the club's own `motivoRechazo`
 * verbatim), and the pre-#1228 copy when there is nothing to report yet
 * (`primerPago` null) — e.g. the enrolment was never registered at all.
 */
function enrolmentScreenMessage(activation: ActivationSession): string {
  const primerPago = activation.primerPago;
  if (!primerPago) {
    return (
      "Acérquese al club o escríbanos por WhatsApp para registrar la inscripción y el primer pago. El club lo " +
      "valida y ahí se activa la membresía."
    );
  }
  if (primerPago.estado === "PENDIENTE_VALIDACION") {
    return "Su primer pago está en revisión. El club lo valida y ahí se activa la membresía; no hace falta volver al club.";
  }
  const motivo = primerPago.motivoRechazo;
  return motivo
    ? `Su primer pago fue rechazado: ${motivo}. Acérquese al club o escríbanos por WhatsApp para registrarlo de nuevo.`
    : "Su primer pago fue rechazado. Acérquese al club o escríbanos por WhatsApp para registrarlo de nuevo.";
}

function ActivationPageContent(): React.ReactElement {
  const router = useRouter();
  const { session, isAuthenticated, isLoading, refreshSession, logout } = useAuth();
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  /**
   * Set once `checkStatus` learns the email went from pending to verified
   * (#1191) — the verification itself happens on the email's own link, not
   * on a request this page makes, so nothing else here can name that
   * transition. Read only on the enrolment screen below, which is the one
   * this can land on right after: the checklist story a code/link paste used
   * to need (a session dying at the exact moment its OWN verification
   * request lands) does not apply to a plain status refresh.
   */
  const [emailJustVerified, setEmailJustVerified] = useState(false);
  /**
   * Set when "Ya verifiqué mi correo" re-checks and the email is STILL
   * pending (#1195) — until now that press re-fetched the session and
   * re-rendered the exact same screen, with nothing telling the visitor
   * anything happened at all. Cleared on the next attempt (success or not),
   * same as `resendMessage`/`resendError` below.
   */
  const [stillUnverified, setStillUnverified] = useState(false);
  /**
   * Set when "Consultar estado nuevamente" re-checks and the in-person
   * enrolment is STILL pending (#1222) — mirrors `stillUnverified` above,
   * which the enrolment screen had no equivalent of: `checkStatus` only ever
   * named the email-verified transition, so the button appeared dead when
   * the enrolment fact did not change. Cleared on the next attempt (success
   * or not), same as `stillUnverified`.
   */
  const [stillPending, setStillPending] = useState(false);
  /**
   * Issue #1245: "¿Correo equivocado? Corregirlo" on the email screen — the
   * visitor who mistyped the address at enrolment never received the
   * verification link and had no way to fix it (reinscribing collides with
   * the identity-duplicate check before the correo is even looked at). No
   * separate success banner on top of these three: the existing subtitle
   * (`emailScreenSubtitle`) already names `activation.user.email`, so once
   * `refreshSession` reloads the session under the corrected address, the
   * screen's own status copy — and the resend button below it, which reads
   * the same field — pick it up without any extra state here.
   */
  const [newEmail, setNewEmail] = useState("");
  const [emailCorrectionOpen, setEmailCorrectionOpen] = useState(false);
  const [emailCorrectionSubmitting, setEmailCorrectionSubmitting] = useState(false);
  const [emailCorrectionError, setEmailCorrectionError] = useState<string | null>(null);
  const activation = session as ActivationSession | null;
  // The BFF defaults omitted fields to complete for pre-#858 sessions.
  const correoVerificado = activation?.correoVerificado !== false;
  const altaCompletada = activation?.altaPresencialCompletada !== false;
  /**
   * Guards the mount-time refresh below so it fires at most once per visit
   * to this page, not on every re-render `isLoading`/`isAuthenticated`
   * happen to produce.
   */
  const hasRefreshedOnMount = useRef(false);

  useEffect((): void => {
    if (isLoading) return;
    if (!isAuthenticated || !activation) {
      router.replace("/login");
      return;
    }
    // Issue #940: the backend's gate decision rules the redirect — not the
    // two facts below, which only drive which of the two screens renders.
    if (isActivationComplete(activation)) {
      router.replace(getDefaultRoute(activation.user.role));
    }
  }, [activation, isAuthenticated, isLoading, router]);

  /**
   * Re-reads activation status once the session is settled (#1195). Without
   * this the gate rendered from whatever `session` held at login — so a
   * visitor who verified their email in another tab, then followed
   * "Iniciar sesión" back here, saw the pending screen again and had to
   * press "Ya verifiqué mi correo" by hand to learn what the backend
   * already knew. This is the same round trip `checkStatus` makes, but
   * silent: it only updates `session`, with none of `checkStatus`'s own
   * messaging (a background refresh is not something the visitor did).
   */
  useEffect((): void => {
    if (isLoading || !isAuthenticated || !activation) return;
    if (hasRefreshedOnMount.current) return;
    hasRefreshedOnMount.current = true;
    void refreshSession();
  }, [activation, isAuthenticated, isLoading, refreshSession]);

  async function resendVerification(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!activation) return;
    setResending(true);
    setResendMessage(null);
    setResendError(null);
    setStillUnverified(false);
    try {
      const result = await reenviarVerificacionCorreo(activation.user.email);
      setResendMessage(result.mensaje);
    } catch (error: unknown) {
      setResendError(toUserMessage(error, "No se pudo reenviar el correo. Intente nuevamente."));
    } finally {
      setResending(false);
    }
  }

  /**
   * "¿Correo equivocado? Corregirlo" (#1245): submits the new address through
   * `PATCH /api/auth/correo`, then reloads the session so the screen's own
   * status copy and the resend button both pick up the corrected value — see
   * the state comment above for why no separate success banner is needed.
   */
  async function submitEmailCorrection(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setEmailCorrectionSubmitting(true);
    setEmailCorrectionError(null);
    try {
      await cambiarCorreoNoVerificado(newEmail);
      await refreshSession();
      setEmailCorrectionOpen(false);
      setNewEmail("");
    } catch (error: unknown) {
      setEmailCorrectionError(toUserMessage(error, "No se pudo corregir el correo. Intente nuevamente."));
    } finally {
      setEmailCorrectionSubmitting(false);
    }
  }

  /**
   * Re-reads the session from the BFF — the one way this page learns the
   * email link (opened elsewhere, maybe on another device) was followed.
   * Used both as the email screen's primary action ("Ya verifiqué mi
   * correo") and the enrolment screen's ("Consultar estado nuevamente"): the
   * two are the same request, only the label differs by which fact is still
   * pending when it is pressed.
   */
  async function checkStatus(): Promise<void> {
    setResendMessage(null);
    setResendError(null);
    setStillUnverified(false);
    setStillPending(false);
    const wasEmailPending = !correoVerificado;
    const wasEnrolmentPending = correoVerificado && !altaCompletada;
    const result = await refreshSession();
    if (result.kind === "outage") {
      setResendError("No se pudo consultar el estado. Intente nuevamente en unos minutos.");
      return;
    }
    if (wasEmailPending && result.kind === "authenticated") {
      const next = result.session as ActivationSession;
      if (next.correoVerificado !== false) {
        setEmailJustVerified(true);
      } else {
        // Issue #1195: "Ya verifiqué mi correo" re-fetched and re-rendered
        // the same screen with no feedback when the email was still
        // pending — this is the one branch that names that outcome.
        setStillUnverified(true);
      }
    } else if (wasEnrolmentPending && result.kind === "authenticated") {
      const next = result.session as ActivationSession;
      if (next.altaPresencialCompletada === false) {
        // Issue #1222: "Consultar estado nuevamente" re-fetched and
        // re-rendered the same screen with no feedback when the enrolment
        // was still pending — this is the one branch that names that
        // outcome. When it is no longer false, the gate effect above
        // redirects once the backend's own decision confirms it.
        setStillPending(true);
      }
    }
  }

  if (isLoading || !activation || !isAuthenticated) {
    return (
      <div className="auth-shell flex min-h-screen items-center justify-center">
        <p className="text-sm text-cata-text/65">Cargando estado de activación…</p>
      </div>
    );
  }

  if (isActivationComplete(activation)) {
    // The guard effect above is about to redirect — nothing meaningful to
    // render for a state neither screen below is built for.
    return (
      <div className="auth-shell flex min-h-screen items-center justify-center">
        <p className="text-sm text-cata-text/65">Cargando estado de activación…</p>
      </div>
    );
  }

  // Screen A (#1191): the email is still pending, regardless of the
  // enrolment fact — the link in the verification email is the one thing
  // that resolves it, and this page only offers to re-check for it or send
  // another one.
  if (!correoVerificado) {
    return (
      <AuthShell
        title="Verifique su correo"
        subtitle={emailScreenSubtitle(activation)}
        eyebrow="Acceso al club"
        hideBack
      >
        <div className="flex flex-col gap-4">
          {/*
           * ONE primary action (#1295): "Reenviar correo de verificación".
           * "Ya verifiqué mi correo" used to sit here as a second primary —
           * the status is already checked once on mount (#1195), so the
           * manual re-check moves below as a quiet text action instead of
           * competing for the same visual weight.
           */}
          <form className="flex flex-col gap-2.5" onSubmit={resendVerification}>
            <Button type="submit" variant="primary" disabled={resending} className="w-full">
              <Mail size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              {resending ? "Enviando…" : "Reenviar correo de verificación"}
            </Button>
          </form>
          {resendMessage && <p role="status" className="text-sm leading-relaxed text-state-ok">{resendMessage}</p>}
          {resendError && <p role="alert" className="text-sm leading-relaxed text-state-bad">{resendError}</p>}

          <div className="flex flex-col items-center gap-2 text-center">
            <button
              type="button"
              onClick={checkStatus}
              disabled={resending}
              className={buttonClasses("tertiary", "sm")}
            >
              Ya verifiqué mi correo
            </button>
            {stillUnverified && (
              <p role="status" className="text-sm leading-relaxed text-ink-2">
                Todavía no encontramos la verificación. Abra el enlace del correo y vuelva a intentar.
              </p>
            )}
          </div>

          {!emailCorrectionOpen && (
            <button
              type="button"
              onClick={() => setEmailCorrectionOpen(true)}
              className={buttonClasses("tertiary", "sm")}
            >
              ¿Correo equivocado? Corregirlo
            </button>
          )}
          {emailCorrectionOpen && (
            <form className="flex flex-col gap-2.5" onSubmit={submitEmailCorrection}>
              <div>
                <label htmlFor="correo-corregido" className={AUTH_LABEL_CLASSES}>
                  Correo correcto
                </label>
                <input
                  type="email"
                  id="correo-corregido"
                  name="correo-corregido"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="correo@ejemplo.com"
                  required
                  disabled={emailCorrectionSubmitting}
                  className={AUTH_INPUT_CLASSES}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" disabled={emailCorrectionSubmitting} className="w-full">
                  {emailCorrectionSubmitting ? "Guardando…" : "Guardar correo"}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={emailCorrectionSubmitting}
                  onClick={() => {
                    setEmailCorrectionOpen(false);
                    setEmailCorrectionError(null);
                    setNewEmail("");
                  }}
                >
                  Cancelar
                </Button>
              </div>
              {emailCorrectionError && (
                <p role="alert" className="text-sm leading-relaxed text-state-bad">{emailCorrectionError}</p>
              )}
            </form>
          )}

          {/*
           * Issue #1295: the shell already renders "¿Necesita ayuda para
           * entrar?" (`AuthShell.tsx`) below the card — this in-card
           * "Necesito ayuda" duplicated that same path a few pixels away.
           * "Cerrar sesión" is the one action here the shell has no
           * equivalent for, so it is the only thing left in this row.
           */}
          <div className="flex flex-col items-center gap-2 text-center text-sm">
            <button type="button" onClick={() => void logout()} className={buttonClasses("tertiary", "sm")}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </AuthShell>
    );
  }

  // Screen B (#1191): the email is verified, the in-person enrolment is not.
  // It is completed at the club by staff — there is nothing to submit here,
  // only the status to re-check once it lands.
  return (
    <AuthShell title="Complete su inscripción en el club" eyebrow="Acceso al club" hideBack>
      <div className="flex flex-col gap-4">
        {/*
         * `aria-live="polite"`: this screen replaces the email screen in
         * place, with no navigation — the old checklist (#1045) carried the
         * same attribute so a screen-reader user heard the state change; this
         * wrapper is what carries it across the split into two screens
         * (#1191), for the one moment that content actually changes.
         */}
        <div className="flex flex-col gap-4" aria-live="polite">
          <p className="flex items-center gap-2 text-sm font-semibold text-state-ok">
            <Check size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            Correo verificado
          </p>
          <p className="text-sm leading-relaxed text-ink-2">{enrolmentScreenMessage(activation)}</p>
          {emailJustVerified && (
            <p role="status" className="text-sm leading-relaxed text-state-ok">Su correo quedó verificado.</p>
          )}
          {stillPending && (
            <p role="status" className="text-sm leading-relaxed text-ink-2">
              Todavía no registramos su inscripción en el club. Vuelva a consultar más tarde.
            </p>
          )}
        </div>

        <Button type="button" variant="primary" onClick={checkStatus} disabled={resending} className="w-full">
          Consultar estado nuevamente
        </Button>
        {resendError && <p role="alert" className="text-sm leading-relaxed text-state-bad">{resendError}</p>}

        <div className="flex flex-col items-center gap-2 text-center text-sm">
          <Link href="/ayuda" className={AUTH_LINK_CLASSES}>Necesito ayuda</Link>
          <button type="button" onClick={() => void logout()} className={buttonClasses("tertiary", "sm")}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

export default function ActivationPage(): React.ReactElement {
  return <ActivationPageContent />;
}
