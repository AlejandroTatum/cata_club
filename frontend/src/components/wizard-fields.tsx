/**
 * Shared field-render helpers for the multi-step wizards (`/student/enroll`,
 * `/student/add-dependent`) — extracted to avoid duplicating id-slugging and
 * input/textarea markup across both.
 */

import type { InputHTMLAttributes, ReactElement, ReactNode } from "react";
import { useRef, useState } from "react";
import {
  User,
  Calendar,
  Hash,
  Phone,
  UserPlus,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import {
  calculatePersonAge,
  isPlausibleHumanAge,
  isValidCalendarDate,
  studentBirthDateBounds,
  PHONE_FORMAT_HINT,
} from "@/lib/identity-validation";
import { Button, buttonClasses } from "@/components/ui";
import { DuplicateIdentityHelp, type DuplicateIdentityAudience } from "@/components/DuplicateIdentityHelp";
import { isDuplicateIdentityError } from "@/lib/duplicate-identity";
import { NUMERIC_FIELD_LIMIT_MESSAGE, type NumericFieldMode } from "@/lib/numeric-input";
import { useNumericFieldMasking } from "@/lib/use-numeric-field-masking";


const ACCENTED_CHARS: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n",
};

/**
 * The neutral marker an OPTIONAL field carries.
 *
 * It replaces the red asterisk that used to mark the required ones, and the
 * swap is not cosmetic. Seven asterisks per step in `cata-red` spent the
 * system's one action colour on decoration, next to the single red button that
 * had earned it ("la regla del rojo único"). It also marked the majority: on
 * this wizard nearly every field is required, so the asterisk carried no
 * information — a mark that fires on almost everything is a texture.
 *
 * Marking the minority instead says the same thing with one word and no
 * colour. `required` stays on the input, so assistive technology still hears
 * it from the attribute that means it.
 */
const OPTIONAL_MARKER = "(opcional)";

/**
 * How a placeholder announces that it is an example.
 *
 * "p. ej." appeared eight times on the enrolment wizard alone, and it is an
 * abbreviation — the one thing "la regla de las palabras" forbids outright:
 * *"la interfaz no abrevia. Si algo no entra, entra menos información, nunca
 * una palabra cortada."* A placeholder has room for the whole word.
 */
export function example(value: string): string {
  return `Por ejemplo: ${value}`;
}

/**
 * Derives a stable, unique-enough field id from a label so <label htmlFor>
 * can be programmatically associated with its <input>/<textarea>.
 *
 * This is the FALLBACK, not the contract. A label is copy, and copy gets
 * rewritten; deriving the id from it makes every visible word a selector, and
 * that is exactly how renaming one label in `/student/enroll` could take forty
 * end-to-end cases with it. Callers that care pass an explicit `field` token
 * (see `ENROLL_FIELD_TOKEN` in `enroll-utils.ts`); this keeps working for the
 * wizards that have not declared theirs yet.
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
  /**
   * The field's own id token, appended to `idPrefix`. Declared by the caller
   * so the DOM id survives a rewrite of `label` — see `slugifyLabel`, which is
   * what runs when this is omitted.
   */
  field?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  placeholder?: string;
  /**
   * `type="password"` grows its own reveal toggle — issue #661. Callers pass
   * nothing extra for that; the same `aria-label` wording as `/login` and
   * `/reset-password` ("Mostrar contraseña"/"Ocultar contraseña") ships for
   * free, and any other `type` renders exactly as before.
   */
  type?: string;
  required?: boolean;
  icon?: ReactNode;
  pattern?: string;
  maxLength?: number;
  minLength?: number;
  /** `<input type="date">` bounds — HTML forwards these to `min`/`max`. */
  min?: string;
  max?: string;
  inputMode?: string;
  /**
   * Standard autofill token (`given-name`, `family-name`, `bday`, `tel`,
   * `email`, `new-password`, …) — issue #312 / hallazgo #33: without it the
   * browser has nothing to offer back on a 17-field form spread over 5
   * screens.
   */
  autoComplete?: string;
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
  /**
   * Cédula/teléfono keystroke-and-paste filtering (see `numeric-input.ts`).
   * A disallowed character (a letter; a separator on cédula) is rejected
   * before it lands, silently — it was never valid input. The digit cap
   * (10) is enforced the same way for a real keystroke or paste, but a
   * rejected digit at the cap shows a visible, `aria-live` warning instead
   * — the cap is real, unlike issue #225's, it is never silent.
   */
  numericMode?: NumericFieldMode;
}

