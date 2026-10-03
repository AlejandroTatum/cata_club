import { describe, it, expect } from "vitest";
import { readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { buildRobots, buildSitemap, PUBLIC_PATHS, PRIVATE_PATH_PREFIXES } from "../seo";
import { PROTECTED_PATH_PREFIXES } from "../middleware-utils";

const APP_DIR = path.resolve(__dirname, "../../app");
const ENV = { DOMINIO_INDEXABLE: "cataclub.com" };

function hasRoute(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? hasRoute(path.join(dir, entry.name))
      : /^(page|route)\.tsx?$/.test(entry.name),
  );
}

describe("robots", () => {
  it("disallows everything when no canonical URL is configured", () => {
    expect(buildRobots({})).toEqual({ rules: { userAgent: "*", disallow: "/" } });
    expect(buildRobots({ DOMINIO_INDEXABLE: "ninguno.invalid" })).toEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });

  it("allows the site, disallows private routes and points at the sitemap", () => {
    const robots = buildRobots(ENV);
    const rules = robots.rules as { allow: string; disallow: string[] };
    expect(rules.allow).toBe("/");
    for (const prefix of ["/login", "/dashboard", "/admin", "/api", "/student", "/trainer"]) {
      expect(rules.disallow).toContain(prefix);
    }
    expect(robots.sitemap).toBe("https://cataclub.com/sitemap.xml");
  });
});

describe("sitemap", () => {
  it("lists only the public pages on the canonical origin", () => {
    expect(buildSitemap(ENV).map((entry) => entry.url)).toEqual([
      "https://cataclub.com",
      "https://cataclub.com/privacidad",
      "https://cataclub.com/terminos",
      "https://cataclub.com/permiso-imagen-fetm",
    ]);
  });

  it("is empty without a canonical URL", () => {
    expect(buildSitemap({})).toEqual([]);
  });
});

describe("route classification", () => {
  const topLevel = readdirSync(APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && hasRoute(path.join(APP_DIR, entry.name)))
    .map((entry) => `/${entry.name}`);

  it("every top-level route is declared either public or private", () => {
    const declared: string[] = [...PUBLIC_PATHS, ...PRIVATE_PATH_PREFIXES];
    expect(topLevel.filter((route) => !declared.includes(route))).toEqual([]);
  });

  it("every declared public page exists and none is also private", () => {
    for (const route of PUBLIC_PATHS) {
      if (route !== "/") expect(existsSync(path.join(APP_DIR, route, "page.tsx"))).toBe(true);
      expect((PRIVATE_PATH_PREFIXES as readonly string[]).includes(route)).toBe(false);
    }
  });

  it("every session-protected prefix is disallowed", () => {
    for (const prefix of PROTECTED_PATH_PREFIXES) {
      expect((PRIVATE_PATH_PREFIXES as readonly string[]).includes(prefix)).toBe(true);
    }
  });
});
