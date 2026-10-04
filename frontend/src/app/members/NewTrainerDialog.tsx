/**
 * «Nuevo entrenador» — the admin creates a trainer account directly (issue
 * #1575): minimal identity data, a trainer-only account, and an invitation
 * email with a one-use link to set the password. The admin never sees or
 * defines the password.
 *
 * The rules are the ones the rest of the app already uses (`cedulaRule`,
 * `personNameRule`, `phoneFieldRule`); the backend enforces them again and
 * answers a clear message when the cédula or the email already exist.
 */

"use client";

import { type FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { PhoneField } from "@/components/wizard-fields";
import { useToast } from "@/contexts/ToastContext";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";
import {
  EDAD_MAYORIA_EDAD,
  MAX_PLAUSIBLE_HUMAN_AGE,
  calculatePersonAge,
  cedulaRule,
  isFutureBirthDate,
  isPlausibleHumanAge,
  isValidCalendarDate,
  personNameRule,
  phoneFieldRule,
  toStoredPhone,
} from "@/lib/identity-validation";
import { crearEntrenador } from "@/services/api";
import { useNativeDialog, NATIVE_DIALOG_SHELL_CLASS, NATIVE_DIALOG_BODY_CLASS } from "./useNativeDialog";

interface NewTrainerDialogProps {
  onClose: () => void;
  /** Refetch the member list: the new trainer appears as «Invitación pendiente». */
  onCreated: () => void;
}

type FieldName = "nombres" | "apellidos" | "cedula" | "fechaNacimiento" | "correo" | "telefono";
type FieldErrors = Partial<Record<FieldName, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORM_ID = "new-trainer-form";

function birthDateRule(value: string): string | null {
  if (!value) return "Indica la fecha de nacimiento.";
  if (!isValidCalendarDate(value)) return "La fecha de nacimiento no existe. Revisa el día, el mes y el año.";
  if (isFutureBirthDate(value)) return "La fecha de nacimiento no puede ser posterior a hoy. Revisa el año.";
  const age = calculatePersonAge(value);
  if (!isPlausibleHumanAge(age)) {
    return `La fecha de nacimiento corresponde a más de ${MAX_PLAUSIBLE_HUMAN_AGE} años. Revisa el año.`;
  }
  if (age < EDAD_MAYORIA_EDAD) return "El entrenador debe ser mayor de edad.";
  return null;
}

function emailRule(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "El correo es obligatorio.";
  return EMAIL_PATTERN.test(trimmed) ? null : "Escribe un correo válido, por ejemplo nombre@correo.com.";
}

export default function NewTrainerDialog({ onClose, onCreated }: NewTrainerDialogProps): React.ReactElement {
  const { showSuccess } = useToast();
  const { dialogRef, closeButtonRef, shellStyle } = useNativeDialog(onClose);
  const [nombres, setNombres] = useState("");
  const [apellidos, setApellidos] = useState("");
  const [cedula, setCedula] = useState("");
  const [fechaNacimiento, setFechaNacimiento] = useState("");
  const [correo, setCorreo] = useState("");
  const [telefono, setTelefono] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  function validate(): FieldErrors {
    const found: FieldErrors = {};
    const checks: [FieldName, string | null][] = [
      ["nombres", personNameRule(nombres, "Los nombres")],
      ["apellidos", personNameRule(apellidos, "Los apellidos")],
      ["cedula", cedulaRule(cedula, "La cédula")],
      ["fechaNacimiento", birthDateRule(fechaNacimiento)],
      ["correo", emailRule(correo)],
      ["telefono", phoneFieldRule(telefono, "El celular", { guided: true })],
    ];
    for (const [field, message] of checks) {
      if (message) found[field] = message;
    }
    return found;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setServerError(null);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const payload = {
        nombres: nombres.trim(),
        apellidos: apellidos.trim(),
        cedula: cedula.trim(),
        fechaNacimiento,
        correo: correo.trim(),
        telefono: toStoredPhone(telefono),
      };
      await crearEntrenador(payload);
      showSuccess(
        `Enviamos la invitación a ${payload.correo}. La cuenta queda como «Invitación pendiente» hasta que cree su contraseña.`,
      );
      onCreated();
      onClose();
    } catch (err: unknown) {
      setServerError(toUserMessage(err, "No se pudo crear al entrenador. Intenta nuevamente."));
    } finally {
      setSubmitting(false);
    }
  }

  function textField(
    id: FieldName,
    label: string,
    value: string,
    onChange: (next: string) => void,
    extra: { type?: string; autoComplete?: string; max?: string } = {},
  ): React.ReactElement {
    const error = errors[id];
    return (
      <div>
        <label htmlFor={`new-trainer-${id}`} className="mb-field block text-sm font-semibold text-ink">
          {label}
        </label>
        <input
          id={`new-trainer-${id}`}
          type={extra.type ?? "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={submitting}
          autoComplete={extra.autoComplete}
          max={extra.max}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `new-trainer-${id}-error` : undefined}
          className="input-field w-full"
        />
        {error && (
          <p id={`new-trainer-${id}-error`} role="alert" className="mt-1 text-xs text-state-bad">
            {error}
          </p>
        )}
      </div>
    );
  }

  const latestBirthDate = `${new Date().getFullYear() - EDAD_MAYORIA_EDAD}-12-31`;

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="new-trainer-title"
      onCancel={(event) => event.preventDefault()}
      className={NATIVE_DIALOG_SHELL_CLASS}
      style={shellStyle}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-sunken px-5 py-4">
        <div className="min-w-0">
          <h2 id="new-trainer-title" className="font-display text-lg uppercase leading-tight tracking-flat text-ink">
            Nuevo entrenador
          </h2>
          <p className="mt-1 text-xs text-ink-3">
            Le enviamos un correo para que cree su contraseña. Tú no la defines ni la ves.
          </p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar ventana"
          className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
        >
          <X size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>

      <div className={NATIVE_DIALOG_BODY_CLASS}>
        <form id={FORM_ID} noValidate onSubmit={(event) => void handleSubmit(event)} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {textField("nombres", "Nombres", nombres, setNombres, { autoComplete: "off" })}
            {textField("apellidos", "Apellidos", apellidos, setApellidos, { autoComplete: "off" })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {textField("cedula", "Cédula", cedula, setCedula, { autoComplete: "off" })}
            {textField("fechaNacimiento", "Fecha de nacimiento", fechaNacimiento, setFechaNacimiento, {
              type: "date",
              max: latestBirthDate,
            })}
          </div>
          {textField("correo", "Correo", correo, setCorreo, { type: "email", autoComplete: "off" })}
          <PhoneField
            idPrefix="new-trainer"
            field="telefono"
            label="Celular"
            value={telefono}
            onChange={setTelefono}
            disabled={submitting}
            error={errors.telefono}
          />
          {serverError && (
            <p role="alert" className="text-sm text-state-bad">
              {serverError}
            </p>
          )}
        </form>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3.5">
        <Button variant="secondary" onClick={onClose} disabled={submitting}>
          Cancelar
        </Button>
        <Button type="submit" form={FORM_ID} variant="primary" disabled={submitting}>
          {submitting && <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />}
          {submitting ? "Enviando…" : "Crear y enviar invitación"}
        </Button>
      </div>
    </dialog>,
    document.body,
  );
}
