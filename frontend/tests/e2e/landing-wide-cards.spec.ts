/**
 * Wide-card layouts on the landing (#1657, #1658) and the two sponsors strips
 * (#1659), measured in a real layout engine: jsdom cannot tell a centred tile
 * from a left-aligned one.
 */
import { expect, test, type Route } from "@playwright/test";

const SCHEDULE = (count: number): unknown[] => Array.from({ length: count }, (_, index) => ({
  category: `Categoría ${index + 1}`, ages: "5 a 10 años",
  blocks: [{ days: ["LUNES", "MIERCOLES"], startTime: "15:00", endTime: "16:00" }],
}));
const TARIFAS = (count: number): unknown[] => Array.from({ length: count }, (_, index) => ({
  categoria: `Plan ${index + 1}`, precio: `${25 + index}.00`,
}));
const SPONSORS = [{ id: 1, nombre: "Municipio", logoUrl: "/crest.png" }];

async function mock(page: import("@playwright/test").Page, opts: { categories: number; tarifas: number; sponsors?: unknown[] }): Promise<{ sponsorCalls: () => number }> {
  let sponsorCalls = 0;
  await page.route("**/api/schedules", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SCHEDULE(opts.categories)) }));
  await page.route("**/api/membresias/tarifas", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TARIFAS(opts.tarifas)) }));
  await page.route("**/api/sponsors", (route: Route) => {
    sponsorCalls += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(opts.sponsors ?? []) });
  });
  return { sponsorCalls: (): number => sponsorCalls };
}

test.describe("landing wide cards (desktop)", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the help tile alone on its row is centred with larger type; with other counts it keeps the tile look", async ({ page }) => {
    await mock(page, { categories: 3, tarifas: 3 });
    await page.goto("/");
    const help = page.locator(".landing-schedule-help");
    await expect(help).toBeVisible();
    await expect(help.locator("h3")).toHaveCSS("text-align", "center");
    await expect(help.locator("h3")).toHaveCSS("font-size", "40px");
    const tile = (await help.boundingBox())!;
    const link = (await help.locator("a").boundingBox())!;
    expect(Math.abs(link.x + link.width / 2 - (tile.x + tile.width / 2))).toBeLessThan(2);
    const heading = (await help.locator("h3").boundingBox())!;
    expect(Math.abs(heading.x + heading.width / 2 - (tile.x + tile.width / 2))).toBeLessThan(2);
    await help.scrollIntoViewIfNeeded();
    await page.unroute("**/api/schedules");
    await page.route("**/api/schedules", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SCHEDULE(4)) }));
    await page.reload();
    await expect(page.locator(".landing-schedule-help h3")).toHaveCSS("font-size", "28px");
    await expect(page.locator(".landing-schedule-help a")).toHaveCSS("align-self", "flex-start");
  });

  for (const count of [1, 2, 3]) {
    test(`${count} tariff(s): cards ${count < 3 ? "are capped and centred" : "keep the full-width grid"}`, async ({ page }) => {
      await mock(page, { categories: 3, tarifas: count });
      await page.goto("/");
      const cards = page.locator("#mensualidad .landing-price");
      await expect(cards).toHaveCount(count);
      const widths = await cards.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
      for (const width of widths) {
        if (count < 3) expect(width).toBeLessThanOrEqual(420);
        else expect(width).toBeGreaterThan(300);
      }
    });
  }

  test("two sponsor strips share one /api/sponsors request and carry unique ids", async ({ page }) => {
    const calls = await mock(page, { categories: 3, tarifas: 2, sponsors: SPONSORS });
    await page.goto("/");
    await expect(page.locator("#patrocinadores-destacados")).toBeVisible();
    await expect(page.locator("#patrocinadores")).toBeVisible();
    expect(calls.sponsorCalls()).toBe(1);
    const ids = await page.locator("[id]").evaluateAll((nodes) => nodes.map((node) => node.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("no strip renders without sponsors", async ({ page }) => {
    await mock(page, { categories: 3, tarifas: 2 });
    await page.goto("/");
    // The roster resolved empty (footer strip says so) and the hero rendered,
    // so the missing highlight strip is a decision, not a page that never loaded.
    await expect(page.locator("#inicio")).toBeVisible();
    await expect(page.locator("#patrocinadores")).toContainText("Pronto anunciaremos a nuestros patrocinadores");
    await expect(page.locator("#patrocinadores-destacados")).toHaveCount(0);
  });
});

test.describe("landing wide cards (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile keeps the single-column look and no horizontal scroll", async ({ page }) => {
    await mock(page, { categories: 3, tarifas: 2, sponsors: SPONSORS });
    await page.goto("/");
    await expect(page.locator(".landing-schedule-help h3")).toHaveCSS("font-size", "28px");
    const cards = page.locator("#mensualidad .landing-price");
    await expect(cards).toHaveCount(2);
    const width = await cards.first().evaluate((node) => node.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
