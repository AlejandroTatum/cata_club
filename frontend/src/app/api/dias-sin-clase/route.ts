/**
 * BFF proxy — GET/POST /api/dias-sin-clase (issue #1665)
 *
 * GET: club-wide no-class days for any signed-in member (`desde`/`hasta`
 *      query forwarded as-is). There is deliberately no public read: the
 *      owner wants them in the member panel only, never on the landing.
 * POST: admin-only create; the backend enforces the role (403 passed through).
 */
import { NextRequest, NextResponse } from "next/server";
import { proxyBackendGet } from "@/lib/server/backend-client";
import { postCatalogResource } from "@/lib/server/bff-helpers";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyBackendGet(
    request,
    `/dias-sin-clase/${request.nextUrl.search}`,
    "No se pudieron cargar los días sin clase.",
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return postCatalogResource(request, {
    backendPath: "/dias-sin-clase/",
    requiredFields: ["fecha_inicio", "motivo"],
    missingFieldMessage: "La fecha y el motivo son obligatorios.",
    failureMessage: "No se pudo crear el día sin clase.",
  });
}
