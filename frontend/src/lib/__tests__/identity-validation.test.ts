import { describe, it, expect } from "vitest";
import {
  cedulaError,
  isValidCedula,
  cedulaRule,
  phoneError,
  isValidEcuadorianPhone,
  phoneRule,
  normalizeEcuadorianMobile,
  emergencyPhoneDiffersRule,
  EMERGENCY_PHONE_SAME_AS_PERSONAL_MESSAGE,
  PERSON_NAME_PATTERN,
  personNameError,
  personNameRule,
  EDAD_MINIMA_ALUMNO,
  EDAD_MAXIMA_ALUMNO,
  calculatePersonAge,
  isValidCalendarDate,
  isFutureBirthDate,
  studentBirthDateRule,
  isPlausibleHumanAge,
  studentBirthDateBounds,
  PASSWORD_MIN_LENGTH,
  isCommonPassword,
  passwordRule,
  PHONE_LOCAL_HINT,
  PHONE_ENROLL_LOCAL_HINT,
} from "@/lib/identity-validation";

// The backend test suite freezes "today" at 2029-01-01 (`FECHA_CONGELADA_HOY`
// in backend/tests/conftest.py). Every age-related test below anchors to the
// same date so results agree with the backend instead of drifting by
// however many years have passed since that freeze.
const FROZEN_TODAY = new Date(2029, 0, 1);

describe("cédula", () => {
  describe("cedulaError / isValidCedula — the four cases from issue #228", () => {
    it("rejects 1712345678 — check digit should be 5, has 8", () => {
      expect(cedulaError("1712345678")).toBe("invalid");
      expect(isValidCedula("1712345678")).toBe(false);
    });

    it("rejects 9912345678 — province 99 does not exist", () => {
      expect(cedulaError("9912345678")).toBe("invalid");
      expect(isValidCedula("9912345678")).toBe(false);
    });

    it("rejects 0000000000 — no valid province, even though checksum degenerately closes", () => {
      expect(cedulaError("0000000000")).toBe("invalid");
      expect(isValidCedula("0000000000")).toBe(false);
    });

    it("accepts 1798765432 — the control case", () => {
      expect(cedulaError("1798765432")).toBeNull();
      expect(isValidCedula("1798765432")).toBe(true);
    });
  });

  describe("length", () => {
    it("flags fewer than 10 digits as a length error, not a checksum error", () => {
      expect(cedulaError("171234567")).toBe("length");
    });

    it("flags more than 10 digits as a length error (issue #225's 11th digit)", () => {
      expect(cedulaError("17123456789")).toBe("length");
    });

    it("flags non-digit characters as a length error", () => {
      expect(cedulaError("171234567a")).toBe("length");
    });
  });

  describe("province boundaries", () => {
    it("accepts province 30 (registered abroad) with a matching check digit", () => {
      // First 9 digits "301234587" -> check digit 6 (module-10 computation).
      expect(cedulaError("3012345876")).toBeNull();
    });

    it("rejects province 00", () => {
      expect(cedulaError("0012345678")).toBe("invalid");
    });

    it("rejects province 25 (between the valid range and 30)", () => {
      expect(cedulaError("2512345678")).toBe("invalid");
    });

    it("rejects province 31", () => {
      expect(cedulaError("3112345678")).toBe("invalid");
    });
  });

  describe("cedulaRule", () => {
    it("requires a value", () => {
      expect(cedulaRule("", "La cédula")).toBe("La cédula es obligatoria.");
      expect(cedulaRule("   ", "La cédula")).toBe("La cédula es obligatoria.");
    });

    it("names the length problem distinctly from the validity problem", () => {
      expect(cedulaRule("171234567", "La cédula")).toBe("La cédula debe tener 10 dígitos.");
      expect(cedulaRule("1712345678", "La cédula")).toBe("La cédula no es válida.");
    });

    it("carries the subject through to the representative variant", () => {
      expect(cedulaRule("9912345678", "La cédula del representante")).toBe(
        "La cédula del representante no es válida.",
      );
    });

    it("passes a valid cédula", () => {
      expect(cedulaRule("1798765432", "La cédula")).toBeNull();
    });
  });
});

