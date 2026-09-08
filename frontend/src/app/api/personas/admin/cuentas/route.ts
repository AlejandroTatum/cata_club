/**
 * The legacy admin account-creation API is intentionally unavailable.
 *
 * The file remains as an inert route marker so deployments with an older
 * generated route manifest do not accidentally retain the former proxy. There
 * is no POST handler and no backend client import: POST therefore receives the
 * framework's 405 Method Not Allowed response.
 */

import { NextResponse } from "next/server";

/** Keep the legacy path non-functional for any direct GET bookmark/request. */
export function GET(): NextResponse {
  return NextResponse.json({ message: "Esta ruta ya no está disponible." }, { status: 404 });
}
