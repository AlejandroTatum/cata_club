import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { buildSportsClubJsonLd, serializeJsonLd, STRUCTURED_DATA_LOGO_PATH } from "../seo-structured-data";
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

  it("does not invent a street address", () => {
    expect(data.address).not.toHaveProperty("streetAddress");
  });

  it("escapes markup so a value cannot close the script tag", () => {
    expect(serializeJsonLd({ name: "</script><b>" })).not.toContain("<");
  });
});