/**
 * The `*`/`(opcional)` mark every field label carries — shared by `WizardInput`,
 * `WizardTextarea` and `BirthDateField`'s `<legend>` so a third field never
 * re-declares the same six lines a second time (issue #853).
 */
function RequiredMarker(props: { required?: boolean }): ReactElement {
  return props.required ? (
    <span aria-hidden="true" className="ml-1 text-state-bad">*</span>
  ) : (
    <span className="ml-1 font-normal text-ink-3">{OPTIONAL_MARKER}</span>
  );
}

/** The error paragraph every field message renders in its `hasError` branch — shared so `BirthDateField` (issue #853) does not duplicate `WizardInput`'s. */
function FieldErrorMessage(props: { id: string; children: ReactNode }): ReactElement {
  return (
    <p id={props.id} className="mt-field flex items-center gap-1.5 text-xs font-semibold text-state-bad">
      <AlertTriangle size={ICON.sm} strokeWidth={2} className="shrink-0" aria-hidden="true" />
      {props.children}
    </p>
  );
}

/** The neutral hint paragraph every field message renders when there is no error — same sharing reason as `FieldErrorMessage`. */
function FieldHintMessage(props: { id: string; children: ReactNode }): ReactElement {
  return (
    <p id={props.id} className="mt-field text-xs text-ink-3">
      {props.children}
    </p>
  );
}

export function WizardInput(opts: WizardInputProps): ReactElement {
  const fieldId = `${opts.idPrefix}-${opts.field ?? slugifyLabel(opts.label)}`;
  const messageId = `${fieldId}-message`;
  const hasError = Boolean(opts.error);
  const { numericMode } = opts;
  // See `use-numeric-field-masking.ts` — the keydown/paste/onChange
  // filtering shared with `MedicalRecordEditor`'s teléfono de emergencia
  // field (issue #667's emergency-contact parity gap).
  const masking = useNumericFieldMasking(numericMode, opts.onChange);
  const limitReached = masking.limitReached;
  // Issue #661: masked by default, exactly like `/login` and
  // `/reset-password` — this state never leaks into `opts.type` itself, so a
  // caller that passes `type="password"` keeps meaning "start masked", not
  // "always masked".
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = opts.type === "password";
  const inputType = isPassword ? (showPassword ? "text" : "password") : (opts.type ?? "text");

  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="mb-field block text-sm font-semibold text-ink">
        {opts.label}
        <RequiredMarker required={opts.required} />
      </label>
      <div className="relative">
        {opts.icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">
            {opts.icon}
          </span>
        )}
        <input
          id={fieldId}
          type={inputType}
          value={opts.value}
          onChange={(e) => masking.onChange(e.target.value)}
          onKeyDown={masking.onKeyDown}
          onPaste={masking.onPaste}
          onBlur={opts.onBlur}
          placeholder={opts.placeholder}
          required={opts.required}
          disabled={opts.disabled}
          pattern={opts.pattern}
          maxLength={opts.maxLength}
          minLength={opts.minLength}
          min={opts.min}
          max={opts.max}
          autoComplete={opts.autoComplete}
          aria-invalid={hasError || undefined}
          aria-describedby={opts.error || limitReached || opts.hint ? messageId : undefined}
          inputMode={(opts.inputMode ?? "text") as InputHTMLAttributes<HTMLInputElement>["inputMode"]}
          /* `state-bad` is the error ink of the ramp; `cata-red` is the ACTION
             colour, and as a border it said "press me" on the one field the
             visitor got wrong. The 3px `cata-red/10` halo went with it: a
             translucent red composites to 1.27–1.96:1, which the system already
             retired once as decoration rather than an indicator. The border
             alone is the state, and the shared focus ring marks focus. */
          className={`input-field ${opts.icon ? "pl-10" : ""} ${isPassword ? "pr-10" : ""} ${
            hasError ? "border-state-bad" : ""
          }`}
        />
        {/* Same 24x24 recipe as `/login`'s toggle (WCAG 2.2 SC 2.5.8): the
            icon rides its own step, the padded button around it is what
            clears the target size. */}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-ink-3 transition-colors hover:text-ink"
            aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {showPassword ? (
              <EyeOff size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Eye size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      {hasError ? (
        <FieldErrorMessage id={messageId}>{opts.error}</FieldErrorMessage>
      ) : limitReached && numericMode ? (
        <p
          id={messageId}
          aria-live="polite"
          className="mt-field flex items-center gap-1.5 text-xs font-semibold text-state-warn"
        >
          <AlertTriangle size={ICON.sm} strokeWidth={2} className="shrink-0" aria-hidden="true" />
          {NUMERIC_FIELD_LIMIT_MESSAGE[numericMode]}
        </p>
      ) : opts.hint ? (
        <FieldHintMessage id={messageId}>{opts.hint}</FieldHintMessage>
      ) : null}
    </div>
  );
}

