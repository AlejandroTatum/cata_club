import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TermsPage from "../page";
import LegalDocumentPage from "../LegalDocumentPage";
import { heading, paragraph, sectionId, blockAnchor } from "../legal-content";
import { legalBlocks as termsBlocks, summary as termsSummary } from "../content";
import { healthChapter } from "../health-chapter";
import { imageChapter } from "../image-chapter";
import nextConfig from "../../../../next.config";

const pages = [["Términos", TermsPage, termsBlocks]] as const;

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

describe("terms wording (owner QA r2, S2)", () => {
  const texts = termsBlocks.map((block) => block.text);

  function chapter(startsWith: string): string[] {
    const start = termsBlocks.findIndex((block) => block.kind === "heading" && block.text.startsWith(startsWith));
    const end = termsBlocks.findIndex((block, index) => index > start && block.kind === "heading" && block.text.startsWith("Capítulo"));
    return termsBlocks.slice(start + 1, end).map((block) => block.text);
  }

  it("keeps the defined term «el club» without the 'nombre comercial' aside", () => {
    expect(texts.join("\n")).not.toMatch(/nombre comercial/i);
    expect(texts.some((text) => text.includes("propietaria de Cata Club (en adelante, «el club»)"))).toBe(true);
  });

  it("publishes Chapter II exactly as the owner approved it", () => {
    expect(chapter("Capítulo II.")).toEqual([
      "El club se compromete a:",
      "• Hacer lo posible para que la plataforma funcione de forma segura y continua.",
      "• Mostrar a cada cuenta únicamente la información que su rol necesita.",
      "• Tratar los datos personales conforme a la Ley Orgánica de Protección de Datos Personales y a lo descrito en el Capítulo VIII.",
      "• Revisar los pagos que se registren, emitir el recibo cuando los valide y responder por sus canales de contacto las consultas, los errores de pago y las solicitudes de devolución.",
      "• Registrar el documento y la versión aceptada por el usuario, junto con la fecha de aceptación y la cuenta asociada. La aceptación deberá ser realizada directamente por el usuario y no por el sistema en su nombre.",
      "• Respetar los derechos que la ley le reconoce como titular de datos personales y como consumidor, y actuar siempre según el interés superior del niño, niña o adolescente.",
    ]);
  });

  it("starts every Chapter IV list item with a capital letter and ends it with a period", () => {
    const items = chapter("Capítulo IV.").filter((text) => text.startsWith("• "));
    expect(items).toHaveLength(9);
    for (const item of items) {
      expect(item).toMatch(/^• \p{Lu}/u);
      expect(item).toMatch(/\.$/);
    }
  });

  it("spaces the whole document with one tight rhythm", () => {
    const html = renderToStaticMarkup(<TermsPage />);
    const article = /<article class="([^"]*)"/.exec(html);
    expect(article?.[1]).toContain("space-y-4");
    expect(article?.[1]).toContain("leading-snug");
    expect(article?.[1]).not.toContain("space-y-6");
    expect(article?.[1]).not.toContain("leading-prose");
  });
});

