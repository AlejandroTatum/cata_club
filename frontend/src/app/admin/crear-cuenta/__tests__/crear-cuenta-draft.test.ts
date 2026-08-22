/**
 * Draft persistence for the admin "Crear cuenta" wizard (issue #353).
 *
 * The 5-step wizard used to keep `formData` only in `useState`: a session
 * that expired mid-flow (401 on the refresh) bounced the admin to /login and
 * every field typed so far — nombres, cédula, teléfono, ficha médica — was
 * gone. This mirrors the pattern issue #317 (K8) already established for the
 * public enrollment wizard (`student/enroll/enroll-utils.ts`'s
 * saveEnrollDraft/loadEnrollDraft/clearEnrollDraft/parseEnrollDraft): same
 * `sessionStorage` persistence, same "discard anything malformed wholesale"
 * parse contract.
 *
 * `CrearCuentaPage.test.tsx` covers the on-screen label and the exact moment
 * it is cleared; this file covers only the pure read/write/parse contract.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  clearCrearCuentaDraft,
  loadCrearCuentaDraft,
  parseCrearCuentaDraft,
  saveCrearCuentaDraft,
  initialCrearCuentaFormData,
  type CrearCuentaFormData,
} from "../crear-cuenta-utils";

const SOME_DRAFT: CrearCuentaFormData = {
  ...initialCrearCuentaFormData,
  accountType: "JUGADOR",
  nombres: "Mateo",
  apellidos: "Zambrano",
  cedula: "1798765432",
};

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("saveCrearCuentaDraft / loadCrearCuentaDraft", () => {
  it("round-trips whatever was saved", () => {
    saveCrearCuentaDraft(SOME_DRAFT);
    expect(loadCrearCuentaDraft()).toEqual(SOME_DRAFT);
  });

  it("returns null when nothing was ever saved", () => {
    expect(loadCrearCuentaDraft()).toBeNull();
  });

  it("round-trips a MENOR draft carrying a numeric representanteId", () => {
    const draft: CrearCuentaFormData = {
      ...SOME_DRAFT,
      accountType: "MENOR",
      representanteId: 42,
    };
    saveCrearCuentaDraft(draft);
    expect(loadCrearCuentaDraft()).toEqual(draft);
  });
});

describe("clearCrearCuentaDraft", () => {
  it("removes a previously saved draft", () => {
    saveCrearCuentaDraft(SOME_DRAFT);
    clearCrearCuentaDraft();
    expect(loadCrearCuentaDraft()).toBeNull();
  });

  it("is a no-op when there was nothing to clear", () => {
    expect(() => clearCrearCuentaDraft()).not.toThrow();
  });
});

describe("password stripping (issue #553)", () => {
  const DRAFT_KEY = "cata_crear_cuenta_draft";
  const DRAFT_WITH_PASSWORD: CrearCuentaFormData = {
    ...SOME_DRAFT,
    contrasenia: "SecretaAdmin3!",
  };

  it("never persists the password field in the stored draft", () => {
    saveCrearCuentaDraft(DRAFT_WITH_PASSWORD);
    const stored = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) as string);
    expect(stored).not.toHaveProperty("contrasenia");
    // The rest of the draft still round-trips.
    expect(stored.nombres).toBe("Mateo");
  });

  it("loads a saved draft with the password field blanked, not resurrected", () => {
    saveCrearCuentaDraft(DRAFT_WITH_PASSWORD);
    expect(loadCrearCuentaDraft()).toEqual({ ...DRAFT_WITH_PASSWORD, contrasenia: "" });
  });

  it("strips the password from a legacy stored draft and rewrites storage sanitized", () => {
    // A draft written by the pre-fix code: password stored in plaintext.
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(DRAFT_WITH_PASSWORD));

    expect(loadCrearCuentaDraft()).toEqual({ ...DRAFT_WITH_PASSWORD, contrasenia: "" });

    // First load must overwrite the stored value so the plaintext password
    // does not keep living in sessionStorage.
    const rewritten = window.sessionStorage.getItem(DRAFT_KEY) as string;
    expect(rewritten).not.toContain("SecretaAdmin3!");
    expect(JSON.parse(rewritten)).not.toHaveProperty("contrasenia");
  });

  it("parseCrearCuentaDraft accepts a stored draft without the password key", () => {
    const { contrasenia: _c, ...stored } = SOME_DRAFT;
    expect(parseCrearCuentaDraft(JSON.stringify(stored))).toEqual({
      ...SOME_DRAFT,
      contrasenia: "",
    });
  });
});

describe("parseCrearCuentaDraft", () => {
  it("discards malformed JSON wholesale, rather than partially trusting it", () => {
    expect(parseCrearCuentaDraft("{not json")).toBeNull();
  });

  it("discards a value that is not a CrearCuentaFormData shape", () => {
    expect(parseCrearCuentaDraft(JSON.stringify({ nombres: "Mateo" }))).toBeNull();
    expect(parseCrearCuentaDraft(JSON.stringify(["not", "an", "object"]))).toBeNull();
    expect(parseCrearCuentaDraft(JSON.stringify(null))).toBeNull();
  });

  it("discards an accountType outside the known enum", () => {
    const tampered = { ...SOME_DRAFT, accountType: "SUPERADMIN" };
    expect(parseCrearCuentaDraft(JSON.stringify(tampered))).toBeNull();
  });

  it("discards a representanteId that is neither a number nor an empty string", () => {
    const tampered = { ...SOME_DRAFT, representanteId: "not-a-number" };
    expect(parseCrearCuentaDraft(JSON.stringify(tampered))).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseCrearCuentaDraft(null)).toBeNull();
    expect(parseCrearCuentaDraft("")).toBeNull();
  });
});
