import { describe, expect, it } from "vitest";
import { extractVerificationToken } from "../verification-token";

describe("extractVerificationToken", () => {
  it("returns the raw value when it is a bare token", () => {
    expect(extractVerificationToken("abc123token")).toBe("abc123token");
  });

  it("pulls the token out of a full verification link", () => {
    expect(
      extractVerificationToken("https://cataclub.com/verificar-correo?token=abc123token"),
    ).toBe("abc123token");
  });

  it("trims surrounding whitespace from a pasted value", () => {
    expect(extractVerificationToken("  abc123token  ")).toBe("abc123token");
  });

  it("returns the empty string for an empty value", () => {
    expect(extractVerificationToken("   ")).toBe("");
  });

  it("falls back to the raw value when the URL carries no token param", () => {
    expect(extractVerificationToken("https://cataclub.com/verificar-correo")).toBe(
      "https://cataclub.com/verificar-correo",
    );
  });
});
