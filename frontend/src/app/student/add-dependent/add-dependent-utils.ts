/**
 * Pure utility functions for the authenticated "Add Dependent" wizard.
 *
 * A short, 3-step counterpart to `enroll-utils.ts` (child data → medical
 * record → summary/confirm) for a representante already logged into the
 * portal — no account/credentials step, since no new `Usuario` is created.
 *
 * Extracted for testability — no React dependencies.
 */

import type { RepresentadoCreatePayload } from "@/services/api";
import type { TipoSangre } from "@/types/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Wizard step identifiers — 3 steps only (not the public 5-step enroll flow). */
export type AddDependentStep = "child" | "health" | "summary";

/** Step order used by the wizard. */
export const ADD_DEPENDENT_STEP_ORDER: AddDependentStep[] = ["child", "health", "summary"];

/** Human-readable labels for each step, in Spanish. */
export const ADD_DEPENDENT_STEP_LABELS: Record<AddDependentStep, string> = {
  child: "Datos del Dependiente",
  health: "Ficha Médica",
  summary: "Resumen y Confirmación",
};

/**
 * One-word names for the stepper pills — the same named-stepper contract the
 * public wizard uses (`STEP_SHORT_LABELS` in enroll-utils.ts). This flow has
 * three steps, not five, because it creates neither a `Usuario` nor a
 * representante: the caller is already both.
 */
export const ADD_DEPENDENT_SHORT_LABELS: Record<AddDependentStep, string> = {
  child: "Estudiante",
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
    case "health":
      return validateHealthData(data);
    case "summary":
      return [];
  }
}

/** Validate the whole form at once (all steps) — used before final submit. */
export function validateAddDependentForm(data: AddDependentFormData): string[] {
  return [...validateChildData(data), ...validateHealthData(data)];
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

const FIELD_RULES: Partial<Record<AddDependentField, (d: AddDependentFormData) => string | null>> = {
  nombres: (d) => (d.nombres.trim() ? null : "Los nombres son obligatorios."),
  apellidos: (d) => (d.apellidos.trim() ? null : "Los apellidos son obligatorios."),
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
  telefono: (d) => {
    if (!d.telefono.trim()) return "El teléfono es obligatorio.";
    return digitsOf(d.telefono).length === 10 ? null : "El teléfono debe tener 10 dígitos.";
  },
  tipoSangre: (d) => (isTipoSangre(d.tipoSangre) ? null : "El tipo de sangre es obligatorio."),
  contactoEmergencia: (d) =>
    d.contactoEmergencia.trim() ? null : "El nombre de contacto de emergencia es obligatorio.",
  telefonoEmergencia: (d) => {
    if (!d.telefonoEmergencia.trim()) return "El teléfono de emergencia es obligatorio.";
    return digitsOf(d.telefonoEmergencia).length === 10
      ? null
      : "El teléfono de emergencia debe tener 10 dígitos.";
  },
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
 */
export function buildRepresentadoPayload(data: AddDependentFormData): RepresentadoCreatePayload {
  return {
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
}
