/**
 * Backend lookups shared by the BFF routes that build `MemberAccount`s:
 * `GET /api/members` (every persona) and `GET /api/members/[id]` (one).
 * Moved out of the list route unchanged — a Next.js route module may only
 * export HTTP handlers, so the second consumer could not import them from it.
 *
 * ⚠️ Server-only.
 */

import type { NextRequest } from "next/server";
import { backendFetchAuthed } from "@/lib/server/backend-client";
import { readsAsVencida } from "@/lib/membership-status";
import {
  resolveMembresiaParaPersona,
  selectMembresiaParaPersona,
  type BackendPersonaFull,
  type DeudaBulkItem,
} from "@/lib/server/members-adapter";
import type { BackendMembresia, BackendPagoListItem } from "@/lib/server/payments-adapter";
import type { BackendTipoRol } from "@/types/domain";

/** The backend caps every `?persona_ids=` bulk lookup at 200 ids per request. */
const BULK_IDS_LIMIT = 200;

export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export type MembershipMaps = {
  byId: Map<number, BackendMembresia>;
  byPersona: Map<number, BackendMembresia>;
};
type BackendDeudaBulkItem = {
  membresiaId: number;
  mesesAdeudados: number;
  ultimaCoberturaFin?: string | null;
  montoMensual: string;
};

export function latestPaymentsByPersona(pagos: BackendPagoListItem[]): Map<number, BackendPagoListItem> {
  const latest = new Map<number, BackendPagoListItem>();
  for (const pago of pagos) {
    const current = latest.get(pago.personaId);
    if (!current || new Date(pago.fechaRegistro) > new Date(current.fechaRegistro)) {
      latest.set(pago.personaId, pago);
    }
  }
  return latest;
}

export function membershipMaps(membresias: BackendMembresia[]): MembershipMaps {
  const byId = new Map<number, BackendMembresia>();
  const grouped = new Map<number, BackendMembresia[]>();
  for (const membresia of membresias) {
    byId.set(membresia.id, membresia);
    if (membresia.personaId === undefined) continue;
    const list = grouped.get(membresia.personaId) ?? [];
    list.push(membresia);
    grouped.set(membresia.personaId, list);
  }
  const byPersona = new Map<number, BackendMembresia>();
  for (const [personaId, items] of grouped) {
    const selected = selectMembresiaParaPersona(items);
    if (selected) byPersona.set(personaId, selected);
  }
  return { byId, byPersona };
}

export async function fetchMedicalRecordIds(
  request: NextRequest,
  personas: BackendPersonaFull[],
): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const group of chunk(personas, BULK_IDS_LIMIT)) {
    const query = group.map((persona) => `persona_ids=${persona.id}`).join("&");
    const result = await backendFetchAuthed(request, `/fichas-medicas/existe?${query}`);
    if (!result.ok || !result.response.ok) continue;
    const body = (await result.response.json()) as { personaIdsConFicha?: number[] };
    for (const id of body.personaIdsConFicha ?? []) ids.add(id);
  }
  return ids;
}

type BackendRolesBulkItem = { personaId: number; roles: BackendTipoRol[] };

/**
 * Issue #1132: "who has which roles" — one bulk `?persona_ids=1&persona_ids=2`
 * call, same shape and same best-effort degrade as `fetchMedicalRecordIds`
 * right above (a failed lookup degrades to "no real roles known" rather than
 * failing the whole page, and `members-adapter.ts` already falls back to the
 * pre-#1132 default for any persona missing from the map).
 */
export async function fetchRolesByPersonaId(
  request: NextRequest,
  personas: BackendPersonaFull[],
): Promise<Map<number, BackendTipoRol[]>> {
  const roles = new Map<number, BackendTipoRol[]>();
  for (const group of chunk(personas, BULK_IDS_LIMIT)) {
    const query = group.map((persona) => `persona_ids=${persona.id}`).join("&");
    const result = await backendFetchAuthed(request, `/personas/roles/bulk?${query}`);
    if (!result.ok || !result.response.ok) continue;
    const items = (await result.response.json()) as BackendRolesBulkItem[];
    for (const item of items) roles.set(item.personaId, item.roles);
  }
  return roles;
}

export async function fetchDebtByMembership(
  request: NextRequest,
  personas: BackendPersonaFull[],
  latest: Map<number, BackendPagoListItem>,
  maps: MembershipMaps,
): Promise<Map<number, DeudaBulkItem>> {
  const ids = new Set<number>();
  for (const persona of personas) {
    const membresia = resolveMembresiaParaPersona(persona.id, latest.get(persona.id), maps.byId, maps.byPersona);
    if (membresia && readsAsVencida(membresia.estado)) ids.add(membresia.id);
  }
  const debts = new Map<number, DeudaBulkItem>();
  for (const group of chunk(Array.from(ids), BULK_IDS_LIMIT)) {
    const query = group.map((id) => `membresia_ids=${id}`).join("&");
    const result = await backendFetchAuthed(request, `/membresias/deuda/bulk?${query}`);
    if (!result.ok || !result.response.ok) continue;
    const items = (await result.response.json()) as BackendDeudaBulkItem[];
    for (const item of items) {
      debts.set(item.membresiaId, {
        mesesAdeudados: item.mesesAdeudados,
        montoMensual: Number(item.montoMensual),
        ultimaCoberturaFin: item.ultimaCoberturaFin ?? null,
      });
    }
  }
  return debts;
}
