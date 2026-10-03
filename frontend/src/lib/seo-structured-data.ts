/**
 * schema.org `SportsClub` for the landing, built only from values the landing
 * itself already publishes (`landingConfig`, `club-location`, `FOUNDING_DATE`).
 * Nothing here is typed in a second time: a fact the club has not published is
 * left out rather than invented. Missing on purpose: `streetAddress` (the club
 * only publishes a Plus Code and a landmark) and `openingHours` (managed in the
 * app and fetched live, see `landing-config.ts`).
 */

import { CLUB_POSITION } from "@/app/landing/club-location";
import { FOUNDING_DATE, landingConfig, toWhatsAppNumber } from "@/app/landing/landing-config";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

/** Square, padded full logo, 512px. Stable public URL. */
export const STRUCTURED_DATA_LOGO_PATH = "/brand/cata-club-logo-square-512.png";

export interface SportsClubJsonLd {
  "@context": "https://schema.org";
  "@type": "SportsClub";
  name: string;
  description: string;
  url: string;
  logo: string;
  image: string;
  sport: string;
  foundingDate: string;
  address: { "@type": "PostalAddress"; addressLocality: string; postalCode: string; addressCountry: string };
  geo: { "@type": "GeoCoordinates"; latitude: number; longitude: number };
  contactPoint: { "@type": "ContactPoint"; contactType: string; telephone: string; availableLanguage: string }[];
  sameAs: string[];
}

const pad = (value: number): string => String(value).padStart(2, "0");

export function buildSportsClubJsonLd(siteUrl: string): SportsClubJsonLd {
  const { contact } = landingConfig;
  const [latitude, longitude] = CLUB_POSITION;
  return {
    "@context": "https://schema.org",
    "@type": "SportsClub",
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: siteUrl,
    logo: `${siteUrl}${STRUCTURED_DATA_LOGO_PATH}`,
    image: `${siteUrl}${STRUCTURED_DATA_LOGO_PATH}`,
    sport: "Tenis de mesa",
    foundingDate: `${FOUNDING_DATE.year}-${pad(FOUNDING_DATE.month)}-${pad(FOUNDING_DATE.day)}`,
    address: { "@type": "PostalAddress", addressLocality: "Loja", postalCode: "110102", addressCountry: "EC" },
    geo: { "@type": "GeoCoordinates", latitude, longitude },
    contactPoint: contact.whatsapp.map((number) => ({
      "@type": "ContactPoint",
      contactType: "customer service",
      telephone: `+${toWhatsAppNumber(number)}`,
      availableLanguage: "es",
    })),
    sameAs: [contact.facebook, contact.instagram],
  };
}

/** `<` is escaped so a value can never close the surrounding script tag. */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
