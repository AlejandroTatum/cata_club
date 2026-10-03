import { describe, it, expect } from "vitest";
import { resolveSiteUrl, publicPageMetadata } from "../seo";

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
  it("is indexable with a canonical path on the indexable host", () => {
    const metadata = publicPageMetadata("/terminos", { DOMINIO_INDEXABLE: "cataclub.com" });
    expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe("/terminos");
  });

  it("stays out of the index when no canonical URL is configured", () => {
    const metadata = publicPageMetadata("/terminos", {});
    expect(metadata.robots).toBeUndefined();
    expect(metadata.alternates).toBeUndefined();
  });
});