describe("teléfono", () => {
  describe("phoneError / isValidEcuadorianPhone", () => {
    it("accepts a valid 10-digit celular starting with 09", () => {
      expect(phoneError("0991234567")).toBeNull();
      expect(isValidEcuadorianPhone("0991234567")).toBe(true);
    });

    it("accepts a valid 9-digit fijo — Loja's area code is 7", () => {
      expect(phoneError("072570000")).toBeNull();
      expect(isValidEcuadorianPhone("072570000")).toBe(true);
    });

    it("rejects letters instead of silently stripping them (issue #229)", () => {
      expect(phoneError("099abc1234")).toBe("invalid-chars");
    });

    it("rejects a 7-digit number — no Ecuadorian line has 7 digits", () => {
      expect(phoneError("0991234")).toBe("invalid-number");
    });

    it("rejects an 11-digit number", () => {
      expect(phoneError("09912345678")).toBe("invalid-number");
    });

    it("rejects a 10-digit number not starting with 09", () => {
      expect(phoneError("0812345678")).toBe("invalid-number");
    });

    it("tolerates the explicit allowed separators (space, hyphen, parentheses)", () => {
      expect(phoneError("099-123-4567")).toBeNull();
      expect(phoneError("099 123 4567")).toBeNull();
      expect(phoneError("(099) 123-4567")).toBeNull();
    });

    it("does NOT tolerate a separator outside the explicit allowlist", () => {
      expect(phoneError("099.123.4567")).toBe("invalid-chars");
      expect(phoneError("099/123/4567")).toBe("invalid-chars");
    });
  });

  describe("phoneRule", () => {
    it("requires a value", () => {
      expect(phoneRule("", "El teléfono")).toBe("El teléfono es obligatorio.");
    });

    it("names what is expected instead of the old incorrect 7-10 digit hint", () => {
      const message = phoneRule("0991234", "El teléfono");
      expect(message).toContain("celular");
      expect(message).toContain("fijo");
    });

    it("flags disallowed characters distinctly", () => {
      expect(phoneRule("099abc1234", "El teléfono")).toBe(
        "El teléfono solo puede contener dígitos y separadores (espacio, guion, paréntesis).",
      );
    });

    it("passes a valid number", () => {
      expect(phoneRule("0991234567", "El teléfono")).toBeNull();
    });

    it("carries the subject through to the emergency-contact variant", () => {
      expect(phoneRule("0991234", "El teléfono de emergencia")).toContain(
        "El teléfono de emergencia debe ser",
      );
    });
  });

  // Issue #855: un navegador móvil autocompleta el celular en formato
  // internacional. Los tres formatos del criterio de aceptación producen el
  // mismo valor local, y la normalización corre ANTES del chequeo de forma
  // — no queda enmascarada por "invalid-chars" solo por llevar un "+".
  describe("normalizeEcuadorianMobile", () => {
    it.each([
      ["converts the +593 form to the local 09 form", "+593991234567", "0991234567"],
      ["converts the 593 form (no plus sign) to the local 09 form", "593991234567", "0991234567"],
      ["converts +593 with the typing separators an autofill can include", "+593 99 123 4567", "0991234567"],
      ["leaves an already-local celular untouched", "0991234567", "0991234567"],
      ["leaves a fijo untouched even with a 593 prefix — the mapping is mobile-only", "+593223456", "+593223456"],
      ["leaves a different country code untouched", "+11234567890", "+11234567890"],
      ["leaves a value with a wrong length after 593 untouched", "+59399123456", "+59399123456"],
      // Regression guard for the masking layer: a value that never matches
      // the international shape must come back byte-for-byte, separators
      // included — `use-numeric-field-masking.ts` relies on this to never
      // rewrite what a visitor is typing locally.
      ["does not rewrite a locally-typed number that merely has separators", "099-123-4567", "099-123-4567"],
    ])("%s", (_description, input, expected) => {
      expect(normalizeEcuadorianMobile(input)).toBe(expected);
    });
  });

  describe("phoneError accepts/rejects the international mobile formats (issue #855)", () => {
    it.each([
      ["accepts +593991234567 as a valid celular", "+593991234567", null],
      ["accepts 593991234567 (no plus sign) as a valid celular", "593991234567", null],
      ["accepts the international form with the typing separators", "+593 99 123 4567", null],
      ["rejects a fijo dressed up with a 593 prefix — the mapping is mobile-only", "593223456", "invalid-number"],
      // The stray "+" is never silently dropped (issue #229's own rule).
      ["rejects a fijo with a leading + as invalid-chars, not invalid-number", "+593223456", "invalid-chars"],
      ["rejects a different country code", "+11234567890", "invalid-chars"],
      ["rejects 593 with the wrong number of digits after it", "+59399123456", "invalid-chars"],
    ])("%s", (_description, input, expected) => {
      expect(phoneError(input)).toBe(expected);
    });

    it("isValidEcuadorianPhone/phoneRule agree with phoneError on an international value", () => {
      expect(isValidEcuadorianPhone("+593991234567")).toBe(true);
      expect(phoneRule("+593991234567", "El teléfono")).toBeNull();
    });
  });

  describe("emergencyPhoneDiffersRule (issue #860)", () => {
    it.each([
      ["the exact same local value", "0993568597", "0993568597"],
      ["the local value against its +593 form", "0993568597", "+593993568597"],
      ["the local value against its 593 form (no plus sign)", "0993568597", "593993568597"],
      ["two international forms of the same number", "+593993568597", "593993568597"],
    ])("rejects when both sides are %s vs %s", (_description, emergency, personal) => {
      expect(emergencyPhoneDiffersRule(emergency, personal)).toBe(EMERGENCY_PHONE_SAME_AS_PERSONAL_MESSAGE);
    });

    it("accepts two different valid numbers", () => {
      expect(emergencyPhoneDiffersRule("0993568597", "0991234567")).toBeNull();
    });

    it("does not fire when the emergency phone is blank — that is phoneRule's job", () => {
      expect(emergencyPhoneDiffersRule("", "0991234567")).toBeNull();
      expect(emergencyPhoneDiffersRule("   ", "0991234567")).toBeNull();
    });

    it("does not fire when the personal phone is blank — never turns it into a requirement", () => {
      expect(emergencyPhoneDiffersRule("0991234567", "")).toBeNull();
      expect(emergencyPhoneDiffersRule("0991234567", "   ")).toBeNull();
    });

    it("does not fire when both are blank", () => {
      expect(emergencyPhoneDiffersRule("", "")).toBeNull();
    });
  });
});

