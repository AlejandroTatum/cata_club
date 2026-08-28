/**
 * Shared scaffolding for BFF Route Handler tests.
 *
 * Every `src/app/api/**` route test needs the same four things: a way to build
 * a `NextRequest` carrying a JSON body, canned `Response` objects to hand back
 * from a stubbed `fetch`, and the spy/env setup-teardown pair around
 * `global.fetch` and `BACKEND_API_URL`. Written out per file that block is
 * pure boilerplate, and it was the largest duplicated region in the
 * verification feature's test code.
 *
 * Only SCAFFOLDING lives here — never assertions. What a route is supposed to
 * do stays written out in its own test file, where it can be read next to the
 * route it describes. Extracting environment setup is the same call this
 * codebase already made for `src/components/__tests__/test-utils.ts` and, on
 * the backend, `tests/fabricas_auth.py`; extracting the expectations would be
 * a different and much worse trade.
 */

import { NextRequest } from "next/server";
import { vi, beforeEach, afterEach } from "vitest";

export const BACKEND_API_URL = "http://localhost:8000/api/v1";

/** A JSON `Response`, as FastAPI would return it. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A body-less `Response` — a 204, or an error status with nothing attached. */
export function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

/** Build a POST `NextRequest` for `path` carrying `body` as JSON. */
export function postRequest(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

/**
 * Install the `fetch` spy and `BACKEND_API_URL` for the current test file, and
 * tear both down afterwards. Call once at the top level of the file.
 */
export function stubBackendFetch(): void {
  beforeEach(() => {
    vi.spyOn(global, "fetch");
    process.env.BACKEND_API_URL = BACKEND_API_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.BACKEND_API_URL;
  });
}

/** The single `fetch` call a route made: `[url, init]`. */
export function fetchCall(index = 0): [string, RequestInit] {
  const [url, init] = vi.mocked(global.fetch).mock.calls[index];
  return [String(url), (init ?? {}) as RequestInit];
}
