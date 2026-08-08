/**
 * GET /api/attendance/categories — proxies FastAPI's `/asistencias/categorias`.
 *
 * BFF Route Handler: any authenticated user may list the categoria catalog
 * (the backend endpoint only requires a valid token, no role restriction —
 * same as `/api/attendance/schedules`). Consumed by `@/services/categorias`,
 * which replaces this repo's old static `CATEGORIA_METADATA` mirror of the
 * backend's `categoria_horario` table — a client-side copy of data the
 * backend can edit at runtime is exactly the staleness bug `franja_horaria`
 * caused before it (#160).
 *
 * Translates `CategoriaResponseDTO` (backend field names, `dias` as backend
 * `DiaSemana` enum values like `"LUNES"`) into this repo's frontend shape —
 * same translate-in-the-route pattern `buildTrainingSchedule` uses in
 * `@/lib/server/attendance-adapter` for `/asistencias/horarios`.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import { DIA_SEMANA_BACKEND_TO_FRONTEND, trimSeconds, type BackendDiaSemana } from "@/lib/server/attendance-adapter";
import type { DiaSemana } from "@/types/domain";

/** `CategoriaResponseDTO` as received from FastAPI — already camelCase, see
 *  `ResponseBase`'s `alias_generator` (backend/app/presentacion/schemas/base.py). */
interface BackendCategoria {
  codigo: string;
  label: string;
  horaInicio: string; // "HH:MM:SS"
  horaFin: string;
  dias: BackendDiaSemana[];
}

/** The frontend-shaped categoria catalog entry this route returns. */
export interface CategoriaCatalogEntry {
  codigo: string;
  label: string;
  horaInicio: string;
  horaFin: string;
  dias: DiaSemana[];
}

function buildCategoriaEntry(categoria: BackendCategoria): CategoriaCatalogEntry {
  return {
    codigo: categoria.codigo,
    label: categoria.label,
    horaInicio: trimSeconds(categoria.horaInicio),
    horaFin: trimSeconds(categoria.horaFin),
    dias: categoria.dias.map((dia) => DIA_SEMANA_BACKEND_TO_FRONTEND[dia]),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const categoriasResult = await backendFetchAuthed(request, "/asistencias/categorias");
  if (!categoriasResult.ok) {
    return NextResponse.json(
      { message: "No se pudo cargar el catálogo de categorías." },
      { status: categoriasResult.status },
    );
  }
  if (!categoriasResult.response.ok) {
    return passthroughBackendError(categoriasResult.response, "No se pudo cargar el catálogo de categorías.");
  }

  const backendCategorias = (await categoriasResult.response.json()) as BackendCategoria[];
  const categorias = backendCategorias.map(buildCategoriaEntry);

  const response = NextResponse.json(categorias);
  if (categoriasResult.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: categoriasResult.refreshedAccessToken });
  }
  return response;
}
