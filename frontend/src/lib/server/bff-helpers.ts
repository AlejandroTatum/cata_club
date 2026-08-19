/**
 * Shared BFF (Backend-for-Frontend) proxy helpers.
 *
 * Every Route Handler under `src/app/api/**` that proxies to FastAPI repeats
 * the same scaffolding: extract the access-token cookie, build an
 * `AbortController` with a timeout, parse a JSON body, relay non-OK backend
 * errors as user-facing messages, and translate abort/network failures into
 * 504/503. These helpers centralize that boilerplate so each route handler
 * only declares its own request shape and backend path — no duplicated
 * cookie/timeout/error plumbing.
 *
 * ⚠️ Server-only — import only from Route Handlers (`src/app/api/**`).
 */

import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_TOKEN_COOKIE, backendFetch, getBackendApiUrl, setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";

/** Default backend timeout for proxied requests. */
export const BACKEND_TIMEOUT_MS = 10_000;

/**
 * Extract the access-token cookie from the incoming request.
 * Returns `null` when the cookie is absent — callers should reply with a 401.
 */
export function extractAccessToken(request: NextRequest): string | null {
  return request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ?? null;
}

/** Build the full backend URL for a given path (e.g. `/ranking/niveles`). */
export function backendUrl(path: string): string {
  return `${getBackendApiUrl()}${path}`;
}

/**
 * Convenience: return a 401 `NextResponse` when the access token is missing.
 * Callers do: `const token = extractAccessToken(request); if (!token) return unauthorizedResponse();`
 */
export function unauthorizedResponse(): NextResponse {
  return NextResponse.json({ message: "No autenticado." }, { status: 401 });
}

/** Return a 400 `NextResponse` with the given message. */
export function badRequestResponse(message: string): NextResponse {
  return NextResponse.json({ message }, { status: 400 });
}

/** Return a 504 `NextResponse` for backend timeout. */
export function timeoutResponse(): NextResponse {
  return NextResponse.json(
    { message: "La solicitud al servidor tardó demasiado." },
    { status: 504 },
  );
}

/** Return a 503 `NextResponse` for network/backend-unreachable failures. */
export function networkErrorResponse(): NextResponse {
  return NextResponse.json(
    { message: "No se pudo contactar al servidor." },
    { status: 503 },
  );
}

/**
 * Parse a JSON body from the request. Returns `[body, null]` on success or
 * `[null, NextResponse]` when the body is not valid JSON — callers should
 * return the error response immediately.
 */
export async function parseJsonBody(
  request: NextRequest,
): Promise<readonly [unknown, null] | readonly [null, NextResponse]> {
  try {
    const body = await request.json();
    return [body, null] as const;
  } catch {
    return [null, badRequestResponse("JSON inválido en el cuerpo de la solicitud.")] as const;
  }
}

/** Safely parse a `Response` body as JSON; returns `null` when the body is empty or not JSON. */
export async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Extract a user-facing message from a parsed backend error body.
 * Falls back to a status-based message when the body has no `message` field.
 */
export function extractBackendErrorMessage(data: unknown, status: number): string {
  if (
    typeof data === "object" &&
    data !== null &&
    typeof (data as Record<string, unknown>).message === "string"
  ) {
    return (data as { message: string }).message;
  }
  return `El servidor respondió con un error (${status}).`;
}

/**
 * Translate a caught error from the proxy `fetch` into the appropriate
 * `NextResponse` (504 for timeout-abort, 503 for network failure).
 */
export function handleProxyError(error: unknown): NextResponse {
  if (error instanceof DOMException && error.name === "AbortError") {
    return timeoutResponse();
  }
  return networkErrorResponse();
}

/**
 * Shared timeout controller. Returns `[controller, done]` where `done()`
 * MUST be called in a `finally` block to clear the timeout.
 */
export function backendTimeout(): readonly [AbortController, () => void] {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  return [controller, () => clearTimeout(timeoutId)] as const;
}

interface ProxyToBackendInit {
  method: string;
  accessToken: string;
  /** JSON-serialized as the request body when present; omit for bodyless requests. */
  body?: unknown;
  /** Status returned on success. Use 204 for a no-content response. Defaults to 200. */
  successStatus?: number;
}

/**
 * Perform a simple proxied fetch to FastAPI and shape the `NextResponse`:
 * attaches the Bearer token and JSON content-type (when a body is given),
 * applies the shared timeout, relays a non-OK backend response as a
 * user-facing error, and on success returns the backend's JSON body (or an
 * empty 204) with `successStatus`. Centralizes the fetch/timeout/error-shaping
 * sequence that simple single-call proxy routes would otherwise each repeat.
 */
