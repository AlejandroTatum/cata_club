/**
 * Route Handler Tests — POST /api/csp-report
 *
 * Fase 1 de la CSP (issue #1069): el Caddyfile declara
 * `Content-Security-Policy-Report-Only` con `report-uri` apuntando acá. Este
 * endpoint no valida ni bloquea nada -- solo registra lo que el navegador
 * reporta, para poder construir la política real en modo estricto sobre
 * evidencia y no a ciegas.
 *
 * El navegador manda el reporte con uno de dos `Content-Type` según el modo
 * de reporte que soporte: `application/csp-report` (el formato viejo, todavía
 * el más extendido) o `application/reports+json` (el nuevo Reporting API).
 * Sin auth, sin cookies, sin llamada al backend -- lo dispara el navegador de
 * cualquier visitante, autenticado o no.
 *
 * @vitest-environment node
 */

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";

function buildRequest(body: unknown, contentType: string): NextRequest {
  return new NextRequest("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  });
}

describe("POST /api/csp-report", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("responds 204 and logs the body for a legacy application/csp-report", async () => {
    const cspReport = {
      "csp-report": {
        "document-uri": "https://cataclub.example/login",
        "violated-directive": "script-src",
      },
    };

    const response = await POST(buildRequest(cspReport, "application/csp-report"));

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("CSP report-only"),
      expect.objectContaining(cspReport),
    );
  });

  it("responds 204 and logs the body for the newer application/reports+json", async () => {
    const reportsJson = [
      {
        type: "csp-violation",
        body: { documentURL: "https://cataclub.example/login", disposition: "reporting" },
      },
    ];

    const response = await POST(buildRequest(reportsJson, "application/reports+json"));

    expect(response.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("CSP report-only"),
      expect.objectContaining({ 0: expect.objectContaining({ type: "csp-violation" }) }),
    );
  });

  it("responds 204 without logging when the body is not valid JSON", async () => {
    const request = new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "Content-Type": "application/csp-report" },
      body: "no es json",
    });

    const response = await POST(request);

    expect(response.status).toBe(204);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