describe("public legal documents", () => {
  it.each(pages)("%s publishes version and effective date", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain("2.2");
    expect(html).toContain("4 de octubre de 2026");
    expect(html).not.toContain("27 de agosto de 2026");
    expect(html).toContain('id="contenido"');
  });

  it.each(pages)("%s contains no internal review markers", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />).toLowerCase();
    expect(html).not.toMatch(/\b(borrador|validación legal|lista de revisión|pendiente de (revisión|validación))\b/);
  });

  it("publishes the three authorised image uses as plain text, with no opt-out and no controls", () => {
    const html = decode(renderToStaticMarkup(<TermsPage />));
    for (const use of ["1. Galería del club.", "2. Redes sociales del club.", "3. FETM."]) {
      expect(html).toContain(use);
    }
    expect(html).not.toContain("No autorizo ninguna");
    expect(html).not.toContain("4. ");
    expect(html).not.toMatch(/<input|<select|type="checkbox"|type="radio"/);
  });

  it("lists one public document («Términos y condiciones») and no other legal page (#1615)", () => {
    const html = renderToStaticMarkup(<TermsPage />);
    const nav = /<nav aria-label="Otros documentos públicos"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(nav.match(/<a /g)).toHaveLength(1);
    expect(decode(nav)).toContain("Términos y condiciones");
    expect(nav).toContain('href="/terminos"');
    expect(html).not.toContain('href="/consentimiento-salud"');
    expect(html).not.toContain('href="/permiso-imagen-fetm"');
    expect(html).not.toContain('href="/privacidad"');
  });

  it("publishes health-data consent and image permission as chapters X and XI, anchored for the old routes (#1615)", () => {
    const html = decode(renderToStaticMarkup(<TermsPage />));
    expect(html).toMatch(/<h2[^>]*id="consentimiento-salud"[^>]*>Capítulo X\. Consentimiento para el tratamiento de datos de salud<\/h2>/);
    expect(html).toMatch(/<h2[^>]*id="permiso-imagen"[^>]*>Capítulo XI\. Permiso de uso de imagen<\/h2>/);
    expect(html).toContain('href="#consentimiento-salud"');
    expect(html).toContain('href="#permiso-imagen"');
  });

  it("carries the former health and image documents verbatim, key sentences included (#1615)", () => {
    const html = decode(renderToStaticMarkup(<TermsPage />));
    for (const sentence of [
      "Con él usted autoriza expresamente que Cata Club trate datos de salud, que la ley considera datos sensibles.",
      "La ficha médica del jugador: tipo de sangre, alergias, enfermedades que debamos conocer, y el nombre y teléfono de una persona de contacto en caso de emergencia.",
      "• No usamos imágenes de jugadores menores de 18 años en mensajes publicitarios.",
      "3. FETM. Autorizar a la Federación Ecuatoriana de Tenis de Mesa la difusión de la imagen del jugador",
    ]) {
      expect(html).toContain(sentence);
    }
    const texts = termsBlocks.map((block) => block.text);
    for (const [title, chapter] of [
      ["Capítulo X. Consentimiento para el tratamiento de datos de salud", healthChapter],
      ["Capítulo XI. Permiso de uso de imagen", imageChapter],
    ] as const) {
      const start = texts.indexOf(title) + 1;
      expect(start).toBeGreaterThan(0);
      expect(texts.slice(start, start + chapter.length)).toEqual(chapter.map((block) => block.text));
    }
  });

  it("refers to itself as one document: no chapter calls another «independiente» or a separate Términos (#1615)", () => {
    const text = termsBlocks.map((block) => block.text).join("\n");
    expect(text).not.toMatch(/es independiente de los Términos/);
    expect(text).not.toMatch(/Capítulo VIII de los Términos/);
    expect(text).toContain("Este capítulo forma parte de los presentes Términos y condiciones; su aceptación es específica para el tratamiento de datos de salud");
    expect(text).toContain("Este capítulo forma parte de los presentes Términos y condiciones; su aceptación es específica para el uso de imagen");
    expect(termsSummary.join("\n")).toContain("aceptar este documento, que incluye el consentimiento de datos de salud (Capítulo X) y el permiso de uso de imagen (Capítulo XI)");
  });

  it.each([
    ["/consentimiento-salud", "/terminos#consentimiento-salud"],
    ["/permiso-imagen-fetm", "/terminos#permiso-imagen"],
  ])("redirects the old %s route permanently to its chapter", async (source, destination) => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects).toContainEqual({ source, destination, permanent: true });
  });

  it("publishes the privacy notice as a chapter of the terms, anchored at #privacidad", () => {
    const html = decode(renderToStaticMarkup(<TermsPage />));
    expect(html).toMatch(/<h2[^>]*id="privacidad"[^>]*>Capítulo VIII\. Protección de datos personales \(Aviso de privacidad\)<\/h2>/);
    expect(html).toContain('href="#privacidad"');
  });

  it("redirects the old /privacidad route permanently to the privacy chapter", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects).toContainEqual({ source: "/privacidad", destination: "/terminos#privacidad", permanent: true });
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
   * jsdom does not lay text out; the measure is confirmed in a browser. What a
   * unit test can hold is that the page declares its three zones (contents,
   * document, summary) instead of one narrow centred column.
   */
  it("lays the document out as contents, document and summary zones", () => {
    const html = renderToStaticMarkup(<TermsPage />);
    expect(html).toContain("xl:grid-cols-[minmax(232px,260px)_minmax(0,1fr)_minmax(300px,380px)]");
    expect(html).not.toContain("max-w-measure");
  });

  it.each(pages)("%s links every section from the contents list", (_name, Page, blocks) => {
    const html = renderToStaticMarkup(<Page />);
    const headings = blocks.flatMap((block, index) => (block.kind === "heading" ? [{ text: block.text, id: blockAnchor(block, index) }] : []));
    const nav = /<nav aria-label="En este documento"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    for (const { text, id } of headings) {
      expect(html).toMatch(new RegExp(`<h2[^>]*id="${id}"`));
      expect(nav).toContain(`href="#${id}"`);
      expect(decode(nav)).toContain(text);
    }
  });

  it("gives every section id a distinct, accent-free anchor", () => {
    expect(sectionId("Cuenta y responsabilidades", 2)).toBe("cuenta-y-responsabilidades-3");
    expect(sectionId("Derechos, consultas y revocación", 0)).toBe("derechos-consultas-y-revocacion-1");
  });

  it("shows three to five summary points under En resumen", () => {
    expect(termsSummary.length).toBeGreaterThanOrEqual(3);
    expect(termsSummary.length).toBeLessThanOrEqual(5);
    const html = decode(renderToStaticMarkup(<TermsPage />));
    expect(html).toContain("En resumen");
    for (const point of termsSummary) expect(html).toContain(point);
  });

  it.each(pages)("%s makes the scrollable contents rail keyboard-focusable (LAN-11)", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />);
    const nav = /<nav [^>]*aria-label="En este documento"[^>]*>/.exec(html)?.[0] ?? "";
    expect(nav).toContain('tabindex="0"');
  });

  it.each(pages)("%s has no link back to the landing inside the document", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).not.toContain("Volver a Cata Club");
    expect(html).not.toMatch(/<a[^>]*href="\/"/);
  });

  it("uses the wide three-zone grid for long documents", () => {
    const html = renderToStaticMarkup(<TermsPage />);
    expect(html).toContain("xl:w-[min(1600px,calc(100vw-7rem))]");
  });

  /** "Reframe rather than fill": no document may stretch a card or hold the page open. */
  it.each(pages)("%s stretches nothing and reserves no minimum height", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).not.toMatch(/items-stretch|min-h-\[|flex-1|grid-rows-\[1fr|grid-rows-\[auto_1fr/);
  });

  it.each(pages)("%s carries a real club photograph with a description", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html).toMatch(/<img[^>]*alt="[^"]{20,}"/);
    expect(html).toMatch(/landing%2F|\/landing\//);
  });

  it.each(pages)("%s pins two rails around the document", (_name, Page) => {
    const html = renderToStaticMarkup(<Page />);
    expect(html.match(/xl:sticky/g)).toHaveLength(2);
    expect(html).toContain('aria-label="En este documento"');
  });

  it("offers the club contact beside the document", () => {
    const html = renderToStaticMarkup(<TermsPage />);
    expect(html).toContain("¿Dudas?");
    expect(html).toContain('href="mailto:cataclub.loja@proton.me"');
  });
});
