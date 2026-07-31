/**
 * BFF proxy — GET /api/groups/horarios/[id]/alumnos
 *
 * Lists a page of the students directly assigned to a training schedule, in
 * the backend's standard `{items, total, skip, limit}` envelope (issue #7).
 * Proxies to FastAPI's GET /asistencias/horarios/{horario_id}/alumnos.
 * `skip`/`limit` are forwarded verbatim — the backend validates the bounds
 * (`skip >= 0`, `1 <= limit <= 200`).
 */

import { NextRequest, NextResponse } from "next/server";
import { extractAccessToken, proxyToBackend, unauthorizedResponse } from "@/lib/server/bff-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const skip = searchParams.get("skip");
  const limit = searchParams.get("limit");
  if (skip) qs.set("skip", skip);
  if (limit) qs.set("limit", limit);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";

  return proxyToBackend(
    `/asistencias/horarios/${encodeURIComponent(params.id)}/alumnos${suffix}`,
    {
      method: "GET",
      accessToken,
    },
  );
}
