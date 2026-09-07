/**
 * Unit tests for the shared `?motivo=` redirect-reason helper (#1057).
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { REDIRECT_REASON_MESSAGES, redirectReasonFrom, withRedirectReason } from "@/lib/redirect-reason";

describe("withRedirectReason", () => {
  it("appends the reason to the given route", () => {
    expect(withRedirectReason("/login", "sesion-expirada")).toBe("/login?motivo=sesion-expirada");
  });

  it("carries the reason onto a non-default route", () => {
    expect(withRedirectReason("/custom-login", "correo-verificado")).toBe(
      "/custom-login?motivo=correo-verificado",
    );
  });
});

describe("redirectReasonFrom", () => {
  it("recognizes every known reason", () => {
    expect(redirectReasonFrom("sesion-expirada")).toBe("sesion-expirada");
    expect(redirectReasonFrom("correo-verificado")).toBe("correo-verificado");
  });

  it("returns null for an absent or unknown motivo", () => {
    expect(redirectReasonFrom(null)).toBeNull();
    expect(redirectReasonFrom("algo-desconocido")).toBeNull();
  });
});

describe("REDIRECT_REASON_MESSAGES", () => {
  it("keeps the exact wording each mechanism already showed before the unification", () => {
    expect(REDIRECT_REASON_MESSAGES["sesion-expirada"]).toBe("Su sesión expiró. Vuelva a iniciar sesión.");
    expect(REDIRECT_REASON_MESSAGES["correo-verificado"]).toBe(
      "Su correo quedó verificado. Vuelva a iniciar sesión para continuar.",
    );
  });
});
