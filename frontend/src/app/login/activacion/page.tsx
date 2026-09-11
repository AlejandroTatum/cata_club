"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Mail } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { reenviarVerificacionCorreo } from "@/services/api";
import { getDefaultRoute } from "@/lib/auth-utils";
import { isActivationComplete, type ActivationSession } from "@/lib/activation-reasons";
import { toUserMessage } from "@/lib/error-message";
import AuthShell, { AUTH_LINK_CLASSES } from "@/components/auth/AuthShell";
import { Button, buttonClasses } from "@/components/ui";
import { ICON } from "@/lib/icon-size";

/**
 * The subtitle for the email-verification screen (#1191).
 *
 * Names the account's own address so the person can confirm they are looking
 * for the right inbox — the verification email carries a LINK, not a code,
 * so opening it (from any device) is the one thing that resolves this
 * screen. The third sentence only appears when the in-person enrolment is
 * ALSO still pending — naming the next step up front avoids the surprise of
 * landing back on this same route for a different reason right after
 * finishing this one.
 */
function emailScreenSubtitle(activation: ActivationSession, altaCompletada: boolean): string {
  const email = activation.user.email;
  const parts = [
    email ? `Le enviamos un enlace a ${email}.` : "Le enviamos un enlace a su correo.",
    "Ábralo para verificar su cuenta; puede hacerlo desde este u otro dispositivo.",
  ];
  if (!altaCompletada) {
    parts.push("Después queda un paso: la inscripción presencial en el club.");
  }
  return parts.join(" ");
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
  const activation = session as ActivationSession | null;
  // The BFF defaults omitted fields to complete for pre-#858 sessions.
  const correoVerificado = activation?.correoVerificado !== false;
  const altaCompletada = activation?.altaPresencialCompletada !== false;

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

  async function resendVerification(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!activation) return;
    setResending(true);
    setResendMessage(null);
    setResendError(null);
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
    const wasEmailPending = !correoVerificado;
    const result = await refreshSession();
    if (result.kind === "outage") {
      setResendError("No se pudo consultar el estado. Intente nuevamente en unos minutos.");
      return;
    }
    if (wasEmailPending && result.kind === "authenticated") {
      const next = result.session as ActivationSession;
      if (next.correoVerificado !== false) {
        setEmailJustVerified(true);
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
      <AuthShell title="Verifique su correo" subtitle={emailScreenSubtitle(activation, altaCompletada)} hideBack>
        <div className="flex flex-col gap-4">
          <Button type="button" variant="primary" onClick={checkStatus} disabled={resending} className="w-full">
            Ya verifiqué mi correo
          </Button>
          {resendMessage && <p role="status" className="text-sm leading-relaxed text-state-ok">{resendMessage}</p>}
          {resendError && <p role="alert" className="text-sm leading-relaxed text-state-bad">{resendError}</p>}

          <p className="text-center text-2xs text-ink-3-strong">¿No recibió el enlace?</p>
          <form className="flex flex-col gap-2.5" onSubmit={resendVerification}>
            <Button type="submit" variant="secondary" disabled={resending} className="w-full">
              <Mail size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              {resending ? "Enviando…" : "Reenviar correo de verificación"}
            </Button>
          </form>

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

  // Screen B (#1191): the email is verified, the in-person enrolment is not.
  // It is completed at the club by staff — there is nothing to submit here,
  // only the status to re-check once it lands.
  return (
    <AuthShell title="Complete su inscripción en el club" hideBack>
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
          <p className="text-sm leading-relaxed text-ink-2">
            La inscripción presencial se completa en el club, a cargo del personal. El acceso a los módulos se
            habilita en cuanto quede registrada.
          </p>
          {emailJustVerified && (
            <p role="status" className="text-sm leading-relaxed text-state-ok">Su correo quedó verificado.</p>
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
