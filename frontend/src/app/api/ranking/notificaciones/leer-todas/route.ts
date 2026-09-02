/**
 * BFF proxy — PATCH /api/ranking/notificaciones/leer-todas
 *
 * Marks ALL of the caller's pending in-app notifications as read (issue
 * #859). Proxies to FastAPI's `PATCH /ranking/notificaciones/leer-todas`
 * (confirmed live in notificaciones_router.py). Bodyless on purpose: scope
 * (own notifications + active dependents', for a representative) is
 * resolved entirely server-side — this route never forwards ids.
 *
 * Uses the shared `proxyToBackend` helper instead of the hand-rolled
 * fetch/timeout/error-shaping its two sibling routes (`mias`, `[id]/leer`)
 * still duplicate — see `bff-helpers.ts` for why new routes go through it.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractAccessToken, proxyToBackend, unauthorizedResponse } from "@/lib/server/bff-helpers";

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const accessToken = extractAccessToken(request);
  if (!accessToken) return unauthorizedResponse();

  return proxyToBackend("/ranking/notificaciones/leer-todas", {
    method: "PATCH",
    accessToken,
  });
}
