"use client";

/**
 * "Cambiar contraseña" — the signed-in user changes their own password
 * (FAM-17). Current password + new one, twice.
 *
 * The rules are the same ones the reset screen enforces (`passwordRule`), plus
 * the two that only make sense here: the new password must differ from the
 * current one and must match its repeat. Nothing is shown as wrong before the
 * first submit attempt. The backend stays the authority: its message (wrong
 * current password, same password) lands under the field it is about.
 *
 * On success the backend revokes every OTHER session and reissues this
 * device's tokens as cookies (see `api/auth/contrasenia/cambiar/route.ts`), so
 * there is nothing to refresh here — the form just clears.
 */

import { type FormEvent, useId, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui";
import PasswordStrengthMeter from "@/components/ui/PasswordStrengthMeter";
import { ICON } from "@/lib/icon-size";
import { passwordRule } from "@/lib/identity-validation";
import LinkifiedText from "@/components/LinkifiedText";
import { toUserMessage } from "@/lib/error-message";
import { cambiarContrasenia } from "@/services/api";
import { useToast } from "@/contexts/ToastContext";
import { SectionHead } from "./ProfileParts";

interface FieldErrors {
  current?: string;
  next?: string;
  repeat?: string;
}

function validate(current: string, next: string, repeat: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!current) errors.current = "Ingresa tu contraseña actual.";
  const policy = passwordRule(next, "La nueva contraseña");
  if (policy) errors.next = policy;
  else if (next === current) errors.next = "La nueva contraseña debe ser distinta de la actual.";
  if (repeat !== next) errors.repeat = "No coincide con la nueva contraseña.";
  return errors;
}

function PasswordField({
  id,
  label,
  value,
  error,
  autoComplete,
  disabled,
  onChange,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  autoComplete: string;
  disabled: boolean;
  onChange: (value: string) => void;
  /** Extra description id (the strength meter's line), read after the error. */
  describedBy?: string;
}): React.ReactElement {
  const errorId = `${id}-error`;
  const [visible, setVisible] = useState(false);
  const described = [error ? errorId : null, describedBy].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          onChange={(event) => onChange(event.target.value)}
          className={`input-field pr-10 ${error ? "border-state-bad" : ""}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3-strong transition-colors hover:text-ink"
        >
          {visible ? (
            <EyeOff size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <Eye size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-state-bad">
          <LinkifiedText text={error} />
        </p>
      )}
    </div>
  );
}

export default function ChangePasswordCard(): React.ReactElement {
  const { showSuccess } = useToast();
  const baseId = useId();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const errors = attempted ? validate(current, next, repeat) : {};
  const visibleCurrent = errors.current ?? serverError ?? undefined;

  /** Editing any field closes the previous attempt's notices (FAM-24). */
  function clearNotices(): void {
    setServerError(null);
    setMessage(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setAttempted(true);
    setMessage(null);
    setServerError(null);
    if (Object.keys(validate(current, next, repeat)).length > 0) return;

    setSubmitting(true);
    try {
      const result = await cambiarContrasenia(current, next);
      setCurrent("");
      setNext("");
      setRepeat("");
      setAttempted(false);
      setMessage(result.mensaje);
      showSuccess(result.mensaje);
    } catch (error: unknown) {
      const text = toUserMessage(error, "No se pudo cambiar la contraseña.");
      // Shown inline under the field only: a second copy as a toast outlived
      // the next attempt and contradicted the field's new message (FAM-24).
      setServerError(text);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section data-testid="profile-change-password" className="card overflow-hidden">
      <SectionHead
        title="Cambiar contraseña"
        subtitle="Al cambiarla, se cerrarán tus otras sesiones."
        icon={<KeyRound size={ICON.sm} strokeWidth={1.5} />}
        tone="ball"
      />
      <form noValidate onSubmit={(event) => void handleSubmit(event)} className="grid gap-4 p-4">
        <PasswordField
          id={`${baseId}-current`}
          label="Contraseña actual"
          value={current}
          error={visibleCurrent}
          autoComplete="current-password"
          disabled={submitting}
          onChange={(value) => {
            setCurrent(value);
            clearNotices();
          }}
        />
        <PasswordField
          id={`${baseId}-next`}
          label="Nueva contraseña"
          value={next}
          error={errors.next}
          autoComplete="new-password"
          disabled={submitting}
          onChange={(value) => {
            setNext(value);
            clearNotices();
          }}
          describedBy={`${baseId}-meter`}
        />
        <PasswordStrengthMeter id={`${baseId}-meter`} value={next} className="-mt-2 mb-0" />
        <PasswordField
          id={`${baseId}-repeat`}
          label="Repetir nueva contraseña"
          value={repeat}
          error={errors.repeat}
          autoComplete="new-password"
          disabled={submitting}
          onChange={(value) => {
            setRepeat(value);
            clearNotices();
          }}
        />
        <Button type="submit" variant="secondary" disabled={submitting}>
          {submitting ? "Guardando…" : "Actualizar contraseña"}
        </Button>
        {message && (
          <p role="status" className="text-sm text-state-ok">
            {message}
          </p>
        )}
      </form>
    </section>
  );
}
