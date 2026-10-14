/**
 * Shared fixtures for the BFF tests that sit behind the non-payment block gate
 * (#1779 S4): `GET /auth/me` says who the caller is, `GET /portal/alumno/{id}`
 * says which of their profiles is blocked, and the resource itself answers last.
 */

import { vi } from "vitest";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** The camelCased `/auth/me` body the BFF reads. */
export function meBody(overrides: {
  personaId?: number;
  roles?: string[];
  bloqueadoPorImpago?: boolean;
} = {}): Record<string, unknown> {
  return {
    correo: "caller@example.com",
    personaId: overrides.personaId ?? 5,
    nombres: "Caller",
    apellidos: "Account",
    roles: overrides.roles ?? ["ESTUDIANTE"],
    bloqueadoPorImpago: overrides.bloqueadoPorImpago ?? false,
    cubiertoHasta: null,
  };
}

/** A minimal `GET /portal/alumno/{id}` body: the caller's own profile and their dependents. */
export function portalBody(
  titular: { id: number; bloqueadoPorImpago?: boolean },
  representados: Array<{ id: number; bloqueadoPorImpago?: boolean }> = [],
): Record<string, unknown> {
  const perfil = (p: { id: number; bloqueadoPorImpago?: boolean }) => ({
    persona: { id: p.id, nombres: "N", apellidos: "A", representanteId: null },
    representante: null,
    historial: [],
    membresias: [],
    bloqueadoPorImpago: p.bloqueadoPorImpago ?? false,
    cubiertoHasta: p.bloqueadoPorImpago ? "2026-09-30" : null,
  });
  return {
    titular: perfil(titular),
    representados: representados.map(perfil),
    horarios: [],
    tipos: [],
  };
}

type Route = Response | (() => Response);

/**
 * Answers `fetch` by URL substring (first match wins) so a test states WHICH
 * backend resources it serves instead of the order they are asked in. An
 * unmatched URL fails the test loudly with a 599.
 */
export function routeFetch(routes: Record<string, Route>): void {
  vi.mocked(global.fetch).mockImplementation(async (input) => {
    const url = String(input);
    const key = Object.keys(routes).find((fragment) => url.includes(fragment));
    if (key === undefined) return new Response(`unrouted fetch: ${url}`, { status: 599 });
    const route = routes[key];
    return typeof route === "function" ? route() : route.clone();
  });
}

/** Every URL the BFF asked the backend for, in order. */
export function fetchedUrls(): string[] {
  return vi.mocked(global.fetch).mock.calls.map((call) => String(call[0]));
}
