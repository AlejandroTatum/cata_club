/**
 * Server side of the non-payment block (#1768, #1779 S4).
 *
 * The portal sends a blocked profile to Payments with a client redirect. That
 * is UX, not a boundary: the BFF routes behind the pages it hides (the portal
 * aggregate, the attendance history, the medical record) must refuse the same
 * profile themselves, so the data is not one URL away. The backend already
 * computes the block per profile (`bloqueadoPorImpago` on `/auth/me` and on each
 * portal profile) and is not reachable from outside except through this BFF, so
 * the decision is made here from those two reads.
 *
 * Staff are NEVER restricted (see `isPaymentsOnlyProfile`), and the Payments
 * module is not behind this gate.
 *
 * ⚠️ Server-only — import only from Route Handlers (`src/app/api/**`).
 */

import { NextResponse, type NextRequest } from "next/server";
import { pickRefreshed, refreshedTokenCookies, setAuthCookies, type RefreshedTokens } from "@/lib/server/auth";
import { backendFetchAuthed } from "@/lib/server/backend-client";
import { PAYMENT_BLOCK_API_MESSAGE, PAYMENT_BLOCK_ERROR_CODE } from "@/lib/payment-block";

const STAFF_ROLES = ["ADMINISTRADOR", "ENTRENADOR"];

export interface CallerIdentity extends RefreshedTokens {
  personaId: number;
  isStaff: boolean;
  /** The caller's OWN profile is blocked. */
  blocked: boolean;
}

export type CallerCheck =
  | { ok: true; caller: CallerIdentity }
  | { ok: false; response: NextResponse };

function failure(status: number): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ message: "No autorizado" }, { status }) };
}

/** Who the caller is and whether their own profile is blocked, from `/auth/me`. */
export async function resolveCaller(request: NextRequest): Promise<CallerCheck> {
  const result = await backendFetchAuthed(request, "/auth/me", { method: "GET", cache: "no-store" });
  if (!result.ok) return failure(result.status);
  if (!result.response.ok) return failure(result.response.status === 403 ? 403 : 401);
  const me = (await result.response.json().catch(() => null)) as Record<string, unknown> | null;
  const personaId = Number(me?.personaId);
  if (!Number.isInteger(personaId)) return failure(401);
  const roles = Array.isArray(me?.roles) ? me.roles : [];
  return {
    ok: true,
    caller: {
      personaId,
      isStaff: roles.some((role) => STAFF_ROLES.includes(String(role))),
      blocked: me?.bloqueadoPorImpago === true,
      ...pickRefreshed(result),
    },
  };
}

/** The 403 a blocked profile's data gets: same status and shape everywhere. */
export function paymentBlockedResponse(refreshed: RefreshedTokens = {}): NextResponse {
  const response = NextResponse.json(
    { message: PAYMENT_BLOCK_API_MESSAGE, mensaje_seguro: true, codigo: PAYMENT_BLOCK_ERROR_CODE },
    { status: 403 },
  );
  if (refreshed.refreshedAccessToken) setAuthCookies(response, refreshedTokenCookies(refreshed));
  return response;
}

export type PersonaGate =
  | ({ ok: true } & RefreshedTokens)
  | { ok: false; response: NextResponse };

/**
 * Lets the request through unless `personaId` is a blocked profile the caller
 * is NOT staff for. The target is the caller (own flag), or one of the caller's
 * dependents (the portal aggregate carries each one's flag). A target that is
 * neither is left to the backend's own ownership check, which refuses it.
 * An unresolvable caller or portal fails closed.
 */
export async function gateBlockedPersona(request: NextRequest, personaId: number): Promise<PersonaGate> {
  const who = await resolveCaller(request);
  if (!who.ok) return who;
  const { caller } = who;
  if (caller.isStaff) return { ok: true, ...pickRefreshed(caller) };

  if (caller.personaId === personaId) {
    return caller.blocked ? { ok: false, response: paymentBlockedResponse(caller) } : { ok: true, ...pickRefreshed(caller) };
  }

  const portal = await backendFetchAuthed(request, `/portal/alumno/${caller.personaId}?historial_limite=1`, {
    cache: "no-store",
  });
  if (!portal.ok) return failure(portal.status);
  if (!portal.response.ok) return failure(portal.response.status === 403 ? 403 : 502);
  const body = (await portal.response.json().catch(() => null)) as {
    representados?: Array<{ persona?: { id?: number | string }; bloqueadoPorImpago?: boolean }>;
  } | null;
  if (body === null) return failure(502);
  const refreshed = pickRefreshed(caller, portal);
  const dependent = body.representados?.find((perfil) => Number(perfil.persona?.id) === personaId);
  if (dependent?.bloqueadoPorImpago === true) return { ok: false, response: paymentBlockedResponse(refreshed) };
  return { ok: true, ...refreshed };
}
