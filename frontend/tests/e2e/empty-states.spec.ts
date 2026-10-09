/**
 * Empty states from the T14 audit, batch C (S13, S9, S4), measured in a browser.
 *
 *  - RC1  a screen with nothing on it shows ONE compact block (what is missing,
 *         the page's next action) — no dashed placeholder tiles, no skeleton
 *         rows, no card floating over a 900px column of ghosts;
 *  - RC17 `/groups` with no categories shows its real zero, never a perpetual
 *         «Calculando…».
 *
 * Like `shell-batch-a.spec.ts` it answers the same-origin BFF with empty lists:
 * the subject is layout, not the backend.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const ADMIN = {
  user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin", representanteId: null },
  roles: ["ADMINISTRADOR"],
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/**", (route) =>
    route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {}),
  );
  await page.route("**/api/ranking/notificaciones/mias", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }));
  await page.route("**/api/descuentos**", (route) => fulfillJson(route, { items: [], total: 0 }));
  await page.route("**/api/members", (route) => fulfillJson(route, { accounts: [], stats: {} }));
  await page.route("**/api/auth/session", (route) =>
    fulfillJson(route, { ...ADMIN, loggedInAt: new Date().toISOString() }),
  );
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

/** `scope` is where placeholders would show up; the upload forms keep their own (legit) dashed drop zone. */
const SCREENS = [
  { route: "/galeria", scope: "[aria-label='Fotos publicadas']", title: "Aún no hay fotos en la galería", action: "Subir la primera foto" },
  { route: "/sponsors", scope: "[aria-label='Logos cargados']", title: "Aún no hay patrocinadores cargados", action: "Subir el primer logo" },
  { route: "/admin/reportes-error", scope: "main", title: "Aún no hay reportes de error", action: null },
  { route: "/discounts", scope: "main", title: "Sin descuentos en el catálogo", action: "Crear primer descuento" },
  { route: "/attendance", scope: "main", title: "No hay listas en este período", action: null },
] as const;

test.describe("Empty states (T14C)", () => {
  for (const viewport of [DESKTOP, PHONE]) {
    for (const screen of SCREENS) {
      test(`RC1: ${screen.route} is one compact block at ${viewport.width}px`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await signInAsAdmin(page);
        await page.goto(screen.route);

        const title = page.getByText(screen.title, { exact: true });
        await expect(title).toBeVisible({ timeout: 20_000 });

        // No placeholder scaffolding: dashed tiles or skeleton rows under the statement.
        await expect(page.locator("main [data-testid$='ghost-rows'], main [data-testid='empty-grid-tiles']")).toHaveCount(0);
        await expect(page.locator(`${screen.scope} [class*='border-dashed']`)).toHaveCount(0);

        // The statement itself is short: icon + two lines + action, wrapped on a phone.
        const block = title.locator("xpath=ancestor::*[contains(@class,'flex-wrap')][1]");
        const box = (await block.boundingBox())!;
        expect(box.height).toBeLessThanOrEqual(viewport === PHONE ? 220 : 110);

        if (screen.action) {
          await expect(page.getByRole("button", { name: screen.action })).toBeVisible();
        }
        await noHorizontalOverflow(page);
      });
    }
  }

  test("RC1: the galería action hands over to the upload form's file picker", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signInAsAdmin(page);
    await page.goto("/galeria");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Subir la primera foto" }).click({ timeout: 20_000 });
    expect(await chooser).toBeTruthy();
  });

  test("RC17: /groups with no categories shows real zeros, not «Calculando…»", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await signInAsAdmin(page);
    await page.goto("/groups");

    await expect(page.getByText("No hay categorías configuradas")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Aún no hay jugadores activos.")).toBeVisible();
    await expect(page.getByText(/calculando/i)).toHaveCount(0);
  });
});
