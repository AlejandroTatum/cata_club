/**
 * Pure utility functions for the Student Enrollment page.
 *
 * Extracted from page.tsx for testability and to avoid Next.js page
 * export conflicts — no React dependencies.
 */

import { isSelectableBloodType, type BloodType, type EnrollmentRequest } from "@/types/enrollment";
import { toUserMessage } from "@/lib/error-message";
import {
  cedulaRule,
  phoneRule,
  emergencyPhoneDiffersRule,
  personNameRule,
  passwordRule,
  studentBirthDateRule,
  calculatePersonAge,
  isValidCalendarDate,
  EDAD_MAYORIA_EDAD,
  EDAD_MAXIMA_ALUMNO,
} from "@/lib/identity-validation";

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
export type WizardStep = "type" | "personal" | "representative" | "health" | "summary";

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
  /** UI-only: never read by the draft serializer or the payload builder (#876). */
  contraseniaConfirmacion: string;
  /** School/institution (child enrollment only) — optional. */
  institucionId: string;
  nombreRepresentante: string;
  apellidosRepresentante: string;
  cedulaRepresentante: string;
  fechaNacimientoRepresentante: string;
  telefonoRepresentante: string;
  correoRepresentante: string;
  contraseniaRepresentante: string;
  /** UI-only: never read by the draft serializer or the payload builder (#876). */
  contraseniaRepresentanteConfirmacion: string;
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
  "representative",
  "health",
  "summary",
];

/**
 * Human-readable labels for each step, in Spanish.
 *
 * Sentence case, like every other label on the screen. The wizard used to run
 * two capitalisation criteria at once — "Tipo de Inscripción" beside "Correo
 * electrónico" — which is the same defect as two words for one thing, spelled
 * in caps.
 */
export const STEP_LABELS: Record<WizardStep, string> = {
  type: "Tipo de inscripción",
  personal: "Datos del estudiante",
  representative: "Datos del representante",
  health: "Salud y emergencia",
  summary: "Resumen y confirmación",
};

/**
 * One-word names for the stepper pills — the visitor must see what the five
 * steps ARE from step one, not "Paso 2 de 5".
 *
 * The approved prototype (`docs/archive/prototypes/prototipos/05-inscripcion.html`) names the
 * fourth step "Membresía". This wizard's fourth step is NOT membership: the
 * public `POST /enrollment` contract takes `alumno`, `fichaMedica` and either
 * `credencialesAlumno` or `representante` — no plan, no amount. Creating a
 * `Membresia` is `POST /membresias`, which is ADMINISTRADOR-only. The step
 * collects the medical record, so it is named for what it collects.
 */
export const STEP_SHORT_LABELS: Record<WizardStep, string> = {
  type: "Tipo",
  personal: "Estudiante",
  representative: "Representante",
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
  contraseniaConfirmacion: "",
  institucionId: "",
  nombreRepresentante: "",
  apellidosRepresentante: "",
  cedulaRepresentante: "",
  fechaNacimientoRepresentante: "",
  telefonoRepresentante: "",
  correoRepresentante: "",
  contraseniaRepresentante: "",
  contraseniaRepresentanteConfirmacion: "",
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
      // A child enrollment may create an optional account for the student:
      // blank is fine, half-filled is not.
      if (data.enrollmentType !== ENROLLMENT_TYPES.SELF) {
        errors.push(...validateOptionalStudentCredentials(data));
      }
      break;
    case "representative":
      // NOT `fieldsForStep`: this runs as an aggregate check too, so it must
      // hold even for a self enrollment that never renders the step.
      errors.push(...validateRepresentative(data));
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
      : validateOptionalStudentCredentials(data)),
    ...(data.enrollmentType === ENROLLMENT_TYPES.CHILD
      ? validateRepresentative(data)
      : []),
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

/**
 * This one passed the backend's `detail` through on 422 as well as 400 — the
 * case its sibling in `add-dependent-utils` documented in writing as unsafe,
 * because a 422 is where FastAPI puts a serialized list of field/loc/msg
 * objects. Two helpers, the same question, opposite answers, and nothing
 * reconciling them. The translator is that reconciliation.
 */
