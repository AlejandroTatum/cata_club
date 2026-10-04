/**
 * GET /api/club/payment-info — the club's transfer data is for signed-in users
 * only: anonymous gets a 401 with no data, a session gets the normalized info,
 * and neither is ever cached.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";
import { CLUB_PAYMENT_INFO } from "@/lib/server/club-payment-info";

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${base64Url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${base64Url(JSON.stringify({ sub: "1", exp }))}.sig`;
}

function getRequest(cookie: string | null): NextRequest {
  return new NextRequest("http://localhost/api/club/payment-info", {
    headers: cookie ? { cookie } : {},
  });
}

describe("GET /api/club/payment-info", () => {
  beforeEach(() => {
    process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });

  it("answers 401 with no data and no-store to an anonymous request", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const response = await GET(getRequest(null));
    const text = await response.text();

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(text).not.toContain(CLUB_PAYMENT_INFO.accountNumber);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 401 when the backend rejects the session", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt()}`));

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(CLUB_PAYMENT_INFO.accountNumber);
  });

  it("returns the normalized info, uncached, to a signed-in user", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ correo: "a@b.c" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt()}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      holder: CLUB_PAYMENT_INFO.holder,
      bank: CLUB_PAYMENT_INFO.bank,
      accountNumber: CLUB_PAYMENT_INFO.accountNumber,
      holderId: CLUB_PAYMENT_INFO.holderId,
    });
  });
});
