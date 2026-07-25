/**
 * Login Page — real backend authentication via the BFF (/api/auth/login).
 *
 * Layout is `AuthShell`, transcribed from the login stage of
 * `docs/ux/prototipo-rediseno.html` (the approved 14-view prototype, which is
 * the authority for the auth screens). This screen owns none of its own
 * composition: coal panel, card, red eyebrow and the security note below the
 * card all come from the shared template.
 *
 * The old mockup's "Acceso rápido (Demo)" shortcuts are intentionally not
 * implemented — real backend auth is wired up, so pre-filled demo credentials
 * have no purpose here.
 */

"use client";

import { type FormEvent, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { getDefaultRoute } from "@/lib/auth-utils";
import type { AuthErrorKind } from "@/services/auth";
import AuthShell, { AUTH_INPUT_CLASSES, AUTH_LABEL_CLASSES } from "@/components/auth/AuthShell";
import LoginSuccessOverlay from "@/components/auth/LoginSuccessOverlay";
import { Button } from "@/components/ui";

/** How long the welcome overlay stays on screen before redirecting. */
const WELCOME_OVERLAY_MS = 1400;

/** Permissive client-side format check — the backend is the real source of truth for validity. */
const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Distinct, user-readable message per login failure kind. */
function loginErrorMessage(error: AuthErrorKind): string {
  switch (error) {
    case "invalid_credentials":
      return "Credenciales inválidas. Verifique su correo y contraseña.";
    case "session_validation_failed":
      return "No se pudo validar la sesión luego de iniciar sesión. Intente nuevamente.";
    case "timeout":
      return "La solicitud tardó demasiado en responder. Verifique su conexión e intente nuevamente.";
    case "backend_unavailable":
      return "No se pudo conectar con el servidor. Intente nuevamente en unos minutos.";
    case "unknown":
    default:
      return "Ocurrió un error inesperado al iniciar sesión. Intente nuevamente.";
  }
}

export default function LoginPage(): React.ReactElement {
  const router = useRouter();
  const { login, isAuthenticated, isLoading, session } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });
  const [welcome, setWelcome] = useState<{ name: string; route: string } | null>(null);

  // Redirect to role-appropriate page if already authenticated. Skipped
  // while the welcome overlay is up — a login just completed, and that
  // effect below owns the (delayed) redirect instead.
  useEffect((): void => {
    if (!isLoading && isAuthenticated && session && !welcome) {
      router.replace(getDefaultRoute(session.user.role));
    }
  }, [isLoading, isAuthenticated, session, welcome, router]);

  // Hold the welcome overlay on screen briefly before navigating away, so a
  // successful login is actually seen instead of flashing past.
  useEffect((): (() => void) | void => {
    if (!welcome) return;
    const timer = setTimeout((): void => router.replace(welcome.route), WELCOME_OVERLAY_MS);
    return (): void => clearTimeout(timer);
  }, [welcome, router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();
    const nextFieldErrors = {
      email: !trimmedEmail
        ? "Ingrese su correo electrónico."
        : !EMAIL_FORMAT_REGEX.test(trimmedEmail)
          ? "Ingrese un correo electrónico válido."
          : "",
      password: trimmedPassword ? "" : "Ingrese su contraseña.",
    };
    setFieldErrors(nextFieldErrors);
    if (nextFieldErrors.email || nextFieldErrors.password) return;
    setSubmitting(true);

    const result = await login(trimmedEmail, trimmedPassword);

    if (!result.ok) {
      toast.showError(loginErrorMessage(result.error));
      setSubmitting(false);
      return;
    }

    setWelcome({
      name: result.session.user.name,
      route: getDefaultRoute(result.session.user.role),
    });
  }

  // Show loading during session hydration, and keep showing it while an
  // already-authenticated user is mid-redirect — otherwise the form paints
  // for one frame between hydration resolving and the effect above firing.
  // Skipped while the welcome overlay is up: `isAuthenticated`/`session`
  // flip true around the same time as a successful login, and without this
  // guard that would replace the page (and the overlay's backdrop) with
  // this plain "Cargando sesión…" div instead.
  if (!welcome && (isLoading || (isAuthenticated && session))) {
    return (
      <div className="auth-shell flex min-h-screen items-center justify-center">
        <p className="text-sm text-cata-text/65">Cargando sesión…</p>
      </div>
    );
  }

  return (
    <>
    {welcome && <LoginSuccessOverlay name={welcome.name} />}
    <AuthShell
      title="Bienvenido de nuevo"
      subtitle="Inicie sesión para continuar"
      note="La autenticación se verifica contra el servidor. Su sesión se mantiene mediante una cookie segura — el navegador nunca almacena su contraseña ni su token de acceso."
    >
      <form className="flex flex-col gap-3.5" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="email" className={AUTH_LABEL_CLASSES}>
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
              id="email"
              name="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
              required
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "email-error" : undefined}
              disabled={submitting}
              className={`${AUTH_INPUT_CLASSES} pl-9`}
            />
          </div>
          {fieldErrors.email && (
            <p id="email-error" role="alert" className="mt-1.5 text-xs font-semibold text-cata-red">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="password" className={AUTH_LABEL_CLASSES}>
            Contraseña
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
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void => setPassword(e.target.value)}
              placeholder="Ingrese su contraseña"
              required
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? "password-error" : undefined}
              disabled={submitting}
              className={`${AUTH_INPUT_CLASSES} pl-9 pr-10`}
            />
            <button
              type="button"
              onClick={(): void => setShowPassword(!showPassword)}
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
          {fieldErrors.password && (
            <p id="password-error" role="alert" className="mt-1.5 text-xs font-semibold text-cata-red">
              {fieldErrors.password}
            </p>
          )}
        </div>

        {/*
         * The recovery escape hatch — `align-self:flex-end`, RED and 600 at
         * 12.5px (prototype line 810). It is a peer of the fields, sitting
         * between the last control and the CTA, not a footnote under it.
         */}
        <Link
          href="/forgot-password"
          className="self-end text-[12.5px] font-semibold text-cata-red transition-colors hover:text-cata-red-dark"
        >
          ¿Olvidó su contraseña?
        </Link>

        <Button type="submit" variant="primary" disabled={submitting} className="w-full">
          {submitting ? "Iniciando sesión…" : "Iniciar Sesión"}
        </Button>
      </form>

      {/* `.fcard` footer (line 812) — 12.5px muted, with the action in red. */}
      <p className="text-center text-[12.5px] text-ink-3">
        ¿No tiene una cuenta?{" "}
        <Link
          href="/register"
          className="font-semibold text-cata-red transition-colors hover:text-cata-red-dark"
        >
          Crear una
        </Link>
      </p>
    </AuthShell>
    </>
  );
}
