/**
 * GET /api/co-representantes/mios — the minors the session is a guardian of,
 * each with its second guardian (visible to the primary only). Issue #1666.
 *
 * Transparent proxy to FastAPI's `GET /co-representantes/mios`. Authorization
 * lives in the backend; this route holds no ownership logic.
 */

import { NextRequest, NextResponse } from "next/server";
import { proxyBackendGet } from "@/lib/server/backend-client";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyBackendGet(request, "/co-representantes/mios", "No se pudieron cargar los representantes.");
}
