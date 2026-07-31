/**
 * BFF proxy — GET /api/ranking/asignaciones
 *
 * Returns a page of students in the ranking with their assigned level, in the
 * backend's standard `{items, total, skip, limit}` envelope (issue #7). There
 * is no position or score: the competitive ranking was removed, and those
 * columns no longer exist. `skip`/`limit` are forwarded verbatim — the
 * backend validates the bounds (`skip >= 0`, `1 <= limit <= 200`).
 */

import { NextRequest, NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE, getBackendApiUrl } from "@/lib/server/auth";

const BACKEND_TIMEOUT_MS = 10_000;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!accessToken) {
    return NextResponse.json({ message: "No autenticado." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const qs = new URLSearchParams();
  const skip = searchParams.get("skip");
  const limit = searchParams.get("limit");
  if (skip) qs.set("skip", skip);
  if (limit) qs.set("limit", limit);
  const suffix = qs.size > 0 ? `?${qs.toString()}` : "";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${getBackendApiUrl()}/ranking/asignaciones${suffix}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });

    return await forwardBackendResponse(response);
  } catch (error: unknown) {
    return backendFailureResponse(error);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function forwardBackendResponse(response: Response): Promise<NextResponse> {
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // fall through
  }

  if (!response.ok) {
    const message = isMessageBody(data)
      ? data.message
      : `El servidor respondió con un error (${response.status}).`;
    return NextResponse.json({ message }, { status: response.status });
  }

  return NextResponse.json(data, { status: response.status });
}

function backendFailureResponse(error: unknown): NextResponse {
  if (error instanceof DOMException && error.name === "AbortError") {
    return NextResponse.json(
      { message: "La solicitud al servidor tardó demasiado." },
      { status: 504 },
    );
  }
  return NextResponse.json(
    { message: "No se pudo contactar al servidor." },
    { status: 503 },
  );
}

function isMessageBody(value: unknown): value is { message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}
