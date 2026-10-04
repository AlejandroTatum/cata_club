/**
 * GET /api/club/payment-info — the club's transfer data («Cómo pagar», #1535).
 *
 * Signed-in users only (owner decision): an anonymous request gets a 401 with
 * no data, and the data lives in a server-only module so it is never in the
 * client bundle. The session is verified against the backend (`/auth/me`), not
 * just the presence of a cookie. Never cached: `private, no-store`.
 */
import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/server/auth";
import { backendFetchAuthed } from "@/lib/server/backend-client";
import { unauthorizedResponse } from "@/lib/server/bff-helpers";
import { getServerClubPaymentInfo } from "@/lib/server/club-payment-info";

const NO_STORE = "private, no-store";

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", NO_STORE);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await backendFetchAuthed(request, "/auth/me");
  if (!session.ok || session.response.status === 401) return withNoStore(unauthorizedResponse());
  if (!session.response.ok) {
    return withNoStore(NextResponse.json({ message: "No se pudo cargar los datos de pago." }, { status: 502 }));
  }

  const response = withNoStore(NextResponse.json(getServerClubPaymentInfo()));
  if (session.refreshedAccessToken) {
    setAuthCookies(response, { accessToken: session.refreshedAccessToken });
  }
  return response;
}
