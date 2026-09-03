"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Mail } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { reenviarVerificacionCorreo } from "@/services/api";
import { getDefaultRoute } from "@/lib/auth-utils";
import { activationPendingReasons, isActivationComplete, type ActivationSession } from "@/lib/activation-reasons";
import { toUserMessage } from "@/lib/error-message";
import AuthShell, { AUTH_LINK_CLASSES } from "@/components/auth/AuthShell";
import { Button, buttonClasses } from "@/components/ui";
import { ICON } from "@/lib/icon-size";


function ActivationCheck({ label, complete }: { label: string; complete: boolean }): React.ReactElement {
  return (
    <li className="flex items-start gap-3 rounded-ctl border border-line-2 bg-canvas px-3.5 py-3">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${complete ? "bg-state-ok-bg text-state-ok" : "bg-state-bad-bg text-state-bad"}`}
        aria-hidden="true"
      >
        {complete ? <Check size={ICON.sm} strokeWidth={2} /> : <CircleAlert size={ICON.sm} strokeWidth={1.5} />}
      </span>
      <span className="text-sm leading-relaxed text-ink-2">{label}</span>
    </li>
  );
}

function ActivationPageContent(): React.ReactElement {
  const router = useRouter();
  const { session, isAuthenticated, isLoading, refreshSession, logout } = useAuth();
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
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
    <AuthShell title="Active su cuenta" subtitle="Antes de entrar a los módulos del club, complete estas condiciones.">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2.5" aria-label="Estado de activación">
          <ActivationCheck label="Correo electrónico verificado" complete={correoVerificado} />
          <ActivationCheck label="Inscripción presencial completada" complete={altaCompletada} />
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
          <form className="flex flex-col gap-2.5" onSubmit={resendVerification}>
            <Button type="submit" variant="primary" disabled={resending} className="w-full">
              <Mail size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              {resending ? "Enviando…" : "Reenviar correo de verificación"}
            </Button>
            {resendMessage && <p role="status" className="text-sm leading-relaxed text-state-ok">{resendMessage}</p>}
            {resendError && <p role="alert" className="text-sm leading-relaxed text-state-bad">{resendError}</p>}
          </form>
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
