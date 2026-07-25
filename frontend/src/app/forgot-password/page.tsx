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
import { KeyRound, ArrowLeft, Mail, CheckCircle2 } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
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
      eyebrow="Cata Club Admin"
      title="Recuperar contraseña"
      subtitle={submitted ? undefined : "Ingrese su correo para recibir un enlace de recuperación"}
      headline={
        <>
          Perdiste el punto,
          <br />
          no <em className="not-italic text-cata-red-light">el partido</em>.
        </>
      }
      description="Recupera el acceso a tu cuenta en un par de pasos. La gestión del club no se detiene."
    >
      {submitted ? (
        /* Confirmation card — deliberately identical regardless of whether
         * the email is registered (mirrors the backend's own contract). */
        <div className="card p-8 text-center sm:p-9">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cata-state-ok/10">
            <CheckCircle2 size={28} className="text-cata-state-ok" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-cata-text">
            Revise su correo
          </h2>
          <p className="text-sm leading-relaxed text-cata-text/65">
            Si <strong>{correo.trim()}</strong> está registrado, recibirá un enlace para
            restablecer su contraseña en unos minutos.
          </p>
        </div>
      ) : (
        <div className="card p-8 sm:p-9">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cata-red/10">
            <KeyRound size={28} className="text-cata-red" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="correo" className="mb-1.5 block text-sm font-medium text-cata-text">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail
                  size={16}
                  strokeWidth={1.5}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
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
                  className="input-field pl-10"
                />
              </div>
            </div>

            <button type="submit" disabled={submitting} className="btn-primary w-full shadow-soft">
              {submitting ? "Enviando…" : "Enviar enlace de recuperación"}
            </button>
          </form>
        </div>
      )}

      {/* Auth companion link — back to login */}
      <p className="mt-6 text-center text-sm text-cata-text/65">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 font-medium text-cata-red transition-colors hover:text-cata-red-light"
        >
          <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          Volver a Iniciar Sesión
        </Link>
      </p>
    </AuthShell>
  );
}