describe("nombre de persona", () => {
  describe("PERSON_NAME_PATTERN", () => {
    it("accepts a hyphenated surname (issue #230 — Pérez-Mora)", () => {
      expect(PERSON_NAME_PATTERN.test("Pérez-Mora")).toBe(true);
    });

    it("accepts an apostrophe surname (D'Angelo)", () => {
      expect(PERSON_NAME_PATTERN.test("D'Angelo")).toBe(true);
    });

    it("still accepts accented letters and spaces (José Ñandú)", () => {
      expect(PERSON_NAME_PATTERN.test("José Ñandú")).toBe(true);
    });

    it("rejects a connector at the start", () => {
      expect(PERSON_NAME_PATTERN.test("-Pérez")).toBe(false);
      expect(PERSON_NAME_PATTERN.test("'Angelo")).toBe(false);
    });

    it("rejects a connector at the end", () => {
      expect(PERSON_NAME_PATTERN.test("Pérez-")).toBe(false);
    });

    it("rejects two connectors in a row", () => {
      expect(PERSON_NAME_PATTERN.test("Pérez--Mora")).toBe(false);
      expect(PERSON_NAME_PATTERN.test("Pérez  Mora")).toBe(false);
    });

    it("still rejects digits and symbols outside the allowed connectors", () => {
      expect(PERSON_NAME_PATTERN.test("Pérez123")).toBe(false);
      expect(PERSON_NAME_PATTERN.test("Pérez@Mora")).toBe(false);
    });

    it("rejects the two mathematical signs sitting inside the Latin-1 letter block", () => {
      // × is U+00D7 and ÷ is U+00F7, both embedded between letters in the
      // À(U+00C0)-ɏ(U+024F) span. They are signs, not letters.
      expect(PERSON_NAME_PATTERN.test("Pérez×Mora")).toBe(false);
      expect(PERSON_NAME_PATTERN.test("Pérez÷Mora")).toBe(false);
    });
  });

  describe("personNameRule", () => {
    it("requires a value, plural form by default", () => {
      expect(personNameRule("", "Los apellidos")).toBe("Los apellidos son obligatorios.");
    });

    it("requires a value, singular form when told", () => {
      expect(personNameRule("", "El nombre del contacto de emergencia", { plural: false })).toBe(
        "El nombre del contacto de emergencia es obligatorio.",
      );
    });

    it("enforces the minimum length, in the right grammatical number", () => {
      expect(personNameRule("Al", "Los apellidos")).toBe(
        "Los apellidos deben tener al menos 3 caracteres.",
      );
      expect(personNameRule("Al", "El nombre del contacto de emergencia", { plural: false })).toBe(
        "El nombre del contacto de emergencia debe tener al menos 3 caracteres.",
      );
    });

    it("does not claim the pattern only allows letters and spaces", () => {
      const message = personNameRule("Pérez123", "Los apellidos");
      expect(message).not.toContain("solo pueden contener letras y espacios");
    });

    it("passes a real hyphenated surname", () => {
      expect(personNameRule("Pérez-Mora", "Los apellidos")).toBeNull();
    });

    it("passes a valid single-word contact name (singular)", () => {
      expect(personNameRule("María", "El nombre del contacto de emergencia", { plural: false })).toBeNull();
    });
  });

  // Issue #1042: las tres causas de rechazo compartían un único mensaje, que
  // solo describe bien una de ellas ("juan  carlos" acusaba a un carácter
  // cuando lo que sobra es un separador repetido).
  describe("personNameError — distingue la causa real del rechazo (issue #1042)", () => {
    it.each([
      ["repeated-separator", "juan  carlos"], // doble espacio
      ["repeated-separator", "juan--carlos"], // doble guion
      ["repeated-separator", "o''brien"], // doble apóstrofe
      ["repeated-separator", "juan··carlos"], // doble punto medio
      ["separator-at-edge", "-juan"],
      ["separator-at-edge", "juan-"],
      ["separator-at-edge", "·juan"],
      ["invalid-char", "juan carlos 3"], // dígito
      ["invalid-char", "juan_carlos"], // guion bajo
      ["invalid-char", "juan@carlos"], // arroba
    ])("clasifica %s para %s", (reason, value) => {
      expect(personNameError(value)).toBe(reason);
    });

    it("no reporta ninguna causa para un nombre válido", () => {
      expect(personNameError("Pérez-Mora")).toBeNull();
    });
  });

  describe("personNameRule nombra la causa real, no siempre un carácter (issue #1042)", () => {
    it("nombra la repetición del separador, no un carácter", () => {
      expect(personNameRule("juan  carlos", "Los apellidos")).toBe(
        "Los apellidos no pueden tener un espacio, guion, apóstrofe o punto medio repetido.",
      );
    });

    it("nombra la repetición también con guiones dobles", () => {
      expect(personNameRule("juan--carlos", "Los apellidos")).toBe(
        "Los apellidos no pueden tener un espacio, guion, apóstrofe o punto medio repetido.",
      );
    });

    it("nombra la repetición también con apóstrofes dobles", () => {
      expect(personNameRule("o''brien", "Los apellidos")).toBe(
        "Los apellidos no pueden tener un espacio, guion, apóstrofe o punto medio repetido.",
      );
    });

    it("nombra la posición cuando el separador abre el nombre", () => {
      expect(personNameRule("-juan", "Los apellidos")).toBe(
        "Los apellidos no pueden empezar ni terminar con un espacio, guion, apóstrofe o punto medio.",
      );
    });

    it("nombra la posición cuando el separador cierra el nombre, en singular", () => {
      expect(
        personNameRule("juan-", "El nombre del contacto de emergencia", { plural: false }),
      ).toBe(
        "El nombre del contacto de emergencia no puede empezar ni terminar con un espacio, guion, apóstrofe o punto medio.",
      );
    });

    it("sigue nombrando un carácter no permitido cuando esa es la causa real", () => {
      expect(personNameRule("juan_carlos", "Los apellidos")).toBe(
        "Los apellidos tienen un carácter que no reconocemos en un nombre de persona.",
      );
    });
  });

  describe("personNameRule — el conjunto aceptado/rechazado no cambia (issue #1042)", () => {
    it.each([
      "Pérez-Mora",
      "D'Angelo",
      "José Ñandú",
      "María",
      "Juan·Carlos",
    ])("sigue aceptando %s", (value) => {
      expect(personNameRule(value, "Los apellidos")).toBeNull();
    });

    it.each([
      "juan  carlos",
      "juan--carlos",
      "o''brien",
      "-juan",
      "juan-",
      "juan carlos 3",
      "juan_carlos",
      "juan@carlos",
    ])("sigue rechazando %s", (value) => {
      expect(personNameRule(value, "Los apellidos")).not.toBeNull();
    });
  });
});

