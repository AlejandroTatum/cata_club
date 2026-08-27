/**
 * Login Page — real backend authentication via the BFF (/api/auth/login).
 *
 * Layout is `AuthShell`, transcribed from the login stage of
 * `docs/archive/prototypes/prototipo-rediseno.html` (the approved 14-view prototype, which is
 * the authority for the auth screens). This screen owns none of its own
 * composition: coal panel, card and red eyebrow all come from the shared
 * template.
 *
 * The old mockup's "Acceso rápido (Demo)" shortcuts are intentionally not
 * implemented — real backend auth is wired up, so pre-filled demo credentials
 * have no purpose here.
 */

"use client";

import { type FormEvent, useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { getDefaultRoute } from "@/lib/auth-utils";
import type { AuthErrorKind } from "@/services/auth";
import { STATUS_MESSAGES } from "@/lib/error-message";
import AuthShell, {
  AUTH_INPUT_CLASSES,
  AUTH_LABEL_CLASSES,
  AUTH_LINK_CLASSES,
} from "@/components/auth/AuthShell";
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

/** Written once because two fields point at it through `aria-describedby`. */
const CREDENTIALS_ERROR_ID = "credentials-error";

/*
 * The skin of a link on this card now lives in `AuthShell` as
 * `AUTH_LINK_CLASSES`, beside the input and label recipes the same four
 * screens already shared.
 *
 * `DESIGN.md`, Links: *"Lo que navega no es un botón: es un enlace subrayado
 * en rojo, con flecha cuando apunta a otra pantalla."* Both links here went
 * somewhere else and neither was underlined, so the card had two red bold
 * phrases, two red bold error lines and a red button, all wearing one colour
 * and behaving three ways. That was fixed here and stayed here, which is how
 * `/reset-password` came to write a second, underline-less version of the same
 * idea: a recipe that lives in one screen is not a system.
 */

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
    case "session_not_persisted":
      return {
        message: "Su navegador no guardó la sesión",
        description: "Habilite las cookies para este sitio e intente nuevamente.",
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
    case "config_error":
      return {
        message: "El servidor no está configurado correctamente",
        description: "No es un problema de su conexión. Avise al administrador del sistema.",
      };
    case "unknown":
    default:
      return {
        message: "No se pudo iniciar sesión",
        description: "Ocurrió un error inesperado. Intente nuevamente.",
      };
  }
}

