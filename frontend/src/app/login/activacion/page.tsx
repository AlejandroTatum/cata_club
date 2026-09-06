"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Mail, MapPin } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { reenviarVerificacionCorreo, verificarCorreo } from "@/services/api";
import { getDefaultRoute } from "@/lib/auth-utils";
import { activationPendingReasons, isActivationComplete, type ActivationSession } from "@/lib/activation-reasons";
import { extractVerificationToken } from "@/lib/verification-token";
import { toUserMessage } from "@/lib/error-message";
import AuthShell, { AUTH_INPUT_CLASSES, AUTH_LABEL_CLASSES, AUTH_LINK_CLASSES } from "@/components/auth/AuthShell";
import { Button, buttonClasses } from "@/components/ui";
import { ICON } from "@/lib/icon-size";


/**
 * One condition row.
 *
 * `resolvableHere` marks whether the condition is something this screen can
 * act on (the default), or something that only happens elsewhere — the
 * inscripción presencial, done at the club (#1045). The two are not the same
 * kind of pending: a red alert on the club-only condition would say "do
 * something", and there is nothing to do here. It takes a quiet neutral mark
 * and a line naming where it IS resolved instead.
 */
function ActivationCheck({
  label,
  complete,
  resolvableHere = true,
  note,
}: {
  label: string;
  complete: boolean;
  resolvableHere?: boolean;
  note?: string;
}): React.ReactElement {
  const pendingElsewhere = !complete && !resolvableHere;
  return (
    <li className="flex items-start gap-3 rounded-ctl border border-line-2 bg-canvas px-3.5 py-3">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          complete
            ? "bg-state-ok-bg text-state-ok"
            : pendingElsewhere
              ? "border border-line-2 bg-paper text-ink-3-strong"
              : "bg-state-bad-bg text-state-bad"
        }`}
        aria-hidden="true"
      >
        {complete ? (
          <Check size={ICON.sm} strokeWidth={2} />
        ) : pendingElsewhere ? (
          <MapPin size={ICON.sm} strokeWidth={1.5} />
        ) : (
          <CircleAlert size={ICON.sm} strokeWidth={1.5} />
        )}
      </span>
      <span className="text-sm leading-relaxed text-ink-2">
        {label}
        {note && <span className="mt-0.5 block text-xs text-ink-3-strong">{note}</span>}
      </span>
    </li>
  );
}

function ActivationPageContent(): React.ReactElement {
  const router = useRouter();
  const { session, isAuthenticated, isLoading, refreshSession, logout } = useAuth();
  const toast = useToast();
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [codigoVerificacion, setCodigoVerificacion] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
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
    // two facts below, which only drive the checklist rendered underneath.
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
   * Confirms the pasted code or link without leaving the page (#1045).
   *
   * `refreshSession` re-hydrates `session` from the BFF, so the checklist
   * below reflects the new fact in place — no re-login, and if that leaves
   * BOTH conditions complete, the effect above already redirects on its own.
   *
   * `SessionOutcome` has a third shape besides "authenticated" and "outage":
   * "unauthenticated" — the person's OWN session ended at the exact moment
   * their verification landed (it expired, or they logged out from another
   * tab). The backend already persisted `correo_verificado = true`; the
   * operation succeeded. But `activation` goes null the instant that happens,
   * and the guard effect above sends this screen to /login on its own — any
   * message set on THIS component's local state would be thrown away with it
   * before the redirect even paints. The toast survives that: it is
   * root-mounted in `app/layout.tsx`, outside the page tree `router.replace`
   * swaps out, so it is still on screen after the jump to /login. That is
   * also why this is a toast and not a query-param banner on /login the way
   * `?motivo=sesion-expirada` works for an involuntary logout — that page is
   * out of scope for this change.
   *
   * Every failure `verificarCorreo` itself can throw reads the same,
   * deliberately: `confirmar_verificacion_correo` answers a dead token, a
   * wrong one and a corrupted paste identically on purpose (same reasoning
   * `/verificar-correo` already documents for the same endpoint), and this
   * call's own 401 must NOT go through `toUserMessage` — that status is
   * reserved for "su sesión expiró", and a bad verification token says
   * nothing about the person's own session.
   */
  async function verifyEmailInline(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const token = extractVerificationToken(codigoVerificacion);
    if (!token) return;
    setVerifying(true);
    setVerifyMessage(null);
    setVerifyError(null);
    try {
      await verificarCorreo(token);
      setCodigoVerificacion("");
      const result = await refreshSession();
      if (result.kind === "outage") {
        setVerifyMessage(
          "Su correo quedó verificado. No pudimos actualizar esta pantalla — use «Consultar estado nuevamente» para verlo reflejado.",
        );
      } else if (result.kind === "unauthenticated") {
        toast.showSuccess("Su correo quedó verificado. Vuelva a iniciar sesión para continuar.");
      }
    } catch {
      setVerifyError(
        "El código o enlace no es válido, o venció. Puede pedir uno nuevo con «Reenviar correo de verificación», debajo.",
      );
    } finally {
      setVerifying(false);
    }
  }

  async function checkStatus(): Promise<void> {
    setResendMessage(null);
    setResendError(null);
    const result = await refreshSession();
    if (result.kind === "outage") {
      setResendError("No se pudo consultar el estado. Intente nuevamente en unos minutos.");
    }
  }

  if (isLoading || !activation || !isAuthenticated) {
    return (
      <div className="auth-shell flex min-h-screen items-center justify-center">
        <p className="text-sm text-cata-text/65">Cargando estado de activación…</p>
      </div>
    );
  }

  return (
    <AuthShell
      title="Active su cuenta"
      subtitle="Antes de entrar a los módulos del club, complete estas condiciones."
      hideBack
    >
      <div className="flex flex-col gap-4">
        {/*
         * `aria-live`: after verifying inline, the two facts below update in
         * place with no navigation — a screen-reader user needs that same
         * announcement a sighted person gets from the icons swapping (#1045).
         */}
        <ul className="flex flex-col gap-2.5" aria-label="Estado de activación" aria-live="polite">
          <ActivationCheck label="Correo electrónico verificado" complete={correoVerificado} />
          <ActivationCheck
            label="Inscripción presencial completada"
            complete={altaCompletada}
            resolvableHere={false}
            note="Se completa en el club, no en esta pantalla."
          />
        </ul>

        {activationPendingReasons(activation).length > 0 && (
          <div className="rounded-ctl border border-line-2 bg-canvas px-3.5 py-3 text-sm leading-relaxed text-ink-2">
            {activationPendingReasons(activation).length === 2 && (
              <p>Le faltan verificar su correo y completar la inscripción presencial en el club.</p>
            )}
            {activationPendingReasons(activation).length === 1 && !correoVerificado && (
              <p>Verifique su correo electrónico para continuar. La inscripción presencial ya está registrada.</p>
            )}
            {activationPendingReasons(activation).length === 1 && !altaCompletada && (
              <p>Complete la inscripción presencial en el club para habilitar el acceso a los módulos.</p>
            )}
          </div>
        )}

        {!correoVerificado && (
          <form className="flex flex-col gap-2.5" onSubmit={verifyEmailInline}>
            <div>
              <label htmlFor="codigo-verificacion" className={AUTH_LABEL_CLASSES}>
                Código o enlace de verificación
              </label>
              <input
                type="text"
                id="codigo-verificacion"
                name="codigo-verificacion"
                value={codigoVerificacion}
                onChange={(event) => setCodigoVerificacion(event.target.value)}
                placeholder="Pegue el código o el enlace que recibió por correo"
                autoComplete="off"
                disabled={verifying}
                aria-invalid={verifyError ? true : undefined}
                aria-describedby={verifyError ? "codigo-verificacion-error" : undefined}
                className={AUTH_INPUT_CLASSES}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={verifying || !codigoVerificacion.trim()}
              className="w-full"
            >
              {verifying ? "Verificando…" : "Verificar correo"}
            </Button>
            {verifyMessage && <p role="status" className="text-sm leading-relaxed text-state-ok">{verifyMessage}</p>}
            {verifyError && (
              <p id="codigo-verificacion-error" role="alert" className="text-sm leading-relaxed text-state-bad">
                {verifyError}
              </p>
            )}
          </form>
        )}

        {!correoVerificado && (
          <>
            <p className="text-center text-2xs text-ink-3-strong">¿No tiene el código a mano?</p>
            <form className="flex flex-col gap-2.5" onSubmit={resendVerification}>
              <Button type="submit" variant="primary" disabled={resending} className="w-full">
                <Mail size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                {resending ? "Enviando…" : "Reenviar correo de verificación"}
              </Button>
              {resendMessage && (
                <p role="status" className="text-sm leading-relaxed text-state-ok">{resendMessage}</p>
              )}
              {resendError && <p role="alert" className="text-sm leading-relaxed text-state-bad">{resendError}</p>}
            </form>
          </>
        )}

        <Button type="button" variant="secondary" onClick={checkStatus} disabled={resending} className="w-full">
          Consultar estado nuevamente
        </Button>

        <div className="flex flex-col items-center gap-2 text-center text-sm">
          <Link href="/verificar-correo" className={AUTH_LINK_CLASSES}>Abrir verificación de correo</Link>
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