describe("edad del alumno", () => {
  describe("calculatePersonAge", () => {
    it("computes age from a birth date component-wise, not via UTC parsing", () => {
      expect(calculatePersonAge("2024-01-01", FROZEN_TODAY)).toBe(5);
    });

    it("has not had this year's birthday yet", () => {
      expect(calculatePersonAge("2024-01-02", FROZEN_TODAY)).toBe(4);
    });

    it("returns NaN for a non-existent calendar date (Feb 31)", () => {
      expect(Number.isNaN(calculatePersonAge("2024-02-31", FROZEN_TODAY))).toBe(true);
    });

    it("returns NaN for malformed input", () => {
      expect(Number.isNaN(calculatePersonAge("not-a-date", FROZEN_TODAY))).toBe(true);
      expect(Number.isNaN(calculatePersonAge("", FROZEN_TODAY))).toBe(true);
    });

    it("does not cap implausible-but-real years — that is a domain rule, not a parsing concern", () => {
      expect(calculatePersonAge("1800-01-01", FROZEN_TODAY)).toBe(229);
    });
  });

  describe("isValidCalendarDate", () => {
    it("accepts a real date", () => {
      expect(isValidCalendarDate("2024-01-01")).toBe(true);
    });

    it("rejects a non-existent date", () => {
      expect(isValidCalendarDate("2024-04-31")).toBe(false);
    });
  });

  describe("isFutureBirthDate", () => {
    it("flags a date after today", () => {
      expect(isFutureBirthDate("2029-06-15", FROZEN_TODAY)).toBe(true);
    });

    it("does not flag today itself", () => {
      expect(isFutureBirthDate("2029-01-01", FROZEN_TODAY)).toBe(false);
    });

    it("does not flag a past date", () => {
      expect(isFutureBirthDate("2020-01-01", FROZEN_TODAY)).toBe(false);
    });
  });

  describe("studentBirthDateRule — issue #224's five reproduction cases", () => {
    it("requires a value", () => {
      expect(studentBirthDateRule("", FROZEN_TODAY)).toBe("La fecha de nacimiento es obligatoria.");
    });

    it("rejects an invalid calendar date", () => {
      expect(studentBirthDateRule("2024-02-30", FROZEN_TODAY)).toBe(
        "La fecha de nacimiento ingresada no es válida.",
      );
    });

    it("rejects a future date by naming it future, never as a bogus negative age", () => {
      const message = studentBirthDateRule("2030-01-01", FROZEN_TODAY);
      expect(message).toBe("La fecha de nacimiento no puede ser en el futuro.");
      expect(message).not.toContain("menor");
    });

    it("rejects a birth date 3 years ago, naming the computed age", () => {
      expect(studentBirthDateRule("2026-01-01", FROZEN_TODAY)).toBe(
        `La edad del alumno debe estar entre ${EDAD_MINIMA_ALUMNO} y ${EDAD_MAXIMA_ALUMNO} años (calculado: 3).`,
      );
    });

    it("rejects a birth date 120 years ago, naming the computed age", () => {
      expect(studentBirthDateRule("1909-01-01", FROZEN_TODAY)).toBe(
        `La edad del alumno debe estar entre ${EDAD_MINIMA_ALUMNO} y ${EDAD_MAXIMA_ALUMNO} años (calculado: 120).`,
      );
    });

    it("rejects an implausible historical date (1750), naming the computed age", () => {
      expect(studentBirthDateRule("1750-03-15", FROZEN_TODAY)).toBe(
        `La edad del alumno debe estar entre ${EDAD_MINIMA_ALUMNO} y ${EDAD_MAXIMA_ALUMNO} años (calculado: 278).`,
      );
    });

    it("accepts the minimum boundary (exactly 5 years old today)", () => {
      expect(studentBirthDateRule("2024-01-01", FROZEN_TODAY)).toBeNull();
    });

    it("accepts the maximum boundary (exactly 74 years old today)", () => {
      expect(studentBirthDateRule("1955-01-01", FROZEN_TODAY)).toBeNull();
    });

    it("rejects one day past the maximum boundary (75 years old)", () => {
      expect(studentBirthDateRule("1954-01-01", FROZEN_TODAY)).toBe(
        `La edad del alumno debe estar entre ${EDAD_MINIMA_ALUMNO} y ${EDAD_MAXIMA_ALUMNO} años (calculado: 75).`,
      );
    });

    it("rejects one day short of the minimum boundary (4 years old)", () => {
      expect(studentBirthDateRule("2024-01-02", FROZEN_TODAY)).toBe(
        `La edad del alumno debe estar entre ${EDAD_MINIMA_ALUMNO} y ${EDAD_MAXIMA_ALUMNO} años (calculado: 4).`,
      );
    });
  });

  // #312 / hallazgo #32 — the live "Edad calculada" preview (still-focused
  // field, before studentBirthDateRule's own message appears on blur) needs
  // to tell an impossible age (a typo'd year) apart from a real one the
  // club's policy merely rejects.
  describe("isPlausibleHumanAge", () => {
    it("accepts an ordinary human age", () => {
      expect(isPlausibleHumanAge(5)).toBe(true);
      expect(isPlausibleHumanAge(74)).toBe(true);
      expect(isPlausibleHumanAge(100)).toBe(true);
    });

    it("accepts 0 (born this year) and the 120-year ceiling itself", () => {
      expect(isPlausibleHumanAge(0)).toBe(true);
      expect(isPlausibleHumanAge(120)).toBe(true);
    });

    it("rejects a negative age", () => {
      expect(isPlausibleHumanAge(-5)).toBe(false);
    });

    it("rejects an age past the 120-year ceiling — a typo'd year, not a real one", () => {
      expect(isPlausibleHumanAge(121)).toBe(false);
      // #312's own repro: typing "1015" instead of "2015".
      expect(isPlausibleHumanAge(1011)).toBe(false);
    });

    it("rejects NaN", () => {
      expect(isPlausibleHumanAge(NaN)).toBe(false);
    });
  });

  describe("studentBirthDateBounds", () => {
    it("bounds min/max a year of margin around EDAD_MINIMA_ALUMNO/EDAD_MAXIMA_ALUMNO", () => {
      expect(studentBirthDateBounds(FROZEN_TODAY)).toEqual({
        min: `${2029 - EDAD_MAXIMA_ALUMNO - 1}-01-01`,
        max: `${2029 - EDAD_MINIMA_ALUMNO}-12-31`,
      });
    });
  });
});

