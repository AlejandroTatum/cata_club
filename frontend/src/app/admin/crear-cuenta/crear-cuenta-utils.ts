import { toUserMessage } from "@/lib/error-message";
import {
  cedulaRule,
  phoneRule,
  personNameRule,
  passwordRule,
  calculatePersonAge,
  isValidCalendarDate,
  isFutureBirthDate,
  EDAD_MINIMA_ALUMNO,
  EDAD_MAXIMA_ALUMNO,
  EDAD_MAYORIA_EDAD,
} from "@/lib/identity-validation";

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
  const nombresError = personNameRule(data.nombres, "Los nombres");
  if (nombresError) errors.push(nombresError);
  const apellidosError = personNameRule(data.apellidos, "Los apellidos");
  if (apellidosError) errors.push(apellidosError);
  if (!data.fechaNacimiento) errors.push("La fecha de nacimiento es obligatoria.");
  else if (!isValidCalendarDate(data.fechaNacimiento)) errors.push("La fecha de nacimiento ingresada no es válida.");
  else if (isFutureBirthDate(data.fechaNacimiento)) errors.push("La fecha de nacimiento no puede ser en el futuro.");
  const cedulaMessage = cedulaRule(data.cedula, "La cédula de identidad");
  if (cedulaMessage) errors.push(cedulaMessage);
  const telefonoMessage = phoneRule(data.telefono, "El teléfono");
  if (telefonoMessage) errors.push(telefonoMessage);

  // Age validation based on account type. `calculatePersonAge` never caps its
  // input year (see its docstring in `@/lib/identity-validation`) — an
  // implausibly old year like 1700 used to return NaN from this file's own
  // capped copy, and `NaN < 18` / `NaN > 74` are both `false`, so it passed
  // every check below in silence.
  if (data.accountType && data.fechaNacimiento && isValidCalendarDate(data.fechaNacimiento)) {
    const age = calculatePersonAge(data.fechaNacimiento);
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
  const passwordError = passwordRule(data.contrasenia, "La contraseña");
  if (passwordError) errors.push(passwordError);
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
  const contactoMessage = personNameRule(data.contactoEmergencia, "El nombre del contacto de emergencia", { plural: false });
  if (contactoMessage) errors.push(contactoMessage);
  const telefonoEmergenciaMessage = phoneRule(data.telefonoEmergencia, "El teléfono de emergencia");
  if (telefonoEmergenciaMessage) errors.push(telefonoEmergenciaMessage);
  return errors;
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

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
