/**
 * Issue #1666: the club approved the second-guardian privacy text, so it is
 * part of the PUBLISHED legal document (version 2.4). This suite pins that the
 * text is published, that no draft marker is left, and that the legal version
 * was bumped so every account re-accepts it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { legalBlocks } from "../content";
import { healthChapter } from "../health-chapter";

const publicado = [...legalBlocks, ...healthChapter].map((bloque) => bloque.text).join("\n");
const SERVICIO = join(__dirname, "../../../../../backend/app/servicios_negocio/consentimiento_legal_servicio.py");

describe("second-guardian privacy text (published)", () => {
  it("is part of the published document", () => {
    expect(publicado).toContain("hasta dos representantes con cuenta propia");
    expect(publicado).toContain("el principal y, si lo hay, el segundo");
    expect(publicado).toContain("sea como representante principal o como segundo representante");
    expect(publicado).toContain("quedan visibles para esa otra persona adulta");
    expect(publicado).toContain("se lo retira del jugador y se conserva el registro de su alta y su baja");
    expect(publicado).toContain("El segundo representante, si lo hay, puede ver este consentimiento");
  });

  it("no longer carries the sentences it replaced", () => {
    expect(publicado).not.toContain("• Ficha médica: el administrador del club y el representante del jugador. El entrenador");
  });

  it("leaves no draft marker behind", () => {
    expect(publicado).not.toMatch(/BORRADOR/i);
  });

  it("bumps the legal version so every account re-accepts", () => {
    expect(readFileSync(SERVICIO, "utf8")).toContain('VERSION_LEGAL_VIGENTE = "2.4"');
  });
});
