/**
 * Shared identity/person validation rules — cédula, phone, person name,
 * student age, and password.
 *
 * ## Why this file exists
 *
 * Four rules that ought to be ONE rule each were instead written three times,
 * once per signup wizard, and drifted every time:
 *
 *   - `frontend/src/app/student/enroll/enroll-utils.ts`
 *   - `frontend/src/app/student/add-dependent/add-dependent-utils.ts`
 *   - `frontend/src/app/admin/crear-cuenta/crear-cuenta-utils.ts`
 *
 * Cédula validation was `/^\d{10}$/` in all three (length only — no province,
 * no check digit). Phone validation disagreed between "7-10 digits after
 * stripping letters" and "7-10 digits, letters rejected". The person-name
 * pattern rejected real hyphenated/apostrophe surnames. The age rule the
 * backend actually enforces (`EDAD_MINIMA_ALUMNO`/`EDAD_MAXIMA_ALUMNO` in
 * `backend/app/servicios_negocio/persona_servicio.py`) existed in two of the
 * three wizards and was missing from the third, the one the public uses to
 * self-enroll.
 *
 * This module is the single place those rules live now: `enroll-utils.ts`,
 * `add-dependent-utils.ts`, and `crear-cuenta-utils.ts` (PR #255) all import
 * from here instead of carrying their own copy, so the three wizards can no
 * longer drift against each other or against the backend's bounds.
 *
 * ## The "today" parameter
 *
 * Every function here that needs "the current date" takes it as an explicit
 * parameter defaulting to `new Date()`, never reading the clock internally
 * mid-computation. The backend's own test suite freezes "today" at
 * `2029-01-01` (`FECHA_CONGELADA_HOY` in `backend/tests/conftest.py`); a rule
 * that reads the real clock produces answers that disagree with the backend
 * by however many years have passed since that freeze, which reads as a
 * defect in the rule when the actual mismatch is in the test's assumptions.
 */

// ---------------------------------------------------------------------------
// Cédula (Ecuadorian national ID)
// ---------------------------------------------------------------------------

const CEDULA_LENGTH = 10;

/** Módulo 10 coefficients applied to the first 9 digits, in order. */
const CEDULA_CHECK_COEFFICIENTS = [2, 1, 2, 1, 2, 1, 2, 1, 2];

/** Provinces 01-24, plus 30 for Ecuadorians registered while living abroad. */
function hasValidCedulaProvince(digits: string): boolean {
  const province = Number(digits.slice(0, 2));
  return (province >= 1 && province <= 24) || province === 30;
}

/**
 * Módulo 10 check digit: each of the first 9 digits is multiplied by its
 * coefficient (2,1,2,1,2,1,2,1,2); any product over 9 has 9 subtracted; the
 * results are summed; the check digit is whatever closes that sum to the
 * next multiple of 10 (0 if it is already a multiple of 10).
 *
 * Deliberately NOT implemented: the "third digit must be under 6" rule.
 * Real cédulas have been issued with a third digit of 6, and Registro Civil
 * staff have said that digit is not used for validation — see issue #228.
 * Enforcing it would reject real people over a rule nobody official applies.
 */