/**
 * Día/Mes/Año guided replacement for the birth-date `<input type="date">`
 * (issue #853): on some mobile browsers the native picker only steps month
 * by month, so entering a birth date a few decades back could take roughly
 * 480 taps — desktop was never affected. The external contract stays the
 * one `WizardInput type="date"` already had: it still emits the ISO
 * `YYYY-MM-DD` string every caller's own validation
 * (`studentBirthDateRule`, `crear-cuenta-utils`, `enroll-utils`) already
 * checks, so those rules keep firing unchanged. An empty, partial, or
 * calendrically impossible date (31/02, 30/02, 29/02 on a non-leap year)
 * emits `""`, the same as an empty native field did.
 *
 * Real-date validation reuses `isValidCalendarDate` rather than a
 * hand-rolled days-in-month table: it already round-trips the value through
 * a component-wise `Date` construction and rejects any mismatch (Feb 31
 * rolls over to Mar 3, which fails the check) — the safe form of the
 * "build a `Date`, then verify it" technique, and the one this codebase's
 * age/validity checks already rely on everywhere else.
 */
export interface BirthDateFieldProps {
  idPrefix: string;
  /** See `WizardInputProps.field`. */
  field?: string;
  label: string;
  /** The ISO `YYYY-MM-DD` value, or `""` — same shape `WizardInput type="date"` used. */
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  required?: boolean;
  icon?: ReactNode;
  /**
   * The same bounds `WizardInput`'s `min`/`max` carried — only shown on the
   * year part as a guide; out-of-range is still reported by the caller's own
   * validation, exactly as before. Nothing here clamps the typed value.
   */
  min?: string;
  max?: string;
  error?: string;
  hint?: string;
  onBlur?: () => void;
}

const BIRTH_DATE_MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * The suffix each of `BirthDateField`'s three controls appends to the
 * field's own id. Exported so a test written against the single native
 * `type="date"` input this replaces can address the exact control that took
 * its place, instead of re-deriving the suffix.
 */
export const BIRTH_DATE_PART_SUFFIX = { day: "dia", month: "mes", year: "anio" } as const;

export function birthDatePartIds(fieldId: string): Record<keyof typeof BIRTH_DATE_PART_SUFFIX, string> {
  return {
    day: `${fieldId}-${BIRTH_DATE_PART_SUFFIX.day}`,
    month: `${fieldId}-${BIRTH_DATE_PART_SUFFIX.month}`,
    year: `${fieldId}-${BIRTH_DATE_PART_SUFFIX.year}`,
  };
}

