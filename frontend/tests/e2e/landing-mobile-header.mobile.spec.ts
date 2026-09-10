/**
 * Two defects reported from a real phone (~390 CSS px wide), neither visible
 * to jsdom: it performs no real layout, so it can assert a class was written
 * but never that the navbar actually wraps to a second row or that a number
 * actually breaks across two lines. Only a layout engine answers those,
 * which is `mobile-chromium`'s reason to carry this spec at all — the same
 * reasoning `landing-schedule-card.mobile.spec.ts` gives for issue #988.
 *
 * `mobile-chromium` runs `devices["Pixel 7"]` (412×839, `isMobile: true`,
 * `hasTouch: true`), so no viewport override is needed for the base case —
 * a narrower desktop window would not exercise the `(max-width: 768px)`
 * layout with a real coarse pointer.
 */
import { expect, test, type Route } from "@playwright/test";

// The exact case from the bug report: "20:00 – 21:1" wrapping "5" onto its
// own line. One category is enough — the schedule-time assertions below
// only ever look at the FIRST slot's rendered hours.
const SCHEDULE_PAYLOAD = [
  {
    category: "Competitivo de alto rendimiento", ages: "Selección",
    blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "20:00", endTime: "21:15" }],
  },
];

async function mockSchedules(page: import("@playwright/test").Page): Promise<void> {
  await page.route("**/api/schedules", (route: Route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SCHEDULE_PAYLOAD) }),
  );
}

/**
 * Every `.landing-schedule-digit` inside one `.landing-schedule-time-part`
 * shares the same `y` (never split by a wrap) and the part's own box height
 * stays within a single line — the assertion that catches "21:1" / "5"
 * landing on two lines even though each individual digit box looks fine.
 */
async function expectTimePartsUnbroken(page: import("@playwright/test").Page): Promise<void> {
  const parts = page.locator(".landing-schedule-time-part");
  await expect(parts).toHaveCount(2);
  const partCount = await parts.count();

  for (let index = 0; index < partCount; index += 1) {
    const part = parts.nth(index);
    const partBox = await part.boundingBox();
    expect(partBox, `part ${index} box`).not.toBeNull();

    const digitYs = await part.locator(".landing-schedule-digit").evaluateAll((digits) =>
      digits.map((digit) => digit.getBoundingClientRect().y),
    );
    expect(digitYs.length, `part ${index} digit count`).toBeGreaterThan(0);
    digitYs.forEach((y, digitIndex) => {
      expect(y, `part ${index} digit ${digitIndex} y vs first`).toBeCloseTo(digitYs[0], 0);
    });

    const digitHeights = await part.locator(".landing-schedule-digit").evaluateAll((digits) =>
      digits.map((digit) => digit.getBoundingClientRect().height),
    );
    const maxDigitHeight = Math.max(...digitHeights);
    // A part whose own box is taller than a single digit's own line height
    // wrapped internally — that is exactly the defect this lock exists for.
    expect(partBox!.height, `part ${index} height vs a single digit's own line`).toBeLessThanOrEqual(maxDigitHeight + 1);
  }
}

