import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

function apiRequest(path: string, method: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://cataclub.com${path}`, { method, headers });
}

describe("middleware → Origin check on mutating /api requests (#1653)", () => {
  it("lets a same-origin POST through", async () => {
    const response = middleware(apiRequest("/api/payments", "POST", { origin: "https://cataclub.com" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("rejects a cross-origin %s with a 403 JSON error", async (method) => {
    const response = middleware(apiRequest("/api/payments", method, { origin: "https://evil.example" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(await response.json()).toEqual({
      error: "forbidden_origin",
      message: "Origen de la solicitud no permitido.",
    });
  });

  it("rejects the opaque `null` origin", () => {
    expect(middleware(apiRequest("/api/auth/logout", "POST", { origin: "null" })).status).toBe(403);
  });

  it("does not touch safe methods", () => {
    const response = middleware(apiRequest("/api/payments", "GET", { origin: "https://evil.example" }));
    expect(response.status).toBe(200);
  });

  it("does not touch page navigations, even a cross-origin POST to a document route", () => {
    const response = middleware(apiRequest("/login", "POST", { origin: "https://evil.example" }));
    expect(response.status).toBe(200);
  });

  it("rejects a request without Origin when Sec-Fetch-Site says cross-site or same-site", () => {
    expect(middleware(apiRequest("/api/payments", "POST", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(middleware(apiRequest("/api/payments", "POST", { "sec-fetch-site": "same-site" })).status).toBe(403);
  });

  it("allows a request without Origin when Sec-Fetch-Site is same-origin, none, or absent", () => {
    expect(middleware(apiRequest("/api/payments", "POST", { "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect(middleware(apiRequest("/api/payments", "POST", { "sec-fetch-site": "none" })).status).toBe(200);
    expect(middleware(apiRequest("/api/payments", "POST")).status).toBe(200);
  });

  it("resolves the public host from x-forwarded-host behind the reverse proxy", () => {
    const behindProxy = new NextRequest("http://frontend:3000/api/payments", {
      method: "POST",
      headers: { origin: "https://cataclub.com", "x-forwarded-host": "cataclub.com", host: "frontend:3000" },
    });
    expect(middleware(behindProxy).status).toBe(200);
  });

  it("still rejects a foreign origin behind the reverse proxy", () => {
    const behindProxy = new NextRequest("http://frontend:3000/api/payments", {
      method: "POST",
      headers: { origin: "https://evil.example", "x-forwarded-host": "cataclub.com", host: "frontend:3000" },
    });
    expect(middleware(behindProxy).status).toBe(403);
  });

  it("normalizes case and the scheme's default port on the public host", () => {
    const behindProxy = new NextRequest("http://frontend:3000/api/payments", {
      method: "POST",
      headers: { origin: "https://cataclub.com", "x-forwarded-host": "CataClub.com:443", host: "frontend:3000" },
    });
    expect(middleware(behindProxy).status).toBe(200);
  });

  it("exempts the browser-driven CSP report sink", () => {
    const response = middleware(apiRequest("/api/csp-report", "POST", { origin: "https://evil.example" }));
    expect(response.status).toBe(200);
  });
});
