/**
 * Route Handler Tests — GET /api/payments
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed
 * (same pattern as src/app/api/auth/__tests__/session-route.test.ts). Covers
 * the BFF proxy contract: cookie -> Authorization: Bearer against
 * `/membresias/pagos`, N+1 membresia/tipo resolution, DTO translation into
 * `PaymentValidationRequest`, and error propagation.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.sig`;
}

function getRequest(cookie = ""): NextRequest {
  return new NextRequest("http://localhost/api/payments", { headers: cookie ? { cookie } : {} });
}

const pagoListItem = {
  id: 1,
  monto: "85.00",
  estadoPago: "PENDIENTE_VALIDACION",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-06-28T10:30:00Z",
  fechaValidacion: null,
  fechaInicio: "2026-07-01",
  fechaFin: "2026-07-31",
  personaId: 3,
  personaNombreCompleto: "Sofia Alumna",
  membresiaId: 1,
  voucherUrl: "https://example.com/comprobante.pdf",
  voucherFormato: "application/pdf",
};

const tipos = [{ id: 5, categoria: "Mensual", franjaHoraria: "Mañana" }];
const membresia = { id: 1, estado: "VENCIDA", tipoMembresiaId: 5 };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/payments", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("calls /membresias/pagos with Authorization: Bearer using the cookie's access token", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /personas/
      .mockResolvedValueOnce(jsonResponse([])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [] })); // /membresias/

    const access = makeJwt(3600);
    await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8000/api/v1/membresias/pagos?limit=200",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${access}` }) }),
    );
  });

  it("translates the backend queue into PaymentValidationRequest[]", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [pagoListItem] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /personas/
      .mockResolvedValueOnce(jsonResponse(tipos)) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [membresia] })); // /membresias/

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      {
        id: "1",
        studentName: "Sofia Alumna",
        membershipPeriod: "01/07/2026 – 31/07/2026",
        membershipType: "Mensual (Mañana)",
        expectedAmount: 85,
        paymentMethod: "Transferencia",
        uploadedAt: "2026-06-28T10:30:00Z",
        currentMembershipStatus: "vencida",
        proofFileName: "comprobante.pdf",
        proofFileType: "pdf",
        proofPreviewUrl: "https://example.com/comprobante.pdf",
        validationStatus: "pendiente",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
      },
    ]);
  });

  it("calls /personas/ with limit=200 (auth cookie forwarded) to resolve responsablePagoName", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /personas/
      .mockResolvedValueOnce(jsonResponse([])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [] })); // /membresias/

    const access = makeJwt(3600);
    await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://localhost:8000/api/v1/personas/?limit=200",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${access}` }) }),
    );
  });

  it("resolves responsablePagoName from the bulk personas fetch (self-managed vs represented)", async () => {
    const selfManagedPago = { ...pagoListItem, id: 2, personaId: 5, personaNombreCompleto: "Carlos Padre" };
    const personas = [
      { id: 3, nombres: "Sofia", apellidos: "Alumna", representanteId: 5 }, // represented
      { id: 5, nombres: "Carlos", apellidos: "Padre", representanteId: null }, // self-managed representante
    ];
    const membresiaWithId = { id: 1, estado: "VENCIDA", tipoMembresiaId: 5 };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [pagoListItem, selfManagedPago] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse({ items: personas })) // /personas/
      .mockResolvedValueOnce(jsonResponse(tipos)) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [membresiaWithId] })); // /membresias/

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    const represented = body.find((item: { id: string }) => item.id === "1");
    const selfManaged = body.find((item: { id: string }) => item.id === "2");
    expect(represented.responsablePagoName).toBe("Carlos Padre");
    expect(selfManaged.responsablePagoName).toBe("Carlos Padre");
  });

  it("falls back to an inactive/untyped membership when the per-row membresia lookup fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [pagoListItem] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /personas/
      .mockResolvedValueOnce(jsonResponse(tipos)) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({}, 404)); // /membresias/

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[0].currentMembershipStatus).toBe("vencida");
    expect(body[0].membershipType).toBe("Sin tipo");
  });

  it("falls back to an inactive/untyped membership when the bulk membresia lookup returns empty", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [pagoListItem] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /personas/
      .mockResolvedValueOnce(jsonResponse(tipos)) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [] })); // /membresias/

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body[0].currentMembershipStatus).toBe("vencida");
    expect(body[0].membershipType).toBe("Sin tipo");
  });

  it("propagates the backend's status and message when /membresias/pagos fails", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 403));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.message).toBe("No autorizado");
  });

  it("returns 503 when the backend is unreachable", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError("fetch failed"));

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));

    expect(response.status).toBe(503);
  });
});
