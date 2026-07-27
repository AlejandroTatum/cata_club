/**
 * Shared field-render helpers for the multi-step wizards (`/student/enroll`,
 * `/student/add-dependent`) — extracted to avoid duplicating id-slugging and
 * input/textarea markup across both.
 */

import type { InputHTMLAttributes, ReactElement, ReactNode } from "react";
import { User, Calendar, Hash, Phone, UserPlus, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { calculateAge } from "@/app/student/enroll/enroll-utils";
import { Button } from "@/components/ui";
import { DuplicateIdentityHelp, type DuplicateIdentityAudience } from "@/components/DuplicateIdentityHelp";
import { isDuplicateIdentityError } from "@/lib/duplicate-identity";

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
  /**
   * The field's own validation message, shown BESIDE the field
   * (`_sistema.css` `.input.err` + `.errmsg`). Passing `undefined` keeps the
   * field in its resting state — callers surface an error only once the
   * visitor has touched the field, so a pristine form is never a wall of red.
   */
  error?: string;
  /** Neutral guidance under the field (`.hint`), shown only when there is no error. */
  hint?: string;
  /** Fired when the field loses focus — callers use it to mark the field "touched". */
  onBlur?: () => void;
}

export function WizardInput(opts: WizardInputProps): ReactElement {
  const fieldId = `${opts.idPrefix}-${slugifyLabel(opts.label)}`;
  const messageId = `${fieldId}-message`;
  const hasError = Boolean(opts.error);
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
          onBlur={opts.onBlur}
          placeholder={opts.placeholder}
          required={opts.required}
          disabled={opts.disabled}
          pattern={opts.pattern}
          maxLength={opts.maxLength}
          minLength={opts.minLength}
          aria-invalid={hasError || undefined}
          aria-describedby={opts.error || opts.hint ? messageId : undefined}
          inputMode={(opts.inputMode ?? "text") as InputHTMLAttributes<HTMLInputElement>["inputMode"]}
          className={`input-field ${opts.icon ? "pl-10" : ""} ${
            hasError ? "border-cata-red ring-[3px] ring-cata-red/10" : ""
          }`}
        />
      </div>
      {hasError ? (
        <p id={messageId} className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-cata-red">
          <AlertTriangle size={13} strokeWidth={2} className="shrink-0" aria-hidden="true" />
          {opts.error}
        </p>
      ) : opts.hint ? (
        <p id={messageId} className="mt-1.5 text-xs text-ink-3">
          {opts.hint}
        </p>
      ) : null}
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

/** Per-field messages for the five identity inputs, keyed the same way the wizards key their form state. */
export interface PersonIdentityErrors {
  nombres?: string;
  apellidos?: string;
  fechaNacimiento?: string;
  cedula?: string;
  telefono?: string;
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
  /** Live validation messages, already filtered by the caller to the fields the visitor has touched. */
  errors?: PersonIdentityErrors;
  /** Marks a field as touched, so its message only appears after the visitor has left it. */
  onFieldBlur?: (field: keyof PersonIdentityErrors) => void;
  /** Extra content appended after the "Edad calculada" preview — e.g. `/student/enroll`'s minor-without-representative warning, which `/student/add-dependent` doesn't need. */
  renderAgeWarning?: (age: number) => ReactNode;
}

/** How many digits an Ecuadorian cédula carries. Mirrors the backend's own rule. */
const CEDULA_DIGITS = 10;

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

/** Nombres/apellidos/fecha de nacimiento/cédula/teléfono + a live "Edad calculada" preview — shared by both wizards, which collect the same person-identity shape for their respective subject (student or dependent). */
export function PersonIdentityFields(props: PersonIdentityFieldsProps): ReactElement {
  const { idPrefix, disabled } = props;
  const errors = props.errors ?? {};
  const age = calculateAge(props.fechaNacimiento);
  const ageValid = !isNaN(age);
  const cedulaTyped = digitCount(props.cedula);
  return (
    <>
      <WizardInput
        idPrefix={idPrefix} disabled={disabled} label="Nombres" value={props.nombres}
        onChange={props.onNombresChange} placeholder="p. ej. Juan Carlos" required
        icon={<User size={16} strokeWidth={1.5} aria-hidden="true" />}
        error={errors.nombres} onBlur={() => props.onFieldBlur?.("nombres")}
        pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={100} minLength={3}
      />
      <WizardInput
        idPrefix={idPrefix} disabled={disabled} label="Apellidos" value={props.apellidos}
        onChange={props.onApellidosChange} placeholder="p. ej. Rodríguez López" required
        icon={<User size={16} strokeWidth={1.5} aria-hidden="true" />}
        error={errors.apellidos} onBlur={() => props.onFieldBlur?.("apellidos")}
        pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={100} minLength={3}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <WizardInput
          idPrefix={idPrefix} disabled={disabled} label="Fecha de Nacimiento" value={props.fechaNacimiento}
          onChange={props.onFechaNacimientoChange} type="date" required
          icon={<Calendar size={16} strokeWidth={1.5} aria-hidden="true" />}
          error={errors.fechaNacimiento} onBlur={() => props.onFieldBlur?.("fechaNacimiento")}
        />
        <WizardInput
          idPrefix={idPrefix} disabled={disabled} label="Cédula de Identidad" value={props.cedula}
          onChange={props.onCedulaChange} placeholder="p. ej. 1712345678" required
          icon={<Hash size={16} strokeWidth={1.5} aria-hidden="true" />}
          pattern="[0-9]{10}" maxLength={CEDULA_DIGITS} inputMode="numeric"
          error={errors.cedula} onBlur={() => props.onFieldBlur?.("cedula")}
          hint={
            cedulaTyped > 0 && cedulaTyped < CEDULA_DIGITS
              ? `Lleva ${cedulaTyped} de ${CEDULA_DIGITS} dígitos.`
              : `${CEDULA_DIGITS} dígitos, sin guiones.`
          }
        />
      </div>
      <WizardInput
        idPrefix={idPrefix} disabled={disabled} label="Teléfono" value={props.telefono}
        onChange={props.onTelefonoChange} placeholder="p. ej. 0991234567" required
        icon={<Phone size={16} strokeWidth={1.5} aria-hidden="true" />}
        pattern="[0-9]+" maxLength={10} minLength={7} inputMode="tel"
        error={errors.telefono} onBlur={() => props.onFieldBlur?.("telefono")}
        hint="Entre siete y diez dígitos, con o sin espacios."
      />
      {props.fechaNacimiento && (
        <div className="rounded-ctl bg-canvas p-3 text-xs text-ink-3">
          Edad calculada:{" "}
          <span className="font-semibold text-ink">
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
  contactoError?: string;
  telefonoError?: string;
  onContactoBlur?: () => void;
  onTelefonoBlur?: () => void;
}

/** "Contacto de Emergencia" section (divider + header + 2 fields) — shared by both wizards' health/medical step. */
export function EmergencyContactFields(props: EmergencyContactFieldsProps): ReactElement {
  const { idPrefix, disabled } = props;
  return (
    <>
      <div className="my-8 h-px bg-line" />
      <div className="mb-3 flex items-center gap-2">
        <Phone size={14} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
        <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
          Contacto de Emergencia
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <WizardInput
          idPrefix={idPrefix} disabled={disabled} label="Nombre del Contacto" value={props.contacto}
          onChange={props.onContactoChange} placeholder="p. ej. María Rodríguez" required
          icon={<UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />}
          error={props.contactoError} onBlur={props.onContactoBlur}
          pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={150} minLength={3}
        />
        <WizardInput
          idPrefix={idPrefix} disabled={disabled} label="Teléfono de Emergencia" value={props.telefono}
          onChange={props.onTelefonoChange} placeholder="p. ej. 0991234567" required
          icon={<Phone size={16} strokeWidth={1.5} aria-hidden="true" />}
          pattern="[0-9]+" maxLength={10} minLength={7} inputMode="tel"
          error={props.telefonoError} onBlur={props.onTelefonoBlur}
          hint="Entre siete y diez dígitos, con o sin espacios."
        />
      </div>
    </>
  );
}

interface WizardNavigationProps {
  formErrors: string[];
  /**
   * Who is filling this wizard in. When one of `formErrors` is the backend's
   * "already registered" answer, the alert grows an escape hatch pointing at
   * whatever the next step is for THIS audience — an error that only restates
   * the problem is a dead end. Omit it and the alert behaves as before.
   */
  duplicateIdentityAudience?: DuplicateIdentityAudience;
  isFirst: boolean;
  isLast: boolean;
  submitting: boolean;
  onBack: () => void;
  onNext: () => void;
  /** Blocks "Siguiente" until every field on the step is valid. */
  nextDisabled?: boolean;
  /** Why "Siguiente" is blocked, shown under it — a disabled control that does not say what is missing is a dead end. */
  nextBlockedReason?: string;
  /** The final step's submit button — its label/disabled condition differ per wizard, so the caller renders it. */
  submitButton: ReactNode;
}

/** Validation-errors alert + Atrás/Siguiente navigation chrome — shared by both wizards' step footer. The final step renders `submitButton` instead of "Siguiente". */
export function WizardNavigation(props: WizardNavigationProps): ReactElement {
  const duplicateHelpAudience =
    props.duplicateIdentityAudience !== undefined && props.formErrors.some(isDuplicateIdentityError)
      ? props.duplicateIdentityAudience
      : null;
  return (
    <>
      {props.formErrors.length > 0 && (
        <div className="alert-error mt-4 items-start" role="alert">
          <AlertTriangle size={14} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <ul className="list-inside list-disc space-y-1">
              {props.formErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
            {duplicateHelpAudience && <DuplicateIdentityHelp audience={duplicateHelpAudience} />}
          </div>
        </div>
      )}

      <div className="mt-8 flex items-start justify-between gap-3">
        <div>
          {!props.isFirst && (
            <Button variant="ghost" onClick={props.onBack} disabled={props.submitting}>
              <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
              Atrás
            </Button>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {!props.isLast ? (
            <>
              <Button variant="primary" onClick={props.onNext} disabled={props.nextDisabled}>
                Siguiente
                <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
              </Button>
              {props.nextDisabled && props.nextBlockedReason && (
                <p className="max-w-xs text-right text-xs text-ink-3">{props.nextBlockedReason}</p>
              )}
            </>
          ) : props.submitButton}
        </div>
      </div>
    </>
  );
}
