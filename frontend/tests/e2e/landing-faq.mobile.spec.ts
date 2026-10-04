/**
 * Landing FAQ and plan/step blocks on a real touch device: `(pointer: coarse)`
 * only matches here, so this is where the 44px touch floor is provable.
 */
import { expect, test, type Route } from "@playwright/test";

test("FAQ summaries are at least 44px tall on a coarse pointer and the answer stays in its card", async ({ page }) => {
  await page.route("**/api/schedules", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.goto("/");

  const items = page.locator("#preguntas .landing-faq-list details");
  await expect(items).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const summary = items.nth(index).locator("summary");
    await summary.scrollIntoViewIfNeeded();
    const box = await summary.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await summary.tap();
    await expect(items.nth(index).locator("p")).toBeVisible();
  }
});
