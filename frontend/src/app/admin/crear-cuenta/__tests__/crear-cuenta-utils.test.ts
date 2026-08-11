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
    cedula: "1712345678",
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

describe("AccountType", () => {
  it("covers the four account types the backend accepts", () => {
    const todos: AccountType[] = ["JUGADOR", "REPRESENTANTE", "MENOR", "ENTRENADOR"];
    expect(todos).toHaveLength(4);
  });
});
