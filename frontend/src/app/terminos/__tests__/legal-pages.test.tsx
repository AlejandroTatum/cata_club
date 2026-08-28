import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TermsPage from "../page";
import PrivacyPage from "../../privacidad/page";
import FETMPage from "../../permiso-imagen-fetm/page";
import LegalDocumentPage from "../LegalDocumentPage";
import { heading, paragraph } from "../legal-content";
import { legalBlocks as termsBlocks } from "../content";
import { legalBlocks as privacyBlocks } from "../../privacidad/content";
import { legalBlocks as fetmBlocks } from "../../permiso-imagen-fetm/content";

const pages = [
  ["Términos", TermsPage, termsBlocks],
  ["Privacidad", PrivacyPage, privacyBlocks],
  ["FETM", FETMPage, fetmBlocks],
] as const;

/**
 * React escapes exactly these five characters in text content, so undoing them
 * is the whole of what stands between rendered markup and its source string.
 */
function decode(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * The document's blocks, in the order they were rendered, as `{ tag, text }`.
 *
 * Reading them back out of the `<article>` — rather than trusting a class name
 * or a count — is what lets one assertion cover three separate claims: that a
 * declared heading really became a heading, that a paragraph really stayed a
 * paragraph, and that the legal prose between the tags was not touched.
 */
function documentBlocks(html: string): { tag: string; text: string }[] {
  const article = /<article[^>]*>([\s\S]*)<\/article>/.exec(html);
  if (article === null) throw new Error("the document rendered no <article>");
  const blocks: { tag: string; text: string }[] = [];
  const pattern = /<(h2|p)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(article[1])) !== null) {
    blocks.push({ tag: match[1], text: decode(match[2]) });
  }
  return blocks;
}

describe("public legal documents", () => {
  it.each(pages)("%s publishes version and effective date", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain("1.0");
    expect(html).toContain("27 de agosto de 2026");
    expect(html).toContain('id="contenido"');
  });

  it.each(pages)("%s contains no internal review markers", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />).toLowerCase();
    expect(html).not.toMatch(/borrador|pendiente|validación legal|lista de revisión/);
  });

  it("publishes only the confirmed FETM sentence", () => {
    const html = renderToStaticMarkup(<FETMPage />);
    const sentence = "Autorizo a la Federación Ecuatoriana de Tenis de Mesa la difusión de mi imagen según las condiciones que se desglosan en el documento de Difusión de Imagen de Deportistas FETM.";
    expect(html).toContain(sentence);
    expect(html.match(/<article[^>]*>[\s\S]*?<p/g)).toHaveLength(1);
    expect(html).not.toMatch(/propuesto|propone|generaría|revisión|checklist|TODO/i);
  });

  it("links all public documents together", () => {
    const html = renderToStaticMarkup(<TermsPage />);
    expect(html).toContain('href="/terminos"');
    expect(html).toContain('href="/privacidad"');
    expect(html).toContain('href="/permiso-imagen-fetm"');
  });

  it.each(pages)("%s renders every declared heading as a heading", (_name, Page, blocks) => {
    const rendered = documentBlocks(renderToStaticMarkup(<Page />));
    expect(rendered.map((block) => block.tag)).toEqual(
      blocks.map((block) => (block.kind === "heading" ? "h2" : "p")),
    );
  });

  /**
   * The regression the old `SECTION_HEADINGS` set made invisible.
   *
   * `<h2>` vs `<p>` was decided by exact string equality against a list of
   * seventeen literals, so rewording a heading in a `content.ts` demoted it to
   * a paragraph with no error and no failing test — and the document quietly
   * lost a level of the outline screen readers navigate by. The wording below
   * is deliberately one no list could have known.
   */
  it("keeps a heading a heading even when its wording is new", () => {
    const html = renderToStaticMarkup(
      <LegalDocumentPage
        title="Documento de prueba"
        blocks={[heading("Un encabezado que ninguna lista conoce"), paragraph("Cuerpo del documento.")]}
      />,
    );
    expect(html).toMatch(/<h2[^>]*>Un encabezado que ninguna lista conoce<\/h2>/);
    expect(html).not.toMatch(/<p[^>]*>Un encabezado que ninguna lista conoce<\/p>/);
  });

  it.each(pages)("%s publishes its legal text verbatim and in order", (_name, Page, blocks) => {
    const rendered = documentBlocks(renderToStaticMarkup(<Page />));
    expect(rendered.map((block) => block.text)).toEqual(blocks.map((block) => block.text));
  });

  it.each(pages)("%s wears the club display face on its title and headings", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />);
    const title = /<h1[^>]*>/.exec(html);
    expect(title?.[0]).toContain("font-display");
    for (const openingTag of html.match(/<h2[^>]*>/g) ?? []) {
      expect(openingTag).toContain("font-display");
    }
  });

  /**
   * jsdom does not lay text out, so the characters per line this produces can
   * only be confirmed in a real browser. What a unit test can hold is that the
   * column declares a measure at all, and that the old full-width one is gone.
   */
  it("sets the column to a reading measure rather than the page width", () => {
    const html = renderToStaticMarkup(<TermsPage />);
    expect(html).toContain("max-w-measure");
    expect(html).not.toContain("max-w-4xl");
  });
});
