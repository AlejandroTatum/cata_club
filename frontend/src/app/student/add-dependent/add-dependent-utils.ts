/**
 * Pure utility functions for the authenticated "Add Dependent" wizard.
 *
 * 4-step wizard (child data → credentials → medical record → summary/confirm)
 * for a representante already logged into the portal. If the representative
 * provides credentials for the minor, a Usuario with rol ALUMNO is also
 * created (Option B: minors with own account).
 *
 * Extracted for testability — no React dependencies.
 */

import type { RepresentadoCreatePayload } from "@/services/api";
import type { TipoSangre } from "@/types/domain";
import { toUserMessage } from "@/lib/error-message";
import {
  cedulaRule,
  phoneRule,
  personNameRule,
  passwordRule,
  studentBirthDateRule,
} from "@/lib/identity-validation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Wizard step identifiers — 4 steps (child, credentials, health, summary). */
export type AddDependentStep = "child" | "credentials" | "health" | "summary";

/** Step order used by the wizard. */
export const ADD_DEPENDENT_STEP_ORDER: AddDependentStep[] = ["child", "credentials", "health", "summary"];

/** Human-readable labels for each step, in Spanish. */
/**
 * Sentence case, and the same words the public wizard uses for the same step.
 *
 * These were Title Case ("Datos del Dependiente") on a screen whose every
 * other label is sentence case, and "Ficha Médica" was a second name for the
 * step `STEP_LABELS` (enroll-utils.ts) calls "Salud y emergencia" — the same
 * four questions, asked of the same person, under two names. The parenthetical
 * "(Opcional)" went too: the two fields inside the step already carry
 * `(opcional)` from `wizard-fields.tsx`, and a title that repeats a mark the
 * fields make is the mark said twice.
 */
export const ADD_DEPENDENT_STEP_LABELS: Record<AddDependentStep, string> = {
  child: "Datos del dependiente",
  credentials: "Cuenta de acceso",
  health: "Salud y emergencia",
  summary: "Resumen y confirmación",
};

/**
 * One-word names for the stepper pills — the same named-stepper contract the
 * public wizard uses (`STEP_SHORT_LABELS` in enroll-utils.ts). This flow has
 * four steps, not five, because it creates no representante: the caller
 * already is one. The `Usuario` it may create is optional.
 */
export const ADD_DEPENDENT_SHORT_LABELS: Record<AddDependentStep, string> = {
  child: "Estudiante",
  credentials: "Cuenta",
  health: "Salud",
  summary: "Confirmar",
};

/** Shape of the add-dependent wizard form data. */
export interface AddDependentFormData {
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  cedula: string;
  telefono: string;
  correo: string;
  contrasenia: string;
  institucionId: string;
  tipoSangre: TipoSangre | "";
  /** Raw comma-separated input — parsed into a string[] by `buildRepresentadoPayload`. */
  enfermedades: string;
  alergias: string;
  contactoEmergencia: string;
  telefonoEmergencia: string;
}

/** Default empty form data. */
export const initialAddDependentFormData: AddDependentFormData = {
  nombres: "",
  apellidos: "",
  fechaNacimiento: "",
  cedula: "",
  telefono: "",
  correo: "",
  contrasenia: "",
  institucionId: "",
  tipoSangre: "",
  enfermedades: "",
  alergias: "",
  contactoEmergencia: "",
  telefonoEmergencia: "",
};

