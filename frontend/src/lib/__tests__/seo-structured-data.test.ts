import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildOpeningHoursJsonLd, buildSportsClubJsonLd, clubEntityId, serializeJsonLd, STRUCTURED_DATA_LOGO_PATH } from "../seo-structured-data";
import { CLUB_NEIGHBORHOOD, CLUB_STREET_ADDRESS } from "@/app/landing/club-location";
import { landingConfig } from "@/app/landing/landing-config";

const SITE = "https://cataclub.com";

describe("SportsClub JSON-LD", () => {
  const data = buildSportsClubJsonLd(SITE);

  it("identifies the club on the canonical origin", () => {
    expect(data["@type"]).toBe("SportsClub");
    expect(data.name).toBe("Cata Club");
    expect(data.url).toBe(SITE);
  });

  it("points the logo at a stable, existing public file", () => {
    expect(data.logo).toBe(`${SITE}${STRUCTURED_DATA_LOGO_PATH}`);
    expect(existsSync(path.join(process.cwd(), "public", STRUCTURED_DATA_LOGO_PATH))).toBe(true);
  });

  it("uses only contact data the landing already publishes", () => {
    expect(data.sameAs).toEqual([landingConfig.contact.facebook, landingConfig.contact.instagram]);
    expect(data.contactPoint.map((point) => point.telephone)).toEqual(["+593994219619", "+593990288152"]);
    expect(data.address).toMatchObject({ addressLocality: "Loja", addressCountry: "EC" });
    expect(data.foundingDate).toBe("2013-10-10");
  });

  it("publishes the street the landing prints, with no invented number", () => {
    expect(data.address.streetAddress).toBe(`${CLUB_STREET_ADDRESS}, ${CLUB_NEIGHBORHOOD}`);
    expect(data.address.streetAddress).not.toMatch(/\d/);
  });

  it("carries the contact email from the club config and a stable entity id", () => {
    expect(data.email).toBe(landingConfig.contact.email);
    expect(data["@id"]).toBe(clubEntityId(SITE));
  });

  it("escapes markup so a value cannot close the script tag", () => {
    expect(serializeJsonLd({ name: "</script><b>" })).not.toContain("<");
  });
});

describe("opening hours JSON-LD", () => {
  const slot = (hours: string, days: string, on: "week" | "sat" = "week") => ({ hours, days, on });

  it("is built from the published schedules and shares the club's entity id", () => {
    const data = buildOpeningHoursJsonLd(SITE, [
      { category: "Infantil", slots: [slot("15:00 – 16:00", "Lunes, Miércoles y Viernes")] },
      { category: "Adultos", slots: [slot("20:00 – 21:30", "Martes y Jueves"), slot("09:00 – 11:00", "Sábado", "sat")] },
    ]);
    expect(data?.["@id"]).toBe(clubEntityId(SITE));
    expect(data?.openingHoursSpecification).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Wednesday", "Friday"], opens: "15:00", closes: "16:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Tuesday", "Thursday"], opens: "20:00", closes: "21:30" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday"], opens: "09:00", closes: "11:00" },
    ]);
  });

  it("deduplicates blocks shared by several categories", () => {
    const shared = slot("15:00 – 16:00", "Lunes y Miércoles");
    const data = buildOpeningHoursJsonLd(SITE, [
      { category: "A", slots: [shared] },
      { category: "B", slots: [shared] },
    ]);
    expect(data?.openingHoursSpecification).toHaveLength(1);
  });

  it("returns null when nothing is publishable", () => {
    expect(buildOpeningHoursJsonLd(SITE, [])).toBeNull();
    expect(buildOpeningHoursJsonLd(SITE, [{ category: "X", slots: [slot("15:00 – 16:00", "Festivo")] }])).toBeNull();
  });
});
