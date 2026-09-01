/**
 * Anti-duplication guard — issue #789, closure criterion 3.
 *
 * The club manages its schedules inside the app, and they reach the public
 * page through `GET /api/schedules` (mapped by `schedule-data.ts`). That
 * catalog is the only canonical source. Until this change `landing-config.ts`
 * carried a second, independently maintained copy of the same knowledge: a
 * category the club edited in the admin never reached the landing's contact
 * card, and the two could disagree forever without anything failing.
 *
 * This file reads the module's own BYTES instead of importing it — the same
 * shape as `backend/tests/test_conocimiento_club.py`'s
 * `test_el_modulo_del_chatbot_ya_no_guarda_una_copia_del_conocimiento`, and
 * for the reason `app/ayuda/__tests__/knowledge-parity.test.tsx` states in its
 * own header: a guard that reads the same definition the code reads can only
 * ever agree with it. An import-based assertion would only see the names the
 * module still exports today; the list can come back under any name, or as a
 * `FALLBACK_SCHEDULES` nobody exports and only an error path renders. The
 * bytes see all of them.
 *
 * What stays deliberately allowed here: `deriveContactHours` and its weekday
 * abbreviations. That function derives a range FROM the dynamic schedules it
 * is handed — it states no schedule of its own, and it is what the contact
 * card now calls with the fetched data.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CONFIG_PATH = resolve(process.cwd(), "src/app/landing/landing-config.ts");

/** A published block such as `15:00 – 16:00` — an en dash, em dash or hyphen. */
const TIME_RANGE_LITERAL = /\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2}/g;

/**
 * The shape of a schedule record: a `category`/`audience`/`days`/`on` field
 * assigned a string, or a `slots` field assigned an array. Property ACCESS
 * (`slot.days`, `schedule.slots`) carries no colon, so reading the dynamic
 * schedules never trips this — only writing a list of them down does.
 */
const SCHEDULE_SHAPED_FIELD = /\b(category|audience|slots|days|on)\s*:\s*(\[|["'`])/g;

interface Finding {
  what: string;
  sample: string;
}

function findScheduleKnowledge(source: string): Finding[] {
  return [
    ...Array.from(source.matchAll(TIME_RANGE_LITERAL), (match): Finding => ({
      what: "a published time range",
      sample: match[0],
    })),
    ...Array.from(source.matchAll(SCHEDULE_SHAPED_FIELD), (match): Finding => ({
      what: "a schedule-shaped field",
      sample: match[0].trim(),
    })),
  ];
}

function explain(findings: Finding[]): string {
  return [
    `landing-config.ts states schedule knowledge again (${findings.length} occurrence(s)):`,
    ...findings.map((finding): string => `  · ${finding.what} → ${finding.sample}`),
    "",
    "This is not allowed. The club edits its schedules inside the app and the",
    "landing reads them from GET /api/schedules (see schedule-data.ts). A copy",
    "here cannot be edited by the club, so it goes stale in silence — which is",
    "exactly the divergence issue #789 removed. Render the fetched catalog, or",
    "say honestly that it is unavailable; never restate it.",
  ].join("\n");
}

function readConfigSource(): string {
  return readFileSync(CONFIG_PATH, "utf8");
}

describe("landing-config.ts keeps no second schedule list (issue #789)", (): void => {
  it("can read the module it polices", (): void => {
    // Without this, a moved file or a wrong cwd would make every assertion
    // below pass against an empty string.
    const source = readConfigSource();
    expect(source.length).toBeGreaterThan(500);
    expect(source).toContain("export const landingConfig");
  });

  it("states no schedule of its own", (): void => {
    const findings = findScheduleKnowledge(readConfigSource());

    expect(findings, explain(findings)).toEqual([]);
  });

  it("still keeps the contact fields that have nothing to do with schedules", (): void => {
    // The guard must forbid the list, not hollow out the module: these are the
    // exports `error-message.ts`, `ChatWidget.tsx`, `AuthShell.tsx` and
    // `reports-utils.ts` depend on.
    const source = readConfigSource();

    expect(source).toContain("FOUNDING_DATE");
    expect(source).toContain("toWhatsAppNumber");
    expect(source).toContain("buildLandingStats");
    expect(source).toContain("deriveContactHours");
  });

  /**
   * Proof the guard bites. The regexes above are run against a copy of the
   * real source with a schedule list pasted back in — the exact regression
   * this file exists to catch — so a guard that silently stopped matching
   * anything fails here instead of passing quietly upstairs.
   */
  it("bites when a schedule list is pasted back into the module", (): void => {
    const pastedBack = [
      readConfigSource(),
      "const schedules: LandingSchedule[] = [",
      '  { category: "Formativo", audience: "5 a 10 años",',
      '    slots: [{ hours: "15:00 – 16:00", days: "Lunes a Viernes", on: "week" }] },',
      "];",
    ].join("\n");

    const findings = findScheduleKnowledge(pastedBack);
    const kinds = findings.map((finding): string => finding.what);

    expect(kinds).toContain("a published time range");
    expect(kinds).toContain("a schedule-shaped field");
    expect(findings.map((finding): string => finding.sample)).toContain("15:00 – 16:00");
    expect(explain(findings)).toContain("issue #789");
  });

  it("does not mistake reading the dynamic schedules for restating them", (): void => {
    // `deriveContactHours` walks `schedule.slots` and `slot.days`. Property
    // access is not a declaration, and this guard must never push anyone into
    // deleting the derivation to stay green.
    const derivation = [
      "export function deriveContactHours(schedules: LandingSchedule[]): string {",
      "  const allSlots = schedules.flatMap((schedule) => schedule.slots);",
      '  const days = allSlots.map((slot) => slot.days).join(" ");',
      '  return days.includes("Sábado") ? "Sáb" : "Vie";',
      "}",
    ].join("\n");

    expect(findScheduleKnowledge(derivation)).toEqual([]);
  });
});
