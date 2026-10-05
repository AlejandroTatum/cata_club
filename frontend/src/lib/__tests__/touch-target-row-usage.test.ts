/**
 * The QA4 minor touch targets (#1567, m1–m7): each control is a text link,
 * chip or disclosure that measured 19–29px on a phone. jsdom has no layout, so
 * this reads the source for the coarse-pointer class; the measurement is
 * `tests/e2e/mobile-audit.mobile.spec.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");

/** The opening tag (or className expression) that precedes a label. */
function tagBefore(code: string, label: string): string {
  const at = code.indexOf(label);
  expect(at, `${label} not found`).toBeGreaterThan(-1);
  return code.slice(Math.max(0, at - 700), at);
}

const ROWS: [string, string, string, string][] = [
  ["m1", "app/student/MemberCard.tsx", "Imprimir carnet", "touch-target-row"],
  ["m2", "app/student/CuotaCard.tsx", "Ver pagos", "touch-target-row"],
  ["m2", "app/student/page.tsx", 'items-center gap-1.5 rounded text-sm', "touch-target-row"],
  ["m3", "app/login/page.tsx", "¿Olvidaste tu contraseña?", "touch-target-row"],
  ["m3", "app/login/page.tsx", "Inscríbete", "touch-target-row"],
  ["m3", "components/auth/AuthShell.tsx", "Escríbenos por WhatsApp", "touch-target-row"],
  ["m4", "app/terminos/LegalSideCards.tsx", "{CONTACT_EMAIL}</a>", "touch-target-row"],
  ["m4", "app/terminos/LegalSideCards.tsx", "WhatsApp {number}", "touch-target-row"],
  ["m5", "components/dashboard/KpiTile.tsx", "{caption}\n          <ArrowRight", "touch-target-row"],
  ["m6", "components/charts/StackedBars.tsx", "on ? \"border-line-2", "touch-target-row"],
  ["m6", "components/charts/StackedBars.tsx", "Ver como tabla", "touch-target-pad"],
  ["m7", "app/trainer/SessionsWithoutList.tsx", "Es una estimación", "touch-target-pad"],
];

describe("minor touch targets carry the coarse-pointer row class", () => {
  it.each(ROWS)("%s %s «%s»", (_id, file, label, cls) => {
    expect(tagBefore(read(file), label)).toContain(cls);
  });
});