function LoginPageContent(): React.ReactElement {
  const router = useRouter();
  const { login, isAuthenticated, isLoading, session } = useAuth();
  const toast = useToast();
  /**
   * Issue #353: `ProtectedRoute` names an involuntary session loss in the
   * redirect itself (`?motivo=sesion-expirada`, set only when
   * `AuthContext`'s `sessionExpired` was true) — an ordinary unauthenticated
   * visit or an explicit logout carries no such param. Read once; there is
   * nothing to keep in sync with, the query string does not change under
   * this form.
   */
  const searchParams = useSearchParams();
  const sessionExpired = searchParams.get("motivo") === "sesion-expirada";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({ email: "", password: "" });
  /**
   * The rejected pair, held on the FORM after the toast has gone.
   *
   * A wrong password used to change nothing on screen: the toast announced it
   * and faded, and what was left was a form that looked like it had never been
   * submitted. The toast is still the announcement — `LoginPage.test.tsx` holds
   * it to that, and it is what carries the recovery sentence — but the field
   * state is what is still true a few seconds later. `DESIGN.md`'s input
   * contract: *"Error: borde en el rojo de estado, con el mensaje debajo."*
   *
   * Separate from `fieldErrors` because it is a different KIND of wrong. Those
   * two are per-field and local ("Ingrese su contraseña"); this one is about
   * the combination, is only knowable after a round trip, and belongs to
   * neither field alone — which is also why the backend never says which half
   * missed, and why this message must not either.
   */
  const [credentialsRejected, setCredentialsRejected] = useState(false);
  /**
   * The login succeeded but the browser did not keep the session cookies —
   * `session_not_persisted`. Held on the CARD, not only in the toast, for the
   * same reason `sessionExpired` gets a static banner: this is the one
   * failure whose remedy is not on this screen. The person has to open their
   * browser's settings, allow cookies for this site and come back, and a
   * toast that fades in a few seconds cannot survive that trip.
   *
   * Separate from `credentialsRejected` because nothing they typed was
   * wrong — marking the fields red would send them to re-check a correo and
   * a contraseña the server already accepted.
   */
  const [sessionNotPersisted, setSessionNotPersisted] = useState(false);
  const [welcome, setWelcome] = useState<{ route: string } | null>(null);
  /**
   * #312 / hallazgo #30: tras un 401 el foco se quedaba en `<body>` — el
   * único aviso visible era el toast, que además se autodescartaba en unos
   * segundos, así que un lector lento perdía el mensaje mientras todavía lo
   * estaba leyendo. Devolver el foco a la contraseña pone el error justo
   * donde el usuario ya está mirando.
   */
  const passwordRef = useRef<HTMLInputElement>(null);

  // Runs as an EFFECT, not inline in `handleSubmit`: `setSubmitting(false)`
  // is what lifts the field's `disabled`, and a browser refuses to focus a
  // disabled element. Calling `.focus()` synchronously in the submit handler
  // races that re-render; the effect fires only after React has committed
  // it, once the field is actually focusable again.
  useEffect((): void => {
    if (credentialsRejected) passwordRef.current?.focus();
  }, [credentialsRejected]);

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
    setCredentialsRejected(false);
    setSessionNotPersisted(false);
    if (nextFieldErrors.email || nextFieldErrors.password) return;
    setSubmitting(true);

    const result = await login(trimmedEmail, trimmedPassword);

    if (!result.ok) {
      const { message, description } = loginErrorFeedback(result.error);
      const isCredentialsError = result.error === "invalid_credentials";
      const isCookieError = result.error === "session_not_persisted";
      toast.showError(message, {
        description,
        // The 4500-10000ms the ordinary toast clamps to reads fine for a
        // one-line confirmation, but a 70-year-old reading "Revise su correo
        // y su contraseña, e intente nuevamente." at a slower pace lost the
        // toast mid-read (measured: gone by ~9s). This is the ONE toast in
        // the product naming the reason a login failed, so it gets the same
        // floor `TOAST_UNDO_DURATION_MS` gives an undo offer — long enough to
        // notice, read, and act, not indefinite.
        // `session_not_persisted` shares the floor: its remedy lives in a
        // browser settings panel, so the person needs the sentence to still
        // be there while they go looking for it.
        duration: isCredentialsError || isCookieError ? 20000 : undefined,
      });
      // ONLY for `invalid_credentials`. The other kinds — a timeout, an
      // unreachable backend, a misconfigured server, a browser that dropped
      // the cookies — are not the person's typing, and painting their fields
      // red would send them to re-check something that was never wrong.
      setCredentialsRejected(isCredentialsError);
      setSessionNotPersisted(isCookieError);
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

  // The error skin a field wears while the pair is rejected: the state red on
  // the border, never the action red — `cata-red` is the fill of the button
  // right below, and as a border it would read as "this field is the thing to
  // press". `AUTH_INPUT_CLASSES` declares `border-line-2`, so the override has
  // to come after it in the class string.
  const invalidFieldClasses = credentialsRejected ? " border-state-bad" : "";

  return (
    <AuthShell title="Bienvenido de nuevo" subtitle="Inicie sesión para continuar">
      {/* Issue #353: a redirect that lost the admin's session mid-form used
          to land here with nothing to explain it — the toast on a FAILED
          login names what went wrong, but nothing said anything about an
          involuntary bounce that happened before this screen even loaded.
          A static banner, not a toast: the admin needs to still see it while
          reading the form, not catch it before it fades. Reuses
          `STATUS_MESSAGES[401]` — the same sentence the rest of the app
          already shows for an expired session, not a new one invented here. */}
      {sessionExpired && (
        <p role="status" className="rounded-ctl border border-line-2 bg-canvas px-3.5 py-2.5 text-sm text-ink-2">
          {STATUS_MESSAGES[401]}
        </p>
      )}
      {/* The session that never was. `role="alert"` and not `status`: unlike
          the expired-session notice above — which explains a bounce that
          already happened — this one answers a button the person just
          pressed, and it is the only thing on screen telling them the login
          did not take. It names the cause in the browser and the one setting
          that fixes it, because there is nothing on this card they can
          usefully change. */}
      {sessionNotPersisted && (
        <p
          role="alert"
          data-testid="session-not-persisted-error"
          className="rounded-ctl border border-state-bad bg-canvas px-3.5 py-2.5 text-sm text-ink-2"
        >
          Sus datos son correctos, pero este navegador no guardó la sesión. Suele ocurrir cuando las cookies
          están bloqueadas o la ventana es de navegación privada. Habilite las cookies para este sitio e
          intente nuevamente.
        </p>
      )}
      <form className="flex flex-col gap-3.5" onSubmit={handleSubmit} noValidate>
        <div>
          <label htmlFor="email" className={AUTH_LABEL_CLASSES}>
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
              type="email"
              id="email"
              name="email"
              value={email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                setEmail(e.target.value);
                // An error that outlives what it describes teaches people to
                // ignore errors. Editing either half retires the pair's mark.
                setCredentialsRejected(false);
              }}
              placeholder="correo@ejemplo.com"
              required
              aria-invalid={Boolean(fieldErrors.email) || credentialsRejected}
              aria-describedby={
                fieldErrors.email ? "email-error" : credentialsRejected ? CREDENTIALS_ERROR_ID : undefined
              }
              disabled={submitting}
              className={`${AUTH_INPUT_CLASSES} pl-9${invalidFieldClasses}`}
            />
          </div>
          {fieldErrors.email && (
            <p id="email-error" role="alert" className="mt-1.5 text-xs font-semibold text-state-bad">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="password" className={AUTH_LABEL_CLASSES}>
            Contraseña <span aria-hidden="true" className="text-state-bad">*</span>
          </label>
          <div className="relative">
            <Lock
              size={ICON.sm}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3"
              aria-hidden="true"
            />
            <input
              ref={passwordRef}
              type={showPassword ? "text" : "password"}
              id="password"
              name="password"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                setPassword(e.target.value);
                setCredentialsRejected(false);
              }}
              placeholder="Ingrese su contraseña"
              required
              aria-invalid={Boolean(fieldErrors.password) || credentialsRejected}
              aria-describedby={
                fieldErrors.password
                  ? "password-error"
                  : credentialsRejected
                    ? CREDENTIALS_ERROR_ID
                    : undefined
              }
              disabled={submitting}
              className={`${AUTH_INPUT_CLASSES} pl-9 pr-10${invalidFieldClasses}`}
            />
            {/* The icon used to BE the button: no padding, so the target
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
                <EyeOff size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <Eye size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              )}
            </button>
          </div>
          {fieldErrors.password && (
            <p id="password-error" role="alert" className="mt-1.5 text-xs font-semibold text-state-bad">
              {fieldErrors.password}
            </p>
          )}
          {/*
            One message for the pair, under the second field, and it does not
            repeat the toast word for word: the toast names what went wrong
            ("Credenciales incorrectas") and this names what is now true of the
            form. It also refuses to say WHICH half was wrong — the backend
            deliberately answers the same way for an unknown correo and a wrong
            password, because a message that distinguishes them tells a stranger
            which accounts exist.
          */}
          {credentialsRejected && !fieldErrors.password && (
            <p
              id={CREDENTIALS_ERROR_ID}
              data-testid="credentials-error"
              role="alert"
              // #312 / hallazgo #30: 12.5px (`text-xs`) mide 5.91:1 — legible,
              // pero es la misma talla que un hint decorativo para el mensaje
              // que le dice al visitante qué falló. `text-base` (15px, el
              // cuerpo de este sistema) le da jerarquía propia sin salirse
              // de la escala tipográfica declarada.
              className="mt-1.5 text-base font-semibold text-state-bad"
            >
              El correo y la contraseña no coinciden. Verifique los dos e intente nuevamente.
            </p>
          )}
        </div>

        {/*
         * The recovery escape hatch — `align-self:flex-end`, RED and 600 at
         * 12.5px (prototype line 810). It is a peer of the fields, sitting
         * between the last control and the CTA, not a footnote under it.
         */}
        {/* `min-h-[24px]` is hit area only — SC 2.5.8 wants 24x24 and a bare
            12.5px line measured 141.5 x 18.8. This link stands alone between
            the last field and the CTA, so the exemption the enrolment link
            below relies on does not cover it. The arrow says it leaves the
            screen. */}
        <Link href="/forgot-password" className={`${AUTH_LINK_CLASSES} min-h-[24px] self-end`}>
          ¿Olvidó su contraseña?
          <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        </Link>

        <Button type="submit" variant="primary" disabled={submitting} className="w-full">
          {submitting ? "Iniciando sesión…" : "Iniciar sesión"}
        </Button>
      </form>

      {/* `.fcard` footer (line 812) — 12.5px muted, with the destination as a
          link rather than as a second red phrase. */}
      <p className="text-center text-xs text-ink-3">
        ¿No tiene una cuenta?{" "}
        <Link href="/student/enroll" className={AUTH_LINK_CLASSES}>
          Inscríbase
          <ArrowRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        </Link>
      </p>
    </AuthShell>
  );
}

export default function LoginPage(): React.ReactElement {
  return (
    // `useSearchParams` needs a boundary to fall back to during prerender —
    // same reason `/admin/crear-cuenta` and `/reset-password` wrap theirs.
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}
