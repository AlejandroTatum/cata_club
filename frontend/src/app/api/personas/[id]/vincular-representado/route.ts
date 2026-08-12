/**
 * POST /api/personas/[id]/vincular-representado — a representante links an
 * ALREADY REGISTERED person (typically added by another representante) to
 * their own account by typing that person's cédula. No approval from the
 * previous representante (INS-2, docs/decisiones-de-negocio-2026-08-11.md
 * §1) — the four guardrails (audit, after-the-fact notice, no PII before
 * confirming, attempt throttling) all live backend-side.
 *
 * BFF proxy to FastAPI's `POST /personas/{persona_id}/vincular-representado`.
 * Same shape as the sibling `[id]/representados/route.ts`: REPRESENTANTE/
 * ADMINISTRADOR-only in the backend, additionally gated by an ownership
 * check (path `persona_id` must match the token's own `persona_id`) — we
 * just propagate whatever 401/403/400/422/429 the backend returns.
 *
 * The 400 the backend returns on an ineligible cédula is the SAME generic
 * sentence regardless of the real reason (nonexistent, adult, already
 * yours, your own cédula) — this route must not do anything that would
 * distinguish those cases either, so it forwards the backend's `detail`
 * verbatim via `passthroughBackendError`, same as every other route here.
 */

import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed, passthroughBackendError } from "@/lib/server/backend-client";
import type { PersonaResponse } from "@/types/domain";

interface RouteContext {
  params: { id: string };
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const personaId = Number(context.params.id);
  if (Number.isNaN(personaId)) {
    return NextResponse.json({ message: "El id de persona no es válido." }, { status: 400 });
  }

  let cedula: string;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== "object" || raw === null || typeof (raw as Record<string, unknown>).cedula !== "string") {
      return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
    }
    cedula = (raw as Record<string, unknown>).cedula as string;
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  const result = await backendFetchAuthed(request, `/personas/${personaId}/vincular-representado`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cedula }),
  });

  const fallback = "No se pudo vincular esa cédula a su cuenta.";
  if (!result.ok) {
    return NextResponse.json({ message: fallback }, { status: result.status });
  }
  if (!result.response.ok) {
    return passthroughBackendError(result.response, fallback);
  }

  const data = (await result.response.json()) as PersonaResponse;
  const response = NextResponse.json(data, { status: 200 });
  if (result.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: result.refreshedAccessToken });
  }
  return response;
}
