/**
 * Issue #1666: the privacy-text change for the second guardian is a DRAFT for
 * the club and its lawyer. Release is blocked until they approve it, so this
 * suite pins that it is marked as a draft, mirrored in the review document,
 * and NOT part of the published legal document.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { legalBlocks } from "../content";
import {
  BORRADOR_SEGUNDO_REPRESENTANTE_ESTADO,
  borradorSegundoRepresentante,
} from "../borrador-segundo-representante";

const publicado = legalBlocks.map((bloque) => bloque.text);
const textosDelBorrador = borradorSegundoRepresentante.flatMap((s) => s.bloques.map((b) => b.text));
const DOC = readFileSync(join(__dirname, "../../../../../docs/privacy-draft-second-guardian.md"), "utf8");

describe("second-guardian privacy text (draft)", () => {
  it("is marked as a draft", () => {
    expect(BORRADOR_SEGUNDO_REPRESENTANTE_ESTADO).toBe("BORRADOR");
    expect(DOC).toMatch(/BORRADOR/);
    expect(DOC).toMatch(/release is blocked/i);
  });

  it("is not part of the published legal document", () => {
    for (const texto of textosDelBorrador) {
      expect(publicado).not.toContain(texto);
    }
    expect(publicado.join("\n")).not.toMatch(/segundo representante/i);
  });

  it("only replaces sentences that exist today in the published document", () => {
    const todo = publicado.join("\n");
    for (const seccion of borradorSegundoRepresentante.filter((s) => s.accion === "reemplazar")) {
      expect(seccion.reemplaza).toBeDefined();
      expect(todo).toContain(seccion.reemplaza as string);
    }
  });

  it("is mirrored word for word in the document the reviewers read", () => {
    for (const texto of textosDelBorrador) {
      expect(DOC).toContain(texto);
    }
  });
});
