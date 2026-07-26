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
import { Button } from "@/components/ui";

/**
 * How long the form stays up, with its button in its "Iniciando sesión…"
 * state and the confirmation toast already visible, before the redirect
 * fires. The toast itself outlives the navigation — `ToastProvider` is
 * mounted in the root layout, above the router — so this is only the beat
 * that lets the user connect the toast to the button they just pressed.
 */
const WELCOME_HOLD_MS = 900;

/** First name only — a toast is not the place for four surnames. */
function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** Permissive client-side format check — the backend is the real source of truth for validity. */
const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Distinct, user-readable feedback per login failure kind, split the way the
 * toast renders it: `message` names what went wrong, `description` names the
 * way out. Crammed into one sentence, every one of these read as a wall the
 * user had to parse before knowing whether to retype a password or wait for
 * the server to come back.
 */
function loginErrorFeedback(error: AuthErrorKind): { message: string; description: string } {
  switch (error) {
    case "invalid_credentials":
      return {
        message: "Credenciales incorrectas",
        description: "Revise su correo y su contraseña, e intente nuevamente.",
      };
    case "session_validation_failed":
      return {
        message: "No se pudo validar su sesión",
        description: "Sus datos son correctos, pero la sesión no quedó activa. Intente nuevamente.",
      };
    case "timeout":
      return {
        message: "El servidor tardó demasiado en responder",
        description: "Revise su conexión e intente nuevamente.",
      };
    case "backend_unavailable":
      return {
        message: "No se pudo conectar con el servidor",
        description: "El servicio no está disponible. Intente nuevamente en unos minutos.",
      };
    case "unknown":
    default:
      return {
        message: "No se pudo iniciar sesión",
        description: "Ocurrió un error inesperado. Intente nuevamente.",
      };
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
  const [welcome, setWelcome] = useState<{ route: string } | null>(null);

  // Redirect to role-appropriate page if already authenticated. Skipped
  // while a welcome is pending — a login just completed, and that effect
  // below owns the (delayed) redirect instead.
  useEffect((): void => {
    if (!isLoading && isAuthenticated && session && !welcome) {
      router.replace(getDefaultRoute(session.user.role));
    }
  }, [isLoading, isAuthenticated, session, welcome, router]);

  // Hold the form on screen for one beat after the confirmation toast fires,
  // so a successful login is actually seen instead of flashing past.
  useEffect((): (() => void) | void => {
    if (!welcome) return;
    const timer = setTimeout((): void => router.replace(welcome.route), WELCOME_HOLD_MS);
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
      const { message, description } = loginErrorFeedback(result.error);
      toast.showError(message, { description });
      setSubmitting(false);
      return;
    }

    // The confirmation is a toast, not the full-screen panel this used to
    // paint. The product owner's words on that panel — *"se ve muy tosco,
    // como que te impone el mensaje"* — were about a modal-weight
    // interruption for an event the user just caused and already expects.
    // A toast confirms without blocking, and carries the one thing the old
    // panel never said: where they are about to land.
    const firstName = firstNameOf(result.session.user.name);
    toast.showSuccess(firstName ? `Hola, ${firstName}` : "Sesión iniciada", {
      description: "Su sesión quedó iniciada. Le llevamos a su panel.",
    });

    setWelcome({ route: getDefaultRoute(result.session.user.role) });
  }

  // Show loading during session hydration, and keep showing it while an
  // already-authenticated user is mid-redirect — otherwise the form paints
  // for one frame between hydration resolving and the effect above firing.
  // Skipped while a welcome is pending: `isAuthenticated`/`session` flip
  // true around the same time as a successful login, and without this guard
  // the form the toast is confirming would be swapped for this plain
  // "Cargando sesión…" div for the length of the hold.
  if (!welcome && (isLoading || (isAuthenticated && session))) {
    return (
      <div className="auth-shell flex min-h-screen items-center justify-center">
        <p className="text-sm text-cata-text/65">Cargando sesión…</p>
      </div>
    );
  }

  return (
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
            {/* The 16px icon used to BE the button: no padding, so the target
                measured 16x16 — the smallest in the product, against the 24x24
                WCAG 2.2 SC 2.5.8 asks for. `h-6 w-6` with the glyph centred
                buys the hit area without touching the icon, and pulling the
                offset from 10px to 6px keeps the glyph's centre exactly where
                it was (6 + 12 = 10 + 8 = 18px from the field's right edge),
                still clear of the input's own 40px right padding. */}
            <button
              type="button"
              onClick={(): void => setShowPassword(!showPassword)}
              className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-ink-3 transition-colors hover:text-ink"
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
          /* `min-h-[24px]` is hit area only — SC 2.5.8 wants 24x24 and a bare
             12.5px line measured 141.5 x 18.8. The type is untouched. */
          className="inline-flex min-h-[24px] items-center self-end text-[12.5px] font-semibold text-cata-red transition-colors hover:text-cata-red-dark"
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
          href="/student/enroll"
          className="font-semibold text-cata-red transition-colors hover:text-cata-red-dark"
        >
          Inscríbase
        </Link>
      </p>
    </AuthShell>
  );
}
