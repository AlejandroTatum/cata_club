/**
 * GET /api/members/[id] — ONE `MemberAccount`, for the per-member payments
 * page (#1668, `/members/[id]/pagos`).
 *
 * `GET /api/members` drains every persona, membership and payment to build the
 * whole list; a page about a single member must not pay that cost, and must
 * not depend on the member having been part of what a list happened to load.
 * This route asks the backend only about this persona (`/personas/{id}`,
 * `/membresias/persona/{id}`, `/membresias/pagos/persona/{id}`) plus the same
 * catalog/bulk lookups the list uses, and feeds them to the SAME
 * `buildMemberAccounts` — no second place that decides what a member looks
 * like.
 *
 * Authorization: the BFF holds no role of its own; the backend decides. Three
 * of the lookups here (`/personas/{id}`, `/membresias/persona/{id}`,
 * `/membresias/pagos/persona/{id}`) also answer to the persona themselves or
 * their representative, so on their own they would let a player read their own
 * payments data through this ADMIN screen's route. `/personas/roles/bulk` is
 * ADMINISTRADOR-only in the backend (`personas_router.py`, `GestorPermisos`) —
 * the very call `GET /api/members` already depends on — so it is the guard
 * here, and its 401/403 is returned as is, before anything is built.
 *
 * The memberships and payments lookups are NOT best-effort here: an account
 * rendered without them would read as "Sin membresía" and offer to create a
 * second one, so a failure is a failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { parseNumericIdOrBadRequest } from "@/lib/server/bff-helpers";
import { buildMemberAccounts, type BackendPersonaFull } from "@/lib/server/members-adapter";
import {
  fetchDebtByMembership,
  fetchMedicalRecordIds,
  latestPaymentsByPersona,
  membershipMaps,
} from "@/lib/server/members-lookups";
import type { BackendMembresia, BackendPagoListItem, BackendTipoMembresia } from "@/lib/server/payments-adapter";
import type { BackendTipoRol } from "@/types/domain";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const NOT_FOUND_MESSAGE = "No se encontró a este miembro.";
const FORBIDDEN_MESSAGE = "No tienes permiso para ver los pagos de este miembro.";
const LOAD_FAILED_MESSAGE = "No se pudieron cargar los datos del miembro.";

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = parseNumericIdOrBadRequest((await context.params).id, "miembro", { requireInteger: true });
  if (personaId instanceof NextResponse) return personaId;

  const [rolesResult, personaResult, membresiasResult, pagosResult, tiposResult] = await Promise.all([
    backendFetchAuthed(request, `/personas/roles/bulk?persona_ids=${personaId}`),
    backendFetchAuthed(request, `/personas/${personaId}`),
    backendFetchAuthed(request, `/membresias/persona/${personaId}`),
    backendFetchAuthed(request, `/membresias/pagos/persona/${personaId}`),
    backendFetchAuthed(request, "/membresias/tipos"),
  ]);

  // The admin-only guard first: a 401/403 here is the whole answer.
  if (!rolesResult.ok) return NextResponse.json({ message: LOAD_FAILED_MESSAGE }, { status: rolesResult.status });
  if (rolesResult.response.status === 401 || rolesResult.response.status === 403) {
    return passthroughBackendError(rolesResult.response, FORBIDDEN_MESSAGE);
  }
  if (personaResult.ok && personaResult.response.status === 404) {
    return NextResponse.json({ message: NOT_FOUND_MESSAGE }, { status: 404 });
  }
  for (const result of [rolesResult, personaResult, membresiasResult, pagosResult]) {
    if (!result.ok) return NextResponse.json({ message: LOAD_FAILED_MESSAGE }, { status: result.status });
    if (!result.response.ok) return passthroughBackendError(result.response, LOAD_FAILED_MESSAGE);
  }
  if (!personaResult.ok || !membresiasResult.ok || !pagosResult.ok) {
    // Unreachable (the loop above returned); narrows the union for the reads below.
    return NextResponse.json({ message: LOAD_FAILED_MESSAGE }, { status: 502 });
  }

  const persona = (await personaResult.response.json()) as BackendPersonaFull;
  const membresias = (await membresiasResult.response.json()) as BackendMembresia[];
  const pagos = ((await pagosResult.response.json()) as Omit<BackendPagoListItem, "personaNombreCompleto">[]).map(
    (pago) => ({ ...pago, personaNombreCompleto: `${persona.nombres} ${persona.apellidos}` }),
  );
  const tipos: BackendTipoMembresia[] =
    tiposResult.ok && tiposResult.response.ok ? await tiposResult.response.json() : [];

  const maps = membershipMaps(membresias.map((membresia) => ({ ...membresia, personaId })));
  const latest = latestPaymentsByPersona(pagos);
  const personas = [persona];

  const rolesByPersonaId = new Map<number, BackendTipoRol[]>(
    ((await rolesResult.response.json()) as { personaId: number; roles: BackendTipoRol[] }[]).map((item) => [
      item.personaId,
      item.roles,
    ]),
  );
  const [personaIdsConFicha, deudaByMembresiaId] = await Promise.all([
    fetchMedicalRecordIds(request, personas),
    fetchDebtByMembership(request, personas, latest, maps),
  ]);

  const [account] = buildMemberAccounts(
    personas,
    latest,
    maps.byId,
    maps.byPersona,
    new Map(tipos.map((tipo) => [tipo.id, tipo])),
    personaIdsConFicha,
    deudaByMembresiaId,
    rolesByPersonaId,
  );

  const response = NextResponse.json({ account });
  if (personaResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: personaResult.refreshedAccessToken });
  }
  return response;
}
