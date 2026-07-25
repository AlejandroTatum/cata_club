/**
 * Shared field-render helpers for the multi-step wizards (`/student/enroll`,
 * `/student/add-dependent`) — extracted to avoid duplicating id-slugging and
 * input/textarea markup across both.
 */

import type { InputHTMLAttributes, ReactElement, ReactNode } from "react";
import { User, Calendar, Hash, Phone, UserPlus, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { calculateAge } from "@/app/student/enroll/enroll-utils";

const ACCENTED_CHARS: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n",
};

/**
 * Derives a stable, unique-enough field id from a label so <label htmlFor>
 * can be programmatically associated with its <input>/<textarea>.
 */
export function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .split("")
    .map((char) => ACCENTED_CHARS[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

interface WizardInputProps {
  idPrefix: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
  type?: string;
  required?: boolean;
  icon?: ReactNode;
  pattern?: string;
  maxLength?: number;
  minLength?: number;
  inputMode?: string;
}

export function WizardInput(opts: WizardInputProps): ReactElement {
  const fieldId = `${opts.idPrefix}-${slugifyLabel(opts.label)}`;
  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-cata-text">
        {opts.label}
        {opts.required && <span className="ml-0.5 text-cata-red">*</span>}
      </label>
      <div className="relative">
        {opts.icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-cata-text/65">
            {opts.icon}
          </span>
        )}
        <input
          id={fieldId}
          type={opts.type ?? "text"}
          value={opts.value}
          onChange={(e) => opts.onChange(e.target.value)}
          placeholder={opts.placeholder}
          required={opts.required}
          disabled={opts.disabled}
          pattern={opts.pattern}
          maxLength={opts.maxLength}
          minLength={opts.minLength}
          inputMode={(opts.inputMode ?? "text") as InputHTMLAttributes<HTMLInputElement>["inputMode"]}
          className={`input-field ${opts.icon ? "pl-10" : ""}`}
        />
      </div>
    </div>
  );
}

interface WizardTextareaProps {
  idPrefix: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
  required?: boolean;
  icon?: ReactNode;
  rows?: number;
}

export function WizardTextarea(opts: WizardTextareaProps): ReactElement {
  const fieldId = `${opts.idPrefix}-${slugifyLabel(opts.label)}`;
  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="mb-1.5 block text-sm font-medium text-cata-text">
        {opts.label}
        {opts.required && <span className="ml-0.5 text-cata-red">*</span>}
        {!opts.required && (
          <span className="ml-1 text-cata-text/45">(opcional)</span>
        )}
      </label>
      <div className="relative">
        {opts.icon && (
          <span className="pointer-events-none absolute left-3.5 top-3 text-cata-text/65">
            {opts.icon}
          </span>
        )}
        <textarea
          id={fieldId}
          value={opts.value}
          onChange={(e) => opts.onChange(e.target.value)}
          placeholder={opts.placeholder}
          required={opts.required}
          disabled={opts.disabled}
          rows={opts.rows ?? 3}
          className={`input-field ${opts.icon ? "pl-10" : ""} resize-none`}
        />
      </div>
    </div>
  );
}

interface PersonIdentityFieldsProps {
  idPrefix: string;
  disabled: boolean;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  cedula: string;
  telefono: string;
  onNombresChange: (v: string) => void;
  onApellidosChange: (v: string) => void;
  onFechaNacimientoChange: (v: string) => void;
  onCedulaChange: (v: string) => void;
  onTelefonoChange: (v: string) => void;
  /** Extra content appended after the "Edad calculada" preview — e.g. `/student/enroll`'s minor-without-representative warning, which `/student/add-dependent` doesn't need. */
  renderAgeWarning?: (age: number) => ReactNode;
}