describe("contraseña", () => {
  describe("isCommonPassword", () => {
    it("flags the three examples issue #230 says currently pass", () => {
      expect(isCommonPassword("12345678")).toBe(true);
      expect(isCommonPassword("password")).toBe(true);
      expect(isCommonPassword("aaaaaaaa")).toBe(true);
    });

    it("compares case-insensitively", () => {
      expect(isCommonPassword("PASSWORD")).toBe(true);
      expect(isCommonPassword("PaSsWoRd")).toBe(true);
    });

    it("does not flag an uncommon password", () => {
      expect(isCommonPassword("Xk29mQzTr7Lp")).toBe(false);
    });
  });

  describe("passwordRule", () => {
    it("enforces the minimum length first", () => {
      expect(passwordRule("abc", "La contraseña")).toBe(
        `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      );
    });

    it("rejects a common password that meets the length floor", () => {
      expect(passwordRule("12345678", "La contraseña")).toBe(
        "La contraseña es una de las más usadas y fácil de adivinar; elija otra.",
      );
      expect(passwordRule("password", "La contraseña")).toBe(
        "La contraseña es una de las más usadas y fácil de adivinar; elija otra.",
      );
      expect(passwordRule("aaaaaaaa", "La contraseña")).toBe(
        "La contraseña es una de las más usadas y fácil de adivinar; elija otra.",
      );
    });

    it("does NOT require composition (uppercase/digit/symbol) — decision from issue #230", () => {
      // A long, lowercase-only, non-common phrase must pass with no composition demand.
      expect(passwordRule("nubesverdesdeloja", "La contraseña")).toBeNull();
    });

    it("passes an uncommon password meeting the length floor", () => {
      expect(passwordRule("Xk29mQzTr7Lp", "La contraseña")).toBeNull();
    });

    it("measures the length floor on the same value the common-list check reads", () => {
      // One real character padded to 8 with spaces: the floor used to see 8
      // while the common-list check saw "a", so a 1-character password passed.
      expect(passwordRule("a       ", "La contraseña")).toBe(
        `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      );
    });

    it("still flags a common password that arrives padded", () => {
      expect(passwordRule("  password  ", "La contraseña")).toBe(
        "La contraseña es una de las más usadas y fácil de adivinar; elija otra.",
      );
    });

    it("carries the subject through to the representative variant", () => {
      expect(passwordRule("abc", "La contraseña del representante")).toBe(
        `La contraseña del representante debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      );
    });
  });
});

describe("PHONE_LOCAL_HINT (#1028)", (): void => {
  it("names Ecuador and says which local digits to type, leaving the code to the field's prefix", (): void => {
    expect(PHONE_LOCAL_HINT).toBe(
      "Escriba su número local de Ecuador: el celular empieza en 09; los fijos, en 0.",
    );
    // The +593 teaching moved INTO the field (`EcuadorPhonePrefix`); the hint
    // would only repeat it.
    expect(PHONE_LOCAL_HINT).not.toContain("593");
    // And it stays the same numbering plan the formats hint has always taught.
    expect(PHONE_LOCAL_HINT).toContain("09");
    expect(PHONE_LOCAL_HINT).toContain("0");
  });
});

describe("PHONE_ENROLL_LOCAL_HINT (#1028 review)", (): void => {
  it("teaches the nine digits after +593 in the usted register, with the example", (): void => {
    expect(PHONE_ENROLL_LOCAL_HINT).toBe(
      "Escriba los 9 dígitos de su celular, sin el 0 inicial: por ejemplo, 991234567.",
    );
    expect(PHONE_ENROLL_LOCAL_HINT).toContain("991234567");
    expect(PHONE_ENROLL_LOCAL_HINT).toContain("sin el 0");
  });
});