test.describe("Landing header and schedule hours on a real mobile engine", () => {
  // The digit-roll stagger animation (35ms per character) puts individual
  // digits at different transform states for ~700ms after mount — real but
  // irrelevant to the wrap defects this spec locks down, and it makes the
  // per-digit `y` comparisons below flaky. Reduced motion withholds
  // `ScheduleSelector`'s own `--animate` class, so digits render at their
  // final position immediately.
  test.use({ reducedMotion: "reduce" });

  test("the navbar link row never wraps to a second row and stays a tappable, page-safe scroll strip", async ({ page }) => {
    await mockSchedules(page);
    await page.goto("/");

    const links = page.locator(".landing-nav-links a");
    await expect(links).toHaveCount(6);

    // One row: every link shares the same top edge. This is the assertion
    // that goes RED on today's code — "Contacto" drops onto a second row.
    const boxes = await links.evaluateAll((elements) => elements.map((el) => el.getBoundingClientRect().y));
    boxes.forEach((y, index) => {
      expect(y, `link ${index} y vs first`).toBeCloseTo(boxes[0], 0);
    });

    // The strip genuinely overflows its own track — six links need ~426px
    // at this padding/font-size and the phone's content width is ~358px —
    // while the page itself never gains horizontal scroll: the overflow
    // lives inside the strip's own scroll container, never on the body.
    const nav = page.locator(".landing-nav-links");
    const stripOverflow = await nav.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(stripOverflow).toBeGreaterThan(0);
    const bodyOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(bodyOverflow).toBeLessThanOrEqual(0);

    // Every chip still meets the 44px pointer-target floor.
    const linkCount = await links.count();
    for (let index = 0; index < linkCount; index += 1) {
      const box = await links.nth(index).boundingBox();
      expect(box, `link ${index} box`).not.toBeNull();
      expect(box!.height, `link ${index} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test("the schedule hours never break mid-number and stay inside the card", async ({ page }) => {
    await mockSchedules(page);
    await page.goto("/");

    const card = page.locator(".landing-schedule-card");
    await expect(card).toBeVisible();
    const time = page.locator(".landing-schedule-time");
    await expect(time).toBeVisible();
    await expect(time).toHaveText("20:00–21:15");

    await expectTimePartsUnbroken(page);

    // The whole range fits on one line: a wrapped range paints as more than
    // one client rect (one per visual line) for its own box.
    const rectCount = await time.evaluate((el) => el.getClientRects().length);
    expect(rectCount).toBe(1);

    const timeBox = await time.boundingBox();
    const cardBox = await card.boundingBox();
    expect(timeBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    expect(timeBox!.x + timeBox!.width, "time right edge vs card right edge").toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5);
  });

  // The difference between "fits today" and "can never break a number": at
  // an even narrower width the range itself is allowed to wrap onto two
  // lines (`.landing-schedule-time` keeps `flex-wrap: wrap`), but neither
  // half may ever split across that wrap.
  test("at 360px the range may wrap as a whole, but never splits a number", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await mockSchedules(page);
    await page.goto("/");

    const time = page.locator(".landing-schedule-time");
    await expect(time).toBeVisible();

    await expectTimePartsUnbroken(page);
  });

  // Issue found on the nav strip once it became a real scroll container:
  // `overflow-x: auto` computes `overflow-y` to `auto` too, so anything
  // painted outside a chip's own border box — the focus ring — got clipped
  // top and bottom by the strip's own scroll box. A permanent right-edge
  // fade had the same "looks cut off" symptom on the last chip, measured by
  // scrolling the strip to its own end and finding the final letter still
  // dimmed with nothing left to scroll to.
  test("never clips a focused nav link's ring, and never fades the strip's own edge", async ({ page }) => {
    await mockSchedules(page);
    await page.goto("/");

    // No permanent edge fade: the strip's own box declares no mask, at any
    // scroll position — so the last chip is never dimmed once it is the
    // last thing left to scroll to.
    const nav = page.locator(".landing-nav-links");
    const maskImages = await nav.evaluate((el) => {
      const style = getComputedStyle(el);
      return { maskImage: style.maskImage, webkitMaskImage: style.getPropertyValue("-webkit-mask-image") };
    });
    expect(maskImages.maskImage, "mask-image").toBe("none");
    expect(maskImages.webkitMaskImage || "none", "-webkit-mask-image").toBe("none");

    // Reach the first nav link with a REAL keyboard, the same way a visitor
    // tabbing through the page would — `:focus-visible` only engages this
    // way, never through a plain programmatic `.focus()`.
    await page.locator(".landing-logo").focus();
    await page.keyboard.press("Tab");

    const ring = await page.evaluate(() => {
      const link = document.activeElement as HTMLElement | null;
      const strip = document.querySelector(".landing-nav-links") as HTMLElement;
      if (!link || !strip.contains(link)) return null;

      const style = getComputedStyle(link);
      const outlineWidth = parseFloat(style.outlineWidth) || 0;
      const outlineOffset = parseFloat(style.outlineOffset) || 0;
      // How far the ring's own outer edge extends past the link's border
      // edge. Negative or zero means the ring stays inside the border box.
      const ringExtent = outlineWidth + outlineOffset;

      const linkRect = link.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      return {
        isFocusVisible: link.matches(":focus-visible"),
        ringExtent,
        ringTop: linkRect.top - ringExtent,
        ringBottom: linkRect.bottom + ringExtent,
        ringLeft: linkRect.left - ringExtent,
        ringRight: linkRect.right + ringExtent,
        stripTop: stripRect.top,
        stripBottom: stripRect.bottom,
        stripLeft: stripRect.left,
        stripRight: stripRect.right,
      };
    });

    expect(ring, "a nav link inside the strip is the active element").not.toBeNull();
    expect(ring!.isFocusVisible, "the focused link reports :focus-visible").toBe(true);

    // The whole ring — border edge plus whatever the outline extends past
    // it — stays inside the strip's own scroll box on every side. This is
    // the assertion that goes RED against the committed `outline-offset:
    // 4px`: the ring's top/bottom sit 7px outside the link, clipped by the
    // strip's own `overflow-y: auto`.
    expect(ring!.ringTop, "ring top vs strip top").toBeGreaterThanOrEqual(ring!.stripTop - 0.5);
    expect(ring!.ringBottom, "ring bottom vs strip bottom").toBeLessThanOrEqual(ring!.stripBottom + 0.5);
    expect(ring!.ringLeft, "ring left vs strip left").toBeGreaterThanOrEqual(ring!.stripLeft - 0.5);
    expect(ring!.ringRight, "ring right vs strip right").toBeLessThanOrEqual(ring!.stripRight + 0.5);
  });
});
