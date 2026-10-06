/**
 * GET /api/co-representantes/invitaciones/recibidas — the pending guardian
 * invitations addressed to the session's account. Issue #1666.
 *
 * Transparent proxy to FastAPI's `GET /co-representantes/invitaciones/recibidas`.
 * Authorization lives in the backend; this route holds no ownership logic.
 */

import { NextRequest, NextResponse } from "next/server";
import { proxyBackendGet } from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyBackendGet(
    request,
    "/co-representantes/invitaciones/recibidas",
    "No se pudieron cargar las invitaciones.",
  );
}
