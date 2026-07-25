/**
 * Register Page — demo placeholder (no backend account creation yet).
 *
 * Layout follows `design/admin-register-mockup-v1.html`: split screen via
 * AuthShell, with the existing field set/validation/demo-success flow
 * unchanged.
 */

"use client";

import { useState, type FormEvent, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { getDefaultRoute } from "@/lib/auth-utils";
import AuthShell from "@/components/auth/AuthShell";
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  Phone,
  Calendar,
  Hash,
  CheckCircle,
  ArrowRight,
} from "lucide-react";

/** Every field name backing a required text/date input in the form below. */
const REQUIRED_FIELDS: { name: string; message: string }[] = [
  { name: "email", message: "Ingrese su correo electrónico." },
  { name: "password", message: "Cree una contraseña." },
  { name: "confirmPassword", message: "Confirme la contraseña." },
  { name: "firstName", message: "Ingrese sus nombres." },
  { name: "lastName", message: "Ingrese sus apellidos." },
  { name: "nationalId", message: "Ingrese su cédula de identidad." },
  { name: "birthDate", message: "Ingrese su fecha de nacimiento." },
  { name: "phone", message: "Ingrese su teléfono celular." },
];

export default function RegisterPage(): React.ReactElement {
  const router = useRouter();
  const { isAuthenticated, isLoading, session } = useAuth();
  const toast = useToast();

  // Redirect to role-appropriate page if already authenticated
  useEffect(() => {
    if (!isLoading && isAuthenticated && session) {
      router.replace(getDefaultRoute(session.user.role));
    }
  }, [isLoading, isAuthenticated, session, router]);
  const [submitting, setSubmitting] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [demoSuccess, setDemoSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();

    const form = e.currentTarget;
    const formData = new FormData(form);
    // Every field here is a plain text/password/date/tel <input>, never
    // <input type="file">, so FormData.get() always returns a string —
    // narrow defensively instead of asserting, since FormDataEntryValue is
    // `string | File | null`.
    const getValue = (name: string): string => {
      const entry = formData.get(name);
      return typeof entry === "string" ? entry.trim() : "";
    };

    const nextFieldErrors: Record<string, string> = {};
    for (const field of REQUIRED_FIELDS) {
      if (!getValue(field.name)) nextFieldErrors[field.name] = field.message;
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) return;

    const password = getValue("password");
    const confirmPassword = getValue("confirmPassword");

    if (password !== confirmPassword) {
      toast.showError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);

    // Demo mode: simulate processing then show success state
    setTimeout(() => {
      setSubmitting(false);
      setDemoSuccess(true);
    }, 1500);
  }

  function handleContinueToEnrollment(): void {
    // Guard: prevent double-click / repeated activation while navigating.
    if (navigating) return;

    // /student/enroll is a public, unauthenticated flow (see
    // PUBLIC_EXCEPTIONS in src/lib/middleware-utils.ts) — it must not
    // depend on a real login. It previously logged in with a hardcoded demo
    // account, which broke this button against the real backend.
    setNavigating(true);
    router.push("/student/enroll");
  }

  if (isLoading) {
    return (
      <div className="auth-shell flex min-h-screen items-center justify-center">
        <p className="text-sm text-cata-text/65">Cargando sesión…</p>
      </div>
    );
  }

  return (
    <AuthShell
      eyebrow="Cata Club — Tenis de Mesa"
      title="Crear su cuenta"
      subtitle="Regístrese en el sistema administrativo"
      headline={
        <>
          Súmate a la
          <br />
          mesa. <em className="not-italic text-cata-red-light">Empieza</em>
          <br />
          a jugar en serio.
        </>
      }
      description="Crea tu cuenta para gestionar estudiantes, pagos y asistencia del club desde un solo lugar."
      showBackToSite
    >
      {demoSuccess ? (
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cata-state-ok/10">
            <CheckCircle size={28} className="text-cata-state-ok" aria-hidden="true" />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-cata-text">
            Registro de Demostración Completado
          </h2>
          <p className="mb-6 text-sm leading-relaxed text-cata-text/65">
            No se almacenó ningún dato. Esto es una demostración de IU — cuando el
            backend esté conectado, se crearía su cuenta. Para continuar el
            recorrido, puede pasar directamente a la inscripción.
          </p>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleContinueToEnrollment}
              disabled={navigating}
              className="btn-primary w-full justify-center"
            >
              {navigating ? "Redirigiendo…" : "Inscribirse"}
              {!navigating && <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={(): void => {
                setDemoSuccess(false);
              }}
              className="btn-secondary w-full justify-center"
            >
              Editar información
            </button>
            <Link href="/login" className="btn-ghost justify-center text-center">
              Ir a Iniciar Sesión
            </Link>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-4 text-center text-xs text-cata-text/45">
            <span className="text-cata-red" aria-hidden="true">*</span> Campos obligatorios
          </p>

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            {/* -- Account -- */}
            <fieldset>
              <legend className="mb-3 text-[11px] font-bold uppercase tracking-widest text-cata-text/45">
                Cuenta
              </legend>

              <div className="mb-4">
                <div className="mb-1.5 flex items-baseline gap-1">
                  <label htmlFor="email" className="text-sm font-medium text-cata-text">
                    Correo electrónico
                  </label>
                  <span className="text-cata-red" aria-hidden="true">*</span>
                </div>
                <div className="relative">
                  <Mail
                    size={16}
                    strokeWidth={1.5}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
                    aria-hidden="true"
                  />
                  <input
                    type="email"
                    id="email"
                    name="email"
                    placeholder="correo@ejemplo.com"
                    required
                    disabled={submitting}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? "email-error" : undefined}
                    className="input-field pl-10"
                  />
                </div>
                {fieldErrors.email && (
                  <p id="email-error" role="alert" className="mt-1.5 text-xs text-cata-red">{fieldErrors.email}</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-baseline gap-1">
                    <label htmlFor="password" className="text-sm font-medium text-cata-text">
                      Contraseña
                    </label>
                    <span className="text-cata-red" aria-hidden="true">*</span>
                  </div>
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
                      placeholder="Cree una contraseña"
                      required
                      minLength={8}
                      disabled={submitting}
                      aria-invalid={Boolean(fieldErrors.password)}
                      aria-describedby={fieldErrors.password ? "password-error" : undefined}
                      className="input-field pl-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={(): void => setShowPassword(!showPassword)}
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
                  {fieldErrors.password && (
                    <p id="password-error" role="alert" className="mt-1.5 text-xs text-cata-red">{fieldErrors.password}</p>
                  )}
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline gap-1">
                    <label htmlFor="confirmPassword" className="text-sm font-medium text-cata-text">
                      Confirmar Contraseña
                    </label>
                    <span className="text-cata-red" aria-hidden="true">*</span>
                  </div>
                  <div className="relative">
                    <Lock
                      size={16}
                      strokeWidth={1.5}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
                      aria-hidden="true"
                    />
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      id="confirmPassword"
                      name="confirmPassword"
                      placeholder="Repita la contraseña"
                      required
                      disabled={submitting}
                      aria-invalid={Boolean(fieldErrors.confirmPassword)}
                      aria-describedby={fieldErrors.confirmPassword ? "confirmPassword-error" : undefined}
                      className="input-field pl-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={(): void => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-cata-text/65 hover:text-cata-text"
                      aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    >
                      {showConfirmPassword ? (
                        <EyeOff size={16} strokeWidth={1.5} aria-hidden="true" />
                      ) : (
                        <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {fieldErrors.confirmPassword && (
                    <p id="confirmPassword-error" role="alert" className="mt-1.5 text-xs text-cata-red">{fieldErrors.confirmPassword}</p>
                  )}
                </div>
              </div>
            </fieldset>

            <hr className="border-cata-border" />

            {/* -- Personal Information -- */}
            <fieldset>
              <legend className="mb-3 text-[11px] font-bold uppercase tracking-widest text-cata-text/45">
                Información personal
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-baseline gap-1">
                    <label htmlFor="firstName" className="text-sm font-medium text-cata-text">
                      Nombres
                    </label>
                    <span className="text-cata-red" aria-hidden="true">*</span>
                  </div>
                  <div className="relative">
                    <User
                      size={16}
                      strokeWidth={1.5}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      id="firstName"
                      name="firstName"
                      placeholder="p. ej. Juan Carlos"
                      required
                      disabled={submitting}
                      aria-invalid={Boolean(fieldErrors.firstName)}
                      aria-describedby={fieldErrors.firstName ? "firstName-error" : undefined}
                      className="input-field pl-10"
                    />
                  </div>
                  {fieldErrors.firstName && (
                    <p id="firstName-error" role="alert" className="mt-1.5 text-xs text-cata-red">{fieldErrors.firstName}</p>
                  )}
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline gap-1">
                    <label htmlFor="lastName" className="text-sm font-medium text-cata-text">
                      Apellidos
                    </label>
                    <span className="text-cata-red" aria-hidden="true">*</span>
                  </div>
                  <div className="relative">
                    <User
                      size={16}
                      strokeWidth={1.5}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      id="lastName"
                      name="lastName"
                      placeholder="p. ej. Rodríguez López"
                      required
                      disabled={submitting}
                      aria-invalid={Boolean(fieldErrors.lastName)}
                      aria-describedby={fieldErrors.lastName ? "lastName-error" : undefined}
                      className="input-field pl-10"
                    />
                  </div>
                  {fieldErrors.lastName && (
                    <p id="lastName-error" role="alert" className="mt-1.5 text-xs text-cata-red">{fieldErrors.lastName}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-baseline gap-1">
                    <label htmlFor="nationalId" className="text-sm font-medium text-cata-text">
                      Cédula de Identidad
                    </label>
                    <span className="text-cata-red" aria-hidden="true">*</span>
                  </div>
                  <div className="relative">
                    <Hash
                      size={16}
                      strokeWidth={1.5}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      id="nationalId"
                      name="nationalId"
                      placeholder="p. ej. 1712345678"
                      required
                      disabled={submitting}
                      pattern="[0-9]{10}"
                      maxLength={10}
                      inputMode="numeric"
                      title="Cédula ecuatoriana: 10 dígitos (p. ej. 1712345678)"
                      aria-invalid={Boolean(fieldErrors.nationalId)}
                      aria-describedby={fieldErrors.nationalId ? "nationalId-error" : undefined}
                      className="input-field pl-10"
                    />
                  </div>
                  {fieldErrors.nationalId && (
                    <p id="nationalId-error" role="alert" className="mt-1.5 text-xs text-cata-red">{fieldErrors.nationalId}</p>
                  )}
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline gap-1">
                    <label htmlFor="birthDate" className="text-sm font-medium text-cata-text">
                      Fecha de Nacimiento
                    </label>
                    <span className="text-cata-red" aria-hidden="true">*</span>
                  </div>
                  <div className="relative">
                    <Calendar
                      size={16}
                      strokeWidth={1.5}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
                      aria-hidden="true"
                    />
                    <input
                      type="date"
                      id="birthDate"
                      name="birthDate"
                      required
                      disabled={submitting}
                      aria-invalid={Boolean(fieldErrors.birthDate)}
                      aria-describedby={fieldErrors.birthDate ? "birthDate-error" : undefined}
                      className="input-field pl-10"
                    />
                  </div>
                  {fieldErrors.birthDate && (
                    <p id="birthDate-error" role="alert" className="mt-1.5 text-xs text-cata-red">{fieldErrors.birthDate}</p>
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-baseline gap-1">
                    <label htmlFor="phone" className="text-sm font-medium text-cata-text">
                      Teléfono Celular
                    </label>
                    <span className="text-cata-red" aria-hidden="true">*</span>
                  </div>
                  <div className="relative">
                    <Phone
                      size={16}
                      strokeWidth={1.5}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
                      aria-hidden="true"
                    />
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      placeholder="p. ej. 0991234567"
                      required
                      disabled={submitting}
                      aria-invalid={Boolean(fieldErrors.phone)}
                      aria-describedby={fieldErrors.phone ? "phone-error" : undefined}
                      className="input-field pl-10"
                    />
                  </div>
                  {fieldErrors.phone && (
                    <p id="phone-error" role="alert" className="mt-1.5 text-xs text-cata-red">{fieldErrors.phone}</p>
                  )}
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline gap-1">
                    <label htmlFor="contactPhone" className="text-sm font-medium text-cata-text">
                      Teléfono de Contacto
                    </label>
                    <span className="text-cata-text/45">(opcional)</span>
                  </div>
                  <div className="relative">
                    <Phone
                      size={16}
                      strokeWidth={1.5}
                      className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65"
                      aria-hidden="true"
                    />
                    <input
                      type="tel"
                      id="contactPhone"
                      name="contactPhone"
                      placeholder="p. ej. 022345678"
                      disabled={submitting}
                      className="input-field pl-10"
                    />
                  </div>
                </div>
              </div>
            </fieldset>

            {/* Note: Club context (technical level, health/medical info) is intentionally
                absent from registration. Those details are captured during the student
                enrollment flow — see /student/enroll. */}

            <button type="submit" disabled={submitting} className="btn-primary mt-2 w-full shadow-soft">
              {submitting ? "Creando cuenta…" : "Crear Cuenta"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-cata-text/65">
            ¿Ya tiene una cuenta?{" "}
            <Link href="/login" className="font-medium text-cata-red transition-colors hover:text-cata-red-light">
              Iniciar sesión
            </Link>
          </p>

          <p className="mt-6 text-center text-xs text-cata-text/30">
            La interfaz de registro es un placeholder de demostración. No se envía ni almacena
            ningún dato. La creación de cuentas se habilitará cuando el servicio de autenticación
            del backend esté conectado.
          </p>
        </>
      )}
    </AuthShell>
  );
}
