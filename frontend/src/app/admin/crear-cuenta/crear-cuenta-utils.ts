import { toUserMessage } from "@/lib/error-message";
import { calculateAge } from "@/app/student/enroll/enroll-utils";

/**
 * Pure utility functions for the Admin "Create Account" wizard.
 *
 * 4-step wizard (type → personal → credentials → summary/confirm) for an
 * authenticated admin to create a full account (Persona + Usuario + Rol)
 * in one step.
 *
 * Extracted for testability — no React dependencies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Mirrors the backend's `tipo_cuenta` Literal in `admin_cuenta_schemas.py`.
 * ENTRENADOR gets the ENTRENADOR role and nothing else — a coach trains the
 * club, they are not enrolled in it.
 */
export type AccountType = "JUGADOR" | "REPRESENTANTE" | "MENOR" | "ENTRENADOR";

/** Account types the backend requires to be of age. */
export const ADULT_ACCOUNT_TYPES: readonly AccountType[] = ["JUGADOR", "REPRESENTANTE", "ENTRENADOR"];

/** Wizard step identifiers. */
export type CrearCuentaStep = "type" | "personal" | "health" | "credentials" | "summary";

/** Step order used by the wizard. */
export const CREAR_CUENTA_STEP_ORDER: CrearCuentaStep[] = ["type", "personal", "health", "credentials", "summary"];

/** Human-readable labels for each step, in Spanish. */
export const CREAR_CUENTA_STEP_LABELS: Record<CrearCuentaStep, string> = {
  type: "Tipo de Cuenta",
  personal: "Datos Personales",
  health: "Ficha Médica",
  credentials: "Credenciales de Acceso",
  summary: "Resumen y Confirmación",
};

/** Blood type options matching the backend TipoSangre enum. */
export const BLOOD_TYPE_OPTIONS = [
  "A_POSITIVO", "A_NEGATIVO", "B_POSITIVO", "B_NEGATIVO",
  "AB_POSITIVO", "AB_NEGATIVO", "O_POSITIVO", "O_NEGATIVO", "DESCONOCIDO",
] as const;

/** Shape of the create-account form data. */
export interface CrearCuentaFormData {
  accountType: AccountType | "";
  nombres: string;
  apellidos: string;
  cedula: string;
  fechaNacimiento: string;
  telefono: string;
  correo: string;
  contrasenia: string;
  representanteId: number | "";
  institucionId: string;
  /** Medical record fields (optional for all account types). */
  tipoSangre: string;
  condicionesSalud: string;
  alergias: string;
  contactoEmergencia: string;
  telefonoEmergencia: string;
}

