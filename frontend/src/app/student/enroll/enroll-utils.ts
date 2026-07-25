/**
 * Pure utility functions for the Student Enrollment page.
 *
 * Extracted from page.tsx for testability and to avoid Next.js page
 * export conflicts — no React dependencies.
 */

import { BLOOD_TYPES, type BloodType, type EnrollmentRequest } from "@/types/enrollment";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Enrollment type:
 * - "self"    → Jugador: the user enrolls themselves as a student.
 * - "child"   → Representante: the user enrolls a child/dependent only.
 */
export const ENROLLMENT_TYPES = {
  SELF: "self",
  CHILD: "child",
} as const;

export type EnrollmentType = (typeof ENROLLMENT_TYPES)[keyof typeof ENROLLMENT_TYPES];

/** Wizard step identifiers. */
export type WizardStep = "type" | "personal" | "club" | "health" | "summary";

/** Shape of the enrollment form data. */
export interface EnrollFormData {
  enrollmentType: EnrollmentType;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  cedula: string;
  telefono: string;
  correo: string;
  contrasenia: string;
  nombreRepresentante: string;
  apellidosRepresentante: string;
  cedulaRepresentante: string;
  fechaNacimientoRepresentante: string;
  telefonoRepresentante: string;
  correoRepresentante: string;
  contraseniaRepresentante: string;
  tipoSangre: BloodType | "";
  condicionesSalud: string;
  alergias: string;
  contactoEmergencia: string;
  telefonoEmergencia: string;
  observaciones: string;
}

/** Step order used by the wizard. */
export const STEP_ORDER: WizardStep[] = [
  "type",
  "personal",
  "club",
  "health",
  "summary",
];

/** Human-readable labels for each step, in Spanish. */
export const STEP_LABELS: Record<WizardStep, string> = {
  type: "Tipo de Inscripción",
  personal: "Datos del Estudiante",
  club: "Cuenta y Representante",
  health: "Salud y Emergencia",
  summary: "Resumen y Confirmación",
};

/** Default empty form data. */
export const initialFormData: EnrollFormData = {
  enrollmentType: ENROLLMENT_TYPES.SELF,
  nombres: "",
  apellidos: "",
  fechaNacimiento: "",
  cedula: "",
  telefono: "",
  correo: "",
  contrasenia: "",
  nombreRepresentante: "",
  apellidosRepresentante: "",
  cedulaRepresentante: "",
  fechaNacimientoRepresentante: "",
  telefonoRepresentante: "",
  correoRepresentante: "",
  contraseniaRepresentante: "",
  tipoSangre: "",
  condicionesSalud: "",
  alergias: "",
  contactoEmergencia: "",
  telefonoEmergencia: "",
  observaciones: "",
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a wizard step's form data and return error messages.
 *
 * Pure function — no React dependencies, fully testable.
 *
 * @param step — The current wizard step identifier.
 * @param data — The current enrollment form data.
 * @returns A list of error message strings (empty = valid).
 */
export function validateEnrollStep(
  step: WizardStep,
  data: EnrollFormData,
): string[] {
  const errors: string[] = [];
  switch (step) {
    case "type":
      // Always valid — player and representative options are acceptable.
      break;
    case "personal":
      errors.push(...validateStudent(data));
      break;
    case "club":
      errors.push(...(data.enrollmentType === ENROLLMENT_TYPES.SELF
        ? validateStudentCredentials(data)
        : validateRepresentative(data)));
      break;
    case "health":
      if (!isBloodType(data.tipoSangre)) errors.push("El tipo de sangre es obligatorio.");
      if (!data.contactoEmergencia.trim())
        errors.push("El nombre de contacto de emergencia es obligatorio.");
      if (!data.telefonoEmergencia.trim())
        errors.push("El teléfono de emergencia es obligatorio.");
      break;
    case "summary":
      break;
  }
  return errors;
}

export function validateEnrollment(data: EnrollFormData): string[] {
  return [
    ...validateStudent(data),
    ...(data.enrollmentType === ENROLLMENT_TYPES.SELF
      ? validateStudentCredentials(data)
      : validateRepresentative(data)),
    ...validateEnrollStep("health", data),
  ];
}

/**
 * Whether the wizard's demo quick-fill panel is allowed to render.
 *
 * The panel is a development affordance: it dumps fake student/representative
 * data into the form. `/student/enroll` is a PUBLIC route (see
 * `PUBLIC_EXCEPTIONS` in src/lib/middleware-utils.ts) and every landing-page
 * enrollment CTA lands on it, so an ungated panel is shown to real prospective
 * families.
 *
 * `process.env.NODE_ENV` is read here rather than captured at module scope so
 * tests can stub it; in a real client bundle Next inlines it to the string
 * literal `"production"`, so the check is a genuine build-time environment
 * gate and not a runtime toggle a visitor can flip.
 */
export function isDemoQuickFillEnabled(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv !== "production";
}

export function getEnrollmentErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as Record<string, unknown>).status;
    if (status === 400 || status === 422) {
      return "No se pudo validar la inscripción. Revise sus datos e intente nuevamente.";
    }
    if (status === 429) {
      return "Ha realizado demasiados intentos. Espere un momento antes de continuar.";
    }
  }
  return "No se pudo completar la inscripción. Intente nuevamente más tarde.";
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/**
 * Build an empty FichaMedica from the health fields of EnrollFormData.
 */
