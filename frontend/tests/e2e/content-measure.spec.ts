/**
 * The content measure, measured.
 *
 * The authenticated app shipped with NO content max-width, and not by
 * omission: the root layout declares one and `globals.css:7-12` cancels it for
 * every route that draws a shell. Nothing stopped a table or a row of four stat
 * tiles from growing as wide as the glass, so a 116px-tall tile holding a 32px
 * number stretched past 400px on a large monitor.
 *
 * A unit test can assert that the cap CLASS is on the right element. Only a
 * browser can say what the column actually measures at a given viewport, which
 * is why this file exists and why it records the numbers rather than only
 * asserting a bound: the next person to change the shell should be able to read
 * what it used to be.
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

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
const AUTHENTICATED_HEADERS = {
  "set-cookie": `access_token=${MOCK_ACCESS_TOKEN}; Path=/; HttpOnly; SameSite=Lax`,
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function loginAsAdmin(page: Page): Promise<void> {
  let authenticated = false;

  await page.route("**/api/**", (route) => {
    if (route.request().method() === "GET") return fulfillJson(route, []);
    return fulfillJson(route, {});
  });
  await page.route("**/api/members", (route) =>
    fulfillJson(route, { accounts: [], niveles: [], personasCapped: false }),
  );
  await page.route("**/api/auth/session", (route: Route): Promise<void> =>
    authenticated
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: AUTHENTICATED_HEADERS,
          body: JSON.stringify(MOCK_SESSION),
        })
      : route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/auth/login", (route: Route): Promise<void> => {
    authenticated = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: AUTHENTICATED_HEADERS,
      body: JSON.stringify(MOCK_SESSION),
    });
  });

  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/correo electrónico/i).fill("admin@cataclub.com");
  await page.getByRole("textbox", { name: /contraseña/i }).fill("admin123");
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
}

/**
 * `max-w-8xl` (88rem) minus the content column's own 26px of padding either
 * side. The cap is on the column that holds the utility row AND the page, so
 * `<main>` measures the cap less that padding.
 */
const MEASURE = 1408;
const GUTTER = 26 * 2;
const CAPPED_MAIN = MEASURE - GUTTER;

/** The rail the content sits beside — `.side` in `_sistema.css`. */
const SIDEBAR = 236;

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

test.describe("content measure", () => {
  for (const viewport of VIEWPORTS) {
    test(`caps the content column at ${viewport.width}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await loginAsAdmin(page);
      await page.goto("/members");

      const main = page.locator("main");
      await expect(main).toBeVisible();

      const width = await main.evaluate((el) => el.getBoundingClientRect().width);

      // Recorded, not just asserted: these are the numbers the shell produces
      // today, and the reason a future change to the measure is a decision
      // rather than an accident.
      await testInfo.attach(`main-width-at-${viewport.width}`, {
        body: String(Math.round(width)),
        contentType: "text/plain",
      });

      // Below the cap the column is simply what the viewport leaves it; above
      // it, the cap is what decides. Both directions are asserted so a cap that
      // silently stopped applying would fail here.
      const uncapped = viewport.width - SIDEBAR - GUTTER;
      expect(Math.round(width)).toBe(Math.min(uncapped, CAPPED_MAIN));
      expect(width).toBeLessThanOrEqual(CAPPED_MAIN);
    });

    test(`keeps a stat tile readable at ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await loginAsAdmin(page);
      await page.goto("/members");

      const tiles = page.locator("main .grid > *").first();
      await expect(tiles).toBeVisible();

      const tileWidth = await tiles.evaluate((el) => el.getBoundingClientRect().width);

      // The complaint this closes, in the issue's own words: "cajas de más de
      // 400px conteniendo un número de 32px". Four tiles across the capped
      // measure land near 330px, so 400 is a ceiling with room, not a
      // restatement of the current number.
      expect(tileWidth).toBeLessThan(400);
    });
  }
});
