/**
 * The motion kit (T4; S3 own identity, S4 reduced motion), measured on computed
 * styles in a browser.
 *
 * With `prefers-reduced-motion: reduce` emulated, every kit transition and
 * animation on the key components must resolve to a zero duration (the
 * `--motion-*` tokens are zeroed), and with no preference the same elements
 * must carry the budgeted, short durations — which proves the reduced run is
 * measuring the switch and not an element that never moved.
 *
 * Like `empty-states.spec.ts` it answers the same-origin BFF with empty lists:
 * the subject is motion, not the backend.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

const ADMIN = {
  user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin", representanteId: null },
  roles: ["ADMINISTRADOR"],
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/**", (route) => (route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {})));
  await page.route("**/api/ranking/notificaciones/mias*", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }));
  await page.route("**/api/descuentos**", (route) => fulfillJson(route, { items: [], total: 0 }));
  await page.route("**/api/payments*", (route) => fulfillJson(route, { items: [], total: 0 }));
  await page.route("**/api/membresias/coberturas/todas*", (route) => fulfillJson(route, { items: [], total: 0 }));
  await page.route("**/api/auth/session", (route) => fulfillJson(route, { ...ADMIN, loggedInAt: new Date().toISOString() }));
}

/** Longest transition and animation duration, in ms, of every element matching `selector`. */
async function durations(page: Page, selector: string): Promise<{ count: number; transition: number; animation: number; names: string[] }> {
  return page.evaluate((sel) => {
    const toMs = (list: string): number => Math.max(0, ...list.split(",").map((v) => (v.trim().endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000)));
    const nodes = Array.from(document.querySelectorAll(sel));
    let transition = 0;
    let animation = 0;
    const names = new Set<string>();
    for (const node of nodes) {
      const style = getComputedStyle(node);
      transition = Math.max(transition, toMs(style.transitionDuration));
      animation = Math.max(animation, toMs(style.animationDuration));
      if (style.animationName !== "none") names.add(style.animationName);
    }
    return { count: nodes.length, transition, animation, names: [...names] };
  }, selector);
}

const MODES = [
  { reducedMotion: "reduce" as const, expect: (ms: number) => expect(ms).toBe(0) },
  { reducedMotion: "no-preference" as const, expect: (ms: number) => { expect(ms).toBeGreaterThan(0); expect(ms).toBeLessThanOrEqual(300); } },
];

for (const mode of MODES) {
  test.describe(`Motion kit with prefers-reduced-motion: ${mode.reducedMotion}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ reducedMotion: mode.reducedMotion });
      await signInAsAdmin(page);
    });

    test("press feedback, empty-state reveal and the command palette", async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/discounts");
      await expect(page.getByText("Sin descuentos en el catálogo")).toBeVisible({ timeout: 20_000 });

      const button = await durations(page, "main button.border-2");
      expect(button.count).toBeGreaterThan(0);
      mode.expect(button.transition);

      const reveal = await durations(page, "main .animate-reveal");
      expect(reveal.count).toBeGreaterThan(0);
      mode.expect(reveal.animation);

      await page.keyboard.press("Control+k");
      const dialog = page.getByRole("dialog", { name: "Buscador de secciones" });
      await expect(dialog).toBeVisible();
      const panel = await durations(page, "[role='dialog'][aria-label='Buscador de secciones']");
      mode.expect(panel.animation);
      expect(panel.names).toEqual(["land"]);
      const backdrop = await durations(page, "div.animate-overlay-in");
      expect(backdrop.count).toBeGreaterThan(0);
      mode.expect(backdrop.animation);
    });

    test("a collapsed help panel opens without travelling", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/payments");
      const toggle = page.getByRole("button", { name: "Mostrar Cómo se revisa un pago" });
      await expect(toggle).toBeVisible({ timeout: 20_000 });
      const chevron = await durations(page, "aside button[aria-expanded] svg");
      mode.expect(chevron.transition);

      await toggle.click();
      const body = await durations(page, "aside .animate-disclose, aside [class*='animate-disclose']");
      expect(body.count).toBeGreaterThan(0);
      mode.expect(body.animation);
    });
  });
}

test("a data table carries no motion while it pages", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await signInAsAdmin(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/payments");
  await page.waitForLoadState("networkidle");
  const table = await durations(page, "table, table tr, table td, table th, [data-testid*='pagination']");
  expect(table.animation).toBe(0);
  expect(table.names).toEqual([]);
});
