/**
 * Unit tests for the authenticated backend proxy (src/lib/server/backend-client.ts).
 *
 * Why this file exists even though 41 Route Handler tests already exercise
 * this module: none of them mock it, so the happy paths and plain backend
 * errors are genuinely covered — but three regions are unreachable from a
 * Route Handler test, because they need conditions a caller cannot stage from
 * the outside. Measured before writing this file, `backend-client.ts` sat at
 * 71% lines, and every uncovered line was in one of these:
 *
 *   1. The refresh-and-retry-once path (the backend answering 401 while the
 *      token was NOT refreshed during resolution). This is the highest-stakes
 *      one: it decides whether a user whose access token just expired sees a
 *      broken screen or recovers without noticing.
 *   2. `proxyBackendPdfGet` in full — no test executed it at all.
 *   3. The unrecoverable-token branches of `resolveAccessToken`, and the
 *      non-JSON body fallback in `passthroughBackendError` (a 502 from a
 *      proxy answers HTML, not JSON).
 *
 * All backend calls are mocked via vi.spyOn(global, "fetch") — no live
 * FastAPI backend involved.
 *
 * @vitest-environment node
 */

import { NextRequest, type NextResponse } from "next/server";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  backendFetchAuthed,
  passthroughBackendError,
  proxyBackendGet,
  proxyBackendPdfGet,
  type BackendProxyResult,
} from "../backend-client";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function base64Url(input: string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Syntactically valid (unsigned) JWT with the given `exp`, so `isNearExpiry` can read it. */
function makeJwt(expSecondsFromNow: number): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  const payload = base64Url(JSON.stringify({ sub: "1", exp }));
  return `${header}.${payload}.signature`;
}

/** Comfortably outside the 5-minute proactive-refresh threshold. */
const TOKEN_VIGENTE = makeJwt(60 * 60);
/** Inside the threshold, so resolution refreshes before the first attempt. */
const TOKEN_POR_VENCER = makeJwt(60);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function pdfResponse(bytes: Uint8Array, disposition?: string): Response {
  const headers: Record<string, string> = { "Content-Type": "application/pdf" };
  if (disposition) headers["Content-Disposition"] = disposition;
  // `.buffer` y no el `Uint8Array`: bajo esta config de TS la vista tipada no
  // es asignable a `BodyInit`, el ArrayBuffer sí.
  return new Response(bytes.buffer as ArrayBuffer, { status: 200, headers });
}

function requestWith(cookies: Partial<Record<"access" | "refresh", string>>): NextRequest {
  const partes: string[] = [];
  if (cookies.access) partes.push(`${ACCESS_TOKEN_COOKIE}=${cookies.access}`);
  if (cookies.refresh) partes.push(`${REFRESH_TOKEN_COOKIE}=${cookies.refresh}`);
  return new NextRequest("http://localhost/api/whatever", {
    headers: partes.length ? { cookie: partes.join("; ") } : {},
  });
}

/** The Authorization header the mocked fetch received on call `n` (0-based). */
function bearerDeLlamada(n: number): string | undefined {
  const init = vi.mocked(global.fetch).mock.calls[n][1] as RequestInit | undefined;
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
  process.env.BACKEND_API_URL = "http://localhost:8000/api/v1";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.BACKEND_API_URL;
});

// ---------------------------------------------------------------------------
// backendFetchAuthed — token resolution
// ---------------------------------------------------------------------------

describe("backendFetchAuthed — token resolution", () => {
  it("refuses without any cookie, without touching the backend", async () => {
    const result = await backendFetchAuthed(requestWith({}), "/whatever");

    expect(result).toEqual({ ok: false, status: 401, error: "unauthorized" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refreshes before the first attempt when the access token is near expiry", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-fresco", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await backendFetchAuthed(
      requestWith({ access: TOKEN_POR_VENCER, refresh: "refresh-valido" }),
      "/recurso",
    );

    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toContain("/auth/refresh");
    // The refreshed token is what actually goes out, and it is handed back so
    // the caller can persist it — dropping it here would silently log the user
    // out on the next request.
    expect(bearerDeLlamada(1)).toBe("Bearer token-fresco");
    expect(result.ok && result.refreshedAccessToken).toBe("token-fresco");
  });

  it("falls back to the current token when the proactive refresh fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({}, 401)) // refresh rechazado
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await backendFetchAuthed(
      requestWith({ access: TOKEN_POR_VENCER, refresh: "refresh-vencido" }),
      "/recurso",
    );

    // Deliberate: the token is near expiry, not expired. Giving up here would
    // break a request that still had valid seconds left on it.
    expect(result.ok).toBe(true);
    expect(bearerDeLlamada(1)).toBe(`Bearer ${TOKEN_POR_VENCER}`);
  });

  it("gives up when there is only a refresh cookie and the refresh fails", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}, 401));

    const result = await backendFetchAuthed(requestWith({ refresh: "refresh-vencido" }), "/recurso");

    expect(result).toEqual({ ok: false, status: 401, error: "unauthorized" });
    // Only the refresh attempt — no request went out with no credential.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("mints a token from the refresh cookie when there is no access cookie", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-nuevo", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await backendFetchAuthed(requestWith({ refresh: "refresh-valido" }), "/recurso");

    expect(result.ok).toBe(true);
    expect(bearerDeLlamada(1)).toBe("Bearer token-nuevo");
  });
});

