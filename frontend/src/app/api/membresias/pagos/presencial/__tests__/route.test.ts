/**
 * Route Handler Tests — POST /api/membresias/pagos/presencial (issue #1402)
 *
 * The BFF is a thin proxy: shape-validates the body, maps camelCase →
 * snake_case, and relays the backend's status verbatim (201 created; the
 * backend decides APPROBADO vs PENDIENTE_VALIDACION and rejects self-service,
 * renewals and non-admins — none of that logic may live here).
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed.
 * Same shape as membresias/pagos/[pagoId]/__tests__/route.test.ts.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/membresias/pagos/presencial", {
    method: "POST",
    headers: { cookie: `${ACCESS_TOKEN_COOKIE}=token`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("POST /api/membresias/pagos/presencial", () => {
  it("maps camelCase to snake_case and relays the backend's created payment", async () => {
    const pago = { id: 9, estadoPago: "APROBADO", validadoPorPersonaId: 1 };
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse(pago, 201));

    const response = await POST(
      postRequest({ meses: 1, tipoPago: "EFECTIVO", personaId: 2, membresiaId: 3 }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(pago);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:8000/api/v1/membresias/pagos/presencial",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ meses: 1, tipo_pago: "EFECTIVO", persona_id: 2, membresia_id: 3 }),
      }),
    );
  });

  it("rejects a body missing required fields with 400 without calling the backend", async () => {
    const response = await POST(postRequest({ meses: 1, tipoPago: "EFECTIVO" }));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("relays the backend's rejection (self-service or non-first payment) verbatim", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "no es primera inscripción" }, 400));

    const response = await POST(
      postRequest({ meses: 1, tipoPago: "TRANSFERENCIA", personaId: 2, membresiaId: 3 }),
    );

    expect(response.status).toBe(400);
    // `passthroughBackendError` maps the backend `detail` onto `message`.
    const body = (await response.json()) as { message: string };
    expect(body.message).toContain("primera inscripción");
  });
});