export function getEnrollmentErrorMessage(error: unknown): string {
  const field = enrollmentValidationField(error);
  if (field === "correo") return "Revise el correo electrónico e intente nuevamente.";
  if (field === "correoRepresentante") return "Revise el correo electrónico del representante e intente nuevamente.";
  // The old helper carried two fallbacks — "revise sus datos" for 400/422 and
  // "intente más tarde" for everything else. The translator answers everything
  // else from the status now, so the one remaining fallback is the one for the
  // case it cannot answer: a 400/422 whose detail was not fit to show. Telling
  // that user to wait would be the wrong advice; their form is what is wrong.
  return toUserMessage(error, "No se pudo validar la inscripción. Revise sus datos e intente nuevamente.");
}

function enrollmentValidationField(error: unknown): EnrollField | undefined {
  if (!error || typeof error !== "object" || !("status" in error) || error.status !== 422) return undefined;
  const loc = "validationLoc" in error ? error.validationLoc : undefined;
  if (!Array.isArray(loc) || !loc.every((part): part is string => typeof part === "string")) return undefined;
  const path = loc.join(".");
  if (path === "body.credenciales_alumno.correo" || path === "body.alumno.correo") return "correo";
  if (path === "body.representante.correo") return "correoRepresentante";
  return undefined;
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

/**
 * Build an empty FichaMedica from the health fields of EnrollFormData.
 */
export function buildEnrollmentRequest(data: EnrollFormData, aceptaConsentimientos = false): EnrollmentRequest {
  const alumno = {
    nombres: data.nombres.trim(), apellidos: data.apellidos.trim(), cedula: data.cedula.trim(),
    fechaNacimiento: data.fechaNacimiento,
    // #1028 (round 3): the visitor typed the 9 digits after the +593; the
    // contract the backend expects is the local 09XXXXXXXX form.
    telefono: canonicalStudentPhone(data.telefono),
    ...(data.institucionId ? { institucionId: Number(data.institucionId) } : {}),
  };
  const fichaMedica = {
    tipoSangre: data.tipoSangre as BloodType, condicionesSalud: data.condicionesSalud.trim(),
    alergias: data.alergias.trim(), contactoEmergencia: data.contactoEmergencia.trim(),
    telefonoEmergencia: data.telefonoEmergencia.trim(),
    ...(data.observaciones.trim() ? { observaciones: data.observaciones.trim() } : {}),
  };
  if (data.enrollmentType === ENROLLMENT_TYPES.SELF) {
    return { alumno, fichaMedica, aceptaConsentimientos, credencialesAlumno: { correo: data.correo.trim(), contrasenia: data.contrasenia } };
  }
  const result: EnrollmentRequest = {
    alumno, fichaMedica, aceptaConsentimientos,
    representante: {
      nombres: data.nombreRepresentante.trim(), apellidos: data.apellidosRepresentante.trim(),
      cedula: data.cedulaRepresentante.trim(), fechaNacimiento: data.fechaNacimientoRepresentante,
      telefono: data.telefonoRepresentante.trim(), correo: data.correoRepresentante.trim(),
      contrasenia: data.contraseniaRepresentante,
    },
  };
  if (data.correo.trim() && data.contrasenia) {
    result.credencialesMenor = { correo: data.correo.trim(), contrasenia: data.contrasenia };
  }
  return result;
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

/**
 * The DOM id of each field, declared once and derived from the field NAME —
 * never from the label the visitor reads.
 *
 * `WizardInput` used to build its id by slugifying the label text
 * (`slugifyLabel`), and `tests/e2e/enroll-qa.spec.ts` reproduced that same
 * function to address roughly forty cases. The two together made the visible
 * copy a test selector: renaming "Nombres del Representante" to "Nombres" —
 * which the rule of the words asks for, since the card is already titled
 * "Datos del representante" — silently moved `#enroll-nombres-del-representante`
 * out from under every case that pointed at it.
 *
 * So the id is declared here instead, beside the field it belongs to. Copy is
 * free to change; the id only changes when the FIELD does, which is a change
 * the tests should notice.
 *
 * Two of the entries name no input on purpose and exist so this table stays a
 * total function of `EnrollField`: `enrollmentType` is the pair of choice
 * cards on the first step, and `institucionId` is a `<select>` the page
 * renders itself. A new form field cannot be added without answering "what is
 * its id" here first.
 */
export const ENROLL_FIELD_TOKEN: Record<EnrollField, string> = {
  enrollmentType: "tipo",
  nombres: "nombres",
  apellidos: "apellidos",
  fechaNacimiento: "fecha-nacimiento",
  cedula: "cedula",
  telefono: "telefono",
  correo: "correo",
  contrasenia: "contrasenia",
  contraseniaConfirmacion: "confirmar-contrasena",
  institucionId: "institucion",
  nombreRepresentante: "nombres-representante",
  apellidosRepresentante: "apellidos-representante",
  cedulaRepresentante: "cedula-representante",
  fechaNacimientoRepresentante: "fecha-nacimiento-representante",
  telefonoRepresentante: "telefono-representante",
  correoRepresentante: "correo-representante",
  contraseniaRepresentante: "contrasenia-representante",
  contraseniaRepresentanteConfirmacion: "confirmar-contrasena-representante",
  tipoSangre: "tipo-sangre",
  condicionesSalud: "condiciones-salud",
  alergias: "alergias",
  contactoEmergencia: "contacto-emergencia",
  telefonoEmergencia: "telefono-emergencia",
  observaciones: "observaciones",
};

/** The id prefix every field on this wizard shares. */
export const ENROLL_ID_PREFIX = "enroll";

/** The full DOM id of a field — what a test, a `<label for>` and a deep link all address. */
export function enrollFieldId(field: EnrollField): string {
  return `${ENROLL_ID_PREFIX}-${ENROLL_FIELD_TOKEN[field]}`;
}

/** Field → its first unmet rule. A field with no entry is currently valid. */
export type EnrollFieldErrors = Partial<Record<EnrollField, string>>;

/** Digits only — a phone or cédula typed with spaces or dashes still counts. */
export function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Confirmation must repeat the password exactly (issue #876). The helper is
 * unconditional; whether a confirmation is required at all is decided by the
 * caller — `FIELD_RULES` for self/representante credentials, and the
 * both-or-neither gate inside `optionalStudentCredentialErrors` for the
 * child's optional account.
 */
function passwordConfirmRule(confirm: string, password: string): string | null {
  if (confirm.length === 0) return "La confirmación de contraseña es obligatoria.";
  return confirm === password ? null : "Las contraseñas no coinciden.";
}

/**
 * The public self-service enrollment's own phone rule (#1028, review round 3):
 * the field shows 🇪🇨 and a fixed `+593`, and the editable value is ONLY the
 * nine mobile digits that follow — `991234567`. A leading `0`, a repeated
 * `593`, and any other length are rejected with a message that names the
 * mistake, never normalized behind the visitor's back.
 *
 * `phoneRule` (the shared rule every OTHER phone field keeps) still accepts
 * `593…`/`+593…` and landlines, and the masking layer silently normalizes an
 * autofilled international value before the digit cap. Both are retired in
 * THIS flow on purpose: with the country code fixed beside the input, a value
 * starting with `0` or `593` is a duplication mistake the visitor needs to
 * see, not one the interface should quietly repair. Typing separators are
 * tolerated (`991 234 567` is that same number); the digits, once separated
 * out, must be exactly `9` plus eight more.
 *
 * The representative's, the emergency contact's and every admin/profile phone
 * keep `phoneRule`'s wider contract: this restriction is scoped to the public
 * student enrollment, exactly the flow the review asked for.
 */
export function enrollStudentPhoneRule(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "El teléfono es obligatorio.";
  if (digits.startsWith("0")) {
    return "No incluya el 0 inicial: escriba solo los 9 dígitos que siguen al +593.";
  }
  if (digits.startsWith("593")) {
    return "No repita el 593: ya está en el campo. Escriba solo los 9 dígitos de su celular.";
  }
  return /^9\d{8}$/.test(digits)
    ? null
    : "Escriba los 9 dígitos de su celular después del +593 (por ejemplo, 991234567).";
}

/**
 * The canonical shape the enrollment contract sends to the backend: the local
 * `09XXXXXXXX` form the API has always received (#855 made that the canonical
 * wire format). The visitor types the 9 digits after the `+593`; this restores
 * the trunk `0` for the payload, so display semantics and wire semantics each
 * stay in their own layer. Values that are not a valid 9-digit entry pass
 * through untouched: validation blocks them long before a request is built,
 * and the emergency-contact cross-check (#860) relies on comparing these same
 * canonical forms.
 */
export function canonicalStudentPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return /^9\d{8}$/.test(digits) ? `0${digits}` : digits;
}

const FIELD_RULES: Partial<Record<EnrollField, (data: EnrollFormData) => string | null>> = {
  nombres: (d) => personNameRule(d.nombres, "Los nombres"),
  apellidos: (d) => personNameRule(d.apellidos, "Los apellidos"),
  fechaNacimiento: (d) => {
    const boundsError = studentBirthDateRule(d.fechaNacimiento);
    if (boundsError) return boundsError;
    if (
      d.enrollmentType === ENROLLMENT_TYPES.SELF &&
      calculatePersonAge(d.fechaNacimiento) < EDAD_MAYORIA_EDAD
    ) {
      return "Los menores de edad no pueden autoinscribirse. Seleccione 'Inscribo a un hijo / dependiente' o un representante debe completar la inscripción.";
    }
    return null;
  },
  cedula: (d) => cedulaRule(d.cedula, "La cédula de identidad"),
  telefono: (d) => enrollStudentPhoneRule(d.telefono),
  correo: (d) => (isEmail(d.correo) ? null : "El correo electrónico no es válido."),
  contrasenia: (d) => passwordRule(d.contrasenia, "La contraseña"),
  contraseniaConfirmacion: (d) => passwordConfirmRule(d.contraseniaConfirmacion, d.contrasenia),
  nombreRepresentante: (d) => personNameRule(d.nombreRepresentante, "Los nombres del representante"),
  apellidosRepresentante: (d) =>
    personNameRule(d.apellidosRepresentante, "Los apellidos del representante"),
  cedulaRepresentante: (d) => cedulaRule(d.cedulaRepresentante, "La cédula del representante"),
  fechaNacimientoRepresentante: (d) => {
    if (!isValidCalendarDate(d.fechaNacimientoRepresentante)) {
      // "(18+)" was an abbreviation of the sentence it sat inside — the rule of
      // the words: the interface never shortens, and never says twice what one
      // phrase already says. The lower bound is stated in full by the very next
      // branch, which is the one that can actually name a number.
      return "El representante debe ser mayor de edad.";
    }
    const edad = calculatePersonAge(d.fechaNacimientoRepresentante);
    return edad >= EDAD_MAYORIA_EDAD && edad <= EDAD_MAXIMA_ALUMNO
      ? null
      : `El representante debe tener entre ${EDAD_MAYORIA_EDAD} y ${EDAD_MAXIMA_ALUMNO} años (calculado: ${edad}).`;
  },
  telefonoRepresentante: (d) => phoneRule(d.telefonoRepresentante, "El teléfono del representante"),
  correoRepresentante: (d) =>
    isEmail(d.correoRepresentante) ? null : "El correo del representante no es válido.",
  contraseniaRepresentante: (d) =>
    passwordRule(d.contraseniaRepresentante, "La contraseña del representante"),
  contraseniaRepresentanteConfirmacion: (d) =>
    passwordConfirmRule(d.contraseniaRepresentanteConfirmacion, d.contraseniaRepresentante),
  tipoSangre: (d) => (isBloodType(d.tipoSangre) ? null : "El tipo de sangre es obligatorio."),
  contactoEmergencia: (d) =>
    personNameRule(d.contactoEmergencia, "El nombre del contacto de emergencia", { plural: false }),
  // Issue #860: chained after `phoneRule` so a malformed number is reported
  // first — the cross-check only makes sense once the value is itself a
  // valid Ecuadorian phone. The student's entry is canonicalized first so a
  // 9-digit `991234567` and an emergency `0991234567` are still recognised
  // as the SAME number (the comparison runs on normalized forms).
  telefonoEmergencia: (d) =>
    phoneRule(d.telefonoEmergencia, "El teléfono de emergencia") ??
    emergencyPhoneDiffersRule(d.telefonoEmergencia, canonicalStudentPhone(d.telefono)),
};

const STUDENT_FIELDS: EnrollField[] = [
  "nombres",
  "apellidos",
  "fechaNacimiento",
  "cedula",
  "telefono",
];

const CREDENTIAL_FIELDS: EnrollField[] = ["correo", "contrasenia", "contraseniaConfirmacion"];

/** Every representante field — they all live on the "representative" step. */
const REPRESENTATIVE_FIELDS: EnrollField[] = [
  "nombreRepresentante",
  "apellidosRepresentante",
  "cedulaRepresentante",
  "fechaNacimientoRepresentante",
  "telefonoRepresentante",
  "correoRepresentante",
  "contraseniaRepresentante",
  "contraseniaRepresentanteConfirmacion",
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
      // A self enrollment signs in as the student, so its credentials are
      // required here. A child's are optional and validated separately.
      return isChild ? STUDENT_FIELDS : [...STUDENT_FIELDS, ...CREDENTIAL_FIELDS];
    case "representative":
      // Skipped entirely for a self enrollment — there is no representante.
      return isChild ? REPRESENTATIVE_FIELDS : [];
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
  // A child enrollment's student account is optional, but half-filled blocks
  // the step the same way `validateAddDependentFields` gates its own
  // "credentials" step — the message has to land on the field that is
  // actually wrong, and "Siguiente" has to see it too (#226).
  if (step === "personal" && data.enrollmentType !== ENROLLMENT_TYPES.SELF) {
    Object.assign(errors, optionalStudentCredentialErrors(data));
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
  contraseniaConfirmacion: "Confirmar contraseña",
  nombreRepresentante: "Nombres del representante",
  apellidosRepresentante: "Apellidos del representante",
  cedulaRepresentante: "Cédula del representante",
  fechaNacimientoRepresentante: "Fecha de nacimiento del representante",
  telefonoRepresentante: "Teléfono del representante",
  correoRepresentante: "Correo del representante",
  contraseniaRepresentante: "Contraseña del representante",
  contraseniaRepresentanteConfirmacion: "Confirmar contraseña del representante",
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

/**
 * The "both-or-neither" rule for a child enrollment's optional student
 * account, keyed to the field that owns each message — mirrors
 * `validateAddDependentFields`'s "credentials" step in `add-dependent-utils.ts`.
 */
function optionalStudentCredentialErrors(data: EnrollFormData): EnrollFieldErrors {
  const errors: EnrollFieldErrors = {};
  const hasCorreo = data.correo.trim().length > 0;
  const hasContrasenia = data.contrasenia.length > 0;
  if (hasCorreo || hasContrasenia) {
    if (!hasCorreo) errors.correo = "El correo del estudiante es obligatorio si se desea crear una cuenta.";
    else if (!isEmail(data.correo)) errors.correo = "El correo del estudiante no es válido.";
    if (!hasContrasenia) {
      errors.contrasenia = "La contraseña del estudiante es obligatoria si se desea crear una cuenta.";
    } else {
      const passwordError = passwordRule(data.contrasenia, "La contraseña del estudiante");
      if (passwordError) errors.contrasenia = passwordError;
    }
    const confirmError = passwordConfirmRule(data.contraseniaConfirmacion, data.contrasenia);
    if (confirmError) errors.contraseniaConfirmacion = confirmError;
  }
  return errors;
}

function validateOptionalStudentCredentials(data: EnrollFormData): string[] {
  return Object.values(optionalStudentCredentialErrors(data));
}

function validateRepresentative(data: EnrollFormData): string[] {
  return collect(REPRESENTATIVE_FIELDS, data);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * Issue #643: this gate asks whether the value may be CHOSEN, not whether it
 * exists in the enum. `DESCONOCIDO` exists — for the sake of records written
 * before the rule — but a public enrollment writes a new, complete record, so
 * "No lo sé" is the absence of an answer, not one.
 */
function isBloodType(value: string): value is BloodType {
  return isSelectableBloodType(value);
}

// ---------------------------------------------------------------------------
// Draft persistence (issue #317 / hallazgo #62)
//
// A reload used to lose every field the visitor had already typed: `formData`
// lived only in a `useState`, with nothing backing it. The fix mirrors
// `attendance-utils.ts`'s `cata_attendance_draft:` contract — `sessionStorage`,
// tab-scoped, best-effort (storage can be unavailable in private browsing or
// SSR), and discarded WHOLESALE rather than partially trusted if malformed.
//
// This is not the ghost-state pattern issue #310 (K3) removed from the
// attendance wizard. That draft outlived a REJECTED `POST` and showed a
// trainer's unaccepted marks as if the club had them on file. This draft is
// data the visitor typed and has never been sent anywhere — there is no
// server fact for it to contradict. `EnrollWizard` labels it on screen as
// unsent whenever it is restored, and clears it the moment the enrollment
// actually succeeds (see `handleConfirm`) or the visitor starts over
// (`handleReset`), so it can never again describe an abandoned attempt as the
// form's current state.
// ---------------------------------------------------------------------------

const ENROLL_DRAFT_KEY = "cata_enroll_draft";

/**
 * Password fields NEVER reach `sessionStorage` (issue #553): a draft used to
 * persist `contrasenia`/`contraseniaRepresentante` in plaintext beside the
 * cédulas and medical data of a minor. The stored draft omits these keys; on
 * restore the visitor re-types the password, and the wizard's own per-field
 * validation walks them back to the step that asks for it.
 *
 * Issue #876 extends the same "never persisted" set to the two confirmation
 * fields — they exist only to catch a typo on screen, never a value the
 * draft has any reason to remember.
 */
const ENROLL_PASSWORD_FIELDS = [
  "contrasenia",
  "contraseniaConfirmacion",
  "contraseniaRepresentante",
  "contraseniaRepresentanteConfirmacion",
] as const;

/** What actually lands in `sessionStorage` — the form minus its passwords. */
type StoredEnrollDraft = Omit<EnrollFormData, (typeof ENROLL_PASSWORD_FIELDS)[number]>;

function stripEnrollPasswords(data: EnrollFormData): StoredEnrollDraft {
  const {
    contrasenia: _c,
    contraseniaConfirmacion: _cc,
    contraseniaRepresentante: _r,
    contraseniaRepresentanteConfirmacion: _rc,
    ...stored
  } = data;
  return stored;
}

function isStoredEnrollDraft(value: unknown): value is StoredEnrollDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.enrollmentType !== ENROLLMENT_TYPES.SELF && record.enrollmentType !== ENROLLMENT_TYPES.CHILD) {
    return false;
  }
  return Object.keys(initialFormData).every((key) => {
    if (key === "enrollmentType") return true;
    // Password keys are absent from post-#553 drafts and present (about to be
    // dropped) in legacy ones — both shapes are valid stored drafts.
    if ((ENROLL_PASSWORD_FIELDS as readonly string[]).includes(key)) {
      return record[key] === undefined || typeof record[key] === "string";
    }
    return typeof record[key] === "string";
  });
}

/**
 * Parse a stored value into a draft plus whether it still carried password
 * keys — a legacy, pre-#553 draft that `loadEnrollDraft` must rewrite.
 */
function parseStoredEnrollDraft(raw: string | null): {
  draft: EnrollFormData | null;
  hadStoredPasswords: boolean;
} {
  if (!raw) return { draft: null, hadStoredPasswords: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { draft: null, hadStoredPasswords: false };
  }
  if (!isStoredEnrollDraft(parsed)) return { draft: null, hadStoredPasswords: false };
  const record = parsed as Record<string, unknown>;
  return {
    // Passwords are ALWAYS blanked, never read back from storage.
    draft: {
      ...parsed,
      contrasenia: "",
      contraseniaConfirmacion: "",
      contraseniaRepresentante: "",
      contraseniaRepresentanteConfirmacion: "",
    },
    hadStoredPasswords: ENROLL_PASSWORD_FIELDS.some((field) => record[field] !== undefined),
  };
}

/**
 * Parse a stored draft. Returns `null` for anything that is not a complete,
 * well-typed stored draft — a corrupted or tampered-with value is dropped
 * rather than half-applied, same rule `parseAttendanceDraft` follows. The
 * password fields come back empty regardless of what storage held (#553).
 */
export function parseEnrollDraft(raw: string | null): EnrollFormData | null {
  return parseStoredEnrollDraft(raw).draft;
}

/** Persist the draft — minus its passwords (#553). Losing draft persistence must never take the wizard down with it. */
export function saveEnrollDraft(data: EnrollFormData): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(ENROLL_DRAFT_KEY, JSON.stringify(stripEnrollPasswords(data)));
  } catch {
    // Best-effort: the wizard works exactly as before without it.
  }
}

/**
 * Read a stored draft, or `null` when there is none / storage is unavailable.
 *
 * A legacy draft that still holds plaintext passwords is rewritten sanitized
 * on this first read, so the passwords stop living in `sessionStorage` (#553).
 */
export function loadEnrollDraft(): EnrollFormData | null {
  if (typeof window === "undefined") return null;
  try {
    const { draft, hadStoredPasswords } = parseStoredEnrollDraft(
      window.sessionStorage?.getItem(ENROLL_DRAFT_KEY) ?? null,
    );
    if (draft && hadStoredPasswords) saveEnrollDraft(draft);
    return draft;
  } catch {
    return null;
  }
}

/** Drop the draft — called once the enrollment is actually submitted, or the visitor starts over. */
export function clearEnrollDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(ENROLL_DRAFT_KEY);
  } catch {
    // Ignore.
  }
}