function hasValidCedulaCheckDigit(digits: string): boolean {
  const checkDigit = Number(digits[CEDULA_LENGTH - 1]);
  const sum = CEDULA_CHECK_COEFFICIENTS.reduce((total, coefficient, index) => {
    const product = Number(digits[index]) * coefficient;
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  const remainder = sum % 10;
  const expected = remainder === 0 ? 0 : 10 - remainder;
  return expected === checkDigit;
}

/**
 * Why a cédula is not valid — distinguished so the message can say "wrong
 * length" and "not a real number" as the two different errors they are
 * (issue #228: they are corrected differently). `null` means valid.
 */
export type CedulaErrorReason = "length" | "invalid";

export function cedulaError(value: string): CedulaErrorReason | null {
  const trimmed = value.trim();
  if (!/^\d{10}$/.test(trimmed)) return "length";
  return hasValidCedulaProvince(trimmed) && hasValidCedulaCheckDigit(trimmed) ? null : "invalid";
}

export function isValidCedula(value: string): boolean {
  return cedulaError(value) === null;
}

/**
 * `subject` is the feminine noun phrase the message is built around, e.g.
 * `"La cédula"` or `"La cédula del representante"`.
 */
export function cedulaRule(value: string, subject: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${subject} es obligatoria.`;
  const reason = cedulaError(trimmed);
  if (reason === null) return null;
  return reason === "length" ? `${subject} debe tener 10 dígitos.` : `${subject} no es válida.`;
}

// ---------------------------------------------------------------------------
// Phone (Ecuadorian numbering plan — ARCOTEL)
// ---------------------------------------------------------------------------

/**
 * Explicit allowlist of typing separators — never "strip everything that
 * isn't a digit". That silent-strip is what let `099abc1234` through before
 * (issue #229): the letters vanished along with the separators, and what
 * was left happened to be a valid-looking length.
 */
const PHONE_SEPARATOR_PATTERN = /[\s\-()]/g;

/** Celular: `09` + 8 digits = 10 digits total. */
const MOBILE_PATTERN = /^09\d{8}$/;

/** Fijo: `0` + 1-digit area code + 7-digit subscriber number = 9 digits total. */
const LANDLINE_PATTERN = /^0\d{8}$/;

export type PhoneErrorReason = "invalid-chars" | "invalid-number";

export function phoneError(value: string): PhoneErrorReason | null {
  const stripped = value.replace(PHONE_SEPARATOR_PATTERN, "");
  if (!/^\d+$/.test(stripped)) return "invalid-chars";
  return MOBILE_PATTERN.test(stripped) || LANDLINE_PATTERN.test(stripped) ? null : "invalid-number";
}

export function isValidEcuadorianPhone(value: string): boolean {
  return phoneError(value) === null;
}

/**
 * `subject` is the masculine noun phrase the message is built around, e.g.
 * `"El teléfono"` or `"El teléfono del representante"`.
 */
export function phoneRule(value: string, subject: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${subject} es obligatorio.`;
  const reason = phoneError(trimmed);
  if (reason === null) return null;
  if (reason === "invalid-chars") {
    return `${subject} solo puede contener dígitos y separadores (espacio, guion, paréntesis).`;
  }
  return `${subject} debe ser un celular (09 y 8 dígitos más) o un fijo (0, código de área y 7 dígitos, 9 en total).`;
}

// ---------------------------------------------------------------------------
// Person name — nombres, apellidos, and (per issue #230) the emergency
// contact, which is a person's name and was validated as if it were not one.
// ---------------------------------------------------------------------------

export const PERSON_NAME_MIN_LENGTH = 3;

/**
 * Letters (incl. accents), spaces, and the three connectors real names use:
 * apostrophe, hyphen, and interpunct. A connector may never open or close
 * the name, and two connectors may never sit next to each other — enforced
 * by requiring at least one letter between any two connector positions,
 * rather than by a denylist of "bad" sequences.
 *
 * The accented span is written as three runs rather than one `À-ɏ` sweep
 * because Latin-1 Supplement embeds two non-letters among its letters: `×`
 * (U+00D7) and `÷` (U+00F7). `À-Ö` stops before U+00D7, `Ø-ö` resumes after
 * it and stops before U+00F7, and `ø-ɏ` resumes after that — excluding
 * exactly those two code points and nothing else.
 */
export const PERSON_NAME_PATTERN =
  /^[A-Za-zÀ-ÖØ-öø-ɏ]+(?:[ '\-·][A-Za-zÀ-ÖØ-öø-ɏ]+)*$/;

/**
 * `subject` is the noun phrase the message is built around, e.g.
 * `"Los apellidos"` (plural) or `"El nombre del contacto de emergencia"`
 * (singular — pass `{ plural: false }`).
 */
export function personNameRule(
  value: string,
  subject: string,
  { plural = true }: { plural?: boolean } = {},
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return `${subject} ${plural ? "son" : "es"} obligatorio${plural ? "s" : ""}.`;
  if (trimmed.length < PERSON_NAME_MIN_LENGTH) {
    return `${subject} ${plural ? "deben" : "debe"} tener al menos ${PERSON_NAME_MIN_LENGTH} caracteres.`;
  }
  return PERSON_NAME_PATTERN.test(trimmed)
    ? null
    : `${subject} ${plural ? "tienen" : "tiene"} un carácter que no reconocemos en un nombre de persona.`;
}

// ---------------------------------------------------------------------------
// Student age — the backend's own bounds (`EnrollmentServicio.enroll`,
// `persona_servicio.py`), which one of the three wizards never implemented.
// ---------------------------------------------------------------------------

export const EDAD_MINIMA_ALUMNO = 5;
export const EDAD_MAXIMA_ALUMNO = 74;
export const EDAD_MAYORIA_EDAD = 18;

/**
 * Calculate age in whole years from an ISO `YYYY-MM-DD` string.
 *
 * Parses the date component-wise instead of via `new Date("YYYY-MM-DD")`
 * (which parses as UTC midnight and shifts a day backward in Ecuador's
 * negative UTC offset) and does the comparison in local calendar terms.
 *
 * Returns `NaN` only for input that is not a real calendar date at all —
 * wrong shape, a non-integer component, a month/day out of range, or a day
 * that does not exist in that month (e.g. Feb 31). It does NOT cap or reject
 * implausible-but-real years: whether a given age is a believable human age
 * is a domain rule (`EDAD_MINIMA_ALUMNO`/`EDAD_MAXIMA_ALUMNO`), not a parsing
 * concern. A parser that rejects implausible years by returning `NaN` makes
 * every numeric bound comparison against it silently `false` (`NaN < 5` and
 * `NaN > 74` both are), which is how an 1800 birth year used to sail through
 * every age check in this codebase instead of failing the one meant to catch
 * it — see the equivalent history in `enroll-utils.ts`'s `calculateAge`.
 */
export function calculatePersonAge(birthDate: string, today: Date = new Date()): number {
  if (!birthDate) return NaN;

  const parts = birthDate.split("-");
  if (parts.length !== 3) return NaN;

  const [birthYear, birthMonth, birthDay] = parts.map(Number);

  if (
    !Number.isInteger(birthYear) ||
    !Number.isInteger(birthMonth) ||
    !Number.isInteger(birthDay) ||
    birthMonth < 1 ||
    birthMonth > 12 ||
    birthDay < 1 ||
    birthDay > 31
  ) {
    return NaN;
  }

  // Round-trips through `Date` to reject calendar overflow (Feb 31) and
  // years too extreme for `Date` to represent (Invalid Date's
  // `getFullYear()` is `NaN`, which never equals `birthYear`).
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

export function isValidCalendarDate(value: string): boolean {
  return !Number.isNaN(calculatePersonAge(value));
}

/**
 * Whether `birthDate` falls after `today`'s calendar date. Only meaningful
 * for a value that is already a real calendar date — callers check
 * `isValidCalendarDate` first, the same order `studentBirthDateRule` uses.
 */
export function isFutureBirthDate(birthDate: string, today: Date = new Date()): boolean {
  const [year, month, day] = birthDate.split("-").map(Number);
  const parsedDate = new Date(year, month - 1, day);
  const referenceDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return parsedDate > referenceDate;
}

/**
 * The student birth-date rule the backend enforces
 * (`5 <= edad <= 74`), applied at the field instead of discovered only after
 * a full wizard and a rejected submit (issue #224).
 *
 * A future date is rejected for BEING future, with its own message — never
 * routed through the age check, where it used to surface as a nonsensical
 * negative age and a "menores de edad" message that sent the visitor to fix
 * the wrong thing.
 */
export function studentBirthDateRule(value: string, today: Date = new Date()): string | null {
  if (!value) return "La fecha de nacimiento es obligatoria.";
  if (!isValidCalendarDate(value)) return "La fecha de nacimiento ingresada no es válida.";
  if (isFutureBirthDate(value, today)) return "La fecha de nacimiento no puede ser en el futuro.";
  const age = calculatePersonAge(value, today);
  if (age < EDAD_MINIMA_ALUMNO || age > EDAD_MAXIMA_ALUMNO) {
    return `La edad del alumno debe estar entre ${EDAD_MINIMA_ALUMNO} y ${EDAD_MAXIMA_ALUMNO} años (calculado: ${age}).`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 8;

// The common-password list, kept as themed groups rather than one flat
// array. The groups are how the list is actually maintained — you add a
// keyboard walk next to the other keyboard walks — and each stays small
// enough to read in one screen.

const DIGIT_SEQUENCES = [
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000",
  "22222222", "33333333", "44444444", "55555555", "66666666", "77777777",
  "88888888", "99999999", "123123123", "12341234", "01234567", "98765432",
  "11223344", "10203040", "192837465", "13131313", "12121212", "11112222",
  "1111", "0000", "121212", "112233", "555555", "666666", "777777", "888888",
  "999999", "102030", "1q2w3e4r", "1qaz2wsx", "1qazxsw2", "q1w2e3r4",
  "zaq12wsx", "1234qwer",
];

const KEYBOARD_WALKS = [
  "qwerty", "qwertyui", "qwertyuiop", "qwerty123", "asdfghjk", "asdfasdf",
  "asdfghjkl", "zxcvbnm", "zxcvbnm1", "zxcvbn", "qazwsxedc", "poiuytrewq",
  "mnbvcxz",
];

const WORDS_AND_CHARACTERS = [
  "password", "password1", "password123", "passw0rd", "letmein", "letmein1",
  "welcome", "welcome1", "welcome123", "monkey", "monkey1", "dragon",
  "dragon1", "football", "football1", "baseball", "baseball1", "master",
  "master1", "shadow", "superman", "batman", "spiderman", "starwars",
  "whatever", "computer", "internet", "freedom", "matrix", "ninja123",
  "hunter1", "hunter2", "soccer", "hockey123", "killer123", "trustno1",
];

const AFFECTION_SEASONS_AND_COLORS = [
  "iloveyou", "iloveyou1", "sunshine", "sunshine1", "princess", "princess1",
  "cheese123", "summer2024", "summer123", "winter123", "spring123",
  "flower123", "purple123", "diamond1", "silver123", "golden123",
  "family123", "friends1", "forever1", "always123", "mylove123",
  "sweetheart", "chocolate",
];

const ACCOUNT_DEFAULTS = [
  "abcd1234", "a1b2c3d4", "abc12345", "test1234", "testing123",
  "changeme", "changeme1", "default1", "admin123", "administrator",
  "adminadmin", "rootroot", "toor1234", "guest123", "temp1234", "temppass",
  "newpass1", "mypassword", "thepassword", "secret123", "secretpass",
  "access123", "login123", "loginpass", "userpass1", "username1",
];

const NAMES_FRANCHISES_AND_LETTER_RUNS = [
  "jennifer1", "michelle1", "michael12", "jordan23",
  "charlie12", "thomas123", "hannah123", "maggie123", "george123",
  "andrew123", "opensesame", "iamgroot1", "harrypotter", "pokemon123",
  "minecraft", "aaaaaaaa", "bbbbbbbb", "abcdefgh", "abcdefg1",
];

const SPANISH_AND_ECUADORIAN = [
  "contraseña", "contrasena", "contrasena1", "clave1234", "clave123",
  "hola1234", "hola12345", "usuario123", "cambiar123", "megusta123",
  "amor12345", "corazon123", "estrella1", "futbol123", "campeon123",
  "ecuador123", "quito1234", "guayaquil1", "cuenca123", "loja12345",
  "miclave123", "micontrasena", "elpassword",
];

/**
 * A bounded list of very common passwords (not a dictionary attack list) —
 * issue #230's option (c): the account gates a minor's medical record,
 * emergency contact, and payments, so a length floor alone is not a policy.
 * Composition requirements (uppercase/digit/symbol) were explicitly rejected
 * in favor of this: it blocks the worst passwords for the least friction.
 * Compared case-insensitively.
 */
export const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  ...DIGIT_SEQUENCES,
  ...KEYBOARD_WALKS,
  ...WORDS_AND_CHARACTERS,
  ...AFFECTION_SEASONS_AND_COLORS,
  ...ACCOUNT_DEFAULTS,
  ...NAMES_FRANCHISES_AND_LETTER_RUNS,
  ...SPANISH_AND_ECUADORIAN,
]);

export function isCommonPassword(value: string): boolean {
  return COMMON_PASSWORDS.has(value.trim().toLowerCase());
}

/**
 * `subject` is the feminine noun phrase the message is built around, e.g.
 * `"La contraseña"` or `"La contraseña del representante"`.
 *
 * The value is normalized ONCE up front and both checks read that same
 * string. When the length floor measured the raw value while the
 * common-list check measured the trimmed one, the two disagreed about what
 * "the password" was: `"a"` padded to 8 with spaces cleared a floor of 8 and
 * then missed the common list as the 1-character password it really is.
 */
export function passwordRule(value: string, subject: string): string | null {
  const password = value.trim();
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `${subject} debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  return isCommonPassword(password)
    ? `${subject} es una de las más usadas y fácil de adivinar; elija otra.`
    : null;
}
