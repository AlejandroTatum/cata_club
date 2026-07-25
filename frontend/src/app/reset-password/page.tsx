/**
 * Reset Password Page — set a new password using a recovery token.
 *
 * Expects `?token=xxx` in the URL (from the email link).
 * Follows the same centered-card layout as /login and /forgot-password.
 */

"use client";

import { type FormEvent, useState, useEffect, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Lock, Eye, EyeOff, ArrowLeft, AlertCircle, CheckCircle2 } from "lucide-react";
import { restablecerContrasenia } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";

function ResetPasswordContent(): React.ReactElement {
  const toast = useToast();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Client-side validation
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (password && password.length < 8) {
      setPasswordError("La contraseña debe tener al menos 8 caracteres.");
    } else if (password && confirmPassword && password !== confirmPassword) {
      setPasswordError("Las contraseñas no coinciden.");
    } else {
      setPasswordError(null);
    }
  }, [password, confirmPassword]);

  if (!token) {
    return (
      <div className="flex min-h-[75vh] items-center justify-center py-12">
        <div className="w-full max-w-sm text-center">
          <div className="card p-8 sm:p-9">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cata-red/10">
              <AlertCircle size={28} className="text-cata-red" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-cata-text">
              Token no válido
            </h2>
            <p className="text-sm text-cata-text/65">
              El enlace de recuperación no contiene un token válido. Solicite uno nuevo.
            </p>
          </div>
          <p className="mt-8 text-center text-sm text-cata-text/65">
            <Link
              href="/forgot-password"
              className="inline-flex items-center gap-1.5 font-medium text-cata-red transition-colors hover:text-cata-red-light"
            >
              <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
              Solicitar nuevo enlace
            </Link>
          </p>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();

    if (password !== confirmPassword) {
      toast.showError("Las contraseñas no coinciden.");
      return;
    }
    if (password.length < 8) {
      toast.showError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }

    setSubmitting(true);
    try {
      // token is guaranteed non-null here by the early return above (line 41)
      await restablecerContrasenia(token as string, password);
      setSuccess(true);
      toast.showSuccess("Contraseña actualizada correctamente");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Ocurrió un error inesperado.";
      toast.showError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[75vh] items-center justify-center py-12">
      <div className="w-full max-w-sm">
        {/* Brand header */}
        <div className="mb-10 text-center">
          <div className="relative mx-auto mb-5 h-20 w-20 overflow-hidden rounded-2xl shadow-soft">
            <Image
              src="/brand/cata-club-logo.jpeg"
              alt="Cata Club"
              fill
              className="object-cover"
              sizes="80px"
              priority
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-cata-text">
            Restablecer Contraseña
          </h1>
          <p className="mt-1.5 text-sm text-cata-text/65">
            Ingrese su nueva contraseña
          </p>
        </div>

        {success ? (
          /* Success state */
          <div className="card p-8 text-center sm:p-9">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cata-state-ok/10">
              <CheckCircle2 size={28} className="text-cata-state-ok" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h2 className="mb-2 text-lg font-semibold text-cata-text">
              Contraseña actualizada
            </h2>
            <p className="text-sm leading-relaxed text-cata-text/65">
              Su contraseña ha sido restablecida correctamente. Ya puede iniciar sesión con su nueva contraseña.
            </p>
            <Link
              href="/login"
              className="btn-primary mt-6 inline-flex w-full items-center justify-center gap-2 shadow-soft"
            >
              Iniciar Sesión
            </Link>
          </div>
        ) : (
          /* Form */
          <div className="card p-8 sm:p-9">
            <form className="space-y-5" onSubmit={handleSubmit}>
              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-sm font-medium text-cata-text"
                >
                  Nueva contraseña
                </label>
                <div className="relative">
                  <Lock
                    size={16}
                    strokeWidth={1.5}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
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
                    className="input-field pl-10 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-cata-text/65 hover:text-cata-text"
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

              <div>
                <label
                  htmlFor="confirmPassword"
                  className="mb-1.5 block text-sm font-medium text-cata-text"
                >
                  Confirmar contraseña
                </label>
                <div className="relative">
                  <Lock
                    size={16}
                    strokeWidth={1.5}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
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
                    className="input-field pl-10"
                  />
                </div>
              </div>

              {/* Client-side validation error */}
              {passwordError && (
                <p className="text-xs text-cata-red">{passwordError}</p>
              )}

              <button
                type="submit"
                disabled={submitting || passwordError !== null}
                className="btn-primary w-full shadow-soft"
              >
                {submitting ? "Restableciendo…" : "Restablecer Contraseña"}
              </button>
            </form>
          </div>
        )}

        {/* Back to login */}
        <p className="mt-8 text-center text-sm text-cata-text/65">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 font-medium text-cata-red transition-colors hover:text-cata-red-light"
          >
            <ArrowLeft size={14} strokeWidth={1.5} aria-hidden="true" />
            Volver a Iniciar Sesión
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage(): React.ReactElement {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}
