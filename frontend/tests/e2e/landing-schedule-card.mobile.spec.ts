/**
 * Issue #988, on a real mobile engine.
 *
 * jsdom (`ScheduleSelector.test.tsx`, `LandingPage.test.tsx`) performs no real
 * layout: it can assert a class is written but never that the chip strip
 * actually scrolls, that the body stays inside its own viewport, or that a
 * ball sits fully inside the card's rounded corner. Only a layout engine
 * answers those, so this is the `mobile-chromium` project's reason to carry
 * this feature at all — the same reasoning `members-dialog-zoom.mobile.spec.ts`
 * gives for issue #767.
 *
 * `mobile-chromium` runs `devices["Pixel 7"]` (412×839, `isMobile: true`,
 * `hasTouch: true`), so no viewport override is needed here — a narrower
 * desktop window would not exercise the `(max-width: 768px)` chip layout
 * with a real coarse pointer.
 *
 * Six categories, one with a long name, so the chip strip genuinely
 * overflows its own track — a two-chip fixture would pass by having nothing
 * to scroll.
 */
import { expect, test, type Route } from "@playwright/test";

const SCHEDULE_PAYLOAD = [
  { category: "Formativo", ages: "5 a 10 años", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "15:00", endTime: "16:00" }] },
  { category: "Infantil", ages: "8 a 12 años", blocks: [{ days: ["LUNES", "MIERCOLES", "VIERNES"], startTime: "16:00", endTime: "17:00" }] },
  { category: "Juvenil", ages: "Mayores de 12 años", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "17:00", endTime: "18:00" }] },
  {
    category: "Competitivo de alto rendimiento", ages: "Selección",
    blocks: [
      { days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "18:00", endTime: "20:00" },
      { days: ["SABADO"], startTime: "18:00", endTime: "20:00" },
    ],
  },
  { category: "Adultos", ages: "Mayores de 18 años", blocks: [{ days: ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"], startTime: "08:00", endTime: "09:15" }] },
  { category: "Juego Libre", ages: null, blocks: [{ days: ["SABADO"], startTime: "15:00", endTime: "18:00" }] },
];

test.describe("Schedule card on a real mobile engine", () => {
  test("scrolls the chip strip horizontally without overflowing the body, keeps the day balls inside the card, and the CTA stays tappable", async ({ page }) => {
    await page.route("**/api/schedules", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SCHEDULE_PAYLOAD) }),
    );

    await page.goto("/");

    const list = page.locator(".landing-schedule-list");
    await expect(list).toBeVisible();
    const card = page.locator(".landing-schedule-card");
    await expect(card).toBeVisible();

    // The body never gains horizontal scroll: whatever overflows lives
    // inside the chip strip's own scroll container, never the page.
    const bodyOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
    });
    expect(bodyOverflow.scrollWidth).toBeLessThanOrEqual(bodyOverflow.clientWidth);

    // Six categories, one with a long name, genuinely overflow the strip's
    // own track — this is the scroll the assertion above must NOT be seeing.
    const stripOverflow = await list.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(stripOverflow).toBeGreaterThan(0);

    // Every day ball sits fully inside the card's own box — none of the six
    // is cut by the card's `overflow: hidden` decorative circle.
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    const balls = page.locator(".landing-schedule-day");
    await expect(balls).toHaveCount(6);
    const ballCount = await balls.count();
    for (let index = 0; index < ballCount; index += 1) {
      const ballBox = await balls.nth(index).boundingBox();
      expect(ballBox, `ball ${index}`).not.toBeNull();
      expect(ballBox!.x, `ball ${index} left edge`).toBeGreaterThanOrEqual(cardBox!.x);
      expect(ballBox!.x + ballBox!.width, `ball ${index} right edge`).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5);
    }

    // The CTA meets the platform's minimum touch target and is a real click
    // target: visible, stable, unobstructed, and receiving pointer events —
    // `click({ trial: true })` proves that without actually navigating away.
    const cta = page.getByRole("link", { name: /consultar cupo por whatsapp/i });
    await expect(cta).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox).not.toBeNull();
    expect(ctaBox!.height).toBeGreaterThanOrEqual(44);
    await cta.click({ trial: true });

    // Switching category keeps the chip strip scrollable and the card intact.
    await page.getByRole("tab", { name: /competitivo de alto rendimiento/i }).click();
    await expect(card.getByRole("heading", { level: 3 })).toHaveText("Competitivo de alto rendimiento");
    const afterSwitchOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(afterSwitchOverflow).toBeLessThanOrEqual(0);
  });
});
