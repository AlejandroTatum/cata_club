/**
 * Shared field-render helpers for the multi-step wizards (`/student/enroll`,
 * `/student/add-dependent`) — extracted to avoid duplicating id-slugging and
 * input/textarea markup across both.
 */

import type { InputHTMLAttributes, KeyboardEvent, ClipboardEvent, ReactElement, ReactNode } from "react";
import { useState } from "react";
import { User, Calendar, Hash, Phone, UserPlus, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { calculatePersonAge, isPlausibleHumanAge, studentBirthDateBounds } from "@/lib/identity-validation";
import { Button, buttonClasses } from "@/components/ui";
import { DuplicateIdentityHelp, type DuplicateIdentityAudience } from "@/components/DuplicateIdentityHelp";
import { isDuplicateIdentityError } from "@/lib/duplicate-identity";
import {
  capDigits,
  filterNumericInput,
  isAllowedChar,
  NUMERIC_FIELD_MAX_DIGITS,
  type NumericFieldMode,
} from "@/lib/numeric-input";

/** `WizardInput`'s digit-cap warning — see numeric-input.ts for why the cap itself never strips a letter, only digits past the limit. */
const LIMIT_REACHED_MESSAGE = "Alcanzó el máximo de 10 dígitos; no se ingresó el último carácter.";

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

export function WizardInput(opts: WizardInputProps): ReactElement {
  const fieldId = `${opts.idPrefix}-${opts.field ?? slugifyLabel(opts.label)}`;
  const messageId = `${fieldId}-message`;
  const hasError = Boolean(opts.error);
  const { numericMode } = opts;
  const [limitReached, setLimitReached] = useState(false);

  /**
   * The `onChange` backstop: applies ONLY the digit cap, never a letter
   * filter. It runs for every value change, including one `keydown`/`paste`
   * never see — browser autofill, IME composition, or a test harness
   * setting `.value` directly — so the cap holds everywhere. It does not
   * strip letters on purpose: `enroll-qa.spec.ts`'s V01 relies on a
   * one-shot value assignment (Playwright's `.fill()`) still reaching
   * validation with its letters intact, so the character-class error fires
   * from the validation layer instead of a field that already erased the
   * evidence. A typed or pasted letter never reaches this path in the first
   * place — `handleKeyDown`/`handlePaste` reject it before `onChange` fires.
   */
  function handleChange(raw: string): void {
    if (!numericMode) {
      opts.onChange(raw);
      return;
    }
    const result = capDigits(numericMode, raw);
    setLimitReached(result.limitReached);
    opts.onChange(result.value);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (!numericMode) return;
    // Modifier combos (Ctrl+V, Cmd+A…) and non-printable keys (Backspace,
    // Tab, arrows…) are never in the way — only a single printable
    // character can be a disallowed letter or an over-the-cap digit.
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (!isAllowedChar(numericMode, e.key)) {
      e.preventDefault();
      return;
    }
    if (!/[0-9]/.test(e.key)) return; // an allowed separator — no cap concern
    const input = e.currentTarget;
    const replacesSelection = (input.selectionEnd ?? 0) > (input.selectionStart ?? 0);
    if (replacesSelection) return; // replacing a selected digit never grows the count
    if (digitCount(input.value) >= NUMERIC_FIELD_MAX_DIGITS[numericMode]) {
      e.preventDefault();
      setLimitReached(true);
    }
  }

  /**
   * Paste gets the full treatment (`filterNumericInput`: strip disallowed
   * characters, then cap) in one pass, computed against what the field's
   * value would become at the current cursor/selection — not just appended
   * blindly to the end.
   */
  function handlePaste(e: ClipboardEvent<HTMLInputElement>): void {
    if (!numericMode) return;
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    const input = e.currentTarget;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;
    const nextRaw = input.value.slice(0, start) + pasted + input.value.slice(end);
    const result = filterNumericInput(numericMode, nextRaw);
    setLimitReached(result.limitReached);
    opts.onChange(result.value);
  }

  return (
    <div className="mb-4">
      <label htmlFor={fieldId} className="mb-field block text-sm font-semibold text-ink">
        {opts.label}
        {!opts.required && <span className="ml-1 font-normal text-ink-3">{OPTIONAL_MARKER}</span>}
      </label>
      <div className="relative">
        {opts.icon && (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3">
            {opts.icon}
          </span>
        )}
        <input
          id={fieldId}
          type={opts.type ?? "text"}
          value={opts.value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={opts.onBlur}
          placeholder={opts.placeholder}
          required={opts.required}
          disabled={opts.disabled}
          pattern={opts.pattern}
          maxLength={opts.maxLength}
          minLength={opts.minLength}
          min={opts.min}
          max={opts.max}
          aria-invalid={hasError || undefined}
          aria-describedby={opts.error || limitReached || opts.hint ? messageId : undefined}
          inputMode={(opts.inputMode ?? "text") as InputHTMLAttributes<HTMLInputElement>["inputMode"]}
          /* `state-bad` is the error ink of the ramp; `cata-red` is the ACTION
             colour, and as a border it said "press me" on the one field the
             visitor got wrong. The 3px `cata-red/10` halo went with it: a
             translucent red composites to 1.27–1.96:1, which the system already
             retired once as decoration rather than an indicator. The border
             alone is the state, and the shared focus ring marks focus. */
          className={`input-field ${opts.icon ? "pl-10" : ""} ${
            hasError ? "border-state-bad" : ""
          }`}
        />
      </div>
      {hasError ? (
        <p id={messageId} className="mt-field flex items-center gap-1.5 text-xs font-semibold text-state-bad">
          <AlertTriangle size={ICON.sm} strokeWidth={2} className="shrink-0" aria-hidden="true" />
          {opts.error}
        </p>
      ) : limitReached ? (
        <p
          id={messageId}
          aria-live="polite"
          className="mt-field flex items-center gap-1.5 text-xs font-semibold text-state-warn"
        >
          <AlertTriangle size={ICON.sm} strokeWidth={2} className="shrink-0" aria-hidden="true" />
          {LIMIT_REACHED_MESSAGE}
        </p>
      ) : opts.hint ? (
        <p id={messageId} className="mt-field text-xs text-ink-3">
          {opts.hint}
        </p>
      ) : null}
    </div>
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
        {!opts.required && <span className="ml-1 font-normal text-ink-3">{OPTIONAL_MARKER}</span>}
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

/** The phone field's hint — shared by both `PersonIdentityFields`, `EmergencyContactFields`, and `/student/enroll`'s representative phone field. */
export const PHONE_HINT = "Celular: 09 y 8 dígitos más. Fijo: 0, código de área y 7 dígitos.";

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
        error={errors.nombres} onBlur={() => props.onFieldBlur?.("nombres")}
        pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={100} minLength={3}
      />
      <WizardInput
        idPrefix={idPrefix} field="apellidos" disabled={disabled} label="Apellidos" value={props.apellidos}
        onChange={props.onApellidosChange} placeholder={example("Rodríguez López")} required
        icon={<User size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
        error={errors.apellidos} onBlur={() => props.onFieldBlur?.("apellidos")}
        pattern="[A-Za-z\u00C0-\u024F\s]+" maxLength={100} minLength={3}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <WizardInput
          idPrefix={idPrefix} field="fecha-nacimiento" disabled={disabled} label="Fecha de nacimiento" value={props.fechaNacimiento}
          onChange={props.onFechaNacimientoChange} type="date" required
          icon={<Calendar size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />}
          min={birthDateBounds.min} max={birthDateBounds.max}
          error={errors.fechaNacimiento} onBlur={() => props.onFieldBlur?.("fechaNacimiento")}
          hint="Año completo, de 4 dígitos (por ejemplo, 2015)."
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
