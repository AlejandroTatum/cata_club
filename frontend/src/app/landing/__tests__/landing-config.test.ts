import { describe, expect, it } from "vitest";
import {
  FOUNDING_DATE,
  buildLandingStats,
  deriveContactHours,
  landingConfig,
  toWhatsAppLink,
  toWhatsAppNumber,
  yearsSinceFounding,
} from "@/app/landing/landing-config";
import type { LandingSchedule } from "@/app/landing/schedule-data";
import { category, publishedCatalog, satSlot } from "./schedule-fixtures";

/**
 * A stand-in catalog, not the club's schedules — those live in the app and
 * reach the page through `GET /api/schedules` (issue #789).
 * `deriveContactHours` is a pure function over whatever catalog it is handed,
 * so its tests state the input they need and nothing more. The builders live
 * in `schedule-fixtures.ts` because `ScheduleSelector.test.tsx` needs the same
 * shapes; importing the club's real list back in would be the second copy this
 * issue removed.
 */
const PUBLISHED: LandingSchedule[] = publishedCatalog();

describe("toWhatsAppNumber", (): void => {
  it("converts an Ecuadorian mobile number to its international form", (): void => {
    expect(toWhatsAppNumber("0994219619")).toBe("593994219619");
    expect(toWhatsAppNumber("0990288152")).toBe("593990288152");
  });

  it("ignores separators and spacing in the configured number", (): void => {
    expect(toWhatsAppNumber("099 421 9619")).toBe("593994219619");
    expect(toWhatsAppNumber("099-421-9619")).toBe("593994219619");
  });

  it("leaves an already international number untouched", (): void => {
    expect(toWhatsAppNumber("+593994219619")).toBe("593994219619");
    expect(toWhatsAppNumber("593994219619")).toBe("593994219619");
  });

  it("converts every configured contact number without a leading zero", (): void => {
    landingConfig.contact.whatsapp.forEach((number): void => {
      const international = toWhatsAppNumber(number);
      expect(international.startsWith("593")).toBe(true);
      expect(international.startsWith("5930")).toBe(false);
      expect(international).toMatch(/^\d+$/);
    });
  });
});

describe("toWhatsAppLink", (): void => {
  it("builds a wa.me deep link from a local number", (): void => {
    expect(toWhatsAppLink("0994219619")).toBe("https://wa.me/593994219619");
  });
});

describe("yearsSinceFounding", (): void => {
  it("counts zero years on the founding day itself", (): void => {
    expect(yearsSinceFounding(new Date(FOUNDING_DATE.year, FOUNDING_DATE.month - 1, FOUNDING_DATE.day))).toBe(0);
  });

  it("does not count the current year before the anniversary", (): void => {
    expect(yearsSinceFounding(new Date(2026, 6, 25))).toBe(12);
    expect(yearsSinceFounding(new Date(2026, 9, 9))).toBe(12);
  });

  it("counts the year from the anniversary onwards", (): void => {
    expect(yearsSinceFounding(new Date(2026, 9, 10))).toBe(13);
    expect(yearsSinceFounding(new Date(2027, 0, 1))).toBe(13);
  });

  it("never drifts negative before the founding date", (): void => {
    expect(yearsSinceFounding(new Date(2012, 0, 1))).toBe(0);
  });
});

