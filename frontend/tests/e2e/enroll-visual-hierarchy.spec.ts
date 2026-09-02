/**
 * Rendered surface hierarchy of `/student/enroll` (#874) — desktop and
 * mobile, against the actual computed background colours the browser
 * resolves, not the class names alone (a Tailwind arbitrary colour or a
 * class-order bug would still pass a `className` assertion and still ship a
 * white-on-white screen).
 *
 * `enroll-qa.spec.ts` already owns the field-by-field, step-by-step
 * behaviour of this wizard; this file adds ONLY the rendered-surface
 * question that suite never asks — reusing its own network mocks so the
 * wizard's fetch-on-mount effects resolve the same way here.
 */

import { test, expect, type Page, type Route } from "@playwright/test";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

/** Same shape as `enroll-qa.spec.ts`'s own `mockBaseRoutes` — the wizard is
 *  public, so the session probe answers 401 and nothing redirects. */
async function mockBaseRoutes(page: Page): Promise<void> {
  await page.route("**/api/auth/session", (route: Route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/personas/instituciones**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, skip: 0, limit: 200 }),
    }),
  );
  await page.route("**/api/membresias/tarifas**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ categoria: "Categoria Test", precio: "1.00" }]),
    }),
  );
}

async function goToEnroll(page: Page): Promise<void> {
  await mockBaseRoutes(page);
  await page.goto("/student/enroll");
  await expect(page.getByRole("heading", { name: /tipo de inscripción/i })).toBeVisible({
    timeout: 20_000,
  });
}

/** Resolved `background-color` of a locator's first match. */
async function bg(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundColor);
}

for (const [viewportName, viewport] of Object.entries({ desktop: DESKTOP, mobile: MOBILE })) {
  test.describe(`surface hierarchy — ${viewportName} (${viewport.width}×${viewport.height})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport);
    });

    test("the header block, the form card and the info panel resolve to three different fills", async ({
      page,
    }) => {
      await goToEnroll(page);

      const header = await bg(page, '[data-testid="enroll-wizard-header"]');
      const card = await bg(page, '[data-testid="enroll-wizard-card"]');
      const panel = await bg(page, '[data-testid="enroll-info-panel"]');

      // None is transparent — every one of the three has to resolve to an
      // opaque, declared fill.
      for (const colour of [header, card, panel]) {
        expect(colour).not.toBe("rgba(0, 0, 0, 0)");
        expect(colour).not.toBe("transparent");
      }
      expect(new Set([header, card, panel]).size).toBe(3);

      // The header carries the wash's own resolved rgb — #FFF7F7.
      expect(header).toBe("rgb(255, 247, 247)");
      // The panel is `sunken` — #F4F4F7.
      expect(panel).toBe("rgb(244, 244, 247)");
      // The card is `paper` — plain white.
      expect(card).toBe("rgb(255, 255, 255)");
    });

    test("the current step pill resolves to coal", async ({ page }) => {
      await goToEnroll(page);

      const stepper = page.getByRole("list", { name: /pasos de la inscripción/i });
      const current = stepper.locator('[data-state="current"]');
      await expect(current).toHaveText(/tipo/i);

      const fill = await current.evaluate((el) => getComputedStyle(el).backgroundColor);
      // `coal` — #131316.
      expect(fill).toBe("rgb(19, 19, 22)");
    });

    test("the selected choice card resolves its border to cata-red", async ({ page }) => {
      await goToEnroll(page);

      const selected = page.getByRole("button", { name: /^Jugador Me inscribo yo al club/ });
      await expect(selected).toHaveAttribute("aria-pressed", "true");

      const borderColor = await selected.evaluate((el) => getComputedStyle(el).borderColor);
      // `cata-red` — #D92128.
      expect(borderColor).toBe("rgb(217, 33, 40)");
    });
  });
}
