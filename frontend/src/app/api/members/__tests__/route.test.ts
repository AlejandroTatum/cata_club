/**
 * Route Handler Tests — GET /api/members
 *
 * Mocks the backend via vi.spyOn(global, "fetch") — no live FastAPI needed
 * (same pattern as src/app/api/payments/__tests__/route.test.ts).
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "../route";
import { ACCESS_TOKEN_COOKIE } from "@/lib/server/auth";
import { MAX_PAGES_PER_SOURCE } from "@/lib/server/paged-fetch";

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
  return new NextRequest("http://localhost/api/members", { headers: cookie ? { cookie } : {} });
}

const persona = {
  id: 3,
  nombres: "Sofia",
  apellidos: "Alumna",
  telefono: "0999999003",
  fechaNacimiento: "1995-01-01",
  representanteId: null,
};

const pago = {
  id: 9,
  monto: "25.00",
  estadoPago: "APROBADO",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-07-01T10:00:00",
  fechaInicio: "2026-07-01",
  fechaFin: "2026-08-01",
  personaId: 3,
  personaNombreCompleto: "Sofia Alumna",
  membresiaId: 77,
};

const membresia = { id: 77, estado: "ACTIVA", tipoMembresiaId: 1, personaId: 3 };

const tipo = { id: 1, categoria: "MENSUAL" };

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

describe("GET /api/members", () => {
  it("returns 401 without calling the backend when no auth cookie is present", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("builds MemberAccount[] from personas + pagos", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse([])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/?limit=200 (bulk)
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]).toMatchObject({ id: "3", role: "representante" });
    expect(body.personasCapped).toBe(false);
  });

  it("preserves the upstream cap when 200 personas expand into one row each", async () => {
    // Issue #388: `buildMemberAccounts` no longer collapses a root and its
    // represented personas into one grouped account — every persona gets its
    // own row now. `personasCapped` has to keep reflecting the raw upstream
    // `total` regardless: it is not derived from `accounts.length`, so this
    // still has to hold even though the shape it counts changed underneath it.
    const personas = Array.from({ length: 200 }, (_, index) => ({
      ...persona,
      id: index + 1,
      representanteId: index === 0 ? null : 1,
    }));
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: personas, total: 200, skip: 0, limit: 200 }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    // One row per persona now — no more collapsing into a single grouped account.
    expect(body.accounts).toHaveLength(200);
    // A represented persona's own row carries `representadoPor`, naming the
    // root persona (id 1) it points at via `representanteId`.
    const represented = body.accounts.find((account: { id: string }) => account.id === "2");
    expect(represented.representadoPor).toBe(`${persona.nombres} ${persona.apellidos}`);
    // The cap flag still derives from the raw upstream `total` (200 >=
    // PERSONAS_PAGE_LIMIT), independent of how many account rows come out.
    expect(body.personasCapped).toBe(true);
  });

  it("propagates the backend's status and message when /personas/ fails", async () => {
    // The other three go out alongside personas now, so they need mocks even
    // though the route discards them: personas failing still decides the
    // response, but it no longer gates whether the rest were dispatched.
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ detail: "No autorizado" }, 401)) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse([])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [] })); // /membresias/

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.message).toBe("No autorizado");
  });

  it("resolves memberships from the single bulk GET /membresias/ call, not per-id lookups", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [pago] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [membresia], total: 1, skip: 0, limit: 200 })) // /membresias/ (bulk)
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    // No per-id or per-persona membresía lookups — the bulk list already has everything.
    const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("http://localhost:8000/api/v1/membresias/?skip=0&limit=200");
    expect(urls.some((url) => /\/membresias\/77$/.test(url))).toBe(false);
    expect(urls.some((url) => /\/membresias\/persona\//.test(url))).toBe(false);
    expect(body.accounts[0].estudiantes[0].membresia).toMatchObject({ estado: "activa" });
    expect(body.membresiasDegraded).toBe(false);
  });

  it("flags the response instead of reporting a membership-less student when the bulk lookup fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [pago] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ detail: "boom" }, 500)) // /membresias/ (bulk)
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts[0].estudiantes[0].membresia).toBeNull();
    // Without this flag the page counts the null as "no active membership" and
    // renders a confident 0 — the contradiction this whole change removes.
    expect(body.membresiasDegraded).toBe(true);
  });

  it("finds a membership for a persona who has never paid, from the same bulk call", async () => {
    // Ana García's case: an ACTIVA membresía with zero Pago rows. Resolving
    // membership only through the payment chain reported her as having none,
    // while her own student portal said "Membresía activa".
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos — none at all
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [membresia], total: 1, skip: 0, limit: 200 })) // /membresias/ (bulk)
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => /\/membresias\/persona\//.test(url))).toBe(false);
    expect(body.accounts[0].estudiantes[0].membresia).toMatchObject({ id: 77, estado: "activa" });
    // No payment, so no invented period and no fabricated payment row.
    expect(body.accounts[0].estudiantes[0].membresia.fechaInicio).toBe("");
    expect(body.accounts[0].estudiantes[0].ultimoPago).toBeNull();
    expect(body.membresiasDegraded).toBe(false);
  });

  it("fetches memberships and fichas médicas in one backend call each, regardless of how many students there are", async () => {
    // The regression this fix closes: resolving membership used to cost one
    // extra request per student (batched, but still N). Five students with no
    // pago at all used to mean five extra `/membresias/persona/{id}` calls.
    // The same shape applies to issue #362's ficha médica lookup — one bulk
    // `/fichas-medicas/existe` call, never one per student.
    const personas = Array.from({ length: 5 }, (_, index) => ({
      ...persona,
      id: index + 10,
      representanteId: null,
    }));
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: personas, total: 5, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos — nobody has paid
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0, skip: 0, limit: 200 })) // /membresias/ (bulk)
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));

    expect(response.status).toBe(200);
    // Exactly 5 calls total: personas, pagos, tipos, membresias, fichas-medicas/existe — never one per student.
    expect(global.fetch).toHaveBeenCalledTimes(5);
  });

  it("loops every backend page so a membership past the 200-row cap is never dropped", async () => {
    // Memberships accumulate per persona over time (vencida, inactiva, la
    // activa), so the membership table outgrows the persona table — 150
    // socios can easily produce 300+ membresía rows. A single
    // `GET /membresias/?limit=200` call would silently drop everything past
    // row 200: `personasCapped` stays false (150 < 200) while a third of the
    // membership map is already gone, and a real socio renders with no
    // membership and no warning. This asserts the fix: the route must keep
    // paging until it has every row, not just the first 200.
    const personaTardia = { ...persona, id: 999, nombres: "Zoe", apellidos: "Tardia" };
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      id: i + 1, estado: "VENCIDA", tipoMembresiaId: 1, personaId: i + 1,
    }));
    const page2 = [{ id: 201, estado: "ACTIVA", tipoMembresiaId: 1, personaId: 999 }];

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona, personaTardia], total: 2, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: page1, total: 201, skip: 0, limit: 200 })) // /membresias/ page 1
      .mockResolvedValueOnce(jsonResponse({ items: page2, total: 201, skip: 200, limit: 200 })) // /membresias/ page 2
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })) // /fichas-medicas/existe
      .mockResolvedValueOnce(jsonResponse([])); // /membresias/deuda/bulk — persona 3's page-1 row is VENCIDA

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("http://localhost:8000/api/v1/membresias/?skip=0&limit=200");
    expect(urls).toContain("http://localhost:8000/api/v1/membresias/?skip=200&limit=200");

    const cuentaTardia = body.accounts.find((account: { id: string }) => account.id === "999");
    expect(cuentaTardia.estudiantes[0].membresia).toMatchObject({ id: 201, estado: "activa" });
    expect(body.membresiasDegraded).toBe(false);
  });

  it("loops every backend page so a payment past the 200-row cap is never dropped", async () => {
    // Same failure mode `fetchAllMembresias` already closes, on the other
    // list: payments accumulate per persona over time (one row per renewal),
    // so the payment table outgrows the persona table just as the membership
    // table does. A single `GET /membresias/pagos?limit=200` drops everything
    // past row 200 while `personasCapped` stays false, and the socio whose
    // payment fell outside renders as "sin pago" — a swallowed truncation
    // reported as a confident absence.
    const personaTardia = { ...persona, id: 999, nombres: "Zoe", apellidos: "Tardia" };
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      ...pago, id: i + 1, personaId: i + 1, membresiaId: undefined,
    }));
    // A monto no row on page 1 carries, so the assertion below can only pass
    // with the page-2 row actually in hand — not with a page-1 lookalike.
    const pagoTardio = { ...pago, id: 201, personaId: 999, membresiaId: 77, monto: "88.00" };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona, personaTardia], total: 2, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: page1, total: 201, skip: 0, limit: 200 })) // /membresias/pagos page 1
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [membresia], total: 1, skip: 0, limit: 200 })) // /membresias/
      .mockResolvedValueOnce(jsonResponse({ items: [pagoTardio], total: 201, skip: 200, limit: 200 })) // /membresias/pagos page 2
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls).toContain("http://localhost:8000/api/v1/membresias/pagos?skip=0&limit=200");
    expect(urls).toContain("http://localhost:8000/api/v1/membresias/pagos?skip=200&limit=200");

    const cuentaTardia = body.accounts.find((account: { id: string }) => account.id === "999");
    expect(cuentaTardia.estudiantes[0].ultimoPago).toMatchObject({ monto: 88 });
  });

  it("treats a mid-loop payment page failure as no payments at all, never as a partial list", async () => {
    // A partial payment list is the same lie as a truncated one: the personas
    // whose rows were on the page that failed render as "sin pago" with the
    // same confidence as the ones who genuinely never paid. Payments are
    // best-effort here (see the route's header comment), so the honest
    // degradation is the empty list the route already handles — not half of one.
    const page1 = Array.from({ length: 200 }, (_, i) => ({
      ...pago, id: i + 1, personaId: i + 1, membresiaId: undefined,
    }));

    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ items: page1, total: 201, skip: 0, limit: 200 })) // /membresias/pagos page 1
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [membresia], total: 1, skip: 0, limit: 200 })) // /membresias/
      .mockResolvedValueOnce(jsonResponse({ detail: "boom" }, 500)) // /membresias/pagos page 2
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts[0].estudiantes[0].ultimoPago).toBeNull();
  });

  it("gives up instead of looping forever when a page never reports a usable total", async () => {
    // The loop's normal exits are a short page and `items.length >= total`.
    // A backend that answers full pages while omitting `total` satisfies
    // neither — `n >= undefined` is false — so a bug that made `skip` a no-op
    // would spin the Route Handler until its deadline with the browser's
    // request open. The bound turns that into the same honest degradation a
    // failed page already produces: no payments, rather than a partial list
    // or a hang.
    const fullPage = Array.from({ length: 200 }, (_, i) => ({
      ...pago, id: i + 1, personaId: i + 1, membresiaId: undefined,
    }));

    vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/personas/")) {
        return Promise.resolve(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 }));
      }
      if (url.includes("/membresias/tipos")) return Promise.resolve(jsonResponse([tipo]));
      if (url.includes("/membresias/pagos")) {
        // Full page, every time, and no `total` — the pathological shape.
        return Promise.resolve(jsonResponse({ items: fullPage }));
      }
      if (url.includes("/fichas-medicas/existe")) {
        return Promise.resolve(jsonResponse({ personaIdsConFicha: [] }));
      }
      return Promise.resolve(jsonResponse({ items: [membresia], total: 1, skip: 0, limit: 200 }));
    });

    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts[0].estudiantes[0].ultimoPago).toBeNull();

    const pagosCalls = vi
      .mocked(global.fetch)
      .mock.calls.map((call) => String(call[0]))
      .filter((url) => url.includes("/membresias/pagos"));
    expect(pagosCalls.length).toBeLessThanOrEqual(MAX_PAGES_PER_SOURCE);
  });

  it("fires every independent backend call at once instead of waiting for /personas/", async () => {
    // Nothing in the pagos/tipos/membresías batch reads the personas response,
    // so awaiting personas first only serialises four independent round trips
    // into two stages. Each `backendFetchAuthed` carries its own deadline
    // (10 s by default), so the wasted stage is real latency on the heaviest
    // admin screen, not just a stylistic detail.
    let releasePersonas: (response: Response) => void = () => {};
    const personasPending = new Promise<Response>((resolve) => {
      releasePersonas = resolve;
    });

    vi.mocked(global.fetch)
      .mockReturnValueOnce(personasPending) // /personas/ — deliberately left in flight
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe — fires only after personas resolves

    const pending = GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));

    // Can only pass if the other three were dispatched without waiting on
    // personas — while it stays unresolved, a sequential route makes 1 call.
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

    // Pin WHICH call got the deferred promise. Without this the test only
    // says "four calls fired while one was pending", which a reordering of
    // the Promise.all array would keep satisfying while quietly restoring a
    // serial personas fetch under some other name.
    const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain("/personas/");
    expect(urls.slice(1)).toEqual([
      expect.stringContaining("/membresias/pagos"),
      expect.stringContaining("/membresias/tipos"),
      expect.stringContaining("/membresias/?"),
    ]);

    releasePersonas(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 }));
    const response = await pending;

    expect(response.status).toBe(200);
  });

  it("degrades gracefully (empty pagos/tipos) when those calls fail", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
      .mockResolvedValueOnce(jsonResponse({ detail: "Forbidden" }, 403)) // /membresias/pagos
      .mockResolvedValueOnce(jsonResponse({ detail: "Forbidden" }, 403)) // /membresias/tipos
      .mockResolvedValueOnce(jsonResponse({ items: [] })) // /membresias/?limit=200 (bulk)
      .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

    const access = makeJwt(3600);
    const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${access}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.accounts[0].estudiantes[0].membresia).toBeNull();
  });

  // --- Deuda en bloque (issue #326) -------------------------------------------
  describe("bulk debt lookup", () => {
    const membresiaVencida = { ...membresia, estado: "VENCIDA" };

    it("does not call the bulk debt endpoint when no membership is VENCIDA", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
        .mockResolvedValueOnce(jsonResponse({ items: [pago] })) // /membresias/pagos
        .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
        .mockResolvedValueOnce(jsonResponse({ items: [membresia], total: 1, skip: 0, limit: 200 })) // /membresias/ (ACTIVA)
        .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })); // /fichas-medicas/existe

      const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));

      expect(response.status).toBe(200);
      // Exactly 5 calls: no /membresias/deuda/bulk fired for an ACTIVA-only page.
      expect(global.fetch).toHaveBeenCalledTimes(5);
    });

    it("calls the bulk debt endpoint ONCE for every VENCIDA membership and attaches amount + months", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
        .mockResolvedValueOnce(jsonResponse({ items: [pago] })) // /membresias/pagos
        .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
        .mockResolvedValueOnce(jsonResponse({ items: [membresiaVencida], total: 1, skip: 0, limit: 200 })) // /membresias/
        .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })) // /fichas-medicas/existe
        .mockResolvedValueOnce(
          jsonResponse([
            { membresiaId: 77, mesesAdeudados: 3, ultimaCoberturaFin: "2026-05-31", montoMensual: "30.00" },
          ]),
        ); // /membresias/deuda/bulk

      const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(6);
      const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
      const bulkCalls = urls.filter((url) => url.includes("/membresias/deuda/bulk"));
      expect(bulkCalls).toHaveLength(1);
      expect(bulkCalls[0]).toContain("membresia_ids=77");

      const student = body.accounts[0].estudiantes[0];
      expect(student.membresia.mesesAdeudados).toBe(3);
      expect(student.membresia.montoAdeudado).toBe(90);
    });

    /*
     * Issue #713. The route decides WHICH ids go into the bulk query, and it
     * has to ask the same question the screen asks. An INACTIVA membership
     * leaves this route as `estado: "vencida"`, so omitting it from the query
     * hands the dialog a vencida whose debt was never requested — which is
     * exactly what "Estado de deuda no disponible" was reporting.
     */
    const membresiaInactiva = { ...membresia, estado: "INACTIVA" };

    it("includes an INACTIVA membership in the bulk debt query, because it is served as vencida", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
        .mockResolvedValueOnce(jsonResponse({ items: [pago] })) // /membresias/pagos
        .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
        .mockResolvedValueOnce(jsonResponse({ items: [membresiaInactiva], total: 1, skip: 0, limit: 200 })) // /membresias/
        .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })) // /fichas-medicas/existe
        .mockResolvedValueOnce(
          jsonResponse([
            { membresiaId: 77, mesesAdeudados: 0, ultimaCoberturaFin: null, montoMensual: "25.00" },
          ]),
        ); // /membresias/deuda/bulk

      const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
      const body = await response.json();

      expect(response.status).toBe(200);
      const urls = vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
      const bulkCalls = urls.filter((url) => url.includes("/membresias/deuda/bulk"));
      // The call is made at all — before this fix it never was for INACTIVA…
      expect(bulkCalls).toHaveLength(1);
      expect(bulkCalls[0]).toContain("membresia_ids=77");

      const student = body.accounts[0].estudiantes[0];
      expect(student.membresia.estado).toBe("vencida");
      // …and the answer reaches the dialog, so it stops degrading.
      expect(student.membresia.mesesAdeudados).toBe(0);
      expect(student.membresia.montoAdeudado).toBe(0);
    });

    it("degrades gracefully (no debt fields) when the bulk debt fetch fails", async () => {
      vi.mocked(global.fetch)
        .mockResolvedValueOnce(jsonResponse({ items: [persona], total: 1, skip: 0, limit: 200 })) // /personas/
        .mockResolvedValueOnce(jsonResponse({ items: [pago] })) // /membresias/pagos
        .mockResolvedValueOnce(jsonResponse([tipo])) // /membresias/tipos
        .mockResolvedValueOnce(jsonResponse({ items: [membresiaVencida], total: 1, skip: 0, limit: 200 })) // /membresias/
        .mockResolvedValueOnce(jsonResponse({ personaIdsConFicha: [] })) // /fichas-medicas/existe
        .mockResolvedValueOnce(jsonResponse({ detail: "boom" }, 500)); // /membresias/deuda/bulk fails

      const response = await GET(getRequest(`${ACCESS_TOKEN_COOKIE}=${makeJwt(3600)}`));
      const body = await response.json();

      expect(response.status).toBe(200);
      const student = body.accounts[0].estudiantes[0];
      expect(student.membresia.estado).toBe("vencida");
      expect(student.membresia.mesesAdeudados).toBeUndefined();
      expect(student.membresia.montoAdeudado).toBeUndefined();
    });
  });
});
