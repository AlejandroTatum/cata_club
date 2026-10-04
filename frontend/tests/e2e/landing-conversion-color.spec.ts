/**
 * «Mensualidad» and «Tres pasos» carry the brand palette (red, yellow, coal):
 * plan cards and step badges must not all share one flat colour. Colours are
 * read from the browser, so a token that failed to resolve shows up here.
 */
import { expect, test, type Route } from "@playwright/test";

const TARIFAS = [
  { categoria: "Plan Uno", precio: "25.00" },
  { categoria: "Plan Dos", precio: "30.00" },
  { categoria: "Plan Tres", precio: "35.00" },
];

test("plan cards and step badges use three different brand colours", async ({ page }) => {
  await page.route("**/api/membresias/tarifas", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(TARIFAS) }));
  await page.route("**/api/schedules", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/");

  const cards = page.locator("#mensualidad .landing-price");
  await expect(cards).toHaveCount(3);
  const cardColors = await cards.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
  expect(new Set(cardColors).size).toBe(3);
  expect(cardColors).not.toContain("rgba(0, 0, 0, 0)");

  const badgeColors = await page.locator("#como-empezar .landing-steps-list li").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node, "::before").backgroundColor));
  expect(badgeColors).toHaveLength(3);
  expect(new Set(badgeColors).size).toBe(3);

  // The price stays the visual anchor: larger than the plan name.
  const sizes = await cards.first().evaluate((node) => ({
    name: parseFloat(getComputedStyle(node.querySelector(".landing-price-name") as Element).fontSize),
    amount: parseFloat(getComputedStyle(node.querySelector(".landing-price-amount") as Element).fontSize),
  }));
  expect(sizes.amount).toBeGreaterThanOrEqual(sizes.name * 3);
});
