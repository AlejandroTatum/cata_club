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
