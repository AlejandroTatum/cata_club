/**
 * GET /api/members — aggregates FastAPI's `/personas`, `/membresias/pagos*`,
 * `/membresias/*` and `/ranking/niveles*` into the `MemberAccount[]` shape
 * src/app/members/page.tsx renders (see src/lib/server/members-adapter.ts
 * for the DTO translation and the backend gaps found while building it).
 * Mirrors src/app/api/payments/route.ts's aggregation style.
 *
 * `GET /membresias/pagos` and `GET /ranking/niveles/{id}/tabla` calls are
 * best-effort: this page's own protection (`allowedRoles={["admin"]}`)
 * covers the admin-only payments queue in practice, but if either fails
 * (e.g. a future non-admin caller) the response still renders — accounts
 * without resolvable membership/group data, not a hard failure.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { buildMemberAccounts, type BackendPersonaFull } from "@/lib/server/members-adapter";
import type { BackendMembresia, BackendPagoListItem, BackendTipoMembresia } from "@/lib/server/payments-adapter";
import type { NivelConOcupacion, TablaRankingItem } from "@/services/api";

const PERSONAS_PAGE_LIMIT = 200;

/** How many `GET /membresias/{id}` calls may be in flight at once. */
const MEMBRESIA_FETCH_CONCURRENCY = 8;

interface PaginatedPersonas {
  items: BackendPersonaFull[];
  total: number;
}

interface PaginatedPagos {
  items: BackendPagoListItem[];
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const personasResult = await backendFetchAuthed(request, `/personas/?limit=${PERSONAS_PAGE_LIMIT}`);
  if (!personasResult.ok) {
    return NextResponse.json({ message: "No se pudieron cargar las personas." }, { status: personasResult.status });
  }
  if (!personasResult.response.ok) {
    return passthroughBackendError(personasResult.response, "No se pudieron cargar las personas.");
  }
  const personasBody = (await personasResult.response.json()) as PaginatedPersonas;

  const [pagosResult, tiposResult, nivelesResult] = await Promise.all([
    backendFetchAuthed(request, "/membresias/pagos?limit=200"),
    backendFetchAuthed(request, "/membresias/tipos"),
    backendFetchAuthed(request, "/ranking/niveles"),
  ]);

  const pagos: BackendPagoListItem[] =
    pagosResult.ok && pagosResult.response.ok ? ((await pagosResult.response.json()) as PaginatedPagos).items : [];
  const tipos: BackendTipoMembresia[] =
    tiposResult.ok && tiposResult.response.ok ? await tiposResult.response.json() : [];
  const niveles: NivelConOcupacion[] =
    nivelesResult.ok && nivelesResult.response.ok ? await nivelesResult.response.json() : [];

  const latestPagoByPersona = new Map<number, BackendPagoListItem>();
  for (const pago of pagos) {
    const current = latestPagoByPersona.get(pago.personaId);
    if (!current || new Date(pago.fechaRegistro) > new Date(current.fechaRegistro)) {
      latestPagoByPersona.set(pago.personaId, pago);
    }
  }

  /*
   * Memberships are resolved ONE BY ONE, not through `GET /membresias/`.
   *
   * The list endpoint answers 500 — `MembresiaServicio.listar_membresias`
   * calls `MembresiaRepositorio.listar()`, which that repository does not
   * define (backend/app/infraestructura/repositorios/membresia_repositorio.py).
   * This route used to turn that 500 into `[]` with an `ok &&` guard, so every
   * student came back with `membresia: null` and `/members` rendered a
   * confident "Membresías activas · 0" next to a dashboard reading 22 — plus
   * an empty membership column in the whole table. A swallowed upstream error
   * must never render as a real zero.
   *
   * `GET /membresias/{id}` works, and the ids needed are only those on the
   * latest payment per persona (~60), not the whole table. They go out in
   * bounded batches rather than one `Promise.all` over all of them: the
   * dashboard route's own history (see its header) is that an unbounded fan-out
   * exhausted the backend connection pool.
   */
  const uniqueMembresiaIds = [...new Set([...latestPagoByPersona.values()].map((pago) => pago.membresiaId))];
  const membresiaById = new Map<number, BackendMembresia>();
  let membresiasDegraded = false;

  for (let i = 0; i < uniqueMembresiaIds.length; i += MEMBRESIA_FETCH_CONCURRENCY) {
    const batch = uniqueMembresiaIds.slice(i, i + MEMBRESIA_FETCH_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (id) => {
        const result = await backendFetchAuthed(request, `/membresias/${id}`);
        if (!result.ok || !result.response.ok) return null;
        return (await result.response.json()) as BackendMembresia;
      }),
    );
    for (const membresia of settled) {
      if (membresia === null) membresiasDegraded = true;
      else membresiaById.set(membresia.id, membresia);
    }
  }

  /*
   * A membership can exist with no payment behind it — three personas in the
   * current data hold an ACTIVA membresía and zero Pago rows, so the payment
   * chain above cannot see them at all and this screen showed them as
   * membership-less while their own student portal said otherwise. Only the
   * personas the chain missed are looked up, so this costs nothing for anyone
   * who has ever paid.
   */
  const personasSinPago = personasBody.items
    .map((persona) => persona.id)
    .filter((id) => !latestPagoByPersona.has(id));
  const membresiaByPersona = new Map<number, BackendMembresia>();

  for (let i = 0; i < personasSinPago.length; i += MEMBRESIA_FETCH_CONCURRENCY) {
    const batch = personasSinPago.slice(i, i + MEMBRESIA_FETCH_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (personaId) => {
        const result = await backendFetchAuthed(request, `/membresias/persona/${personaId}`);
        if (!result.ok || !result.response.ok) return null;
        const body: unknown = await result.response.json();
        // A body that is not a list is a broken contract, not "no membership":
        // treat it as degraded so the page shows "—" rather than a false zero.
        if (!Array.isArray(body)) return null;
        const items = body as BackendMembresia[];
        // An ACTIVA membership is the one worth showing; otherwise the first
        // row, so a VENCIDA still reads as a lapsed member rather than as none.
        return { personaId, membresia: items.find((m) => m.estado === "ACTIVA") ?? items[0] ?? null };
      }),
    );
    for (const entry of settled) {
      if (entry === null) membresiasDegraded = true;
      else if (entry.membresia) membresiaByPersona.set(entry.personaId, entry.membresia);
    }
  }

  const tipoById = new Map(tipos.map((tipo) => [tipo.id, tipo]));

  const tablaEntries = await Promise.all(
    niveles.map(async (nivel) => {
      const result = await backendFetchAuthed(request, `/ranking/niveles/${nivel.id}/tabla`);
      const tabla: TablaRankingItem[] = result.ok && result.response.ok ? await result.response.json() : [];
      return tabla.map((item) => [item.personaId, nivel.id] as const);
    }),
  );
  const nivelIdByPersona = new Map(tablaEntries.flat());

  const accounts = buildMemberAccounts(
    personasBody.items,
    latestPagoByPersona,
    membresiaById,
    membresiaByPersona,
    tipoById,
    nivelIdByPersona,
  );

  const personasCapped = personasBody.total >= PERSONAS_PAGE_LIMIT;
  const response = NextResponse.json({ accounts, niveles, personasCapped, membresiasDegraded });
  if (personasResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: personasResult.refreshedAccessToken });
  }
  return response;
}