function splitBirthDateIso(value: string): { day: string; month: string; year: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return { day: "", month: "", year: "" };
  const [, year, month, day] = match;
  return { day, month, year };
}

function joinBirthDateParts(day: string, month: string, year: string): string {
  if (!day || !month || year.length !== 4) return "";
  const iso = `${year}-${month}-${day.padStart(2, "0")}`;
  return isValidCalendarDate(iso) ? iso : "";
}

export function BirthDateField(opts: BirthDateFieldProps): ReactElement {
  const fieldId = `${opts.idPrefix}-${opts.field ?? slugifyLabel(opts.label)}`;
  const messageId = `${fieldId}-message`;
  const partIds = birthDatePartIds(fieldId);
  const hasError = Boolean(opts.error);
  const describedBy = opts.error || opts.hint ? messageId : undefined;

  const initial = splitBirthDateIso(opts.value);
  const [day, setDay] = useState(initial.day);
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);
  const monthRef = useRef<HTMLSelectElement>(null);
  /** What THIS field itself last reported via `onChange` — lets an external
   *  update (a restored draft, a wizard reset) resync the three parts
   *  without the field fighting the echo of its own emitted value. */
  const lastEmitted = useRef(opts.value);

  if (opts.value !== lastEmitted.current) {
    const parts = splitBirthDateIso(opts.value);
    lastEmitted.current = opts.value;
    if (parts.day !== day) setDay(parts.day);
    if (parts.month !== month) setMonth(parts.month);
    if (parts.year !== year) setYear(parts.year);
  }

  function emit(nextDay: string, nextMonth: string, nextYear: string): void {
    const iso = joinBirthDateParts(nextDay, nextMonth, nextYear);
    lastEmitted.current = iso;
    opts.onChange(iso);
  }

  function handleDayChange(raw: string): void {
    const digits = raw.replace(/\D/g, "").slice(0, 2);
    setDay(digits);
    emit(digits, month, year);
    // Never on backspace: this only fires from `onChange`, and deleting
    // back to one digit never reaches length 2, so it never re-triggers.
    if (digits.length === 2) monthRef.current?.focus();
  }

  function handleMonthChange(next: string): void {
    setMonth(next);
    emit(day, next, year);
  }

  function handleYearChange(raw: string): void {
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    setYear(digits);
    emit(day, month, digits);
  }

  return (
    <fieldset
      id={fieldId}
      disabled={opts.disabled}
      aria-required={opts.required || undefined}
      aria-invalid={hasError || undefined}
      aria-describedby={describedBy}
      className="mb-4"
    >
      <legend className="mb-field flex items-center gap-1.5 text-sm font-semibold text-ink">
        {opts.icon}
        {opts.label}
        <RequiredMarker required={opts.required} />
      </legend>
      <div className="grid grid-cols-[4.5rem_1fr_5.5rem] gap-2">
        <div>
          <label htmlFor={partIds.day} className="mb-1 block text-2xs font-semibold text-ink-3">
            Día
          </label>
          <input
            id={partIds.day}
            type="text"
            inputMode="numeric"
            maxLength={2}
            placeholder="DD"
            autoComplete="bday-day"
            value={day}
            onChange={(e) => handleDayChange(e.target.value)}
            onBlur={opts.onBlur}
            className="input-field"
          />
        </div>
        <div>
          <label htmlFor={partIds.month} className="mb-1 block text-2xs font-semibold text-ink-3">
            Mes
          </label>
          <select
            id={partIds.month}
            ref={monthRef}
            autoComplete="bday-month"
            value={month}
            onChange={(e) => handleMonthChange(e.target.value)}
            onBlur={opts.onBlur}
            className="input-field"
          >
            <option value="">Mes</option>
            {BIRTH_DATE_MONTHS.map((name, i) => (
              <option key={name} value={String(i + 1).padStart(2, "0")}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={partIds.year} className="mb-1 block text-2xs font-semibold text-ink-3">
            Año
          </label>
          <input
            id={partIds.year}
            type="text"
            inputMode="numeric"
            maxLength={4}
            placeholder="AAAA"
            autoComplete="bday-year"
            min={opts.min ? opts.min.slice(0, 4) : undefined}
            max={opts.max ? opts.max.slice(0, 4) : undefined}
            value={year}
            onChange={(e) => handleYearChange(e.target.value)}
            onBlur={opts.onBlur}
            className="input-field"
          />
        </div>
      </div>
      {hasError ? (
        <FieldErrorMessage id={messageId}>{opts.error}</FieldErrorMessage>
      ) : opts.hint ? (
        <FieldHintMessage id={messageId}>{opts.hint}</FieldHintMessage>
      ) : null}
    </fieldset>
  );
}

interface WizardTextareaProps {
  idPrefix: string;
  /** See `WizardInputProps.field` — the id token, declared rather than slugged from the label. */
  field?: string;
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
  const fieldId = `${opts.idPrefix}-${opts.field ?? slugifyLabel(opts.label)}`;
  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="mb-field block text-sm font-semibold text-ink">
        {opts.label}
        <RequiredMarker required={opts.required} />
      </label>
      <div className="relative">
        {opts.icon && (
          <span className="pointer-events-none absolute left-3.5 top-3 text-ink-3">
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
export const CEDULA_DIGITS = 10;

/** The cédula field's resting hint — shared with `/student/enroll`'s representative fields, which render their own copy of `PersonIdentityFields`'s cédula input. */
export const CEDULA_HINT = `${CEDULA_DIGITS} dígitos, sin guiones.`;

/** The phone field's hint — shared by both `PersonIdentityFields`, `EmergencyContactFields`, and `/student/enroll`'s representative phone field. Text lives in `identity-validation.ts` (issue #855) so every consumer names the same accepted formats. */
export const PHONE_HINT = PHONE_FORMAT_HINT;

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

/** Nombres/apellidos/fecha de nacimiento/cédula/teléfono + a live "Edad calculada" preview — shared by both wizards, which collect the same person-identity shape for their respective subject (student or dependent). */
export function PersonIdentityFields(props: PersonIdentityFieldsProps): ReactElement {
  const { idPrefix, disabled } = props;
  const errors = props.errors ?? {};
  const age = calculatePersonAge(props.fechaNacimiento);
  const ageValid = !isNaN(age);
  // A calendrically real but implausible year (issue #312 / hallazgo #32 —
  // "1015" typed for "2015") IS `ageValid`: `calculatePersonAge` deliberately
  // never caps a real date (see its own docstring). `agePlausible` is the
  // separate, presentation-only check that decides whether to show the
  // number at all before `studentBirthDateRule`'s own message can appear —
  // that rule only fires on blur, and this preview updates on every keystroke.
  const agePlausible = ageValid && isPlausibleHumanAge(age);
  const cedulaTyped = digitCount(props.cedula);
  const birthDateBounds = studentBirthDateBounds();
  return (
    <>
      <WizardInput
        idPrefix={idPrefix} field="nombres" disabled={disabled} label="Nombres" value={props.nombres}
        onChange={props.onNombresChange} placeholder={example("Juan Carlos")} required
        icon={<User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
        error={errors.nombres} onBlur={() => props.onFieldBlur?.("nombres")} autoComplete="given-name"
        pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={100} minLength={3}
      />
      <WizardInput
        idPrefix={idPrefix} field="apellidos" disabled={disabled} label="Apellidos" value={props.apellidos}
        onChange={props.onApellidosChange} placeholder={example("Rodríguez López")} required
        icon={<User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
        error={errors.apellidos} onBlur={() => props.onFieldBlur?.("apellidos")} autoComplete="family-name"
        pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={100} minLength={3}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <BirthDateField
          idPrefix={idPrefix} field="fecha-nacimiento" disabled={disabled} label="Fecha de nacimiento" value={props.fechaNacimiento}
          onChange={props.onFechaNacimientoChange} required
          icon={<Calendar size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
          min={birthDateBounds.min} max={birthDateBounds.max}
          error={errors.fechaNacimiento} onBlur={() => props.onFieldBlur?.("fechaNacimiento")}
          hint="Día, mes y año de cuatro dígitos (por ejemplo, 15 marzo 2015)."
        />
        <WizardInput
          idPrefix={idPrefix} field="cedula" disabled={disabled} label="Cédula de identidad" value={props.cedula}
          onChange={props.onCedulaChange} placeholder={example("1712345678")} required
          icon={<Hash size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
          pattern="[0-9]{10}" inputMode="numeric" numericMode="cedula"
          error={errors.cedula} onBlur={() => props.onFieldBlur?.("cedula")}
          hint={
            cedulaTyped > 0 && cedulaTyped < CEDULA_DIGITS
              ? `Lleva ${cedulaTyped} de ${CEDULA_DIGITS} dígitos.`
              : CEDULA_HINT
          }
        />
      </div>
      <WizardInput
        idPrefix={idPrefix} field="telefono" disabled={disabled} label="Teléfono" value={props.telefono}
        onChange={props.onTelefonoChange} placeholder={example("0991234567")} required
        icon={<Phone size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
        pattern="[0-9]+" inputMode="tel" numericMode="phone"
        error={errors.telefono} onBlur={() => props.onFieldBlur?.("telefono")}
        hint={PHONE_HINT}
        autoComplete="tel"
      />
      {/* `sunken`, not `canvas`. The surface ladder is canvas → sunken → paper,
          so `canvas` is the field the PAGE stands on; spending it on a recessed
          well INSIDE a paper card inverts the ladder and paints the well darker
          than the page around the card that holds it. */}
      {props.fechaNacimiento && (
        <div className="rounded-ctl bg-sunken p-3 text-xs text-ink-3-strong">
          Edad calculada:{" "}
          <span className="font-semibold text-ink">
            {agePlausible ? `${age} años` : ageValid ? "Revise el año." : "—"}
          </span>
          {agePlausible && props.renderAgeWarning?.(age)}
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
      {/* One first-level step between blocks (`page`, 20px), not the 32px this
          used to write by hand. The wizard carried seven hand-written distances
          and separated the same kind of work with 16px on one step and 32px on
          the next. */}
      <div className="my-page h-px bg-line" />
      <div className="mb-section flex items-center gap-2">
        <Phone size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
        <p className="text-2xs font-bold uppercase text-ink-3">
          Contacto de emergencia
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <WizardInput
          idPrefix={idPrefix} field="contacto-emergencia" disabled={disabled} label="Nombre del contacto" value={props.contacto}
          onChange={props.onContactoChange} placeholder={example("María Rodríguez")} required
          icon={<UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
          error={props.contactoError} onBlur={props.onContactoBlur}
          pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={150} minLength={3}
        />
        <WizardInput
          idPrefix={idPrefix} field="telefono-emergencia" disabled={disabled} label="Teléfono de emergencia" value={props.telefono}
          onChange={props.onTelefonoChange} placeholder={example("0991234567")} required
          icon={<Phone size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
          pattern="[0-9]+" inputMode="tel" numericMode="phone"
          error={props.telefonoError} onBlur={props.onTelefonoBlur}
          hint={PHONE_HINT}
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
  /**
   * INS-2 (docs/product/decisiones-de-negocio-2026-08-11.md §1): when the caller can
   * actually link the already-registered person (today, only
   * `/student/add-dependent`, `audience="representative"`), passing this
   * renders a same-click "Vincular a mi cuenta" action next to the
   * duplicate-identity alert — no extra page, no extra step. The cédula the
   * visitor already typed is the one the caller sends; this component never
   * sees it.
   */
  onLinkExisting?: () => void;
  /** Disables the link-existing button and swaps its label while the request is in flight. */
  linkingExisting?: boolean;
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
  /**
   * Whether `submitButton` is currently disabled — the caller owns that
   * condition (it may depend on more than field validity, e.g. a
   * confirmation checkbox), so it is repeated here rather than re-derived.
   */
  submitBlocked?: boolean;
  /**
   * Why `submitButton` is blocked, shown under it exactly the way
   * `nextBlockedReason` already is (#312 / hallazgo #2): the wizard's own
   * "Siguiente" names what is missing on steps 2-4, and the final step's
   * button was the one place that stayed silent.
   */
  submitBlockedReason?: string;
}

/**
 * Why a disabled `Button` is disabled, printed right under it.
 *
 * `text-xs text-ink-3` (12.5px, the same grey as "10 dígitos, sin guiones.")
 * used to carry this line too — hallazgo #10: the one sentence that tells the
 * visitor how to get unstuck read as the LEAST important text on the screen.
 * `text-base` (15px, the ramp's own body-copy step — see tailwind.config.ts)
 * is the closest documented size to the audit's "16px o más" ask; a bespoke
 * `text-[16px]` would clear that ask by one pixel but break the type ramp for
 * a single line, which this system treats as load-bearing everywhere else.
 * `text-cata-red-dark` clears 7.74:1 on `paper` and 7.05:1 on `sunken` (AAA),
 * well past the audit's 7:1 floor and the reason it is not `state-bad`
 * (4.84:1 on `canvas`, under that floor).
 */
const BLOCKED_REASON_CLASSES = "max-w-xs text-right text-base font-semibold text-cata-red-dark";

/** Validation-errors alert + Atrás/Siguiente navigation chrome — shared by both wizards' step footer. The final step renders `submitButton` instead of "Siguiente". */
export function WizardNavigation(props: WizardNavigationProps): ReactElement {
  const duplicateHelpAudience =
    props.duplicateIdentityAudience !== undefined && props.formErrors.some(isDuplicateIdentityError)
      ? props.duplicateIdentityAudience
      : null;
  return (
    <>
      {props.formErrors.length > 0 && (
        <div className="alert-error mt-section items-start" role="alert">
          <AlertTriangle size={ICON.sm} strokeWidth={1.5} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="space-y-2">
            <ul className="list-inside list-disc space-y-1">
              {props.formErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
            {duplicateHelpAudience && <DuplicateIdentityHelp audience={duplicateHelpAudience} />}
            {/* INS-2 only reaches a REPRESENTANTE's own account — this check
                is a defense-in-depth belt, not just trusting the caller: even
                if `onLinkExisting` were mistakenly wired into the public
                self-service wizard, this button must not appear there. */}
            {duplicateHelpAudience === "representative" && props.onLinkExisting && (
              <button
                type="button"
                onClick={props.onLinkExisting}
                disabled={props.linkingExisting || props.submitting}
                className={buttonClasses("secondary", "sm", "disabled:cursor-not-allowed")}
              >
                {props.linkingExisting ? "Vinculando…" : "Vincular a mi cuenta"}
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-page flex items-start justify-between gap-3">
        <div>
          {!props.isFirst && (
            <Button variant="tertiary" onClick={props.onBack} disabled={props.submitting}>
              <ChevronLeft size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Atrás
            </Button>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5">
          {!props.isLast ? (
            <>
              <Button variant="primary" onClick={props.onNext} disabled={props.nextDisabled}>
                Siguiente
                <ChevronRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              </Button>
              {props.nextDisabled && props.nextBlockedReason && (
                <p className={BLOCKED_REASON_CLASSES}>{props.nextBlockedReason}</p>
              )}
            </>
          ) : (
            <>
              {props.submitButton}
              {props.submitBlocked && props.submitBlockedReason && (
                <p className={BLOCKED_REASON_CLASSES}>{props.submitBlockedReason}</p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