/** Default empty form data. */
export const initialCrearCuentaFormData: CrearCuentaFormData = {
  accountType: "",
  nombres: "",
  apellidos: "",
  cedula: "",
  fechaNacimiento: "",
  telefono: "",
  correo: "",
  contrasenia: "",
  representanteId: "",
  institucionId: "",
  tipoSangre: "",
  condicionesSalud: "",
  alergias: "",
  contactoEmergencia: "",
  telefonoEmergencia: "",
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateCrearCuentaStep(
  step: CrearCuentaStep,
  data: CrearCuentaFormData,
): string[] {
  switch (step) {
    case "type":
      return validateType(data);
    case "personal":
      return validatePersonal(data);
    case "health":
      return validateMedical(data);
    case "credentials":
      return validateCredentials(data);
    case "summary":
      return [];
  }
}

export function validateCrearCuentaForm(data: CrearCuentaFormData): string[] {
  return [...validateType(data), ...validatePersonal(data), ...validateCredentials(data), ...validateMedical(data)];
}

function validateType(data: CrearCuentaFormData): string[] {
  const errors: string[] = [];
  if (!data.accountType) errors.push("Seleccione un tipo de cuenta.");
  return errors;
}

function validatePersonal(data: CrearCuentaFormData): string[] {
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

  // Age validation based on account type. `calculateAge` no longer caps its
  // input year (see its docstring in enroll-utils.ts) — an implausibly old
  // year like 1700 used to return NaN there, and `NaN < 18` / `NaN > 74` are
  // both `false`, so it passed every check below in silence (this file used
  // to carry its own capped copy of `calculateAge` with the identical bug —
  // now it imports the fixed shared helper instead).
  if (data.accountType && data.fechaNacimiento && isValidDate(data.fechaNacimiento)) {
    const age = calculateAge(data.fechaNacimiento);
    if (ADULT_ACCOUNT_TYPES.includes(data.accountType)) {
      if (age < EDAD_MAYORIA_EDAD || age > EDAD_MAXIMA_ALUMNO) {
        errors.push(
          `Los jugadores, representantes y entrenadores deben tener entre ${EDAD_MAYORIA_EDAD} y ${EDAD_MAXIMA_ALUMNO} años (calculado: ${age}).`,
        );
      }
    }
    if (data.accountType === "MENOR") {
      if (age >= EDAD_MAYORIA_EDAD) errors.push("La persona es mayor de edad. Use tipo Jugador o Representante.");
      else if (age < EDAD_MINIMA_ALUMNO) errors.push(`La edad mínima es ${EDAD_MINIMA_ALUMNO} años.`);
      else if (age > EDAD_MAXIMA_ALUMNO) errors.push(`La edad del alumno debe estar entre ${EDAD_MINIMA_ALUMNO} y ${EDAD_MAXIMA_ALUMNO} años (calculado: ${age}).`);
    }
  }

  if (data.accountType === "MENOR" && !data.representanteId) {
    errors.push("El menor requiere un representante legal asignado.");
  }

  return errors;
}

function validateCredentials(data: CrearCuentaFormData): string[] {
  const errors: string[] = [];
  if (!isEmail(data.correo)) errors.push("El correo electrónico no es válido.");
  if (data.contrasenia.length < 8) errors.push("La contraseña debe tener al menos 8 caracteres.");
  return errors;
}

function validateMedical(data: CrearCuentaFormData): string[] {
  const errors: string[] = [];
  const hasAnyMedicalData =
    data.tipoSangre || data.condicionesSalud.trim() || data.alergias.trim() ||
    data.contactoEmergencia.trim() || data.telefonoEmergencia.trim();
  if (!hasAnyMedicalData) return errors;
  if (!BLOOD_TYPE_OPTIONS.includes(data.tipoSangre as typeof BLOOD_TYPE_OPTIONS[number])) {
    errors.push("El tipo de sangre es obligatorio.");
  }
  if (!data.contactoEmergencia.trim()) errors.push("El nombre de contacto de emergencia es obligatorio.");
  else if (data.contactoEmergencia.trim().length < 3) errors.push("El nombre del contacto de emergencia debe tener al menos 3 caracteres.");
  if (!data.telefonoEmergencia.trim()) errors.push("El teléfono de emergencia es obligatorio.");
  else if (!/^\d{7,10}$/.test(data.telefonoEmergencia.trim())) errors.push("El teléfono de emergencia debe tener entre 7 y 10 dígitos.");
  return errors;
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

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

function isFutureDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed > today;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Real domain limits (`EDAD_MINIMA_ALUMNO` / `EDAD_MAXIMA_ALUMNO` /
 * `EDAD_MAYORIA_EDAD` in `backend/app/servicios_negocio/persona_servicio.py`).
 * `calculateAge` itself is imported from `enroll-utils.ts` — this file used
 * to carry its own copy that capped the birth year to 1900-2200 and returned
 * `NaN` outside it, the same defect audited and fixed there.
 */
const EDAD_MINIMA_ALUMNO = 5;
const EDAD_MAXIMA_ALUMNO = 74;
const EDAD_MAYORIA_EDAD = 18;

/**
 * One of three hand-rolled versions of the same idea that used to live in this
 * codebase, each with slightly different rules — this one passed the backend's
 * `detail` through on 400 only, its sibling in `enroll-utils` did it on 422 as
 * well, and the third documented in writing that 422 was unsafe. They now all
 * defer to the single translator, which is where that argument is made once.
 */
export function getCrearCuentaErrorMessage(error: unknown): string {
  return toUserMessage(error, "No se pudo crear la cuenta. Revise los datos ingresados e intente nuevamente.");
}
