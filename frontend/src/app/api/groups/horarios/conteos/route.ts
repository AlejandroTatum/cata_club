/**
 * BFF proxy — GET /api/groups/horarios/conteos
 *
 * Enrolled students per horario WITHOUT the students (QA4 PERF-01): the
 * screens that only draw "N inscritos" read this (~1 KB) instead of the full
 * roster (`/api/groups/horarios/alumnos`, ~500 KB). `?incluir_personas=true`
 * adds the enrolled person ids, for the screens that count distinct students
 * across several horarios.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractAccessToken, proxyToBackend, unauthorizedResponse } from "@/lib/server/bff-helpers";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const incluirPersonas = request.nextUrl.searchParams.get("incluir_personas") === "true";
  const query = incluirPersonas ? "?incluir_personas=true" : "";
  return proxyToBackend(`/asistencias/horarios/conteos${query}`, { method: "GET", accessToken });
}
