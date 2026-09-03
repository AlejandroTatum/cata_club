/**
 * Test-only builders for the `LandingSchedule` inputs the landing's pure
 * functions are handed — issue #789.
 *
 * These are NOT the club's schedules. The club manages those inside the app
 * and they reach the page through `GET /api/schedules` (see
 * `schedule-data.ts`); restating them in the source is the second copy #789
 * removed, and `landing-config-no-schedule-list.test.ts` guards against
 * exactly that. What lives here is a stand-in catalog invented for the tests:
 * a morning block, a midday closure, back-to-back evening blocks and a
 * Saturday-only category — the cases `deriveContactHours` has to survive.
 *
 * It is shared because `landing-config.test.ts` and `ScheduleSelector.test.tsx`
 * need the same shapes, and two byte-identical copies of the same literal are
 * one duplicated block to a detector that reads tokens rather than intent.
 *
 * Builders only — nothing here asserts. A failing case therefore reports its
 * own line, never a line in this file.
 *
 * It sits in `__tests__/` on purpose: the walker in
 * `src/lib/__tests__/source-scan.ts` skips that directory, so these Spanish
 * literals are never mistaken for screen copy.
 */

import type { LandingSchedule, LandingScheduleSlot } from "@/app/landing/schedule-data";

/** A block the club runs on the weekday grid. */
export function weekSlot(hours: string, days = "Lunes a Viernes"): LandingScheduleSlot {
  return { hours, days, on: "week" };
}

/** A weekend block; `on: "sat"` is what keeps a slot off the weekday grid. */
export function satSlot(hours: string, days = "Sábado"): LandingScheduleSlot {
  return { hours, days, on: "sat" };
}

/**
 * One published category. `audience` stays absent unless a case asks for it,
 * because an absent label is a legitimate state the mapper produces.
 */
export function category(name: string, slots: LandingScheduleSlot[], audience?: string): LandingSchedule {
  return audience === undefined ? { category: name, slots } : { category: name, audience, slots };
}

/**
 * The stand-in catalog both suites derive from: an 08:00 – 09:15 morning, a
 * closure until 15:00, two evening blocks running to 21:15, and a Saturday
 * afternoon. Returns a fresh array per call, so a case that maps or filters it
 * cannot leak into the next one.
 */
export function publishedCatalog(): LandingSchedule[] {
  return [
    category("Mañana", [weekSlot("08:00 – 09:15")], "Mayores de 18 años"),
    category("Tarde", [weekSlot("15:00 – 16:00")]),
    category("Noche", [weekSlot("18:00 – 20:00"), weekSlot("20:00 – 21:15")]),
    category("Sabatino", [satSlot("15:00 – 18:00")]),
  ];
}
