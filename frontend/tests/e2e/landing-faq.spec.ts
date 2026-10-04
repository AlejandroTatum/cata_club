/**
 * Landing FAQ as a card accordion (QA4 follow-up): every question and its
 * answer live inside ONE card, and no answer is ever clipped.
 *
 * jsdom performs no layout, so "the text is not cut off" can only be proven in
 * a browser: for each viewport the owner reads the page at, every item is
 * opened and its answer must sit inside the item's own box, with nothing
 * scrolling or clipping inside the item.
 */
import { expect, test, type Route } from "@playwright/test";

const VIEWPORTS = [
  { name: "desktop 1440", width: 1440, height: 900 },
  { name: "phone 412", width: 412, height: 900 },
  { name: "phone 360", width: 360, height: 800 },
];

for (const vp of VIEWPORTS) {
  test(`FAQ answers read inside their own card, unclipped, at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.route("**/api/schedules", (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("/");

    const items = page.locator("#preguntas .landing-faq-list details");
    await expect(items).toHaveCount(3);

    for (let index = 0; index < 3; index += 1) {
      const item = items.nth(index);
      await item.scrollIntoViewIfNeeded();
      await item.locator("summary").click();
      await expect(item).toHaveJSProperty("open", true);
      const answer = item.locator("p");
      await expect(answer).toBeVisible();

      const geometry = await item.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const answerBox = (node.querySelector("p") as HTMLElement).getBoundingClientRect();
        const style = getComputedStyle(node);
        const answerStyle = getComputedStyle(node.querySelector("p") as HTMLElement);
        const summaryAfter = getComputedStyle(node.querySelector("summary") as HTMLElement, "::after");
        return {
          answerInside: answerBox.top >= box.top && answerBox.bottom <= box.bottom + 0.5 && answerBox.left >= box.left && answerBox.right <= box.right + 0.5,
          clipped: node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1,
          answerClipped: (node.querySelector("p") as HTMLElement).scrollHeight > (node.querySelector("p") as HTMLElement).clientHeight + 1,
          answerOverflow: answerStyle.overflow,
          answerMaxHeight: answerStyle.maxHeight,
          radius: parseFloat(style.borderTopLeftRadius),
          background: style.backgroundColor,
          borderWidth: parseFloat(style.borderTopWidth),
          affordance: summaryAfter.content,
        };
      });

      expect(geometry.answerInside, `answer ${index} sits inside its card`).toBe(true);
      expect(geometry.clipped, `card ${index} does not clip`).toBe(false);
      expect(geometry.answerClipped, `answer ${index} is not clipped`).toBe(false);
      expect(geometry.answerMaxHeight, "no max-height trick on the answer").toBe("none");
      expect(geometry.radius, "item is a rounded card").toBeGreaterThan(0);
      expect(geometry.borderWidth, "item has a visible edge").toBeGreaterThan(0);
      expect(geometry.background, "item is an opaque card").not.toBe("rgba(0, 0, 0, 0)");
      expect(geometry.affordance, "summary shows an open/close indicator").not.toMatch(/^(none|normal)$/);
    }

    // No horizontal page scroll, whatever the card widths do.
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowX).toBeLessThanOrEqual(0);
  });
}
