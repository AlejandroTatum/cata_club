import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TermsPage from "../page";
import PrivacyPage from "../../privacidad/page";
import FETMPage from "../../permiso-imagen-fetm/page";

const pages = [
  ["Términos", TermsPage],
  ["Privacidad", PrivacyPage],
  ["FETM", FETMPage],
] as const;

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
});
