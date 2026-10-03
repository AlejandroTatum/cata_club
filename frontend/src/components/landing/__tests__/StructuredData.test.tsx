import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import StructuredData from "../StructuredData";

afterEach(() => vi.unstubAllEnvs());

describe("StructuredData", () => {
  it("emits a SportsClub script on the indexable host", () => {
    vi.stubEnv("DOMINIO_INDEXABLE", "cataclub.com");
    const html = renderToStaticMarkup(<StructuredData />);
    expect(html).toContain('type="application/ld+json"');
    expect(html).toContain('"@type":"SportsClub"');
    expect(html).toContain("https://cataclub.com/brand/cata-club-logo-square-512.png");
  });

  it("emits nothing without a canonical URL", () => {
    vi.stubEnv("DOMINIO_INDEXABLE", "");
    expect(renderToStaticMarkup(<StructuredData />)).toBe("");
  });
});