export async function proxyToBackend(path: string, init: ProxyToBackendInit): Promise<NextResponse> {
  const { method, accessToken, body, successStatus = 200 } = init;
  const [controller, done] = backendTimeout();
  try {
    const response = await fetch(backendUrl(path), {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${accessToken}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const data = await parseJsonResponse(response);
      return NextResponse.json(
        { message: extractBackendErrorMessage(data, response.status) },
        { status: response.status },
      );
    }

    if (successStatus === 204) {
      return new NextResponse(null, { status: 204 });
    }

    const data = await parseJsonResponse(response);
    return NextResponse.json(data, { status: successStatus });
  } catch (error: unknown) {
    return handleProxyError(error);
  } finally {
    done();
  }
}

/**
 * Shared GET algorithm for anonymous public-catalog routes (issue #394):
 * `api/personas/instituciones` and `api/membresias/tarifas` are the only two
 * BFF routes with NO auth dependency at all, and both proxied the same
 * `backendFetch` + 503 (unreachable) / 502 (backend error) / 502 (invalid
 * JSON) / 200-passthrough sequence almost verbatim. Extracted here so a
 * third anonymous catalog route doesn't copy it a third time.
 *
 * Takes the already-built backend path (including any query string) rather
 * than building it itself: `instituciones` forwards `skip`/`limit` as a
 * query string it assembles on its own, `tarifas` has no query params at
 * all — the helper stays agnostic to that and just proxies whatever path
 * it's given.
 */
export async function publicCatalogGet(
  backendPath: string,
  forwardedFor: string | undefined,
): Promise<NextResponse> {
  const result = await backendFetch(backendPath, { method: "GET" }, { forwardedFor });

  if (!result.ok) {
    return NextResponse.json({ error: result.error.code, message: result.error.message }, { status: 503 });
  }

  const response = result.data;
  if (!response.ok) {
    return NextResponse.json(
      { error: "backend_unavailable", message: `El servidor respondió con un error (${response.status}).` },
      { status: 502 },
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_response", message: "Respuesta del servidor inválida." },
      { status: 502 },
    );
  }

  return NextResponse.json(json, { status: 200 });
}

interface PatchCatalogResourceOptions<Field extends string> {
  /** Raw `[id]` route param — validated as digits-only before anything else runs. */
  id: string;
  /** Build the backend path from the already-validated id (e.g. `(id) => \`/descuentos/${id}\``). */
  buildPath: (id: string) => string;
  /** Whitelist of body keys forwarded to the backend; every other key is dropped. */
  updatableFields: readonly Field[];
  /** 400 message when `id` fails the numeric-id check. */
  invalidIdMessage: string;
  /** Message used both as the fallback backend-error text and when the auth proxy itself fails. */
  failureMessage: string;
}

/**
 * Shared PATCH algorithm for admin catalog resources (issue #400): validate a
 * numeric id, parse JSON, forward only a whitelisted set of body fields — an
 * explicit `null` still travels (it can carry meaning, e.g. clearing a
 * discount's other modality), only `undefined` is dropped — reject an empty
 * payload, PATCH the backend, relay its error verbatim, and refresh the auth
 * cookie on success. `/api/descuentos/[id]` and `/api/membresias/tipos/[id]`
 * were a near-literal copy of exactly this sequence; extracted here so a
 * third catalog PATCH route doesn't copy it a third time.
 */
export async function patchCatalogResource<Field extends string>(
  request: NextRequest,
  options: PatchCatalogResourceOptions<Field>,
): Promise<NextResponse> {
  const { id, buildPath, updatableFields, invalidIdMessage, failureMessage } = options;

  if (!/^\d+$/.test(id)) {
    return badRequestResponse(invalidIdMessage);
  }

  const [body, parseError] = await parseJsonBody(request);
  if (parseError) return parseError;

  const parsed = (typeof body === "object" && body !== null ? body : {}) as Record<Field, unknown>;
  const payload: Record<string, unknown> = {};
  for (const field of updatableFields) {
    if (parsed[field] !== undefined) payload[field] = parsed[field];
  }

  if (Object.keys(payload).length === 0) {
    return badRequestResponse("No hay campos para actualizar.");
  }

  const result = await backendFetchAuthed(request, buildPath(id), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!result.ok) {
    return NextResponse.json({ message: failureMessage }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, failureMessage);
  }

  const data = await result.response.json();
  const response = NextResponse.json(data);
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