/** Nombres/apellidos/fecha de nacimiento/cédula/teléfono + a live "Edad calculada" preview — shared by both wizards, which collect the same person-identity shape for their respective subject (student or dependent). */
export function PersonIdentityFields(props: PersonIdentityFieldsProps): ReactElement {
  const { idPrefix, disabled } = props;
  const age = calculateAge(props.fechaNacimiento);
  const ageValid = !isNaN(age);
  return (
    <>
      <WizardInput
        idPrefix={idPrefix} disabled={disabled} label="Nombres" value={props.nombres}
        onChange={props.onNombresChange} placeholder="p. ej. Juan Carlos" required
        icon={<User size={16} strokeWidth={1.5} aria-hidden="true" />}
        pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={100} minLength={3}
      />
      <WizardInput
        idPrefix={idPrefix} disabled={disabled} label="Apellidos" value={props.apellidos}
        onChange={props.onApellidosChange} placeholder="p. ej. Rodríguez López" required
        icon={<User size={16} strokeWidth={1.5} aria-hidden="true" />}
        pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={100} minLength={3}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <WizardInput
          idPrefix={idPrefix} disabled={disabled} label="Fecha de Nacimiento" value={props.fechaNacimiento}
          onChange={props.onFechaNacimientoChange} type="date" required
          icon={<Calendar size={16} strokeWidth={1.5} aria-hidden="true" />}
        />
        <WizardInput
          idPrefix={idPrefix} disabled={disabled} label="Cédula de Identidad" value={props.cedula}
          onChange={props.onCedulaChange} placeholder="p. ej. 1712345678" required
          icon={<Hash size={16} strokeWidth={1.5} aria-hidden="true" />}
          pattern="[0-9]{10}" maxLength={10} inputMode="numeric"
        />
      </div>
      <WizardInput
        idPrefix={idPrefix} disabled={disabled} label="Teléfono" value={props.telefono}
        onChange={props.onTelefonoChange} placeholder="p. ej. 0991234567" required
        icon={<Phone size={16} strokeWidth={1.5} aria-hidden="true" />}
        pattern="[0-9]+" maxLength={10} minLength={7} inputMode="tel"
      />
      {props.fechaNacimiento && (
        <div className="rounded-xl bg-cata-bg p-3 text-xs text-cata-text/65">
          Edad calculada:{" "}
          <span className="font-medium text-cata-text">
            {ageValid ? `${age} años` : "—"}
          </span>
          {ageValid && props.renderAgeWarning?.(age)}
        </div>
      )}
    </>
  );
}

interface EmergencyContactFieldsProps {
  idPrefix: string;
  disabled: boolean;
  contacto: string;
  telefono: string;
  onContactoChange: (v: string) => void;
  onTelefonoChange: (v: string) => void;
}

/** "Contacto de Emergencia" section (divider + header + 2 fields) — shared by both wizards' health/medical step. */
export function EmergencyContactFields(props: EmergencyContactFieldsProps): ReactElement {
  const { idPrefix, disabled } = props;
  return (
    <>
      <div className="my-8 h-px bg-cata-border" />
      <div className="mb-3 flex items-center gap-2">
        <Phone size={14} strokeWidth={1.5} className="text-cata-red" aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-wider text-cata-text/45">
          Contacto de Emergencia
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <WizardInput
          idPrefix={idPrefix} disabled={disabled} label="Nombre del Contacto" value={props.contacto}
          onChange={props.onContactoChange} placeholder="p. ej. María Rodríguez" required
          icon={<UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />}
          pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={150} minLength={3}
        />
        <WizardInput
          idPrefix={idPrefix} disabled={disabled} label="Teléfono de Emergencia" value={props.telefono}
          onChange={props.onTelefonoChange} placeholder="p. ej. 0991234567" required
          icon={<Phone size={16} strokeWidth={1.5} aria-hidden="true" />}
          pattern="[0-9]+" maxLength={10} minLength={7} inputMode="tel"
        />
      </div>
    </>
  );
}

interface WizardNavigationProps {
  formErrors: string[];
  isFirst: boolean;
  isLast: boolean;
  submitting: boolean;
  onBack: () => void;
  onNext: () => void;
  /** The final step's submit button — its label/disabled condition differ per wizard, so the caller renders it. */
  submitButton: ReactNode;
}

/** Validation-errors alert + Atrás/Siguiente navigation chrome — shared by both wizards' step footer. The final step renders `submitButton` instead of "Siguiente". */
export function WizardNavigation(props: WizardNavigationProps): ReactElement {
  return (
    <>
      {props.formErrors.length > 0 && (
        <div className="alert-error mt-4 items-start" role="alert">
          <AlertTriangle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <ul className="list-inside list-disc space-y-1">
            {props.formErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 flex items-center justify-between gap-3">
        <div>
          {!props.isFirst && (
            <button
              type="button"
              onClick={props.onBack}
              disabled={props.submitting}
              className="btn-ghost"
            >
              <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
              Atrás
            </button>
          )}
        </div>

        <div className="flex gap-3">
          {!props.isLast ? (
            <button
              type="button"
              onClick={props.onNext}
              className="btn-primary shadow-soft"
            >
              Siguiente
              <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
            </button>
          ) : props.submitButton}
        </div>
      </div>
    </>
  );
}
