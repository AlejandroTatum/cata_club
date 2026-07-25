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

/**
 * One-word names for the stepper pills — the visitor must see what the five
 * steps ARE from step one, not "Paso 2 de 5".
 *
 * The approved prototype (`docs/ux/prototipos/05-inscripcion.html`) names the
 * fourth step "Membresía". This wizard's fourth step is NOT membership: the
 * public `POST /enrollment` contract takes `alumno`, `fichaMedica` and either
 * `credencialesAlumno` or `representante` — no plan, no amount. Creating a
 * `Membresia` is `POST /membresias`, which is ADMINISTRADOR-only. The step
 * collects the medical record, so it is named for what it collects.
 */
export const STEP_SHORT_LABELS: Record<WizardStep, string> = {
  type: "Tipo",
  personal: "Estudiante",
  club: "Contacto",
  health: "Salud",
  summary: "Confirmar",
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
      errors.push(...collect(fieldsForStep("personal", data.enrollmentType), data));
      break;
    case "club":
      // NOT `fieldsForStep`: the aggregate check for a child enrollment covers
      // the representante's identity too, so reaching the summary with a blank
      // representante is impossible even if a step were skipped.
      errors.push(...(data.enrollmentType === ENROLLMENT_TYPES.SELF
        ? validateStudentCredentials(data)
        : validateRepresentative(data)));
      break;
    case "health":
      errors.push(...collect(HEALTH_FIELDS, data));
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

// ---------------------------------------------------------------------------
// Per-field validation
//
// The wizard's error prevention (the audit's finding) needs the message BESIDE
// the field, not only in a list at the bottom of the card. Every rule is
// declared once here, per field; the flat `string[]` APIs above are composed
// from these same rules so a message can never drift between the two surfaces.
// ---------------------------------------------------------------------------

/** A form field the wizard can point an error at. */
export type EnrollField = keyof EnrollFormData;

/** Field → its first unmet rule. A field with no entry is currently valid. */
export type EnrollFieldErrors = Partial<Record<EnrollField, string>>;

/** Digits only — a phone or cédula typed with spaces or dashes still counts. */
export function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

const FIELD_RULES: Partial<Record<EnrollField, (data: EnrollFormData) => string | null>> = {
  nombres: (d) => (d.nombres.trim() ? null : "Los nombres son obligatorios."),
  apellidos: (d) => (d.apellidos.trim() ? null : "Los apellidos son obligatorios."),
  fechaNacimiento: (d) => {
    if (!d.fechaNacimiento) return "La fecha de nacimiento es obligatoria.";
    if (!isDate(d.fechaNacimiento)) return "La fecha de nacimiento ingresada no es válida.";
    if (d.enrollmentType === ENROLLMENT_TYPES.SELF && calculateAge(d.fechaNacimiento) < 18) {
      return "Los menores de edad no pueden autoinscribirse. Seleccione 'Inscribo a un hijo / dependiente' o un representante debe completar la inscripción.";
    }
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
  correo: (d) => (isEmail(d.correo) ? null : "El correo electrónico no es válido."),
  contrasenia: (d) =>
    d.contrasenia.length >= 8 ? null : "La contraseña debe tener al menos 8 caracteres.",
  nombreRepresentante: (d) =>
    d.nombreRepresentante.trim() ? null : "Los nombres del representante son obligatorios.",
  apellidosRepresentante: (d) =>
    d.apellidosRepresentante.trim() ? null : "Los apellidos del representante son obligatorios.",
  cedulaRepresentante: (d) =>
    /^\d{10}$/.test(d.cedulaRepresentante.trim())
      ? null
      : "La cédula del representante debe tener 10 dígitos.",
  fechaNacimientoRepresentante: (d) =>
    isDate(d.fechaNacimientoRepresentante) && calculateAge(d.fechaNacimientoRepresentante) >= 18
      ? null
      : "El representante debe ser mayor de edad (18+).",
  telefonoRepresentante: (d) => {
    if (!d.telefonoRepresentante.trim()) return "El teléfono del representante es obligatorio.";
    return digitsOf(d.telefonoRepresentante).length === 10
      ? null
      : "El teléfono del representante debe tener 10 dígitos.";
  },
  correoRepresentante: (d) =>
    isEmail(d.correoRepresentante) ? null : "El correo del representante no es válido.",
  contraseniaRepresentante: (d) =>
    d.contraseniaRepresentante.length >= 8
      ? null
      : "La contraseña del representante debe tener al menos 8 caracteres.",
  tipoSangre: (d) => (isBloodType(d.tipoSangre) ? null : "El tipo de sangre es obligatorio."),
  contactoEmergencia: (d) =>
    d.contactoEmergencia.trim() ? null : "El nombre de contacto de emergencia es obligatorio.",
  telefonoEmergencia: (d) => {
    if (!d.telefonoEmergencia.trim()) return "El teléfono de emergencia es obligatorio.";
    return digitsOf(d.telefonoEmergencia).length === 10
      ? null
      : "El teléfono de emergencia debe tener 10 dígitos.";
  },
};

const STUDENT_FIELDS: EnrollField[] = [
  "nombres",
  "apellidos",
  "fechaNacimiento",
  "cedula",
  "telefono",
];

const CREDENTIAL_FIELDS: EnrollField[] = ["correo", "contrasenia"];

/** Representante fields rendered on the "personal" step (beside the student's own). */
const REPRESENTATIVE_IDENTITY_FIELDS: EnrollField[] = ["nombreRepresentante", "cedulaRepresentante"];

/** Representante fields rendered on the "club" step. */
const REPRESENTATIVE_CONTACT_FIELDS: EnrollField[] = [
  "apellidosRepresentante",
  "fechaNacimientoRepresentante",
  "telefonoRepresentante",
  "correoRepresentante",
  "contraseniaRepresentante",
];

const HEALTH_FIELDS: EnrollField[] = ["tipoSangre", "contactoEmergencia", "telefonoEmergencia"];

/**
 * The fields a given step actually renders — so a disabled "Siguiente" can
 * only ever blame something the visitor can see on screen.
 */
export function fieldsForStep(step: WizardStep, type: EnrollmentType): EnrollField[] {
  const isChild = type === ENROLLMENT_TYPES.CHILD;
  switch (step) {
    case "type":
      return [];
    case "personal":
      return isChild ? [...STUDENT_FIELDS, ...REPRESENTATIVE_IDENTITY_FIELDS] : STUDENT_FIELDS;
    case "club":
      return isChild ? REPRESENTATIVE_CONTACT_FIELDS : CREDENTIAL_FIELDS;
    case "health":
      return HEALTH_FIELDS;
    case "summary":
      return [];
  }
}

function collect(fields: EnrollField[], data: EnrollFormData): string[] {
  return fields.map((field) => FIELD_RULES[field]?.(data) ?? null).filter((m): m is string => m !== null);
}

/** Every unmet rule on the current step, keyed by the field that owns it. */
export function validateEnrollFields(step: WizardStep, data: EnrollFormData): EnrollFieldErrors {
  const errors: EnrollFieldErrors = {};
  for (const field of fieldsForStep(step, data.enrollmentType)) {
    const message = FIELD_RULES[field]?.(data) ?? null;
    if (message !== null) errors[field] = message;
  }
  return errors;
}

/** Whether the step's "Siguiente" may be enabled. */
export function isStepComplete(step: WizardStep, data: EnrollFormData): boolean {
  return Object.keys(validateEnrollFields(step, data)).length === 0;
}

/** Field → the label the visitor actually reads on screen, for the blocked-button explanation. */
const FIELD_LABELS: Partial<Record<EnrollField, string>> = {
  nombres: "Nombres",
  apellidos: "Apellidos",
  fechaNacimiento: "Fecha de nacimiento",
  cedula: "Cédula de identidad",
  telefono: "Teléfono",
  correo: "Correo electrónico",
  contrasenia: "Contraseña",
  nombreRepresentante: "Nombres del representante",
  apellidosRepresentante: "Apellidos del representante",
  cedulaRepresentante: "Cédula del representante",
  fechaNacimientoRepresentante: "Fecha de nacimiento del representante",
  telefonoRepresentante: "Teléfono del representante",
  correoRepresentante: "Correo del representante",
  contraseniaRepresentante: "Contraseña del representante",
  tipoSangre: "Tipo de sangre",
  contactoEmergencia: "Nombre del contacto de emergencia",
  telefonoEmergencia: "Teléfono de emergencia",
};

/**
 * Why "Siguiente" is disabled, in one sentence naming the fields.
 *
 * A disabled control that does not say what is missing is a dead end — the
 * audit's error-prevention finding. Returns `null` when nothing is missing.
 */
export function describeStepBlocker(errors: EnrollFieldErrors): string | null {
  const labels = (Object.keys(errors) as EnrollField[])
    .map((field) => FIELD_LABELS[field])
    .filter((label): label is string => Boolean(label));
  if (labels.length === 0) return null;
  if (labels.length === 1) return `Para continuar, revise: ${labels[0]}.`;
  const last = labels[labels.length - 1];
  return `Para continuar, revise: ${labels.slice(0, -1).join(", ")} y ${last}.`;
}

function validateStudent(data: EnrollFormData): string[] {
  return collect(STUDENT_FIELDS, data);
}

function validateStudentCredentials(data: EnrollFormData): string[] {
  return collect(CREDENTIAL_FIELDS, data);
}

function validateRepresentative(data: EnrollFormData): string[] {
  return collect([...REPRESENTATIVE_IDENTITY_FIELDS, ...REPRESENTATIVE_CONTACT_FIELDS], data);
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
