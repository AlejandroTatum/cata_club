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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Wizard step identifiers — 4 steps (child, credentials, health, summary). */
export type AddDependentStep = "child" | "credentials" | "health" | "summary";

/** Step order used by the wizard. */
export const ADD_DEPENDENT_STEP_ORDER: AddDependentStep[] = ["child", "credentials", "health", "summary"];

/** Human-readable labels for each step, in Spanish. */
export const ADD_DEPENDENT_STEP_LABELS: Record<AddDependentStep, string> = {
  child: "Datos del Dependiente",
  credentials: "Cuenta de Acceso (Opcional)",
  health: "Ficha Médica",
  summary: "Resumen y Confirmación",
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

/** Field → its first unmet rule. A field with no entry is currently valid. */
export type AddDependentFieldErrors = Partial<Record<AddDependentField, string>>;

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/** Letters (incl. accents) and spaces — a person's name, not an identifier. */
const NAME_PATTERN = /^[A-Za-z\u00C0-\u024F\s]+$/;

function nameRule(value: string, subject: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${subject} son obligatorios.`;
  if (trimmed.length < 3) return `${subject} deben tener al menos 3 caracteres.`;
  return NAME_PATTERN.test(trimmed) ? null : `${subject} solo pueden contener letras y espacios.`;
}

/** Ecuadorian numbers run 7 (landline) to 10 (mobile) digits. */
function phoneRule(value: string, subject: string): string | null {
  if (!value.trim()) return `${subject} es obligatorio.`;
  const digits = digitsOf(value);
  return digits.length >= 7 && digits.length <= 10
    ? null
    : `${subject} debe tener entre 7 y 10 dígitos.`;
}

const FIELD_RULES: Partial<Record<AddDependentField, (d: AddDependentFormData) => string | null>> = {
  nombres: (d) => nameRule(d.nombres, "Los nombres"),
  apellidos: (d) => nameRule(d.apellidos, "Los apellidos"),
  fechaNacimiento: (d) => {
    if (!d.fechaNacimiento) return "La fecha de nacimiento es obligatoria.";
    if (!isValidDate(d.fechaNacimiento)) return "La fecha de nacimiento ingresada no es válida.";
    if (isFutureDate(d.fechaNacimiento)) return "La fecha de nacimiento no puede ser en el futuro.";
    return null;
  },
  cedula: (d) => {
    if (!d.cedula.trim()) return "La cédula de identidad es obligatoria.";
    return /^\d{10}$/.test(d.cedula.trim()) ? null : "La cédula debe tener 10 dígitos.";
  },
  telefono: (d) => phoneRule(d.telefono, "El teléfono"),
  tipoSangre: (d) => (isTipoSangre(d.tipoSangre) ? null : "El tipo de sangre es obligatorio."),
  contactoEmergencia: (d) => {
    const trimmed = d.contactoEmergencia.trim();
    if (!trimmed) return "El nombre de contacto de emergencia es obligatorio.";
    return trimmed.length >= 3
      ? null
      : "El nombre del contacto de emergencia debe tener al menos 3 caracteres.";
  },
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
      if (!hasContrasenia) errors.contrasenia = "La contraseña es obligatoria si se desea crear una cuenta.";
      else if (data.contrasenia.length < 8) errors.contrasenia = "La contraseña debe tener al menos 8 caracteres.";
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

function isValidDate(value: string): boolean {
  if (!value) return false;
  const parts = value.split("-");
  if (parts.length !== 3) return false;
  const [year, month, day] = parts.map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

/** `value` is a valid "YYYY-MM-DD" already — compares by local calendar date, not UTC, to avoid off-by-one near midnight. */
function isFutureDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed > today;
}

export function getAddDependentErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as Record<string, unknown>).status;
    // 400 = a domain business-rule violation (see backend's EntidadDuplicada/
    // OperacionInvalida — e.g. "Ya existe una persona con la cédula ...").
    // Those always carry a single clean, user-facing Spanish message, so
    // surface it instead of a generic string that hides which field was
    // wrong (previously always replaced, even for a duplicate cédula).
    if (status === 400) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message.trim();
    }
    // 422 = raw FastAPI/pydantic validation errors (a list of field/loc/msg
    // objects, not a single string) — not safe to show verbatim.
    if (status === 400 || status === 422) {
      return "No se pudo agregar el dependiente. Revise los datos ingresados e intente nuevamente.";
    }
    if (status === 403) {
      return "No tiene permisos para agregar un dependiente.";
    }
  }
  return "No se pudo agregar el dependiente. Intente nuevamente más tarde.";
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