const TIPO_SANGRE_VALUES: TipoSangre[] = [
  "A_POSITIVO",
  "A_NEGATIVO",
  "B_POSITIVO",
  "B_NEGATIVO",
  "AB_POSITIVO",
  "AB_NEGATIVO",
  "O_POSITIVO",
  "O_NEGATIVO",
  "DESCONOCIDO",
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a wizard step's form data and return error messages.
 *
 * Pure function — no React dependencies, fully testable.
 *
 * @param step — The current wizard step identifier.
 * @param data — The current add-dependent form data.
 * @returns A list of error message strings (empty = valid).
 */
export function validateAddDependentStep(
  step: AddDependentStep,
  data: AddDependentFormData,
): string[] {
  switch (step) {
    case "child":
      return validateChildData(data);
    case "credentials":
      return validateCredentialsData(data);
    case "health":
      return validateHealthData(data);
    case "summary":
      return [];
  }
}

/** Validate the whole form at once (all steps) — used before final submit. */
export function validateAddDependentForm(data: AddDependentFormData): string[] {
  return [...validateChildData(data), ...validateCredentialsData(data), ...validateHealthData(data)];
}

// ---------------------------------------------------------------------------
// Per-field validation — same contract as the public wizard: the message goes
// BESIDE the field, and "Siguiente" stays shut until the step is clean.
// ---------------------------------------------------------------------------

/** A form field this wizard can point an error at. */
export type AddDependentField = keyof AddDependentFormData;

/**
 * The DOM id of each field, declared once and derived from the field NAME —
 * never from the label the visitor reads.
 *
 * This is `ENROLL_FIELD_TOKEN`'s twin (`enroll-utils.ts`), and it is here for
 * the same reason: `WizardInput` falls back to slugifying the label text when
 * no `field` is passed, and this wizard passed none for its two textareas
 * while writing its two `<select>` ids by hand to match what that slugifier
 * would have produced. So the visible copy was the id in three places and a
 * hand-kept copy of the id in two more — "Tipo de Sangre" is what made the
 * blood-type select `#add-dependent-tipo-de-sangre` while the identical field
 * on the public wizard is `#add-dependent-tipo-sangre`'s sibling
 * `#enroll-tipo-sangre`. Two names for one field, produced by two spellings
 * of one label.
 *
 * The tokens are deliberately the SAME strings the public wizard uses: the two
 * flows collect the same person, and a field that means the same thing should
 * not be addressed two ways because it is on another screen.
 *
 * `institucionId` names a `<select>` the page renders itself rather than a
 * `WizardInput`, and it stays in the table so this remains a total function of
 * `AddDependentField`: a new form field cannot be added without answering
 * "what is its id" here first.
 */
export const ADD_DEPENDENT_FIELD_TOKEN: Record<AddDependentField, string> = {
  nombres: "nombres",
  apellidos: "apellidos",
  fechaNacimiento: "fecha-nacimiento",
  cedula: "cedula",
  telefono: "telefono",
  correo: "correo",
  contrasenia: "contrasenia",
  institucionId: "institucion",
  tipoSangre: "tipo-sangre",
  enfermedades: "enfermedades",
  alergias: "alergias",
  contactoEmergencia: "contacto-emergencia",
  telefonoEmergencia: "telefono-emergencia",
};

/** The id prefix every field on this wizard shares. */
export const ADD_DEPENDENT_ID_PREFIX = "add-dependent";

/** The full DOM id of a field — what a test, a `<label for>` and a deep link all address. */
export function addDependentFieldId(field: AddDependentField): string {
  return `${ADD_DEPENDENT_ID_PREFIX}-${ADD_DEPENDENT_FIELD_TOKEN[field]}`;
}

/**
 * The id of the school-TYPE filter.
 *
 * Declared beside the tokens but deliberately outside the table: it narrows
 * the institution catalogue and never reaches the payload, so it is not a
 * field of `AddDependentFormData` and must not be added to a map that has to
 * stay total over one.
 */
export const ADD_DEPENDENT_SCHOOL_TYPE_ID = `${ADD_DEPENDENT_ID_PREFIX}-tipo-escuela`;

/** Field → its first unmet rule. A field with no entry is currently valid. */
export type AddDependentFieldErrors = Partial<Record<AddDependentField, string>>;

const FIELD_RULES: Partial<Record<AddDependentField, (d: AddDependentFormData) => string | null>> = {
  nombres: (d) => personNameRule(d.nombres, "Los nombres"),
  apellidos: (d) => personNameRule(d.apellidos, "Los apellidos"),
  fechaNacimiento: (d) => studentBirthDateRule(d.fechaNacimiento),
  cedula: (d) => cedulaRule(d.cedula, "La cédula de identidad"),
  telefono: (d) => phoneRule(d.telefono, "El teléfono"),
  tipoSangre: (d) => (isTipoSangre(d.tipoSangre) ? null : "El tipo de sangre es obligatorio."),
  contactoEmergencia: (d) =>
    personNameRule(d.contactoEmergencia, "El nombre del contacto de emergencia", { plural: false }),
  telefonoEmergencia: (d) => phoneRule(d.telefonoEmergencia, "El teléfono de emergencia"),
};

const CHILD_FIELDS: AddDependentField[] = [
  "nombres",
  "apellidos",
  "fechaNacimiento",
  "cedula",
  "telefono",
];

const HEALTH_FIELDS: AddDependentField[] = ["tipoSangre", "contactoEmergencia", "telefonoEmergencia"];

/** The fields a given step actually renders. */
export function fieldsForAddDependentStep(step: AddDependentStep): AddDependentField[] {
  switch (step) {
    case "child":
      return CHILD_FIELDS;
    case "credentials":
      // Both fields are optional, so neither is ever "missing". The
      // both-or-neither rule is applied by `validateAddDependentFields`.
      return [];
    case "health":
      return HEALTH_FIELDS;
    case "summary":
      return [];
  }
}

/** Every unmet rule on the current step, keyed by the field that owns it. */
export function validateAddDependentFields(
  step: AddDependentStep,
  data: AddDependentFormData,
): AddDependentFieldErrors {
  const errors: AddDependentFieldErrors = {};
  for (const field of fieldsForAddDependentStep(step)) {
    const message = FIELD_RULES[field]?.(data) ?? null;
    if (message !== null) errors[field] = message;
  }
  // An optional account is all-or-nothing: half-filled credentials block the
  // step, and the message has to land on the field that is actually wrong.
  if (step === "credentials") {
    const hasCorreo = data.correo.trim().length > 0;
    const hasContrasenia = data.contrasenia.length > 0;
    if (hasCorreo || hasContrasenia) {
      if (!hasCorreo) errors.correo = "El correo electrónico es obligatorio si se desea crear una cuenta.";
      else if (!isEmail(data.correo)) errors.correo = "El correo electrónico no es válido.";
      if (!hasContrasenia) {
        errors.contrasenia = "La contraseña es obligatoria si se desea crear una cuenta.";
      } else {
        const passwordError = passwordRule(data.contrasenia, "La contraseña");
        if (passwordError) errors.contrasenia = passwordError;
      }
    }
  }
  return errors;
}

/** Whether the step's "Siguiente" may be enabled. */
export function isAddDependentStepComplete(
  step: AddDependentStep,
  data: AddDependentFormData,
): boolean {
  return Object.keys(validateAddDependentFields(step, data)).length === 0;
}

const FIELD_LABELS: Partial<Record<AddDependentField, string>> = {
  nombres: "Nombres",
  apellidos: "Apellidos",
  fechaNacimiento: "Fecha de nacimiento",
  cedula: "Cédula de identidad",
  telefono: "Teléfono",
  correo: "Correo electrónico",
  contrasenia: "Contraseña",
  tipoSangre: "Tipo de sangre",
  contactoEmergencia: "Nombre del contacto de emergencia",
  telefonoEmergencia: "Teléfono de emergencia",
};

/** Why "Siguiente" is disabled, in one sentence naming the fields. `null` when nothing is missing. */
export function describeAddDependentBlocker(errors: AddDependentFieldErrors): string | null {
  const labels = (Object.keys(errors) as AddDependentField[])
    .map((field) => FIELD_LABELS[field])
    .filter((label): label is string => Boolean(label));
  if (labels.length === 0) return null;
  if (labels.length === 1) return `Para continuar, revise: ${labels[0]}.`;
  const last = labels[labels.length - 1];
  return `Para continuar, revise: ${labels.slice(0, -1).join(", ")} y ${last}.`;
}

/**
 * Validate credentials: optional, but if either `correo` or `contrasenia`
 * is provided, BOTH must be present and valid.
 *
 * Composed from `validateAddDependentFields` so the flat list and the
 * beside-the-field message can never drift apart.
 */
function validateCredentialsData(data: AddDependentFormData): string[] {
  return Object.values(validateAddDependentFields("credentials", data));
}

function collect(fields: AddDependentField[], data: AddDependentFormData): string[] {
  return fields
    .map((field) => FIELD_RULES[field]?.(data) ?? null)
    .filter((message): message is string => message !== null);
}

function validateChildData(data: AddDependentFormData): string[] {
  return collect(CHILD_FIELDS, data);
}

function validateHealthData(data: AddDependentFormData): string[] {
  return collect(HEALTH_FIELDS, data);
}

function isTipoSangre(value: string): value is TipoSangre {
  return TIPO_SANGRE_VALUES.includes(value as TipoSangre);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * The observation this used to encode by hand — that a 400 carries a clean
 * Spanish sentence worth showing ("Ya existe una persona con la cédula …")
 * while a 422 carries a raw pydantic payload that is not safe verbatim — was
 * right, and it is exactly the argument the translator now makes for the whole
 * product. The difference is that the translator decides by INSPECTING the
 * text, so a 422 that happens to carry a clean sentence is no longer thrown
 * away and a 400 that leaks a column name is no longer shown.
 */
export function getAddDependentErrorMessage(error: unknown): string {
  return toUserMessage(error, "No se pudo agregar el dependiente. Revise los datos ingresados e intente nuevamente.");
}

/**
 * Same translator, different fallback — for the "Vincular a mi cuenta"
 * action (INS-2). The backend's real message
 * (`MENSAJE_VINCULACION_NO_DISPONIBLE`) is user-facing text and reaches the
 * caller as-is via `toUserMessage`; this fallback only fires for a network
 * failure or an unexpected shape, never to replace the backend's answer.
 */
export function getLinkExistingErrorMessage(error: unknown): string {
  return toUserMessage(error, "No se pudo vincular esa cédula a su cuenta. Intente nuevamente.");
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/** Parse the raw comma-separated `enfermedades` input into a trimmed, non-empty string[]. */
function parseEnfermedades(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Build the `RepresentadoCreatePayload` sent to `crearRepresentado`, matching
 * the backend's `RepresentadoCreateDTO` shape (camelCase here — the BFF
 * route converts to snake_case before calling FastAPI).
 *
 * If the user provided optional `correo` + `contrasenia`, they are included
 * in the payload so the backend also creates a `Usuario` with rol ALUMNO.
 */
export function buildRepresentadoPayload(data: AddDependentFormData): RepresentadoCreatePayload {
  const payload: RepresentadoCreatePayload = {
    nombres: data.nombres.trim(),
    apellidos: data.apellidos.trim(),
    cedula: data.cedula.trim(),
    fechaNacimiento: data.fechaNacimiento,
    telefono: data.telefono.trim(),
    fichaMedica: {
      tipoSangre: data.tipoSangre as TipoSangre,
      enfermedades: parseEnfermedades(data.enfermedades),
      ...(data.alergias.trim() ? { alergias: data.alergias.trim() } : {}),
      ...(data.contactoEmergencia.trim() ? { contactoEmergencia: data.contactoEmergencia.trim() } : {}),
      ...(data.telefonoEmergencia.trim() ? { telefonoEmergencia: data.telefonoEmergencia.trim() } : {}),
    },
  };
  if (data.correo.trim() && data.contrasenia) {
    payload.correo = data.correo.trim();
    payload.contrasenia = data.contrasenia;
  }
  if (data.institucionId) {
    payload.institucionId = Number(data.institucionId);
  }
  return payload;
}
