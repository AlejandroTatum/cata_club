/**
 * POST /api/csp-report — destino de los reportes de la CSP en modo
 * report-only (issue #1069, fase 1).
 *
 * El Caddyfile declara `Content-Security-Policy-Report-Only` con
 * `report-uri /api/csp-report`, así que el navegador de CUALQUIER visitante
 * (autenticado o no) manda acá el JSON de cada violación observada. Esta
 * ruta no valida ni bloquea nada -- solo registra el reporte, para construir
 * el modo estricto sobre evidencia real y no a ciegas.
 *
 * Deliberadamente sin backend ni auth: es el mismo espíritu que
 * `/api/health` (dependency-free), pero acá porque el emisor es el
 * navegador del visitante, no un orquestador.
 *
 * El navegador manda uno de dos `Content-Type` según qué soporte:
 *   - `application/csp-report` — el formato viejo (`report-uri`), todavía el
 *     más extendido.
 *   - `application/reports+json` — el nuevo Reporting API (`report-to`).
 * Ninguno de los dos es JSON "puro" según el `Content-Type` que Next.js
 * reconoce, así que se lee el body crudo y se parsea a mano.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  try {
    const parsed: unknown = JSON.parse(rawBody);
    console.warn("CSP report-only violation", parsed);
  } catch {
    // Un reporte malformado no es un incidente de seguridad -- se descarta
    // sin loguear ruido.
  }

  return new NextResponse(null, { status: 204 });
}
