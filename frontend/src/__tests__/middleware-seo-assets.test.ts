import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware, config } from "../middleware";

const SEO_ASSETS = [
  "/robots.txt",
  "/sitemap.xml",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/brand/icons/icon-48.png",
  "/brand/icons/apple-touch-icon.png",
  "/brand/og-cata-club-1200x630.png",
  "/brand/cata-club-logo-square-512.png",
];

afterEach(() => vi.unstubAllEnvs());

describe("middleware and crawler assets", () => {
  it.each(SEO_ASSETS)("never redirects or blocks %s for an anonymous crawler", (pathname) => {
    const response = middleware(new NextRequest(`https://cataclub.com${pathname}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("middleware matcher", () => {
  it("skips static image and icon files", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    for (const pathname of ["/favicon.ico", "/brand/icons/icon-48.png", "/brand/og-cata-club-1200x630.png"]) {
      expect(pattern.test(pathname)).toBe(false);
    }
  });
});

describe("middleware robots header", () => {
  const get = (pathname: string): string | null =>
    middleware(new NextRequest(`https://cataclub.com${pathname}`)).headers.get("x-robots-tag");

  it("keeps the landing indexable and the login out on the indexable host", () => {
    vi.stubEnv("DOMINIO_INDEXABLE", "cataclub.com");
    expect(get("/")).toBeNull();
    expect(get("/robots.txt")).toBeNull();
    expect(get("/login")).toBe("noindex, nofollow");
  });

  it("marks the landing noindex when no canonical URL is configured", () => {
    vi.stubEnv("DOMINIO_INDEXABLE", "");
    expect(get("/")).toBe("noindex, nofollow");
  });
});
