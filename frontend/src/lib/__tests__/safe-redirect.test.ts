import { describe, expect, it } from "vitest";
import { loginPathWithNext, safeNextPath, withNextPath } from "../safe-redirect";

describe("safeNextPath — accepts internal paths", () => {
  it.each([
    ["/student/payments", "/student/payments"],
    ["/student/payments?month=3", "/student/payments?month=3"],
    ["/admin/payments?status=pending&page=2#top", "/admin/payments?status=pending&page=2#top"],
    ["/members/12", "/members/12"],
    ["/ayuda/", "/ayuda/"],
    // An encoded segment inside the path is an ordinary internal path.
    ["/members/Ana%20Perez", "/members/Ana%20Perez"],
  ])("keeps %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });
});

describe("safeNextPath — open-redirect attempts fall back to null", () => {
  it.each([
    ["absolute https URL", "https://evil.example/phish"],
    ["absolute http URL", "http://evil.example"],
    ["protocol-relative", "//evil.example"],
    ["protocol-relative with path", "//evil.example/student/payments"],
    ["triple slash", "///evil.example"],
    ["backslash host", "/\\evil.example"],
    ["double backslash", "\\\\evil.example"],
    ["leading backslash path", "\\student\\payments"],
    ["backslash inside the path", "/student\\..\\evil"],
    ["javascript scheme", "javascript:alert(1)"],
    ["data scheme", "data:text/html,<script>alert(1)</script>"],
    ["mailto", "mailto:a@b.c"],
    ["scheme with leading space", " https://evil.example"],
    ["scheme with leading tab", "\thttps://evil.example"],
    ["slash then tab then slash", "/\t/evil.example"],
    ["slash then newline then slash", "/\n/evil.example"],
    ["slash then carriage return", "/\r/evil.example"],
    ["encoded second slash", "/%2Fevil.example"],
    ["encoded second slash lowercase", "/%2fevil.example"],
    ["encoded backslash", "/%5Cevil.example"],
    ["encoded backslash lowercase", "/%5cevil.example"],
    ["both slashes encoded", "%2F%2Fevil.example"],
    ["encoded colon scheme", "https%3A%2F%2Fevil.example"],
    ["double-encoded second slash", "/%252Fevil.example"],
    ["double-encoded backslash", "/%255Cevil.example"],
    ["encoded tab between slashes", "/%09/evil.example"],
    ["encoded newline between slashes", "/%0A/evil.example"],
    ["encoded null byte", "/student%00//evil"],
    ["raw null byte", "/student\u0000"],
    ["relative path without a slash", "student/payments"],
    ["dot-relative path", "./student/payments"],
    ["query-only", "?next=/x"],
    ["fragment-only", "#x"],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["unicode slash lookalike", "/\u2215evil.example"],
    ["fullwidth solidus pair", "\uFF0F\uFF0Fevil.example"],
    ["invalid percent encoding", "/%E0%A4%A"],
  ])("rejects %s", (_label, raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });

  it("rejects missing and non-string values", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
  });

  it("rejects an absurdly long value", () => {
    expect(safeNextPath(`/${"a".repeat(3000)}`)).toBeNull();
  });

  it("rejects the landing: the role's home is a better place to land than the public page", () => {
    expect(safeNextPath("/")).toBeNull();
  });

  it("rejects the login page itself and API routes, so it can not loop or expose JSON", () => {
    for (const raw of ["/login", "/login?next=/login", "/login/activacion", "/api/auth/session", "/api"]) {
      expect(safeNextPath(raw)).toBeNull();
    }
  });
});

describe("loginPathWithNext", () => {
  it("appends the encoded original path", () => {
    expect(loginPathWithNext("/student/payments", "?month=3")).toBe(
      "/login?next=%2Fstudent%2Fpayments%3Fmonth%3D3",
    );
  });

  it("omits next when the original path is not a safe internal path", () => {
    expect(loginPathWithNext("//evil.example", "")).toBe("/login");
    expect(loginPathWithNext("/login", "")).toBe("/login");
  });

  it("round-trips through safeNextPath", () => {
    const url = new URL(loginPathWithNext("/admin/payments", "?status=pending"), "https://x.test");
    expect(safeNextPath(url.searchParams.get("next"))).toBe("/admin/payments?status=pending");
  });
});

describe("withNextPath", () => {
  it("starts the query string on a bare route", () => {
    expect(withNextPath("/login", "/student/payments", "")).toBe("/login?next=%2Fstudent%2Fpayments");
  });

  it("continues an existing query string", () => {
    expect(withNextPath("/login?motivo=sesion-expirada", "/student/payments", "")).toBe(
      "/login?motivo=sesion-expirada&next=%2Fstudent%2Fpayments",
    );
  });

  it("returns the route untouched when there is nothing safe to remember", () => {
    expect(withNextPath("/login?motivo=sesion-expirada", "//evil.example", "")).toBe("/login?motivo=sesion-expirada");
  });
});
