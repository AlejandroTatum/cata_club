/**
 * The admin sidebar shows every destination without a scrollbar of its own.
 *
 * Owner feedback on the shell (S5): "aca no quiero scrolleaer en la barra".
 * The admin is the role with the most rail items, so if this rail fits, every
 * other role's does. Ayuda, Perfil and Cerrar sesión moved into the account
 * menu the user card opens — checked here too, because that is what freed the
 * room.
 *
 * Like `admin-smoke.spec.ts`, this intercepts the same-origin BFF routes: the
 * subject is layout, not the backend.
 */

import { test, expect, type Page, type Route } from "@playwright/test";

const MOCK_SESSION = {
  user: {
    id: "1",
    name: "Admin Demo",
    email: "admin@cataclub.com",
    role: "admin" as const,
    representanteId: null,
  },
  roles: ["ADMINISTRADOR"],
  loggedInAt: new Date().toISOString(),
};

// Syntactically plausible JWT for middleware's cookie-presence check; never real.
const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "access_token", value: MOCK_ACCESS_TOKEN, url: "http://127.0.0.1" },
  ]);
  await page.route("**/api/**", (route: Route) =>
    route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {}),
  );
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/payments*", (route: Route) => fulfillJson(route, { items: [], total: 0 }));
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, MOCK_SESSION));
}

const DESKTOPS = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

test.describe("Admin sidebar without its own scrollbar", () => {
  for (const viewport of DESKTOPS) {
    test(`nav does not overflow vertically at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signInAsAdmin(page);
      await page.goto("/dashboard");

      const nav = page.getByRole("navigation", { name: "Navegación principal" });
      await expect(nav).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("link", { name: "Errores reportados" })).toBeVisible();

      const metrics = await nav.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }));
      expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
      await expect(nav).toHaveAttribute("data-more-below", "false");

      // Every item keeps the 40px touch row.
      const heights = await nav.getByRole("link").evaluateAll((links) =>
        links.map((link) => link.getBoundingClientRect().height),
      );
      expect(heights.length).toBeGreaterThan(8);
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(40);
    });
  }

  test("account menu holds Ayuda, Perfil and Cerrar sesión; Escape closes it and returns focus", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await signInAsAdmin(page);
    await page.goto("/dashboard");

    const trigger = page.getByRole("button", { name: /menú de cuenta de/i });
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("dialog", { name: "Menú de cuenta" });
    await expect(menu.getByRole("link", { name: "Perfil" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Ayuda" })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});
