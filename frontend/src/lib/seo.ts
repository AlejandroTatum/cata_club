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

import type { Metadata } from "next";

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
 * Per-page opt-in to indexing. The root layout defaults every route to
 * `noindex`, so only the pages that call this can ever be indexed, and only
 * when a canonical URL exists.
 */
export function publicPageMetadata(path: string, env: SeoEnv = process.env): Metadata {
  if (!resolveSiteUrl(env)) return {};
  const social = socialMetadata();
  return {
    robots: { index: true, follow: true },
    alternates: { canonical: path },
    openGraph: { ...social.openGraph, url: path },
    twitter: social.twitter,
  };
}
