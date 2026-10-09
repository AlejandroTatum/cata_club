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
