/**
 * Pure utility functions for the Student Enrollment page.
 *
 * Extracted from page.tsx for testability and to avoid Next.js page
 * export conflicts — no React dependencies.
 */

import {
  isSelectableBloodType,
  type BloodType,
  type EnrollmentRequest,
  type EnrollmentStudent,
} from "@/types/enrollment";
import { WIZARD_STEP_PARAM, stepParamValue } from "@/lib/wizard-history";
import { isDuplicateIdentityError } from "@/lib/duplicate-identity";
import { toUserMessage } from "@/lib/error-message";
import { formatCurrency } from "@/lib/format-utils";
import {
  cedulaRule,
  phoneRule,
  phoneFieldRule,
  toStoredPhone,
  emergencyPhoneDiffersRule,
  representativeCedulaDiffersRule,
  personNameRule,
  normalizePersonName,
  passwordRule,
  studentBirthDateRule,
  calculatePersonAge,
  isValidCalendarDate,
  isMinorAge,
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

/**
 * REG-25: the `?type=` the landing buttons link with. Both the product's own
 * words (`self`, `child`) and the older aliases (`player`, `representative`)
 * are accepted; anything else — including prototype keys such as
 * `constructor` — is `null`, so an unknown value never picks a flow.
 */
const ENROLLMENT_TYPE_PARAMS: ReadonlyMap<string, EnrollmentType> = new Map([
  ["self", ENROLLMENT_TYPES.SELF],
  ["player", ENROLLMENT_TYPES.SELF],
  ["child", ENROLLMENT_TYPES.CHILD],
  ["representative", ENROLLMENT_TYPES.CHILD],
]);

export function enrollmentTypeFromParam(raw: string | null): EnrollmentType | null {
  return (raw !== null && ENROLLMENT_TYPE_PARAMS.get(raw)) || null;
}

/**
 * Reads the landing's `?type=` ONCE per mount (the ref keeps a StrictMode
 * re-run from finding the URL already cleaned) and consumes it from the
 * address bar:
 * - `type` is removed, so a later reload cannot override a choice the visitor
 *   changed on step 1;
 * - a valid type with no `paso` yet lands on step 2, because the button
 *   already answered step 1 (the «Tipo» step stays for whoever arrives without
 *   choosing, or opens `?paso=1` on purpose).
 * Uses `replaceState`, so Back leaves the wizard instead of walking into it.
 */
export function takePreselectedEnrollmentType(
  cache: { current: EnrollmentType | null | undefined },
): EnrollmentType | null {
  if (cache.current !== undefined) return cache.current;
  const url = new URL(window.location.href);
  const type = enrollmentTypeFromParam(url.searchParams.get("type"));
  if (url.searchParams.has("type")) {
    url.searchParams.delete("type");
    if (type && !url.searchParams.has(WIZARD_STEP_PARAM)) {
      url.searchParams.set(WIZARD_STEP_PARAM, stepParamValue("personal", STEP_ORDER));
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  cache.current = type;
  return type;
}

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
  /**
   * Issue #1138: only collected/sent for a "self" (adult) enrollment. A
   * "child" enrollment never renders or sends these two — the represented
   * minor's emergency contact is derived from the representante, never a
   * free-text field this form collects.
   */
  contactoEmergencia: string;
  telefonoEmergencia: string;
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
    case "representative":
      // NOT `fieldsForStep`: this runs as an aggregate check too, so it must
      // hold even for a self enrollment that never renders the step.
      errors.push(...validateRepresentative(data));
      break;
    case "health":
      errors.push(...collect(healthFieldsFor(data.enrollmentType), data));
      break;
    case "summary":
      break;
  }
  return errors;
}

export function validateEnrollment(data: EnrollFormData): string[] {
  return [
    ...validateStudent(data),
    ...(data.enrollmentType === ENROLLMENT_TYPES.SELF ? validateStudentCredentials(data) : []),
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
  if (field === "correo") {
    return "El servidor no aceptó el correo electrónico. Corríjalo en el paso «Datos del estudiante» e intente de nuevo.";
  }
  if (field === "correoRepresentante") {
    return "El servidor no aceptó el correo electrónico del representante. Corríjalo en el paso «Datos del representante» e intente de nuevo.";
  }
  // The old helper carried two fallbacks — "revise sus datos" for 400/422 and
  // "intente más tarde" for everything else. The translator answers everything
  // else from the status now, so the one remaining fallback is the one for the
  // case it cannot answer: a 400/422 whose detail was not fit to show. Telling
  // that user to wait would be the wrong advice; their form is what is wrong.
  const message = toUserMessage(
    error,
    "No pudimos registrar la inscripción. Revise los datos de cada paso e intente de nuevo.",
  );
  return isDuplicateIdentityError(message) ? DUPLICATE_IDENTITY_COPY : message;
}

/**
 * The backend's anti-enumeration answer says a datum "pertenece a una cuenta
 * registrada" without saying which one. The visitor needs the next move too, so
 * the wizard restates it; `isDuplicateIdentityError` recognises this sentence.
 */
const DUPLICATE_IDENTITY_COPY =
  "Ya existe una cuenta registrada con la cédula o el correo que ingresó. Si es suya, inicie sesión; si no, revise que los datos estén bien escritos.";

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
    nombres: normalizePersonName(data.nombres), apellidos: normalizePersonName(data.apellidos), cedula: data.cedula.trim(),
    fechaNacimiento: data.fechaNacimiento,
    // Issue #1197: a represented minor has no phone of their own — the key
    // is omitted entirely on the CHILD path (never sent as "", which the
    // backend's TelefonoValidado explicitly rejects as blank). Issue #1296:
    // on the SELF path the visitor typed the local digits after the fixed
    // +593; the contract the backend expects is the local 0XXXXXXXX form.
    ...(data.enrollmentType === ENROLLMENT_TYPES.SELF
      ? { telefono: toStoredPhone(data.telefono) }
      : {}),
  } as EnrollmentStudent;
  const fichaMedica = {
    tipoSangre: data.tipoSangre as BloodType, condicionesSalud: data.condicionesSalud.trim(),
    alergias: data.alergias.trim(),
    // Issue #1138: a "child" enrollment never sends these two — the
    // represented minor's emergency contact is derived from the
    // representante, and the backend rejects them explicitly if sent.
    ...(data.enrollmentType === ENROLLMENT_TYPES.SELF
      ? {
          contactoEmergencia: data.contactoEmergencia.trim(),
          telefonoEmergencia: toStoredPhone(data.telefonoEmergencia),
        }
      : {}),
  };
  if (data.enrollmentType === ENROLLMENT_TYPES.SELF) {
    return { alumno, fichaMedica, aceptaConsentimientos, credencialesAlumno: { correo: data.correo.trim(), contrasenia: data.contrasenia } };
  }
  const result: EnrollmentRequest = {
    alumno, fichaMedica, aceptaConsentimientos,
    representante: {
      nombres: normalizePersonName(data.nombreRepresentante), apellidos: normalizePersonName(data.apellidosRepresentante),
      cedula: data.cedulaRepresentante.trim(), fechaNacimiento: data.fechaNacimientoRepresentante,
      telefono: data.telefonoRepresentante.trim(), correo: data.correoRepresentante.trim(),
      contrasenia: data.contraseniaRepresentante,
    },
  };
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
 * One entry names no input on purpose and exists so this table stays a total
 * function of `EnrollField`: `enrollmentType` is the pair of choice cards on
 * the first step. A new form field cannot be added without answering "what is
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
 * caller — `FIELD_RULES` for self/representante credentials.
 */
function passwordConfirmRule(confirm: string, password: string): string | null {
  if (confirm.length === 0) return "Repita la contraseña para confirmarla.";
  return confirm === password ? null : "Las contraseñas no coinciden. Escriba la misma contraseña en los dos campos.";
}

const FIELD_RULES: Partial<Record<EnrollField, (data: EnrollFormData) => string | null>> = {
  nombres: (d) => personNameRule(d.nombres, "Los nombres"),
  apellidos: (d) => personNameRule(d.apellidos, "Los apellidos"),
  fechaNacimiento: (d) => {
    const boundsError = studentBirthDateRule(d.fechaNacimiento);
    if (boundsError) return boundsError;
    if (
      d.enrollmentType === ENROLLMENT_TYPES.SELF &&
      isMinorAge(calculatePersonAge(d.fechaNacimiento))
    ) {
      return "El alumno es menor de edad y necesita un representante. Vuelva al primer paso y elija «Representante».";
    }
    if (
      d.enrollmentType === ENROLLMENT_TYPES.CHILD &&
      !isMinorAge(calculatePersonAge(d.fechaNacimiento))
    ) {
      return "El alumno ya es mayor de edad y gestiona su propia cuenta. Vuelva al primer paso y elija «Jugador».";
    }
    return null;
  },
  cedula: (d) => cedulaRule(d.cedula, "La cédula de identidad"),
  // Issue #1296: the same `PhoneField`/`phoneFieldRule` pair every other
  // phone field on the app now shares — the visitor types the local digits
  // after the fixed +593, and this rule validates the local (mobile-or-
  // landline) form those digits canonicalize to.
  telefono: (d) => phoneFieldRule(d.telefono, "El teléfono", { guided: true }),
  correo: (d) =>
    d.correo.trim().length === 0
      ? "Escriba su correo electrónico: lo usará para iniciar sesión."
      : isEmail(d.correo)
        ? null
        : "El correo electrónico no es válido. Revíselo; debe tener un formato como nombre@ejemplo.com.",
  contrasenia: (d) =>
    d.contrasenia.length === 0
      ? "Cree una contraseña para su cuenta."
      : passwordRule(d.contrasenia, "La contraseña"),
  contraseniaConfirmacion: (d) => passwordConfirmRule(d.contraseniaConfirmacion, d.contrasenia),
  nombreRepresentante: (d) => personNameRule(d.nombreRepresentante, "Los nombres del representante"),
  apellidosRepresentante: (d) =>
    personNameRule(d.apellidosRepresentante, "Los apellidos del representante"),
  cedulaRepresentante: (d) =>
    // Issue #1397: chained after the field's own rule so a malformed number
    // is reported first — the cross-check only makes sense once the value is
    // itself a valid cédula. Same shape as `telefonoEmergencia` below; the
    // backend answers the same collision with the mirrored message.
    cedulaRule(d.cedulaRepresentante, "La cédula del representante") ??
    representativeCedulaDiffersRule(d.cedulaRepresentante, d.cedula),
  fechaNacimientoRepresentante: (d) => {
    if (!d.fechaNacimientoRepresentante) {
      return "Indique la fecha de nacimiento del representante.";
    }
    if (!isValidCalendarDate(d.fechaNacimientoRepresentante)) {
      return "La fecha de nacimiento del representante no existe. Revise el día, el mes y el año.";
    }
    const edad = calculatePersonAge(d.fechaNacimientoRepresentante);
    return edad >= EDAD_MAYORIA_EDAD && edad <= EDAD_MAXIMA_ALUMNO
      ? null
      : `El representante debe tener entre ${EDAD_MAYORIA_EDAD} y ${EDAD_MAXIMA_ALUMNO} años; la fecha ingresada corresponde a ${edad} ${edad === 1 ? "año" : "años"}. Revise el año de nacimiento.`;
  },
  telefonoRepresentante: (d) => phoneRule(d.telefonoRepresentante, "El teléfono del representante"),
  correoRepresentante: (d) =>
    d.correoRepresentante.trim().length === 0
      ? "Escriba el correo electrónico del representante: lo usará para iniciar sesión."
      : isEmail(d.correoRepresentante)
        ? null
        : "El correo del representante no es válido. Revíselo; debe tener un formato como nombre@ejemplo.com.",
  contraseniaRepresentante: (d) =>
    d.contraseniaRepresentante.length === 0
      ? "Cree una contraseña para la cuenta del representante."
      : passwordRule(d.contraseniaRepresentante, "La contraseña del representante"),
  contraseniaRepresentanteConfirmacion: (d) =>
    passwordConfirmRule(d.contraseniaRepresentanteConfirmacion, d.contraseniaRepresentante),
  tipoSangre: (d) => (isBloodType(d.tipoSangre) ? null : "Seleccione el tipo de sangre del alumno."),
  contactoEmergencia: (d) =>
    personNameRule(d.contactoEmergencia, "El nombre del contacto de emergencia", { plural: false }),
  // Issue #860: chained after `phoneFieldRule` so a malformed number is
  // reported first — the cross-check only makes sense once the value is
  // itself a valid Ecuadorian phone. Both sides are canonicalized to the
  // local `0XXXXXXXX` form before comparing (issue #1296: both fields now
  // hold the same digits-only shape, so the comparison needs both restored).
  telefonoEmergencia: (d) =>
    phoneFieldRule(d.telefonoEmergencia, "El teléfono de emergencia", { guided: true }) ??
    emergencyPhoneDiffersRule(toStoredPhone(d.telefonoEmergencia), toStoredPhone(d.telefono)),
};

// Issue #1197: a represented minor has no phone of their own — the
// emergency contact already derives from the representative — so the
// CHILD path never renders or validates the student phone field.
const STUDENT_FIELDS_CHILD: EnrollField[] = [
  "nombres",
  "apellidos",
  "fechaNacimiento",
  "cedula",
];
const STUDENT_FIELDS_SELF: EnrollField[] = [...STUDENT_FIELDS_CHILD, "telefono"];

function studentFieldsFor(type: EnrollmentType): EnrollField[] {
  return type === ENROLLMENT_TYPES.CHILD ? STUDENT_FIELDS_CHILD : STUDENT_FIELDS_SELF;
}

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

// Issue #1138: a represented child never has a contact of their own — the
// health step only asks for the two emergency-contact fields on the "self"
// (adult) path.
const HEALTH_FIELDS_SELF: EnrollField[] = ["tipoSangre", "contactoEmergencia", "telefonoEmergencia"];
const HEALTH_FIELDS_CHILD: EnrollField[] = ["tipoSangre"];

function healthFieldsFor(type: EnrollmentType): EnrollField[] {
  return type === ENROLLMENT_TYPES.CHILD ? HEALTH_FIELDS_CHILD : HEALTH_FIELDS_SELF;
}

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
      // required here. A represented child never has credentials (issue
      // #1137, invariante B: un representado nunca tiene Usuario propio).
      return isChild ? studentFieldsFor(type) : [...studentFieldsFor(type), ...CREDENTIAL_FIELDS];
    case "representative":
      // Skipped entirely for a self enrollment — there is no representante.
      return isChild ? REPRESENTATIVE_FIELDS : [];
    case "health":
      return healthFieldsFor(type);
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

/**
 * Whether a Stepper-originated jump should arm the one-shot focus flag
 * (issue #1347, item 1 — review advisory de #1346, R2-001/R3-002/R4-001).
 *
 * `goToStep` (`wizard-history.ts`) already no-ops when `destination` equals
 * `current` — no history entry is pushed and `step` never changes. Arming the
 * flag anyway would leave it armed with nothing left to consume it, so the
 * NEXT unrelated step change (an ordinary "Siguiente"/"Atrás") would steal
 * focus to the heading in its place. Unreachable through today's `Stepper`
 * (only a DONE step is ever clickable, and a done step is never the current
 * one), but the guard belongs here, not on that accident.
 */
export function shouldFocusStepHeadingOnJump(
  destination: WizardStep,
  current: WizardStep,
): boolean {
  return destination !== current;
}

function validateStudent(data: EnrollFormData): string[] {
  return collect(studentFieldsFor(data.enrollmentType), data);
}

function validateStudentCredentials(data: EnrollFormData): string[] {
  return collect(CREDENTIAL_FIELDS, data);
}

function validateRepresentative(data: EnrollFormData): string[] {
  return collect(REPRESENTATIVE_FIELDS, data);
}

/**
 * Mirrors the format the server accepts (REG-04): no empty or doubled dots in
 * the local part or the domain, and a TLD of two or more letters — so
 * `a@b..com` and `a@b.c` fail at the step instead of at the final submit.
 */
const EMAIL_PATTERN = /^[^\s@.]+(?:\.[^\s@.]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;

function isEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** FAM-08: a plan option reads «Mensual Adultos — $40,00 al mes», never with its internal code. */
export function planOptionLabel(nombre: string, precio: number | string | null | undefined): string {
  return `${nombre} — ${formatCurrency(precio)} al mes`;
}

/** FAM-08: an institution option is its name only; the school-type code is internal. */
export function institutionOptionLabel(nombre: string): string {
  return nombre;
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
  // Built key-by-key from `initialFormData` rather than `{ ...parsed }`: a
  // draft saved by an older build can still carry a field this version no
  // longer has (e.g. `institucionId`, removed by #1190) — spreading the raw
  // stored object would let it ride straight into `formData` again.
  const draft = { ...initialFormData } as EnrollFormData;
  for (const key of Object.keys(initialFormData) as EnrollField[]) {
    if (key === "enrollmentType") continue;
    if (typeof record[key] === "string") {
      (draft as Record<EnrollField, string>)[key] = record[key] as string;
    }
  }
  draft.enrollmentType = record.enrollmentType as EnrollmentType;
  return {
    // Passwords are ALWAYS blanked, never read back from storage.
    draft: {
      ...draft,
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