// ---------------------------------------------------------------------------
// backendFetchAuthed — refresh-and-retry-once on 401
// ---------------------------------------------------------------------------

describe("backendFetchAuthed — refresh and retry once on 401", () => {
  it("refreshes and retries when the backend rejects a token that looked valid", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ detail: "Token expirado" }, 401))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-reintento", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await backendFetchAuthed(
      requestWith({ access: TOKEN_VIGENTE, refresh: "refresh-valido" }),
      "/recurso",
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.response.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(bearerDeLlamada(0)).toBe(`Bearer ${TOKEN_VIGENTE}`);
    expect(vi.mocked(global.fetch).mock.calls[1][0]).toContain("/auth/refresh");
    expect(bearerDeLlamada(2)).toBe("Bearer token-reintento");
    expect(result.ok && result.refreshedAccessToken).toBe("token-reintento");
  });

  it("relays the 401 when the retry refresh also fails", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ detail: "Token expirado" }, 401))
      .mockResolvedValueOnce(jsonResponse({}, 401));

    const result = await backendFetchAuthed(
      requestWith({ access: TOKEN_VIGENTE, refresh: "refresh-vencido" }),
      "/recurso",
    );

    // `ok: true` because the HTTP call succeeded — it is the caller that turns
    // a non-OK backend response into its own error.
    expect(result.ok).toBe(true);
    expect(result.ok && result.response.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 401 when there is no refresh cookie", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({}, 401));

    const result = await backendFetchAuthed(requestWith({ access: TOKEN_VIGENTE }), "/recurso");

    expect(result.ok && result.response.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry when the token was already refreshed during resolution", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-fresco", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({}, 401));

    const result = await backendFetchAuthed(
      requestWith({ access: TOKEN_POR_VENCER, refresh: "refresh-valido" }),
      "/recurso",
    );

    // A second refresh would be pointless: the token is seconds old. The guard
    // is what keeps a rejected brand-new token from looping.
    expect(result.ok && result.response.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// passthroughBackendError
// ---------------------------------------------------------------------------

describe("passthroughBackendError", () => {
  it("keeps the status and lifts the backend's `detail`", async () => {
    const response = await passthroughBackendError(jsonResponse({ detail: "No se pudo" }, 422), "fallback");

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: "No se pudo" });
  });

  it("prefers `message` over `detail` when the backend sends both", async () => {
    const response = await passthroughBackendError(
      jsonResponse({ message: "Mensaje", detail: "Detalle" }, 400),
      "fallback",
    );

    expect(await response.json()).toEqual({ message: "Mensaje" });
  });

  it("falls back when the body is not JSON at all", async () => {
    // The real case this guards: a proxy or gateway in front of FastAPI
    // answering 502 with an HTML error page. Leaking that page to the browser
    // as a message would be worse than saying nothing useful.
    const html = new Response("<html><body>502 Bad Gateway</body></html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });

    const response = await passthroughBackendError(html, "El servicio no está disponible");

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ message: "El servicio no está disponible" });
  });

  it("falls back when the body is JSON without a usable message", async () => {
    const response = await passthroughBackendError(jsonResponse({ codigo: 7 }, 500), "fallback");

    expect(await response.json()).toEqual({ message: "fallback" });
  });
});

// ---------------------------------------------------------------------------
// proxyBackendGet
// ---------------------------------------------------------------------------

describe("proxyBackendGet", () => {
  it("relays the backend body and persists a refreshed token", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-fresco", token_type: "bearer" }))
      .mockResolvedValueOnce(jsonResponse({ items: [1, 2] }));

    const response = await proxyBackendGet(
      requestWith({ access: TOKEN_POR_VENCER, refresh: "refresh-valido" }),
      "/recurso",
      "error",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [1, 2] });
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("token-fresco");
  });

  it("answers the caller's message when authentication is unrecoverable", async () => {
    const response = await proxyBackendGet(requestWith({}), "/recurso", "No se pudo cargar");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "No se pudo cargar" });
  });
});

// ---------------------------------------------------------------------------
// proxyBackendPdfGet
// ---------------------------------------------------------------------------