export function buildEnrollmentRequest(data: EnrollFormData): EnrollmentRequest {
  const alumno = {
    nombres: data.nombres.trim(), apellidos: data.apellidos.trim(), cedula: data.cedula.trim(),
    fechaNacimiento: data.fechaNacimiento, telefono: data.telefono.trim(),
  };
  const fichaMedica = {
    tipoSangre: data.tipoSangre as BloodType, condicionesSalud: data.condicionesSalud.trim(),
    alergias: data.alergias.trim(), contactoEmergencia: data.contactoEmergencia.trim(),
    telefonoEmergencia: data.telefonoEmergencia.trim(),
    ...(data.observaciones.trim() ? { observaciones: data.observaciones.trim() } : {}),
  };
  if (data.enrollmentType === ENROLLMENT_TYPES.SELF) {
    return { alumno, fichaMedica, credencialesAlumno: { correo: data.correo.trim(), contrasenia: data.contrasenia } };
  }
  return {
    alumno, fichaMedica,
    representante: {
      nombres: data.nombreRepresentante.trim(), apellidos: data.apellidosRepresentante.trim(),
      cedula: data.cedulaRepresentante.trim(), fechaNacimiento: data.fechaNacimientoRepresentante,
      telefono: data.telefonoRepresentante.trim(), correo: data.correoRepresentante.trim(),
      contrasenia: data.contraseniaRepresentante,
    },
  };
}

function validateStudent(data: EnrollFormData): string[] {
  const errors: string[] = [];
  if (!data.nombres.trim()) errors.push("Los nombres son obligatorios.");
  if (!data.apellidos.trim()) errors.push("Los apellidos son obligatorios.");
  if (!data.fechaNacimiento) errors.push("La fecha de nacimiento es obligatoria.");
  else if (!isDate(data.fechaNacimiento)) errors.push("La fecha de nacimiento ingresada no es válida.");
  if (!data.cedula.trim()) errors.push("La cédula de identidad es obligatoria.");
  else if (!/^\d{10}$/.test(data.cedula.trim())) errors.push("La cédula debe tener 10 dígitos.");
  if (!data.telefono.trim()) errors.push("El teléfono es obligatorio.");
  if (data.enrollmentType === ENROLLMENT_TYPES.SELF && calculateAge(data.fechaNacimiento) < 18) {
    errors.push("Los menores de edad no pueden autoinscribirse. Seleccione 'Inscribo a un hijo / dependiente' o un representante debe completar la inscripción.");
  }
  return errors;
}

function validateStudentCredentials(data: EnrollFormData): string[] {
  const errors: string[] = [];
  if (!isEmail(data.correo)) errors.push("El correo electrónico no es válido.");
  if (data.contrasenia.length < 8) errors.push("La contraseña debe tener al menos 8 caracteres.");
  return errors;
}

function validateRepresentative(data: EnrollFormData): string[] {
  const errors: string[] = [];
  if (!data.nombreRepresentante.trim()) errors.push("Los nombres del representante son obligatorios.");
  if (!data.apellidosRepresentante.trim()) errors.push("Los apellidos del representante son obligatorios.");
  if (!/^\d{10}$/.test(data.cedulaRepresentante.trim())) errors.push("La cédula del representante debe tener 10 dígitos.");
  if (!isDate(data.fechaNacimientoRepresentante) || calculateAge(data.fechaNacimientoRepresentante) < 18) errors.push("El representante debe ser mayor de edad (18+).");
  if (!data.telefonoRepresentante.trim()) errors.push("El teléfono del representante es obligatorio.");
  if (!isEmail(data.correoRepresentante)) errors.push("El correo del representante no es válido.");
  if (data.contraseniaRepresentante.length < 8) errors.push("La contraseña del representante debe tener al menos 8 caracteres.");
  return errors;
}

function isDate(value: string): boolean {
  return !Number.isNaN(calculateAge(value));
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isBloodType(value: string): value is BloodType {
  return Object.values(BLOOD_TYPES).includes(value as BloodType);
}

// ---------------------------------------------------------------------------
// Age calculation
// ---------------------------------------------------------------------------

/**
 * Calculate age from an ISO date string (YYYY-MM-DD).
 *
 * Parses the date-string component-wise (year, month, day) to avoid the
 * UTC-midnight interpretation of `new Date("YYYY-MM-DD")`, which shifts
 * the date backward in negative-UTC-offset timezones such as Ecuador
 * (UTC-5). Using calendar-component parsing keeps the comparison in local
 * time, ensuring boundary cases like "birthday is tomorrow" are correct.
 *
 * Accepts an optional `today` parameter (defaults to `new Date()`) so that
 * tests can pass a fixed reference date for deterministic results.
 *
 * @param birthDate — ISO date string "YYYY-MM-DD".
 * @param today — Reference date (default `new Date()`).
 * @returns Age in whole years, or `NaN` for invalid/empty/unparseable input.
 */
export function calculateAge(
  birthDate: string,
  today: Date = new Date(),
): number {
  if (!birthDate) return NaN;

  const parts = birthDate.split("-");
  if (parts.length !== 3) return NaN;

  const [birthYear, birthMonth, birthDay] = parts.map(Number);

  if (
    !Number.isInteger(birthYear) ||
    !Number.isInteger(birthMonth) ||
    !Number.isInteger(birthDay) ||
    birthYear < 1900 ||
    birthYear > 2200 ||
    birthMonth < 1 ||
    birthMonth > 12 ||
    birthDay < 1 ||
    birthDay > 31
  ) {
    return NaN;
  }

  // Calendar validation: reject dates like Feb 31 or Apr 31 that JS
  // silently "overflows" into the next valid calendar date.
  const parsed = new Date(birthYear, birthMonth - 1, birthDay);
  if (
    parsed.getFullYear() !== birthYear ||
    parsed.getMonth() !== birthMonth - 1 ||
    parsed.getDate() !== birthDay
  ) {
    return NaN;
  }

  let age = today.getFullYear() - birthYear;
  const monthDiff = today.getMonth() - (birthMonth - 1);
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDay)) {
    age--;
  }
  return age;
}
