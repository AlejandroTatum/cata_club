/**
 * Forgot Password Page — requests a password-recovery link.
 *
 * Layout follows `design/admin-forgot-password-mockup-v1.html` via the
 * shared AuthShell split-screen. Calls the real backend
 * (POST /auth/recuperar-contrasenia via the BFF route
 * src/app/api/auth/recuperar-contrasenia/route.ts) — the backend
 * deliberately returns the same success message whether or not the email
 * is registered (anti-enumeration), so this page always shows the same
 * confirmation state and never reveals whether an account exists.
 *
 * The companion screen, src/app/reset-password/page.tsx, already consumes
 * the recovery token from the email link (?token=...) and was already
 * wired to the real backend — this page was the missing half.
 */

"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, CheckCircle2 } from "lucide-react";
import AuthShell, { AUTH_INPUT_CLASSES, AUTH_LABEL_CLASSES } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui";
import { solicitarRecuperacion, ApiClientError } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";

export default function ForgotPasswordPage(): React.ReactElement {
  const toast = useToast();
  const [correo, setCorreo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!correo.trim()) {
      toast.showError("Ingrese su correo electrónico.");
      return;
    }

    setSubmitting(true);
    try {
      await solicitarRecuperacion(correo.trim());
      setSubmitted(true);
    } catch (err) {
      toast.showError(
        err instanceof ApiClientError
          ? err.message
          : "No se pudo procesar la solicitud. Intente nuevamente.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={submitted ? "Revise su correo" : "Recuperar contraseña"}
      subtitle={
        submitted
          ? undefined
          : "Ingrese su correo para recibir un enlace de recuperación"
      }
      note="Los enlaces de recuperación duran 30 minutos. Si vence, puede pedir uno nuevo desde esta misma pantalla."
    >
      {submitted ? (
        /* Confirmation — deliberately identical regardless of whether the
         * email is registered (mirrors the backend's anti-enumeration
         * contract). No nested card: the shell already IS the card. */
        <div className="flex flex-col items-center gap-2.5 py-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-state-ok-bg">
            <CheckCircle2 size={24} className="text-state-ok" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-ink-2">
            Si <strong className="font-semibold text-ink">{correo.trim()}</strong> está
            registrado, recibirá un enlace para restablecer su contraseña en unos minutos.
          </p>
        </div>
      ) : (
        <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="correo" className={AUTH_LABEL_CLASSES}>
              Correo electrónico
            </label>
            <div className="relative">
              <Mail
                size={15}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                aria-hidden="true"
              />
              <input
                type="email"
                id="correo"
                name="correo"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="correo@ejemplo.com"
                required
                disabled={submitting}
                className={`${AUTH_INPUT_CLASSES} pl-9`}
              />
            </div>
          </div>

          <Button type="submit" variant="primary" disabled={submitting} className="w-full">
            {submitting ? "Enviando…" : "Enviar enlace de recuperación"}
          </Button>
        </form>
      )}

      {/* `.fcard .aux` — 12.5px line with the action in red/600. */}
      <p className="text-center text-xs text-ink-3">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 font-semibold text-cata-red transition-colors hover:text-cata-red-dark"
        >
          <ArrowLeft size={13} strokeWidth={2} aria-hidden="true" />
          Volver a Iniciar Sesión
        </Link>
      </p>
    </AuthShell>
  );
}
