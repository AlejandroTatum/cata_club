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

import { type FormEvent, useRef, useState } from "react";
import { Mail, CheckCircle2 } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import AuthShell, { AUTH_INPUT_CLASSES, AUTH_LABEL_CLASSES } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui";
import { solicitarRecuperacion, ApiClientError } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { toUserMessage } from "@/lib/error-message";

export default function ForgotPasswordPage(): React.ReactElement {
  const toast = useToast();
  const [correo, setCorreo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const correoInputRef = useRef<HTMLInputElement>(null);

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
        toUserMessage(err, "No se pudo procesar la solicitud. Intente nuevamente."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Issue #316 hallazgo #29: the note beside the card promises "puede pedir
   * uno nuevo desde esta misma pantalla", but the confirmation state removed
   * every control that could do that — `#correo` and the submit button both
   * unmount once `submitted` is `true`, leaving "Volver a Iniciar sesión" and
   * the help launcher as the only ways off the screen. Neither lets a reader
   * ask for a second link without first finding `/login`'s own "¿Olvidó su
   * contraseña?" again.
   *
   * The fix keeps the PROMISE rather than rewording it: the confirmation is
   * anti-enumeration by design (the backend already can't say whether the
   * address was even valid), so an abuelo who mistyped it has no other signal
   * that anything went wrong — sending him back to `/login` to start over
   * would be the worse of the two ways to close this gap. Reopening the same
   * form, with the address he just typed still in it, requires no new screen
   * and no new endpoint call: `solicitarRecuperacion` is exactly what the
   * submit button already calls.
   */
  function handleRetry(): void {
    setSubmitted(false);
    // The field remounts the instant `submitted` flips, so the focus move has
    // to wait a frame — the same pattern `payments/page.tsx`'s
    // `handleBackToForm` uses for the same reason.
    window.requestAnimationFrame(() => correoInputRef.current?.focus());
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
      // Reached from the login form, so that is the step behind this one — the
      // shell's default ("/") would skip the user past what they were doing.
      backHref="/login"
    >
      {submitted ? (
        /* Confirmation — deliberately identical regardless of whether the
         * email is registered (mirrors the backend's anti-enumeration
         * contract). No nested card: the shell already IS the card. */
        <div className="flex flex-col items-center gap-2.5 py-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-state-ok-bg">
            <CheckCircle2 size={ICON.lg} className="text-state-ok" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-ink-2">
            Si <strong className="font-semibold text-ink">{correo.trim()}</strong> está
            registrado, recibirá un enlace para restablecer su contraseña en unos minutos.
          </p>
          {/* Issue #316 hallazgo #64: the confirmation named neither of the
              two things an abuelo needs once "en unos minutos" has passed —
              where else to look, and how to tell "me equivoqué al tipear" apart
              from "todavía no llegó". */}
          <p className="text-xs leading-relaxed text-ink-3">
            Si no lo ve en unos minutos, revise la carpeta de correo no deseado.
          </p>
          <Button variant="tertiary" size="sm" onClick={handleRetry} className="mt-1">
            Enviar otro enlace
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="correo" className={AUTH_LABEL_CLASSES}>
              Correo electrónico <span aria-hidden="true" className="text-state-bad">*</span>
            </label>
            <div className="relative">
              <Mail
                size={ICON.sm}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
                aria-hidden="true"
              />
              <input
                ref={correoInputRef}
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

      {/* No back control here any more: the shell's coal exit now points at
          /login itself, and two controls to one place is the DSH-3 defect. */}
    </AuthShell>
  );
}
