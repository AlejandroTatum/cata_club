/**
 * schema.org `SportsClub` for the landing, built only from values the landing
 * itself already publishes (`landingConfig`, `club-location`, `FOUNDING_DATE`).
 * Nothing here is typed in a second time: a fact the club has not published is
 * left out rather than invented. The street has no number (the club publishes a
 * Plus Code and a landmark), so `streetAddress` carries the street only. The
 * opening hours are managed in the app and fetched live (see
 * `landing-config.ts`), so they are built from the published schedules by
 * `buildOpeningHoursJsonLd` once the page has them, never typed here.
 */

import { CLUB_NEIGHBORHOOD, CLUB_POSITION, CLUB_STREET_ADDRESS } from "@/app/landing/club-location";
import { FOUNDING_DATE, landingConfig, toWhatsAppNumber } from "@/app/landing/landing-config";
import { SCHEMA_DAY_OF_WEEK, type LandingSchedule } from "@/app/landing/schedule-data";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

/** Square, padded full logo, 512px. Stable public URL. */
export const STRUCTURED_DATA_LOGO_PATH = "/brand/cata-club-logo-square-512.png";

export interface SportsClubJsonLd {
  "@context": "https://schema.org";
  "@type": "SportsClub";
  "@id": string;
  email: string;
  name: string;
  description: string;
  url: string;
  logo: string;
  image: string;
  sport: string;
  foundingDate: string;
  address: {
    "@type": "PostalAddress";
    streetAddress: string;
    addressLocality: string;
    postalCode: string;
    addressCountry: string;
  };
  geo: { "@type": "GeoCoordinates"; latitude: number; longitude: number };
  contactPoint: { "@type": "ContactPoint"; contactType: string; telephone: string; availableLanguage: string }[];
  sameAs: string[];
}

/** Same `@id` on every script of the page, so search engines merge them into one entity. */
export const clubEntityId = (siteUrl: string): string => `${siteUrl}/#club`;

const pad = (value: number): string => String(value).padStart(2, "0");

export function buildSportsClubJsonLd(siteUrl: string): SportsClubJsonLd {
  const { contact } = landingConfig;
  const [latitude, longitude] = CLUB_POSITION;
  return {
    "@context": "https://schema.org",
    "@type": "SportsClub",
    "@id": clubEntityId(siteUrl),
    email: contact.email,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: siteUrl,
    logo: `${siteUrl}${STRUCTURED_DATA_LOGO_PATH}`,
    image: `${siteUrl}${STRUCTURED_DATA_LOGO_PATH}`,
    sport: "Tenis de mesa",
    foundingDate: `${FOUNDING_DATE.year}-${pad(FOUNDING_DATE.month)}-${pad(FOUNDING_DATE.day)}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: `${CLUB_STREET_ADDRESS}, ${CLUB_NEIGHBORHOOD}`,
      addressLocality: "Loja", postalCode: "110102",
      addressCountry: "EC",
    },
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

export interface OpeningHoursJsonLd {
  "@context": "https://schema.org";
  "@type": "SportsClub";
  "@id": string;
  openingHoursSpecification: { "@type": "OpeningHoursSpecification"; dayOfWeek: string[]; opens: string; closes: string }[];
}

/** "Lunes, Miércoles y Viernes" → ["Monday", "Wednesday", "Friday"]; empty if any day is unknown. */
function schemaDays(label: string): string[] {
  const days = label.split(/,\s*|\s+y\s+/).map((day): string | undefined => SCHEMA_DAY_OF_WEEK[day.trim()]);
  return days.every((day): day is string => day !== undefined) ? (days as string[]) : [];
}

/**
 * The club's opening hours as the app publishes them: one specification per
 * distinct block of days and times across every category. `null` when there is
 * nothing publishable, so the page renders no script rather than an empty one.
 */
export function buildOpeningHoursJsonLd(siteUrl: string, schedules: LandingSchedule[]): OpeningHoursJsonLd | null {
  const seen = new Set<string>();
  const openingHoursSpecification: OpeningHoursJsonLd["openingHoursSpecification"] = [];
  for (const slot of schedules.flatMap((schedule): LandingSchedule["slots"] => schedule.slots)) {
    const [opens, closes] = slot.hours.split(/\s+–\s+/);
    const dayOfWeek = schemaDays(slot.days);
    const key = `${dayOfWeek.join()}|${opens}|${closes}`;
    if (!opens || !closes || dayOfWeek.length === 0 || seen.has(key)) continue;
    seen.add(key);
    openingHoursSpecification.push({ "@type": "OpeningHoursSpecification", dayOfWeek, opens, closes });
  }
  if (openingHoursSpecification.length === 0) return null;
  return { "@context": "https://schema.org", "@type": "SportsClub", "@id": clubEntityId(siteUrl), openingHoursSpecification };
}

/** `<` is escaped so a value can never close the surrounding script tag. */
export function serializeJsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
