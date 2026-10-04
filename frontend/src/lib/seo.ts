/**
 * Search-engine facing metadata, decided at REQUEST time.
 *
 * The same Docker image runs on production and on every non-production host,
 * so "is this site indexable" cannot be baked in at build (`NEXT_PUBLIC_*` is
 * frozen then). It reads `DOMINIO_INDEXABLE` instead: the very variable Caddy
 * compares against the request Host to decide `X-Robots-Tag: noindex`. One
 * knob drives both layers, so the header and the page-level signals cannot
 * disagree. Anything that is not a bare public hostname resolves to `null`,
 * and `null` means fail closed: no canonical URL, no indexing.
 */

import type { Metadata, MetadataRoute } from "next";

export type SeoEnv = Record<string, string | undefined>;

export const SITE_NAME = "Cata Club";
export const SITE_LOCALE = "es_EC";
export const SITE_DESCRIPTION =
  "Club formativo de tenis de mesa en Loja, Ecuador. Entrenamientos para niños, jóvenes y adultos de lunes a sábado, junto al Coliseo Ciudad de Loja.";

/** Full logo on the logo's own light grey, 1200x630. Stable public URL. */
export const SOCIAL_IMAGE = {
  url: "/brand/og-cata-club-1200x630.png",
  width: 1200,
  height: 630,
  alt: "Cata Club — Tenis de Mesa",
} as const;

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/**
 * Canonical origin (`https://host`, no trailing slash) or `null` when this
 * deployment is not the indexable one.
 */
export function resolveSiteUrl(env: SeoEnv = process.env): string | null {
  const host = env.DOMINIO_INDEXABLE?.trim().toLowerCase();
  if (!host || !HOST_PATTERN.test(host)) return null;
  if (host.endsWith(".invalid") || host === "localhost" || host.endsWith(".localhost")) return null;
  return `https://${host}`;
}

/** Social card shared by every page that declares its own `openGraph`. */
export function socialMetadata(): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "website",
      locale: SITE_LOCALE,
      siteName: SITE_NAME,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      images: [SOCIAL_IMAGE.url],
    },
  };
}

/**
 * Canonical + social card for a public page. Static on purpose: the origin
 * comes from `metadataBase`, which the root layout resolves per request.
 */
export function publicPageMetadata(path: string): Metadata {
  const social = socialMetadata();
  return {
    alternates: { canonical: path },
    openGraph: { ...social.openGraph, url: path },
    twitter: social.twitter,
  };
}

/**
 * Pages anyone may find through a search engine. Every top-level route in
 * `src/app` is either listed here or in `PRIVATE_PATH_PREFIXES`;
 * `seo-routes.test.ts` fails when a new route is in neither.
 */
export const PUBLIC_PATHS = ["/", "/terminos"] as const;

/** Everything behind a session, an admin gate or an auth flow. */
export const PRIVATE_PATH_PREFIXES = [
  "/admin",
  "/api",
  "/attendance",
  "/ayuda",
  "/dashboard",
  "/discounts",
  "/forgot-password",
  "/galeria",
  "/groups",
  "/login",
  "/members",
  "/payments",
  "/profile",
  "/reports",
  "/reset-password",
  "/sponsors",
  "/student",
  "/tarifas",
  "/trainer",
  "/unauthorized",
  "/verificar-correo",
] as const;

export function buildRobots(env: SeoEnv = process.env): MetadataRoute.Robots {
  const siteUrl = resolveSiteUrl(env);
  if (!siteUrl) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATH_PREFIXES] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

/** Empty when there is no canonical origin: nothing to advertise. */
export function buildSitemap(env: SeoEnv = process.env): MetadataRoute.Sitemap {
  const siteUrl = resolveSiteUrl(env);
  if (!siteUrl) return [];
  return PUBLIC_PATHS.map((path) => ({ url: path === "/" ? siteUrl : `${siteUrl}${path}` }));
}

/** Crawler infrastructure: must stay indexable-neutral and never be `noindex`. */
const CRAWLER_PATHS: readonly string[] = ["/robots.txt", "/sitemap.xml", "/manifest.webmanifest"];

/**
 * `X-Robots-Tag` value for a document request, or `null` to leave the page
 * indexable. Everything that is not an explicit public page is `noindex`, and
 * with no canonical URL configured so is the whole site (fail closed). This
 * is enforced in middleware, so no private route can forget to opt out.
 */
export function robotsTagFor(pathname: string, env: SeoEnv = process.env): string | null {
  if (CRAWLER_PATHS.includes(pathname)) return null;
  if (!resolveSiteUrl(env)) return "noindex, nofollow";
  return (PUBLIC_PATHS as readonly string[]).includes(pathname) ? null : "noindex, nofollow";
}
