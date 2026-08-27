/**
 * The tariff name column, measured — issues #660 and #677's root cause.
 *
 * `/tarifas` renders one `DataRow` per tariff below `sm`. Every group that
 * row trails with (price and modality chips, "Editar precio") is `flex-none`,
 * so before this lock existed the name — the only flexible item — absorbed
 * the entire squeeze: at 390px it measured a 50px column. Both shipped
 * symptoms came from that one number. `truncate` turned a 53-character name
 * into "M…" (#660); swapping in `break-words` (#677) kept the same 50px and
 * turned it into nine lines broken mid-syllable ("Competi/tivo").
 *
 * A unit test can only assert which class is on the element, and both of
 * those defects passed that bar with the class the page asked for. The
 * column's WIDTH is what was wrong, and only a browser measures width, which
 * is why this lock is an e2e spec and why it records the numbers rather than
 * only asserting a bound.
 *
 * One `page.goto` on purpose: this suite runs on 4-vCPU CI runners, where a
 * spec that navigates repeatedly is how a green PR leaves `main` red.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

/**
 * The 53-character name that first showed the column overflowing. It is a
 * fixture, not a database row: this spec serves `TARIFAS` below through
 * `page.route`, so it never reads the QA database. The QA seed once carried
 * this name under id 3 and no longer does — which is exactly why the case
 * lives here, where a reseed cannot take it away.
 */
const LONG_NAME = "Mensual Competitivo Avanzado Categoria Sub-18 Federados";

const TARIFAS = [
  { id: 3, categoria: LONG_NAME, precio: "33.00", modalidad: "MENSUAL" },
  { id: 1, categoria: "Mensual Infantil", precio: "25.00", modalidad: "MENSUAL" },
];

/**
 * The floor the row now reserves for the name is `basis-56` (224px). The
 * assertion is deliberately looser than the 324px the fixed layout produces:
 * what must never come back is a name column narrower than the words in it,
 * not one exact pixel count. Without the floor this measures 50.
 */
const MIN_NAME_COLUMN_PX = 240;

/** Nine lines was the defect. A 53-character name at this width needs two. */
const MAX_LINES = 3;

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockAdminRuntime(page: Page): Promise<void> {
  await page.context().addCookies([
    { name: "access_token", value: MOCK_ACCESS_TOKEN, url: E2E_BASE_URL },
  ]);
  // A catch-all first: the shell asks for more than this screen does, and an
  // unanswered call reaches the real BFF, fails, and logs the session out.
  await page.route("**/api/**", (route: Route) =>
    route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {}),
  );
  await page.route("**/api/auth/session", (route: Route) =>
    fulfillJson(route, {
      user: { id: "1", name: "Admin Demo", email: "admin@example.test", role: "admin", representanteId: null },
      roles: ["ADMINISTRADOR"],
      loggedInAt: "2026-07-21T00:00:00.000Z",
    }),
  );
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/membresias/tipos", (route: Route) => fulfillJson(route, TARIFAS));
}

test("a long tariff name keeps a readable column at 390px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdminRuntime(page);

  await page.goto("/tarifas");

  // Scoped to the mobile card list: the desktop `<table>` is in the DOM at
  // every width (CSS-hidden below `sm`) and carries the same name.
  const nameEl = page
    .locator('[data-testid="tarifas-cards"]')
    .getByText(LONG_NAME, { exact: true });
  await expect(nameEl).toBeVisible({ timeout: 20_000 });

  const measured = await nameEl.evaluate((el) => {
    const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
    return {
      clientWidth: el.clientWidth,
      textWidth: el.scrollWidth,
      lines: Math.round(el.scrollHeight / lineHeight),
      rowHeight: el.closest("li")?.getBoundingClientRect().height ?? -1,
    };
  });

  // Recorded, not just asserted: the next person to change this row should be
  // able to read what it used to measure.
  await testInfo.attach("tarifas-name-column-at-390", {
    body: JSON.stringify(measured),
    contentType: "application/json",
  });

  expect(measured.clientWidth).toBeGreaterThanOrEqual(MIN_NAME_COLUMN_PX);
  expect(measured.lines).toBeLessThanOrEqual(MAX_LINES);
  // Not truncated either: #660's "M…" must not come back as the cure for the
  // nine lines #677 left behind. The full string is what is on screen.
  expect(measured.textWidth).toBeLessThanOrEqual(measured.clientWidth);

  // The name winning the row must not cost the row its actions, nor push the
  // page sideways.
  const editar = page.getByRole("button", { name: /editar precio/i }).first();
  await expect(editar).toBeVisible();
  const box = await editar.boundingBox();
  expect(box).not.toBeNull();
  const topmost = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest("button")?.textContent?.trim() ?? "",
    [box!.x + box!.width / 2, box!.y + box!.height / 2],
  );
  expect(topmost).toBe("Editar precio");

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBe(overflow.innerWidth);
});
