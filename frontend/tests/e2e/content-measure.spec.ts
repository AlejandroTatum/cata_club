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
  // The catch-all above answers every GET with `[]`, but the bell (issue #281)
  // reads `data.items` — an array breaks it. Last-registered wins, so this
  // specific route overrides the catch-all.
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/members", (route) =>
    fulfillJson(route, { accounts: [], personasCapped: false }),
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

/**
 * The rail, measured on the one admin screen that took it.
 *
 * #36 asked for the student/profile second column to be adopted by the admin
 * screens "whose content does not fill the height", on the theory that a rail
 * closes vertical emptiness. It does not — it moves content sideways, so it
 * only shortens a page that already had that content BELOW. What a rail is
 * actually worth on Descuentos is measured here instead: the edit form used to
 * render between the page header and the catalog, so opening it pushed the row
 * being edited down and out of view.
 *
 * A unit test can assert the form and the table are siblings. Only a browser
 * can say the table did not move.
 */
const DISCOUNTS = [
  { id: 1, nombre: "Beca municipal", porcentaje: "100.00", monto: null, activo: true },
  { id: 2, nombre: "Convenio empresa", porcentaje: null, monto: "5.00", activo: true },
  { id: 3, nombre: "Hermanos", porcentaje: "15.00", monto: null, activo: true },
  { id: 4, nombre: "Pago anual", porcentaje: "10.00", monto: null, activo: false },
];

test.describe("the discounts rail", () => {
  test("opening the form does not move the catalog", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsAdmin(page);
    // Registered after `loginAsAdmin`'s catch-all, so it wins. Paginated
    // backend (issue #814): `fetchDescuentos` unwraps `{items, total, skip,
    // limit}`.
    await page.route("**/descuentos**", (route) =>
      fulfillJson(route, { items: DISCOUNTS, total: DISCOUNTS.length, skip: 0, limit: 200 }),
    );
    await page.goto("/discounts");

    const table = page.locator("table");
    await expect(table).toBeVisible();
    const before = await table.evaluate((el) => el.getBoundingClientRect().top);

    await page.getByRole("row", { name: /Beca municipal/ }).getByRole("button", { name: /editar/i }).click();
    await expect(page.getByLabel(/nombre/i)).toBeVisible();

    const after = await table.evaluate((el) => el.getBoundingClientRect().top);

    await testInfo.attach("catalog-top-before-after", {
      body: `${Math.round(before)} → ${Math.round(after)}`,
      contentType: "text/plain",
    });

    // Exactly, not approximately: the form is a sibling column, so there is no
    // mechanism by which the table could shift at all.
    expect(Math.round(after)).toBe(Math.round(before));
  });
});

/**
 * The login brand measure, measured (#42).
 *
 * The coal panel read as empty on a large monitor because the brand block was
 * capped in `ch` — a unit that resolves against the element's own font-size and
 * so answers the same number at every viewport. The panel grew, the block did
 * not: 440px wide at 1440, at 1920 and at 2560, i.e. 58.7% -> 44.0% -> 32.9%
 * of the panel it sits in.
 *
 * A unit test can pin the classes that produce a fluid cap. Only a browser can
 * say what the block MEASURES and how many lines the motto sets on, which are
 * the two things the issue's acceptance criteria are written in — and the two
 * that pull against each other, since a wider measure is what eventually
 * collapses a three-line motto to one.
 */
const AUTH_VIEWPORTS = [1440, 1920, 2560];

/** The rendered width of the element carrying `testId`, in CSS pixels. */
async function widthOf(page: Page, testId: string): Promise<number> {
  const width = await page
    .locator(`[data-testid="${testId}"]`)
    .evaluate((el) => el.getBoundingClientRect().width);
  return Math.round(width);
}

/** Distinct line boxes of an element's text, counted off its client rects. */
async function countLines(page: Page, testId: string): Promise<number> {
  return page.locator(`[data-testid="${testId}"]`).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops = new Set<number>();
    for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
    return tops.size;
  });
}

test.describe("the login brand measure", () => {
  test("grows the brand block with the panel and keeps the motto at 2-3 lines", async ({
    page,
  }, testInfo) => {
    const measured: { width: number; panel: number; cluster: number; lines: number }[] = [];

    for (const width of AUTH_VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/login");
      await expect(page.getByTestId("auth-brand-cluster")).toBeVisible({ timeout: 20_000 });
      // The measure is `ch`-adjacent and the headline is 46px: an unloaded
      // fallback face would measure something the shipped screen never shows.
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      measured.push({
        width,
        panel: await widthOf(page, "auth-panel-dark"),
        cluster: await widthOf(page, "auth-brand-cluster"),
        lines: await countLines(page, "auth-headline"),
      });
    }

    // Recorded, not only asserted — same contract as the content column above:
    // the next person to touch this measure should be able to read what it was.
    await testInfo.attach("brand-cluster-occupancy", {
      body: measured
        .map(
          (m) =>
            `${m.width}: panel ${m.panel} / cluster ${m.cluster} = ` +
            `${((m.cluster / m.panel) * 100).toFixed(1)}%, motto on ${m.lines} lines`,
        )
        .join("\n"),
      contentType: "text/plain",
    });

    for (const m of measured) {
      // The acceptance criterion, in its own words: the motto never drops below
      // two lines and never passes three. Both directions matter — one line is
      // no longer the centred brand block the panel is built around, and four
      // is the unreadable stack the issue opened on.
      expect(m.lines, `motto lines at ${m.width}`).toBeGreaterThanOrEqual(2);
      expect(m.lines, `motto lines at ${m.width}`).toBeLessThanOrEqual(3);
      // A stable share of the panel. The frozen cap fell to 32.9% at 2560;
      // half the panel is a floor with room under every measured number
      // (61.2 / 63.9 / 52.7) rather than a restatement of one of them.
      expect(m.cluster / m.panel, `cluster share at ${m.width}`).toBeGreaterThan(0.5);
    }

    // The defect itself, stated as the one thing a frozen cap cannot do. This
    // fails on the old code no matter what the bounds are, because 440px at
    // 1440 and 440px at 1920 are the same number.
    const [at1440, at1920] = measured;
    expect(at1920.panel).toBeGreaterThan(at1440.panel);
    expect(at1920.cluster).toBeGreaterThan(at1440.cluster);
  });

  for (const width of [1440, 1920, 390]) {
    test(`renders the auth composition at ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.goto("/login");
      await expect(page.getByTestId("auth-brand-cluster")).toBeVisible({ timeout: 20_000 });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));

      // The capture the issue asks for at each of its three viewports, kept as
      // an artifact rather than a committed baseline: this screen is still
      // being composed, and a byte-exact snapshot would fail on every hue.
      await testInfo.attach(`login-${width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });

      // What IS asserted at every width: the composition never scrolls
      // sideways. A percentage measure inside a flex panel is exactly the shape
      // of change that overflows a narrow one.
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflows).toBe(false);
    });
  }
});
