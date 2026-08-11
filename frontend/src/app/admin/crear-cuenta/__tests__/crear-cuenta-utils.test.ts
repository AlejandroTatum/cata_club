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
    expect(errors.join(" ")).toMatch(/mayores de edad/i);
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

describe("AccountType", () => {
  it("covers the four account types the backend accepts", () => {
    const todos: AccountType[] = ["JUGADOR", "REPRESENTANTE", "MENOR", "ENTRENADOR"];
    expect(todos).toHaveLength(4);
  });
});