describe("buildLandingStats", (): void => {
  it("derives the years figure from the founding year instead of hardcoding it", (): void => {
    const stats = buildLandingStats(new Date(2030, 9, 10));
    const years = stats.find((stat): boolean => stat.label === "Años formando deportistas");

    expect(years?.value).toBe("17");
  });

  it("carries every figure as a ready-to-render string, with no odometer seed", (): void => {
    const stats = buildLandingStats(new Date(2026, 6, 25));

    expect(stats.find((stat): boolean => stat.value === String(FOUNDING_DATE.year))).toBeDefined();
    // A count-up seed is what let the trust band render 0 for a real 12: the
    // figure must reach the DOM as text and stay there.
    stats.forEach((stat): void => {
      expect(stat.value).not.toBe("");
      expect(Object.keys(stat)).toEqual(["value", "label"]);
    });
  });

  it("carries no unverified athlete count", (): void => {
    const labels = buildLandingStats(new Date(2026, 6, 25)).map((stat): string => stat.label);

    expect(labels).not.toContain("Deportistas en formación");
  });

  it("labels the founding date with 'Desde', never the retired 'Fundado' wording", (): void => {
    const stats = buildLandingStats(new Date(2026, 6, 25));

    stats.forEach((stat): void => {
      expect(stat.label).not.toMatch(/fundad/i);
    });
    expect(stats.find((stat): boolean => stat.value === String(FOUNDING_DATE.year))?.label).toBe(
      "Desde el 10 de octubre",
    );
  });

  /**
   * The stats band is read at a glance, well above the map, so its venue
   * figure has to give the same landmark the address line does (#641). A band
   * naming the neighbourhood while the copy below names the Coliseo would
   * leave a visitor holding two references and no way to tell they are one.
   */
  it("locates the venue by the same landmark the address line uses", (): void => {
    const stats = buildLandingStats(new Date(2026, 6, 25));

    const venue = stats.find((stat): boolean => stat.value === "Loja");
    expect(venue).toBeDefined();
    expect(venue?.label).toBe("Junto al Coliseo Ciudad de Loja");
  });
});

describe("deriveContactHours", (): void => {
  it("spans the earliest start and the latest end across every slot, morning block included", (): void => {
    expect(deriveContactHours(PUBLISHED)).toBe("Lun – Sáb · 08:00 – 21:15");
  });

  it("stops at Friday when no slot runs on Saturday", (): void => {
    const weekdaysOnly = PUBLISHED.map((schedule): LandingSchedule => ({
      ...schedule,
      slots: schedule.slots.map((slot): typeof slot => ({ ...slot, on: "week", days: "Lunes a Viernes" })),
    }));

    expect(deriveContactHours(weekdaysOnly)).toBe("Lun – Vie · 08:00 – 21:15");
  });

  it("spans every slot of a single multi-slot category, not just its first one", (): void => {
    const onlyNoche = PUBLISHED.filter((schedule): boolean => schedule.category === "Noche");

    expect(deriveContactHours(onlyNoche)).toBe("Lun – Vie · 18:00 – 21:15");
  });

  it("extends the day range to Saturday from a Saturday-only category with no weekday slot", (): void => {
    const onlySaturday = PUBLISHED.filter((schedule): boolean => schedule.category === "Sabatino");

    expect(deriveContactHours(onlySaturday)).toBe("Lun – Sáb · 15:00 – 18:00");
  });

  it("reaches Sunday when the club publishes a Sunday slot", (): void => {
    const sunday: LandingSchedule[] = [category("Dominical", [satSlot("09:00 – 11:00", "Domingo")])];

    expect(deriveContactHours(sunday)).toBe("Lun – Dom · 09:00 – 11:00");
  });

  /**
   * The contact card calls this with whatever `GET /api/schedules` returned,
   * and an empty catalog is a legitimate answer. The function must not throw
   * or fabricate a window — the caller decides what to say instead (see
   * `LandingPage`'s status copy).
   */
  it("states no window at all when there is nothing published", (): void => {
    expect(deriveContactHours([])).toBe("Lun – Vie ·  – ");
  });
});

describe("landingConfig", (): void => {
  /**
   * Issue #789: the club's schedules are managed in the app, so this module
   * no longer states them — not as a list, and not as a range frozen at
   * module load. `landing-config-no-schedule-list.test.ts` guards the source
   * itself; this only pins what the module is still for.
   */
  it("carries the contact channels and nothing about schedules", (): void => {
    expect(Object.keys(landingConfig)).toEqual(["contact"]);
    expect(Object.keys(landingConfig.contact)).toEqual(["whatsapp", "facebook", "instagram"]);
  });
});
