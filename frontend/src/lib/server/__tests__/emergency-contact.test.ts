import { describe, it, expect } from "vitest";
import { resolveEffectiveEmergencyContact } from "../emergency-contact";

describe("resolveEffectiveEmergencyContact", () => {
  it("flags the representative even when the backend already copied them into contactoEmergencia (#1138)", () => {
    expect(
      resolveEffectiveEmergencyContact({
        contactoEmergencia: "Sofia Loor Zamora",
        telefonoEmergencia: "0900000004",
        representanteNombreCompleto: "Sofia Loor Zamora",
        representanteTelefono: "0900000004",
      }),
    ).toEqual({ nombre: "Sofia Loor Zamora", telefono: "0900000004", esRepresentante: true });
  });

  it("keeps a minor's own contact when it differs from the representative", () => {
    expect(
      resolveEffectiveEmergencyContact({
        contactoEmergencia: "Luis Loor",
        telefonoEmergencia: "0987654321",
        representanteNombreCompleto: "Sofia Loor Zamora",
        representanteTelefono: "0900000004",
      }),
    ).toEqual({ nombre: "Luis Loor", telefono: "0987654321", esRepresentante: false });
  });

  it("falls back to the representative when the minor has no contact", () => {
    expect(
      resolveEffectiveEmergencyContact({
        contactoEmergencia: null,
        telefonoEmergencia: " ",
        representanteNombreCompleto: "Sofia Loor Zamora",
        representanteTelefono: "0900000004",
      }),
    ).toEqual({ nombre: "Sofia Loor Zamora", telefono: "0900000004", esRepresentante: true });
  });

  it("keeps an adult's own contact", () => {
    expect(
      resolveEffectiveEmergencyContact({
        contactoEmergencia: "Ana Torres",
        telefonoEmergencia: "0991112233",
        representanteNombreCompleto: null,
        representanteTelefono: null,
      }),
    ).toEqual({ nombre: "Ana Torres", telefono: "0991112233", esRepresentante: false });
  });

  it("returns null for an adult with no contact", () => {
    expect(
      resolveEffectiveEmergencyContact({
        contactoEmergencia: null,
        telefonoEmergencia: null,
        representanteNombreCompleto: null,
        representanteTelefono: null,
      }),
    ).toBeNull();
  });
});
