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

function validateChildData(data: AddDependentFormData): string[] {
  const errors: string[] = [];
  if (!data.nombres.trim()) errors.push("Los nombres son obligatorios.");
  else if (data.nombres.trim().length < 3) errors.push("Los nombres deben tener al menos 3 caracteres.");
  else if (!/^[A-Za-z\u00C0-\u024F\s]+$/.test(data.nombres.trim())) errors.push("Los nombres solo pueden contener letras y espacios.");
  if (!data.apellidos.trim()) errors.push("Los apellidos son obligatorios.");
  else if (data.apellidos.trim().length < 3) errors.push("Los apellidos deben tener al menos 3 caracteres.");
  else if (!/^[A-Za-z\u00C0-\u024F\s]+$/.test(data.apellidos.trim())) errors.push("Los apellidos solo pueden contener letras y espacios.");
  if (!data.fechaNacimiento) errors.push("La fecha de nacimiento es obligatoria.");
  else if (!isValidDate(data.fechaNacimiento)) errors.push("La fecha de nacimiento ingresada no es válida.");
  else if (isFutureDate(data.fechaNacimiento)) errors.push("La fecha de nacimiento no puede ser en el futuro.");
  if (!data.cedula.trim()) errors.push("La cédula de identidad es obligatoria.");
  else if (!/^\d{10}$/.test(data.cedula.trim())) errors.push("La cédula debe tener 10 dígitos.");
  if (!data.telefono.trim()) errors.push("El teléfono es obligatorio.");
  else if (!/^\d{7,10}$/.test(data.telefono.trim())) errors.push("El teléfono debe tener entre 7 y 10 dígitos.");
  return errors;
}

/**
 * Validate credentials: optional, but if either `correo` or `contrasenia`
 * is provided, BOTH must be present and valid.
 */
function validateCredentialsData(data: AddDependentFormData): string[] {
  const errors: string[] = [];
  const hasCorreo = data.correo.trim().length > 0;
  const hasContrasenia = data.contrasenia.length > 0;

  if (hasCorreo || hasContrasenia) {
    if (!hasCorreo) errors.push("El correo electrónico es obligatorio si se desea crear una cuenta.");
    else if (!isEmail(data.correo)) errors.push("El correo electrónico no es válido.");
    if (!hasContrasenia) errors.push("La contraseña es obligatoria si se desea crear una cuenta.");
    else if (data.contrasenia.length < 8) errors.push("La contraseña debe tener al menos 8 caracteres.");
  }
  return errors;
}

function validateHealthData(data: AddDependentFormData): string[] {
  const errors: string[] = [];
  if (!isTipoSangre(data.tipoSangre)) errors.push("El tipo de sangre es obligatorio.");
  if (!data.contactoEmergencia.trim())
    errors.push("El nombre de contacto de emergencia es obligatorio.");
  else if (data.contactoEmergencia.trim().length < 3)
    errors.push("El nombre del contacto de emergencia debe tener al menos 3 caracteres.");
  if (!data.telefonoEmergencia.trim())
    errors.push("El teléfono de emergencia es obligatorio.");
  else if (!/^\d{7,10}$/.test(data.telefonoEmergencia.trim()))
    errors.push("El teléfono de emergencia debe tener entre 7 y 10 dígitos.");
  return errors;
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
