/**
 * Reset Password Page — set a new password using a recovery token.
 *
 * Expects `?token=xxx` in the URL (from the email link).
 *
 * This was the ONE auth screen that did not use `AuthShell`, and it broke the
 * layout outright. It now inherits the template without exception, so all four
 * public auth screens are the same composition — the login stage of
 * `docs/ux/prototipo-rediseno.html`, which is the authority for these screens.
 *
 * Two behaviors the prototype asks for and this screen now implements:
 *   - The password rules are shown BEFORE anything is typed and tick over
 *     live, instead of surfacing as an error after submit.
 *   - The expired/invalid link has its own way out ("Pedir uno nuevo"),
 *     because it is the most frequent failure and used to end in a dead page.
 *
 * The prototype also lists "Una mayúscula y un número" as a third rule. It is
 * deliberately NOT enforced here: the backend's only constraint is
 * `nueva_contrasenia: str = Field(..., min_length=8)`
 * (backend/app/presentacion/schemas/auth_schemas.py:94). Enforcing a stricter
 * client-side policy would reject passwords the server accepts, and inventing
 * a password policy is a product decision, not a design one.
 */

"use client";

import { type FormEvent, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Lock, Eye, EyeOff, ArrowLeft, AlertCircle, Check, X, CheckCircle2 } from "lucide-react";
import { restablecerContrasenia } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import AuthShell, { AUTH_INPUT_CLASSES, AUTH_LABEL_CLASSES } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui";
import { buildPasswordRules } from "./reset-password-utils";

/** `.authnote` for this screen — the expired-link exit the prototype asks for. */
const EXPIRED_LINK_NOTE = (
  <>
    ¿El enlace ya venció?{" "}
    <Link
      href="/forgot-password"
      className="font-semibold text-cata-red transition-colors hover:text-cata-red-dark"
    >
      Pedir uno nuevo
    </Link>{" "}
    — los enlaces duran 30 minutos.
  </>
);

function ResetPasswordContent(): React.ReactElement {
  const toast = useToast();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const rules = buildPasswordRules(password, confirmPassword);
  const allRulesMet = rules.every((rule) => rule.met);
  /**
   * The one inline blocker kept as prose: it is the mismatch the trainer sees
   * on the SECOND field, attached to that control. The rest of the feedback
   * lives in the live checklist above, before anything is typed.
   */
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  if (!token) {
    return (
      <AuthShell title="Enlace no válido" note={EXPIRED_LINK_NOTE}>
        <div className="flex flex-col items-center gap-2.5 py-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-state-bad-bg">
            <AlertCircle size={24} className="text-cata-red" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-ink-2">
            El enlace de recuperación no contiene un token válido. Solicite uno nuevo y
            vuelva a intentarlo.
          </p>
        </div>
        <Link
          href="/forgot-password"
          className="inline-flex h-ctl w-full items-center justify-center gap-2 rounded-ctl border border-cata-red bg-cata-red text-sm font-semibold text-white transition-colors hover:border-cata-red-dark hover:bg-cata-red-dark"
        >
          <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
          Solicitar nuevo enlace
        </Link>
      </AuthShell>
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!allRulesMet) return;

    setSubmitting(true);
    try {
      // token is guaranteed non-null here by the early return above.
      await restablecerContrasenia(token as string, password);
      setSuccess(true);
      toast.showSuccess("Contraseña actualizada correctamente");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Ocurrió un error inesperado.";
      toast.showError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <AuthShell title="Contraseña actualizada">
        <div className="flex flex-col items-center gap-2.5 py-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-state-ok-bg">
            <CheckCircle2 size={24} className="text-state-ok" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <p className="text-sm leading-relaxed text-ink-2">
            Su contraseña ha sido restablecida correctamente. Ya puede iniciar sesión con
            su nueva contraseña.
          </p>
        </div>
        <Link
          href="/login"
          className="inline-flex h-ctl w-full items-center justify-center gap-2 rounded-ctl border border-cata-red bg-cata-red text-sm font-semibold text-white transition-colors hover:border-cata-red-dark hover:bg-cata-red-dark"
        >
          Iniciar Sesión
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Elija una contraseña nueva"
      subtitle="Debe cumplir las dos condiciones de abajo"
      note={EXPIRED_LINK_NOTE}
    >
      <form className="flex flex-col gap-3.5" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="password" className={AUTH_LABEL_CLASSES}>
            Nueva contraseña
          </label>
          <div className="relative">
            <Lock
              size={15}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
              aria-hidden="true"
            />
            <input
              type={showPassword ? "text" : "password"}
              id="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              required
              disabled={submitting}
              className={`${AUTH_INPUT_CLASSES} pl-9 pr-10`}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 transition-colors hover:text-ink"
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            >
              {showPassword ? (
                <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/*
         * The rules, visible from the first paint and ticking over live.
         * `role="status"` so a screen reader hears a rule turn green instead
         * of only discovering the problem after a failed submit.
         */}
        <ul aria-label="Requisitos de la contraseña" role="status" className="flex flex-col gap-1.5">
          {rules.map((rule) => (
            <li
              key={rule.label}
              data-met={rule.met}
              className={`flex items-center gap-[7px] text-xs ${
                rule.met ? "font-semibold text-state-ok" : "text-ink-3"
              }`}
            >
              {rule.met ? (
                <Check size={13} strokeWidth={3} aria-hidden="true" />
              ) : (
                <X size={13} strokeWidth={2} aria-hidden="true" />
              )}
              {rule.label}
            </li>
          ))}
        </ul>

        <div>
          <label htmlFor="confirmPassword" className={AUTH_LABEL_CLASSES}>
            Repetir contraseña
          </label>
          <div className="relative">
            <Lock
              size={15}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
              aria-hidden="true"
            />
            <input
              type={showPassword ? "text" : "password"}
              id="confirmPassword"
              name="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita su contraseña"
              required
              disabled={submitting}
              aria-invalid={mismatch}
              aria-describedby={mismatch ? "confirm-password-error" : undefined}
              className={`${AUTH_INPUT_CLASSES} pl-9 ${
                mismatch ? "border-cata-red ring-[3px] ring-cata-red/10" : ""
              }`}
            />
          </div>
          {mismatch && (
            <p
              id="confirm-password-error"
              role="alert"
              className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-cata-red"
            >
              <AlertCircle size={13} strokeWidth={2} aria-hidden="true" />
              No coincide con la anterior.
            </p>
          )}
        </div>

        <Button
          type="submit"
          variant="primary"
          disabled={submitting || !allRulesMet}
          className="w-full"
        >
          {submitting ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </form>

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

export default function ResetPasswordPage(): React.ReactElement {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}
