import { toUserMessage } from "@/lib/error-message";
import {
  cedulaRule,
  phoneRule,
  emergencyPhoneDiffersRule,
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

/**
 * Account types that create a STUDENT, and therefore require a medical record
 * (issue #730).
 *
 * Mirrors `TIPOS_CUENTA_ALUMNO` in `backend/app/presentacion/schemas/
 * admin_cuenta_schemas.py`, which is where the rule is actually enforced —
 * this copy exists so the wizard can say so before submitting, not so it can
 * decide. A coach or a representative never steps onto the court: demanding a
 * blood type from them would be the rule applied where it does not belong.
 */
export const STUDENT_ACCOUNT_TYPES: readonly AccountType[] = ["JUGADOR", "MENOR"];

/** Does this account type create a student, whose medical record is required? */
export function requiresMedicalRecord(accountType: AccountType | ""): boolean {
  return STUDENT_ACCOUNT_TYPES.includes(accountType as AccountType);
}

/** Wizard step identifiers. */
export type CrearCuentaStep = "type" | "personal" | "health" | "credentials" | "summary";

/** Step order used by the wizard. */
export const CREAR_CUENTA_STEP_ORDER: CrearCuentaStep[] = ["type", "personal", "health", "credentials", "summary"];

/**
 * Human-readable labels for each step, in Spanish and in SENTENCE case.
 *
 * They were Title Case, on a screen whose fields are labelled "Correo
 * electrónico" and "Nombre del contacto" — so the same page wrote the same
 * kind of string two ways. `STEP_LABELS` on the public wizard
 * (`enroll-utils.ts`) and `ADD_DEPENDENT_STEP_LABELS` on its sibling both
 * write sentence case; this was the odd one of the three.
 *
 * `health` also takes the words the other two use for the same four
 * questions. "Ficha médica" is the name of the RECORD; the step asks about
 * health and about who to call, which is what "Salud y emergencia" says.
 */
export const CREAR_CUENTA_STEP_LABELS: Record<CrearCuentaStep, string> = {
  type: "Tipo de cuenta",
  personal: "Datos personales",
  health: "Salud y emergencia",
  credentials: "Credenciales de acceso",
  summary: "Resumen y confirmación",
};

/** One-word names for the stepper pills — the same contract the two student wizards use. */
export const CREAR_CUENTA_SHORT_LABELS: Record<CrearCuentaStep, string> = {
  type: "Tipo",
  personal: "Datos",
  health: "Salud",
  credentials: "Acceso",
  summary: "Confirmar",
};

/**
 * Blood type options an admin may pick (issue #643).
 *
 * Not the whole `TipoSangre` enum any more: `DESCONOCIDO` still exists there
 * for records written before this rule, but it is no longer offered, and
 * `validateMedical` below rejects it for the same reason. A medical record the
 * club is writing today either has a blood type or is not being written.
 */
export const BLOOD_TYPE_OPTIONS = [
  "A_POSITIVO", "A_NEGATIVO", "B_POSITIVO", "B_NEGATIVO",
  "AB_POSITIVO", "AB_NEGATIVO", "O_POSITIVO", "O_NEGATIVO",
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

/** A form field this wizard can address. */
export type CrearCuentaField = keyof CrearCuentaFormData;

/**
 * The DOM id of each field, declared once and derived from the field NAME —
 * never from the label the visitor reads.
 *
 * The third and last copy of `ENROLL_FIELD_TOKEN`'s contract (enroll-utils.ts,
 * then add-dependent-utils.ts). This wizard passed no `field` to a single one
 * of its seven `WizardInput`s, so `slugifyLabel` built every id out of the
 * visible copy: "Fecha de Nacimiento" made `#crear-cuenta-fecha-de-nacimiento`
 * while the identical field on both student wizards is `-fecha-nacimiento`,
 * and "Contraseña" made `-contrasena` against their `-contrasenia`. Two of the
 * renames this batch makes for the rule of the words — Title Case out,
 * accents in — would each have moved an id.
 *
 * The tokens are the SAME strings the other two wizards use. Three screens
 * collect the same person; a field that means the same thing is addressed the
 * same way.
 *
 * `accountType` and `representanteId` name no `<input>` on purpose — the first
 * is the row of choice cards, the second is filled by a search — and they stay
 * here so this remains a total function of `CrearCuentaField`: a new form
 * field cannot be added without answering "what is its id".
 */
export const CREAR_CUENTA_FIELD_TOKEN: Record<CrearCuentaField, string> = {
  accountType: "tipo",
  nombres: "nombres",
  apellidos: "apellidos",
  cedula: "cedula",
  fechaNacimiento: "fecha-nacimiento",
  telefono: "telefono",
  correo: "correo",
  contrasenia: "contrasenia",
  representanteId: "representante",
  institucionId: "institucion",
  tipoSangre: "tipo-sangre",
  condicionesSalud: "condiciones-salud",
  alergias: "alergias",
  contactoEmergencia: "contacto-emergencia",
  telefonoEmergencia: "telefono-emergencia",
};

/** The id prefix every field on this wizard shares. */
export const CREAR_CUENTA_ID_PREFIX = "crear-cuenta";

/** The full DOM id of a field — what a test, a `<label for>` and a deep link all address. */
export function crearCuentaFieldId(field: CrearCuentaField): string {
  return `${CREAR_CUENTA_ID_PREFIX}-${CREAR_CUENTA_FIELD_TOKEN[field]}`;
}

/**
 * The id of the school-TYPE filter — outside the table for the same reason its
 * twin is on `/student/add-dependent`: it narrows the institution catalogue
 * and never reaches the payload.
 */
export const CREAR_CUENTA_SCHOOL_TYPE_ID = `${CREAR_CUENTA_ID_PREFIX}-tipo-escuela`;

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

/**
 * Whether completing any medical field turns the record's core emergency
 * details into a required set. This is the single contract shared by validation
 * and the health-step labels/HTML required state.
 */
export function hasCrearCuentaMedicalData(data: Pick<CrearCuentaFormData,
  "tipoSangre" | "condicionesSalud" | "alergias" | "contactoEmergencia" | "telefonoEmergencia"
>): boolean {
  return Boolean(
    data.tipoSangre || data.condicionesSalud.trim() || data.alergias.trim() ||
    data.contactoEmergencia.trim() || data.telefonoEmergencia.trim(),
  );
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
  // Issue #730: for a student, an empty step is no longer "nothing to
  // validate" — it is the omission the backend now answers 422 to. Only a
  // non-student may still leave the whole block blank.
  if (!hasCrearCuentaMedicalData(data) && !requiresMedicalRecord(data.accountType)) return errors;
  if (!BLOOD_TYPE_OPTIONS.includes(data.tipoSangre as typeof BLOOD_TYPE_OPTIONS[number])) {
    errors.push("El tipo de sangre es obligatorio.");
  }
  const contactoMessage = personNameRule(data.contactoEmergencia, "El nombre del contacto de emergencia", { plural: false });
  if (contactoMessage) errors.push(contactoMessage);
  // Issue #860: chained after `phoneRule`, same order the two student
  // wizards use — a malformed number is reported first.
  const telefonoEmergenciaMessage =
    phoneRule(data.telefonoEmergencia, "El teléfono de emergencia") ??
    emergencyPhoneDiffersRule(data.telefonoEmergencia, data.telefono);
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

// ---------------------------------------------------------------------------
// Draft persistence (issue #353)
//
// A session that expires mid-wizard (401 on the refresh) bounces the admin
// to /login and, without this, threw away everything typed so far — nombres,
// cédula, teléfono, ficha médica. Follows the exact pattern issue #317 (K8)
// already shipped for the public enrollment wizard
// (`student/enroll/enroll-utils.ts`'s saveEnrollDraft/loadEnrollDraft/
// clearEnrollDraft/parseEnrollDraft): `sessionStorage`, keyed to this one
// wizard, discarded wholesale — never partially trusted — the moment it does
// not parse as a complete `CrearCuentaFormData`.
// ---------------------------------------------------------------------------

const CREAR_CUENTA_DRAFT_KEY = "cata_crear_cuenta_draft";

const KNOWN_ACCOUNT_TYPES: readonly (AccountType | "")[] = ["", "JUGADOR", "REPRESENTANTE", "MENOR", "ENTRENADOR"];

/**
 * The password NEVER reaches `sessionStorage` (issue #553): the draft used to
 * persist `contrasenia` in plaintext beside the person's cédula and medical
 * data. The stored draft omits the key; on restore the admin re-types it, and
 * the credentials step's own validation blocks "Siguiente" until they do.
 */

/** What actually lands in `sessionStorage` — the form minus its password. */
type StoredCrearCuentaDraft = Omit<CrearCuentaFormData, "contrasenia">;

function stripCrearCuentaPassword(data: CrearCuentaFormData): StoredCrearCuentaDraft {
  const { contrasenia: _c, ...stored } = data;
  return stored;
}

function isStoredCrearCuentaDraft(value: unknown): value is StoredCrearCuentaDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (!KNOWN_ACCOUNT_TYPES.includes(record.accountType as AccountType | "")) return false;
  // `representanteId` is the one field that is not a plain string — every
  // other key on `CrearCuentaFormData` is (see its interface above).
  if (typeof record.representanteId !== "number" && record.representanteId !== "") return false;
  return Object.keys(initialCrearCuentaFormData).every((key) => {
    if (key === "accountType" || key === "representanteId") return true;
    // Absent from post-#553 drafts, present (about to be dropped) in legacy
    // ones — both shapes are valid stored drafts.
    if (key === "contrasenia") return record[key] === undefined || typeof record[key] === "string";
    return typeof record[key] === "string";
  });
}

/**
 * Parse a stored value into a draft plus whether it still carried the
 * password key — a legacy, pre-#553 draft `loadCrearCuentaDraft` must rewrite.
 */
function parseStoredCrearCuentaDraft(raw: string | null): {
  draft: CrearCuentaFormData | null;
  hadStoredPassword: boolean;
} {
  if (!raw) return { draft: null, hadStoredPassword: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { draft: null, hadStoredPassword: false };
  }
  if (!isStoredCrearCuentaDraft(parsed)) return { draft: null, hadStoredPassword: false };
  return {
    // The password is ALWAYS blanked, never read back from storage.
    draft: { ...parsed, contrasenia: "" },
    hadStoredPassword: (parsed as Record<string, unknown>).contrasenia !== undefined,
  };
}

/**
 * Parse a stored draft. Returns `null` for anything that is not a complete,
 * well-typed stored draft — a corrupted or tampered-with value is dropped
 * rather than half-applied, same rule `parseEnrollDraft` follows. The
 * password field comes back empty regardless of what storage held (#553).
 */
export function parseCrearCuentaDraft(raw: string | null): CrearCuentaFormData | null {
  return parseStoredCrearCuentaDraft(raw).draft;
}

/** Persist the draft — minus its password (#553). Losing draft persistence must never take the wizard down with it. */
export function saveCrearCuentaDraft(data: CrearCuentaFormData): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(
      CREAR_CUENTA_DRAFT_KEY,
      JSON.stringify(stripCrearCuentaPassword(data)),
    );
  } catch {
    // Best-effort: the wizard works exactly as before without it.
  }
}

/**
 * Read a stored draft, or `null` when there is none / storage is unavailable.
 *
 * A legacy draft that still holds a plaintext password is rewritten sanitized
 * on this first read, so the password stops living in `sessionStorage` (#553).
 */
export function loadCrearCuentaDraft(): CrearCuentaFormData | null {
  if (typeof window === "undefined") return null;
  try {
    const { draft, hadStoredPassword } = parseStoredCrearCuentaDraft(
      window.sessionStorage?.getItem(CREAR_CUENTA_DRAFT_KEY) ?? null,
    );
    if (draft && hadStoredPassword) saveCrearCuentaDraft(draft);
    return draft;
  } catch {
    return null;
  }
}

/** Drop the draft — called once the account is actually created, or the admin starts over. */
export function clearCrearCuentaDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(CREAR_CUENTA_DRAFT_KEY);
  } catch {
    // Ignore.
  }
}
