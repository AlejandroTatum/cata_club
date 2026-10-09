/**
 * One surface language (T14 RC12, S3, S13).
 *
 * The panel's cards are the landing's stickers: a 2px coal outline and a hard
 * offset shadow. The audit found three other dialects next to it — pastel tiles
 * with a 3px coloured top border, white cards with a soft blurred shadow, and
 * cards nested inside cards. These scans keep them from coming back; the
 * StatCard face map itself is covered in `StatCard.test.tsx`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

/** The comment-free source, so prose about the old look cannot trip a scan. */
function code(path: string): string {
  return read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("surface consistency", () => {
  it.each([
    "components/ui/StatCard.tsx",
    "app/profile/ProfileCards.tsx",
    "app/members/MedicalRecordEditor.tsx",
  ])("%s draws no tinted tile with a 3px coloured top border", (path) => {
    expect(code(path)).not.toMatch(/border-t-\[3px\]/);
  });

  it("the profile identity card is a sticker, not a soft-shadow card", () => {
    const source = code("app/profile/ProfileCards.tsx");
    expect(source).not.toMatch(/shadow-elevated/);
    expect(source).toMatch(/data-testid="profile-hero"[\s\S]{0,200}shadow-sticker/);
  });

  it("the membership ticket wears the sticker frame", () => {
    expect(code("app/profile/ProfileCards.tsx")).toMatch(/data-testid="profile-membership"[\s\S]{0,300}shadow-sticker/);
  });

  it("«Dónde se usan las tarifas» is a row of dividers, not three cards inside a card", () => {
    const source = code("app/tarifas/TarifaUsage.tsx");
    expect(source).not.toMatch(/rounded-card border border-line bg-sunken/);
    expect(source).toMatch(/divide-/);
  });
});

/**
 * One primary action per screen (S3, T14 RC10). A button repeated on every row
 * of a list is never the primary skin: fifty yellow «Ficha médica» buttons or
 * five black «Agregar jugadores» blocks made the page's one primary
 * indistinguishable from its rows.
 */
describe("row actions stay quiet", () => {
  it("the trainer roster has no primary-skinned button in a row", () => {
    expect(code("app/trainer/students/page.tsx")).not.toMatch(/variant=\{?"(primary|dark)"/);
  });

  it("the groups rows have no dark or primary button besides the form's own", () => {
    const rows = code("app/groups/page.tsx").match(/aria-label=\{`Agregar jugadores a[\s\S]{0,40}/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    const source = code("app/groups/page.tsx");
    for (const label of ["Agregar jugadores a ${cardTitle(card)}", "Definir horarios de ${entry.label}"]) {
      const at = source.indexOf(label);
      expect(at, label).toBeGreaterThan(-1);
      expect(source.slice(Math.max(0, at - 400), at)).not.toMatch(/variant="(primary|dark)"/);
    }
  });
});

/**
 * Category rows are one compact block, not a 220px slab with a dead middle
 * (T14 RC9): the headcount and the actions share the second line of the
 * two-column band, and no row pads itself by 48px at the widest breakpoint.
 * The rendered height is measured in `e2e/surface-batch-g.spec.ts`.
 */
describe("groups rows are compact", () => {
  const source = code("app/groups/page.tsx");

  it("never spends the 2xl:py-12 padding the slab had", () => {
    expect(source).not.toMatch(/2xl:py-12/);
  });

  it("puts the actions beside the headcount, not on a line of their own", () => {
    expect(source).not.toMatch(/md:col-span-2 md:justify-end/);
    expect(source).toMatch(/md:col-start-2 md:self-end md:justify-end/);
  });
});

/**
 * The micro step is for uppercase tracked labels, chips and counters (T14
 * RC16). Sentence-case helper text — hints, secondary lines, form sub-labels —
 * is read, not scanned, so it sits on `text-xs`; and the step itself is
 * 11.5px, not the 10.5px that was hard to scan at 1440 and cramped at 390.
 */
describe("the micro text step", () => {
  const SENTENCE_CASE_HELPERS = [
    "app/members/page.tsx",
    "app/members/MedicalRecordEditor.tsx",
    "components/wizard-fields.tsx",
    "components/NotificationBell.tsx",
    "components/admin/CampoFormularioAdmin.tsx",
    "app/admin/dias-sin-clase/page.tsx",
    "app/attendance/AttendanceCorrectionAction.tsx",
    "app/student/MemberCard.tsx",
    "app/trainer/RecentSessionsList.tsx",
    "app/trainer/attendance/AttendanceRosterRow.tsx",
    "components/ui/Table.tsx",
    "components/ui/ActivityList.tsx",
    "components/shell/AccountMenu.tsx",
    "app/profile/SessionsCard.tsx",
  ];

  it("is at least 11.5px", async () => {
    const config = (await import("../../../tailwind.config")).default;
    const fontSize = config.theme?.extend?.fontSize as Record<string, [string, unknown]>;
    expect(parseFloat(fontSize["2xs"][0])).toBeGreaterThanOrEqual(11.5);
  });

  it.each(SENTENCE_CASE_HELPERS)("%s sets its helper text on text-xs, not text-2xs", (path) => {
    // These files still use `text-2xs` for chips, badges and initials; what
    // must be gone is the sentence-case use, i.e. a line with `text-2xs` and
    // no `uppercase`, no fixed box (`h-`/`w-`) and no `font-bold` chip look.
    const offenders = code(path)
      .split("\n")
      .filter((line) => /(?<![\w-])text-2xs(?![\w-])/.test(line))
      .filter((line) => !/uppercase|\bh-\d|\bh-\[|\bw-\d|rounded-full|kbd|font-bold|font-extrabold|h-badge/.test(line));
    expect(offenders).toEqual([]);
  });
});
