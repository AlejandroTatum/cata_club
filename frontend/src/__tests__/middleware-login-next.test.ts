import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

/** REG-21: the edge guard sends a session-less visit to /login remembering where it was going. */
function redirectLocation(path: string): string | null {
  const response = middleware(new NextRequest(`https://cataclub.com${path}`));
  expect(response.status).toBe(307);
  return response.headers.get("location");
}

describe("middleware → /login?next=", () => {
  it("remembers the protected path the anonymous visitor asked for", () => {
    expect(redirectLocation("/student/payments")).toBe(
      "https://cataclub.com/login?next=%2Fstudent%2Fpayments",
    );
  });

  it("keeps the query string of that path", () => {
    expect(redirectLocation("/payments?status=pending&page=2")).toBe(
      "https://cataclub.com/login?next=%2Fpayments%3Fstatus%3Dpending%26page%3D2",
    );
  });

  it("never lets the remembered value leave the site, whatever the request carries", () => {
    const location = redirectLocation("/members?next=https://evil.example");
    const next = new URL(location ?? "").searchParams.get("next");
    expect(next).toBe("/members?next=https://evil.example");
    // It is the ORIGINAL internal path as a whole (encoded once), not a destination of its own.
    expect(new URL(next ?? "", "https://cataclub.com").origin).toBe("https://cataclub.com");
  });

  it("does not add next for a public path", () => {
    const response = middleware(new NextRequest("https://cataclub.com/student/enroll"));
    expect(response.headers.get("location")).toBeNull();
  });
});
