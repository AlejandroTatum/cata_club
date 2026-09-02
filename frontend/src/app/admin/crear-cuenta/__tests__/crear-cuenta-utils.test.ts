/**
 * Unit tests for the admin create-account wizard's pure validation.
 *
 * Focus: ENTRENADOR is a first-class account type. Before it existed, giving
 * a coach an account meant creating them as JUGADOR and then fixing the roles
 * by hand in the members panel.
 */

import { describe, it, expect } from "vitest";
import {
  initialCrearCuentaFormData,
  hasCrearCuentaMedicalData,
  validateCrearCuentaForm,
  type AccountType,
  type CrearCuentaFormData,
} from "@/app/admin/crear-cuenta/crear-cuenta-utils";

function form(overrides: Partial<CrearCuentaFormData> = {}): CrearCuentaFormData {
  return {
    ...initialCrearCuentaFormData,
    accountType: "ENTRENADOR",
    nombres: "Carla",
    apellidos: "Ramirez",
    cedula: "1798765432",
    fechaNacimiento: "1990-04-12",
    telefono: "0991234567",
    correo: "carla@cataclub.test",
    contrasenia: "clave12345",
    ...overrides,
  };
}

describe("validateCrearCuentaForm — ENTRENADOR", () => {
  it("accepts an adult trainer", () => {
    expect(validateCrearCuentaForm(form())).toEqual([]);
  });

  it("rejects a trainer who is under age", () => {
    const errors = validateCrearCuentaForm(form({ fechaNacimiento: "2020-01-01" }));
    expect(errors.join(" ")).toMatch(/entre 18 y 74/i);
  });

  /**
   * Root-cause candado: this file used to carry its own copy of
   * `calculateAge` that capped the birth year to 1900-2200 and returned
   * `NaN` outside it — so `age < 18` was always `false` for a wildly old
   * date (the audited pattern: year 1700) and this exact case slipped
   * through in silence. Now it imports the fixed shared helper, which never
   * returns NaN for a syntactically valid date, so this age is caught by
   * name instead.
   */
  it("rejects an implausibly old trainer birth date instead of letting it through", () => {
    const errors = validateCrearCuentaForm(form({ fechaNacimiento: "1700-01-01" }));
    expect(errors.join(" ")).toMatch(/entre 18 y 74 años \(calculado: \d+\)/i);
  });

  it("does not demand a legal guardian from a trainer", () => {
    const errors = validateCrearCuentaForm(form({ representanteId: "" }));
    expect(errors.join(" ")).not.toMatch(/representante/i);
  });

  it("still demands a legal guardian from a minor", () => {
    const errors = validateCrearCuentaForm(
      form({ accountType: "MENOR", fechaNacimiento: "2015-01-01", representanteId: "" }),
    );
    expect(errors.join(" ")).toMatch(/representante/i);
  });
});

// Auditoría 2026-08-10: 1700-01-01 (326 años) se aceptaba sin aviso para
// JUGADOR/REPRESENTANTE/ENTRENADOR. La causa era que `calculateAge` (la
// misma que usa `/student/enroll`) devuelve NaN fuera de 1900-2200 -- y
// `NaN < 18` es `false`, así que la comprobación de "menor de edad" nunca
// disparaba. El candado usa una edad real (no capada), como ya hace
// `add-dependent-utils.ts::edadDesdeFecha` para el mismo bug en MENOR.
describe("validateCrearCuentaForm — edad imposible (326 años)", () => {
  it.each<AccountType>(["JUGADOR", "REPRESENTANTE", "ENTRENADOR"])(
    "rejects %s born in 1700",
    (accountType) => {
      const errors = validateCrearCuentaForm(form({ accountType, fechaNacimiento: "1700-01-01" }));
      expect(errors.join(" ")).toMatch(/74/);
    },
  );

  it("rejects a MENOR born in 1700 too, not just adults", () => {
    const errors = validateCrearCuentaForm(
      form({ accountType: "MENOR", fechaNacimiento: "1700-01-01", representanteId: 1 }),
    );
    expect(errors).not.toEqual([]);
  });
});

describe("hasCrearCuentaMedicalData", () => {
  it("keeps all medical controls optional when every field is empty", () => {
    expect(hasCrearCuentaMedicalData(initialCrearCuentaFormData)).toBe(false);
  });

  it.each<Partial<CrearCuentaFormData>>([
    { tipoSangre: "O_POSITIVO" },
    { condicionesSalud: "Asma" },
    { alergias: "Maní" },
    { contactoEmergencia: "Ana Pérez" },
    { telefonoEmergencia: "0991234567" },
  ])("requires the core details once a medical value is present: %o", (medical) => {
    expect(hasCrearCuentaMedicalData({ ...initialCrearCuentaFormData, ...medical })).toBe(true);
  });
});

