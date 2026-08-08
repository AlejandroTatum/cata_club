/**
 * Categoria catalog — fetched live from the backend's `categoria_horario`
 * table via `GET /api/attendance/categories` (see that Route Handler's doc
 * comment for the `CategoriaResponseDTO` → frontend translation).
 *
 * This file used to hold a static `CATEGORIA_METADATA` dict calling itself a
 * "mirror of the backend's single source of truth". That was exactly the
 * class of bug `franja_horaria` caused before it (#160): a client-side copy
 * of data the backend can edit at runtime goes stale the moment an admin
 * changes a row. There is no module-level cache here either — the caller
 * (see `@/app/groups/page`'s `loadData`) owns the fetched state, same as it
 * already owns `horarios`/`allStudents`, and that keeps `cargarCategorias`
 * trivially re-callable in tests without needing a reset hook.
 *
 * `hora_inicio`/`hora_fin` are still always derived server-side once a
 * `categoria` is chosen — the client never sends them (see
 * `CrearHorarioDTO`/`ActualizarHorarioDTO` in `@/services/api`), it only
 * reads them here to render a locked, read-only display.
 */

import { fetchCategoriasCatalogo } from "@/services/api";
import type { DiaSemana } from "@/types/domain";

/**
 * The set of accepted codes is still gated by the backend's `Categoria`
 * Python enum — out of scope for this change. Only hours/label/días became
 * dynamic.
 */
export type Categoria = "FORMATIVO" | "INFANTIL" | "JUVENIL" | "COMPETITIVO" | "ADULTOS";

export interface CategoriaInfo {
  label: string;
  horaInicio: string;
  horaFin: string;
  /**
   * Backend day-enum values (`"LUNES"`, `"MARTES"`, ...) — NOT the frontend
   * `DiaSemana` codes `/api/attendance/categories` actually returns on the
   * wire. `@/app/groups/page` (this catalog's only consumer) compares these
   * against `Horario.diaSemana`, which stays in the backend's own format:
   * `/api/groups/horarios` proxies FastAPI's `/asistencias/horarios`
   * response untranslated (unlike `/api/attendance/schedules`). Converting
   * back to that format here — see `DIA_FRONTEND_TO_BACKEND` below — is what
   * keeps `diasPermitidos`/day-checkbox comparisons and the `DIA_LABELS`
   * lookups in `groups-page-utils.ts` working unchanged.
   */
  dias: string[];
}

/** Stable iteration order for the categoría `<select>` — same order the
 *  backend enum declares them in. */
export const CATEGORIA_OPTIONS: Categoria[] = ["FORMATIVO", "INFANTIL", "JUVENIL", "COMPETITIVO", "ADULTOS"];

/**
 * Reverse of `DIA_SEMANA_BACKEND_TO_FRONTEND`
 * (`@/lib/server/attendance-adapter`), duplicated rather than imported: that
 * module pulls in `next/server`/`backendFetchAuthed`, which have no business
 * in a browser bundle. Seven fixed weekday names — kept in sync by
 * inspection, not by a shared import.
 */
const DIA_FRONTEND_TO_BACKEND: Record<DiaSemana, string> = {
  lun: "LUNES",
  mar: "MARTES",
  mie: "MIERCOLES",
  jue: "JUEVES",
  vie: "VIERNES",
  sab: "SABADO",
  dom: "DOMINGO",
};

function isCategoria(codigo: string): codigo is Categoria {
  return (CATEGORIA_OPTIONS as string[]).includes(codigo);
}

/**
 * Fetch the live categoria catalog and shape it into a lookup by código.
 * Callers load it once (typically alongside their other fetched lists) and
 * pass the result into `diasPermitidos`/`horarioDe` explicitly — no fetch
 * hides behind either of those, so both stay easily testable pure lookups.
 *
 * Partial, not a full `Record`: a categoría the backend catalog omits (or an
 * unrecognized código, filtered out below) has no entry, and callers must
 * handle that rather than trust every `Categoria` is always present.
 */
export async function cargarCategorias(): Promise<Partial<Record<Categoria, CategoriaInfo>>> {
  const entradas = await fetchCategoriasCatalogo();
  const categorias: Partial<Record<Categoria, CategoriaInfo>> = {};
  for (const entrada of entradas) {
    if (!isCategoria(entrada.codigo)) continue;
    categorias[entrada.codigo] = {
      label: entrada.label,
      horaInicio: entrada.horaInicio,
      horaFin: entrada.horaFin,
      dias: entrada.dias.map((dia) => DIA_FRONTEND_TO_BACKEND[dia]),
    };
  }
  return categorias;
}

/** Days a given categoria is allowed to be scheduled on, from an
 *  already-loaded catalog (see `cargarCategorias`). Empty while the catalog
 *  hasn't loaded yet (or for an unrecognized categoria) instead of throwing. */
export function diasPermitidos(
  categorias: Partial<Record<Categoria, CategoriaInfo>>,
  categoria: Categoria,
): string[] {
  return categorias[categoria]?.dias ?? [];
}

/** The locked, server-derived time range for a given categoria, from an
 *  already-loaded catalog. Empty strings while the catalog hasn't loaded yet. */
export function horarioDe(
  categorias: Partial<Record<Categoria, CategoriaInfo>>,
  categoria: Categoria,
): { horaInicio: string; horaFin: string } {
  const info = categorias[categoria];
  return { horaInicio: info?.horaInicio ?? "", horaFin: info?.horaFin ?? "" };
}
