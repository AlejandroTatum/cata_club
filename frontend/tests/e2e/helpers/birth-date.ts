/**
 * Shared e2e helper for `BirthDateField` (issue #853) — the Día/Mes/Año
 * guided replacement for the birth-date `<input type="date">`.
 *
 * `BirthDateField` keeps its group id exactly what the single native input
 * used to carry (`enroll-fecha-nacimiento`, `crear-cuenta-fecha-nacimiento`,
 * …), so every spec's own `F` table of transcribed ids keeps working — only
 * the way a value is TYPED changes: three controls instead of one. The `-dia`
 * / `-mes` / `-anio` suffixes below are transcribed from
 * `BIRTH_DATE_PART_SUFFIX` in `src/components/wizard-fields.tsx`, the same
 * "declared, not imported" convention `enroll-qa.spec.ts`'s own `F` table
 * already documents for field ids: if the product ever renames a part, this
 * file has to notice by breaking, not silently drift.
 */

import type { Locator, Page } from "@playwright/test";

/** One of `BirthDateField`'s three controls, addressed by the group's own id. */
export function birthDatePart(page: Page, groupId: string, part: "dia" | "mes" | "anio"): Locator {
  return page.locator(`#${groupId}-${part}`);
}

/** Fills Día/Mes/Año from an ISO `YYYY-MM-DD` value — the replacement for a `.fill()` on the single native date input. */
export async function fillBirthDate(page: Page, groupId: string, iso: string): Promise<void> {
  const [year, month, day] = iso.split("-");
  await birthDatePart(page, groupId, "dia").fill(day);
  await birthDatePart(page, groupId, "mes").selectOption(month);
  await birthDatePart(page, groupId, "anio").fill(year);
}