describe("proxyBackendPdfGet", () => {
  const BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

  it("streams the bytes back and forwards the backend's Content-Disposition", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      pdfResponse(BYTES, 'attachment; filename="reporte.pdf"'),
    );

    const response = await proxyBackendPdfGet(
      requestWith({ access: TOKEN_VIGENTE }),
      "/reportes/pagos.pdf",
      "error",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="reporte.pdf"');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
  });

  it("falls back to a bare `attachment` when the backend sends no Content-Disposition", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(pdfResponse(BYTES));

    const response = await proxyBackendPdfGet(requestWith({ access: TOKEN_VIGENTE }), "/reportes/x.pdf", "error");

    // Without this the browser renders the PDF inline instead of downloading
    // it, which is a different feature than the one this route offers.
    expect(response.headers.get("Content-Disposition")).toBe("attachment");
  });

  it("persists a refreshed token alongside the bytes", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-fresco", token_type: "bearer" }))
      .mockResolvedValueOnce(pdfResponse(BYTES));

    const response = await proxyBackendPdfGet(
      requestWith({ access: TOKEN_POR_VENCER, refresh: "refresh-valido" }),
      "/reportes/x.pdf",
      "error",
    );

    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("token-fresco");
  });

  it("answers the caller's message when authentication is unrecoverable", async () => {
    const response = await proxyBackendPdfGet(requestWith({}), "/reportes/x.pdf", "No se pudo exportar");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "No se pudo exportar" });
  });

  it("relays a backend error as JSON instead of a broken PDF", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: "Rango inválido" }, 422));

    const response = await proxyBackendPdfGet(requestWith({ access: TOKEN_VIGENTE }), "/reportes/x.pdf", "error");

    // The browser must get a readable error, not a zero-byte file with
    // `Content-Type: application/pdf`.
    expect(response.status).toBe(422);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ message: "Rango inválido" });
  });
});

// ---------------------------------------------------------------------------
// El plazo del backend, y quién lo alarga (issue #197)
//
// Generar un reporte no es autenticar: la ruta de PDF pide 60 s y el resto
// —autenticación incluida— se queda en los 10 s de siempre. Los dos números
// van escritos acá como milisegundos literales, no importados de ../auth: un
// test que lee la misma constante que lee el código se mueve con ella y nunca
// puede avisar que cambió.
//
// Lo que se observa es el abort real llegando al llamador: el backend falso
// no responde nunca por su cuenta, solo cuando el AbortSignal se dispara.
// ---------------------------------------------------------------------------

describe("plazo del backend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(global.fetch).mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          if (!signal) {
            reject(new Error("backendFetch dejó de pasar un AbortSignal — no hay plazo que observar."));
            return;
          }
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("una ruta autenticada común sigue abortando a los 10 s", async () => {
    // La regresión peligrosa del cambio de #197 es aflojarle el plazo a todo:
    // este candado es el que se pone rojo si el plazo largo se vuelve default.
    const observado: BackendProxyResult[] = [];
    const pendiente = backendFetchAuthed(requestWith({ access: TOKEN_VIGENTE }), "/pagos").then((r) =>
      observado.push(r),
    );

    await vi.advanceTimersByTimeAsync(9_999);
    expect(observado).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(observado).toHaveLength(1);
    await pendiente;
    expect(observado[0]).toEqual({ ok: false, status: 503, error: "timeout" });
  });

  it("la ruta de PDF no se corta a los 10 s y aborta a los 60 s", async () => {
    const observado: NextResponse[] = [];
    const pendiente = proxyBackendPdfGet(
      requestWith({ access: TOKEN_VIGENTE }),
      "/reportes/pagos.pdf",
      "No se pudo exportar",
    ).then((r) => observado.push(r));

    // Acá cortaba antes, con el backend todavía renderizando el reporte.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(observado).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(49_999);
    expect(observado).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(observado).toHaveLength(1);
    await pendiente;

    // El cuerpo se lee ya con timers reales: leer un stream no debe depender
    // de que alguien avance un reloj falso.
    vi.useRealTimers();
    expect(observado[0].status).toBe(503);
    expect(await observado[0].json()).toEqual({ message: "No se pudo exportar" });
  });

  it("comparte un único plazo no-default entre 401, refresh y reintento", async () => {
    let resourceCallCount = 0;
    vi.mocked(global.fetch).mockImplementation((input, init) => {
      const url = String(input);
      const signal = init?.signal;

      if (url.endsWith("/reportes/pagos.pdf")) {
        resourceCallCount += 1;
        if (resourceCallCount > 1) {
          return new Promise<Response>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          });
        }
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(jsonResponse({ detail: "Token expirado" }, 401)), 5_000);
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }

      if (url.endsWith("/auth/refresh")) {
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(jsonResponse({ access_token: "token-reintento", token_type: "bearer" })),
            5_000,
          );
          signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      }

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });

    const observado: BackendProxyResult[] = [];
    const pendiente = backendFetchAuthed(
      requestWith({ access: TOKEN_VIGENTE, refresh: "refresh-valido" }),
      "/reportes/pagos.pdf",
      {},
      { timeoutMs: 60_000 },
    ).then((result) => observado.push(result));

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(observado).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(49_999);
    expect(observado).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    await pendiente;

    expect(observado).toEqual([{ ok: false, status: 503, error: "timeout" }]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
