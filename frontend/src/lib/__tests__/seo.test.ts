import { describe, it, expect } from "vitest";
import { resolveSiteUrl, publicPageMetadata, robotsTagFor } from "../seo";

describe("resolveSiteUrl", () => {
  it("builds the canonical https origin from the indexable host", () => {
    expect(resolveSiteUrl({ DOMINIO_INDEXABLE: "cataclub.com" })).toBe("https://cataclub.com");
  });

  it("is null when the variable is missing or blank", () => {
    expect(resolveSiteUrl({})).toBeNull();
    expect(resolveSiteUrl({ DOMINIO_INDEXABLE: "  " })).toBeNull();
  });

  it("is null for the Caddy sentinel and non-public hosts", () => {
    expect(resolveSiteUrl({ DOMINIO_INDEXABLE: "ninguno.invalid" })).toBeNull();
    expect(resolveSiteUrl({ DOMINIO_INDEXABLE: "localhost" })).toBeNull();
    expect(resolveSiteUrl({ DOMINIO_INDEXABLE: "app.localhost" })).toBeNull();
  });

  it("rejects values that are not a bare host", () => {
    expect(resolveSiteUrl({ DOMINIO_INDEXABLE: "https://cataclub.com" })).toBeNull();
    expect(resolveSiteUrl({ DOMINIO_INDEXABLE: "cataclub.com/x" })).toBeNull();
    expect(resolveSiteUrl({ DOMINIO_INDEXABLE: "cata club.com" })).toBeNull();
  });
});

describe("publicPageMetadata", () => {
  it("carries the canonical path and the shared social card", () => {
    const metadata = publicPageMetadata("/terminos");
    expect(metadata.alternates?.canonical).toBe("/terminos");
    expect((metadata.openGraph as { url: string }).url).toBe("/terminos");
    expect(JSON.stringify(metadata.openGraph?.images)).toContain("og-cata-club-1200x630.png");
  });
});

describe("robotsTagFor", () => {
  const live = { DOMINIO_INDEXABLE: "cataclub.com" };

  it("leaves public pages and crawler files indexable on the indexable host", () => {
    for (const path of ["/", "/privacidad", "/terminos", "/permiso-imagen-fetm", "/robots.txt", "/sitemap.xml"]) {
      expect(robotsTagFor(path, live)).toBeNull();
    }
  });

  it("marks every private or unknown route noindex", () => {
    for (const path of ["/login", "/dashboard", "/student/enroll", "/admin/actividad", "/api/health", "/nuevo"]) {
      expect(robotsTagFor(path, live)).toBe("noindex, nofollow");
    }
  });

  it("marks every page noindex without a canonical URL, even the landing", () => {
    expect(robotsTagFor("/", {})).toBe("noindex, nofollow");
    expect(robotsTagFor("/terminos", { DOMINIO_INDEXABLE: "ninguno.invalid" })).toBe("noindex, nofollow");
  });
});
