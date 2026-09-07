/**
 * Lock — the Motto CTA paddle keeps its own dot.
 *
 * Originally reported from a live review of the hero (the hero drew a real
 * serve ball on top of a paddle whose base shape, `.landing-paddle::after`,
 * already drew a second one — a 13px white dot pinned to the top-right of
 * the face — so the hero read as two balls instead of one shot). The fix
 * scoped that dot away from the hero paddle only, on the reasoning that on
 * the Motto CTA paddle there is no other ball, and paddle-plus-ball is the
 * sport's own icon.
 *
 * The hero's own serve ball and paddle are gone; the two-ball hero concern
 * no longer applies. What survives here is the other half of that fix, the
 * one it exists to protect: the Motto paddle must still render its dot. If
 * someone later deletes `.landing-paddle::after` instead of leaving it
 * alone, this is what turns red.
 */
import { test, expect } from "@playwright/test";

test.describe("Motto keeps its dot", () => {
  test("the Motto paddle keeps the dot that is its only ball", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const motto = page.locator("[data-motto-paddle]");
    await motto.scrollIntoViewIfNeeded();
    await expect(motto).toBeVisible();

    const dot = await motto.evaluate((node) => {
      const style = getComputedStyle(node, "::after");
      return { content: style.content, width: style.width, height: style.height, radius: style.borderRadius };
    });

    expect(dot.content).not.toBe("none");
    expect(dot.width).toBe("13px");
    expect(dot.height).toBe("13px");
    expect(dot.radius.startsWith("50%")).toBe(true);
  });
});
