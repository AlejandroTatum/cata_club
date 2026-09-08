/**
 * Data contract for the competition-grouped Logros foundation.
 * Rendering behavior belongs to the interactive carousel slice.
 */

import { describe, expect, it } from "vitest";
import { ACHIEVEMENT_GROUPS, LOGRO_DESTACADO } from "@/app/landing/landing-logros";

describe("Logros institutional history", (): void => {
  it("keeps the approved competition groups in chronological inventory order", (): void => {
    expect(ACHIEVEMENT_GROUPS).toHaveLength(7);
    expect(ACHIEVEMENT_GROUPS.map(({ id }) => id)).toEqual([
      "south-american-doubles-2026",
      "south-american-qualifiers-2025",
      "pan-american-qualifiers-2025",
      "national-selective-cuenca-2024",
      "national-selective-pichincha-2024",
      "europe-world-circuit-2019",
      "national-podiums-2017-2019",
    ]);
  });

  it("keeps the lead result source-backed and free of private certificate data", (): void => {
    expect(LOGRO_DESTACADO).toMatchObject({
      title: "Bronce sudamericano en dobles",
      venue: "Asunción, Paraguay",
      athletes: "Eleana Ochoa y Dana Palma",
      result: "Medalla de bronce en dobles",
    });
    expect(JSON.stringify(ACHIEVEMENT_GROUPS)).not.toMatch(/cédula|teléfono|correo|certificado/i);
  });

  it("keeps provisional image references tied to the approved inventory", (): void => {
    expect(ACHIEVEMENT_GROUPS.every(({ photo }) => photo.startsWith("photo-"))).toBe(true);
    expect(new Set(ACHIEVEMENT_GROUPS.map(({ photo }) => photo)).size).toBe(ACHIEVEMENT_GROUPS.length);
  });
});