/**
 * Issue #643 tightened one branch: once the record IS being written, it must
 * be a complete one, and `DESCONOCIDO` no longer counts as a blood type.
 *
 * Issue #730 closed the other branch, but only where it belongs. The record
 * is no longer optional for the two account types that ARE students
 * (`JUGADOR`, `MENOR`) — the backend now answers 422 to an alta without one,
 * so a wizard that still let an admin skip the step would just fail at
 * submit. It stays optional for `ENTRENADOR` and `REPRESENTANTE`, who never
 * step onto the court: every case below built with `form()` is a coach, and
 * that is why they still pass with no medical data at all.
 */
describe("validateCrearCuentaForm — ficha médica (#643)", () => {
  const withMedical = (overrides: Partial<CrearCuentaFormData> = {}): CrearCuentaFormData =>
    form({
      tipoSangre: "O_POSITIVO",
      contactoEmergencia: "Ana Pérez",
      telefonoEmergencia: "0987654321",
      ...overrides,
    });

  it("accepts a complete medical record", () => {
    expect(validateCrearCuentaForm(withMedical())).toEqual([]);
  });

  it("rejects DESCONOCIDO as if the blood type had been left blank", () => {
    expect(validateCrearCuentaForm(withMedical({ tipoSangre: "DESCONOCIDO" })))
      .toContain("El tipo de sangre es obligatorio.");
  });

  it("rejects a blank emergency phone", () => {
    expect(validateCrearCuentaForm(withMedical({ telefonoEmergencia: "   " })))
      .toContain("El teléfono de emergencia es obligatorio.");
  });

  it("rejects a malformed emergency phone", () => {
    expect(validateCrearCuentaForm(withMedical({ telefonoEmergencia: "123" })).join(" "))
      .toMatch(/El teléfono de emergencia debe ser un celular/);
  });

  /**
   * Issue #860: the emergency phone must differ from the account's own —
   * otherwise the contact of emergency cannot reach anyone the account
   * holder cannot reach themselves.
   */
  describe("telefonoEmergencia must differ from telefono (#860)", () => {
    const MENSAJE = "El teléfono de emergencia debe ser diferente del teléfono del estudiante.";

    it.each([
      ["the exact same number", form().telefono],
      ["the +593 form of the same number", "+593991234567"],
      ["the 593 form of the same number (no plus sign)", "593991234567"],
    ])("rejects %s as equivalent to the account's own (telefono is 0991234567)", (_description, telefonoEmergencia) => {
      expect(validateCrearCuentaForm(withMedical({ telefonoEmergencia }))).toContain(MENSAJE);
    });

    it("accepts a different valid emergency phone", () => {
      expect(validateCrearCuentaForm(withMedical({ telefonoEmergencia: "0987654321" })))
        .not.toContain(MENSAJE);
    });
  });

  it("keeps alergias and condicionesSalud optional inside a complete record", () => {
    expect(validateCrearCuentaForm(withMedical({ alergias: "", condicionesSalud: "" }))).toEqual([]);
  });

  it("still creates no ficha, and demands nothing, when every medical field is empty", () => {
    expect(validateCrearCuentaForm(form())).toEqual([]);
  });
});

describe("validateCrearCuentaForm — ficha médica obligatoria para alumnos (#730)", () => {
  const alumno = (overrides: Partial<CrearCuentaFormData> = {}): CrearCuentaFormData =>
    form({ accountType: "JUGADOR", fechaNacimiento: "1995-06-15", ...overrides });

  it("rejects a JUGADOR with no medical data at all", () => {
    expect(validateCrearCuentaForm(alumno())).toContain("El tipo de sangre es obligatorio.");
  });

  it("names the emergency contact too, not only the blood type", () => {
    /*
     * The gap issue #730 measured was an empty emergency contact, not an
     * empty blood type — an admin told only about the blood type would fix
     * half of it and submit again into the same 422.
     */
    expect(validateCrearCuentaForm(alumno()).join(" ")).toMatch(/contacto de emergencia/i);
  });

  it("rejects a MENOR with no medical data at all", () => {
    const errors = validateCrearCuentaForm(
      alumno({ accountType: "MENOR", fechaNacimiento: "2015-06-15", representanteId: 1 }),
    );
    expect(errors).toContain("El tipo de sangre es obligatorio.");
  });

  it("accepts a JUGADOR once the record is complete", () => {
    expect(
      validateCrearCuentaForm(
        alumno({
          tipoSangre: "O_POSITIVO",
          contactoEmergencia: "Ana Pérez",
          telefonoEmergencia: "0987654321",
        }),
      ),
    ).toEqual([]);
  });

  it("does not demand a medical record from a REPRESENTANTE", () => {
    /*
     * The deliberate limit of the rule, mirroring `TIPOS_CUENTA_ALUMNO` in
     * `admin_cuenta_schemas.py`. A representative does not train; asking them
     * for a blood type would be the rule applied where it does not belong.
     */
    expect(validateCrearCuentaForm(form({ accountType: "REPRESENTANTE" }))).toEqual([]);
  });
});

describe("AccountType", () => {
  it("covers the four account types the backend accepts", () => {
    const todos: AccountType[] = ["JUGADOR", "REPRESENTANTE", "MENOR", "ENTRENADOR"];
    expect(todos).toHaveLength(4);
  });
});
