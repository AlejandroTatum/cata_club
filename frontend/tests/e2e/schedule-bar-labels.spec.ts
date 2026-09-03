/**
 * Range labels on the schedule timeline bars — issue #872.
 *
 * jsdom never evaluates container queries (no real layout, so a bar's
 * rendered width is always 0 — see `ScheduleSelector.test.tsx`), so the
 * narrow-bar fallback can only be proven here, in a real browser, with real
 * bounding boxes. Two shapes are exercised on the same fixed payload:
 *
 *   - "Amplia": one wide block. Wide enough on desktop to hold the label
 *     inside the bar; narrow enough on a phone lane to force the fallback,
 *     which is the "en mobile" half of the issue.
 *   - "Angosta": two back-to-back 30-minute blocks against a wide shared day
 *     range (08:00–21:00), narrow on both viewports — the "barras estrechas"
 *     half, and the one case where two fallback labels sit in the same lane
 *     and must not grow into each other or into the neighbouring bar.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";

const SCHEDULE_PAYLOAD = [
  {
    category: "Amplia",
    blocks: [{ days: ["LUNES", "MIERCOLES", "VIERNES"], startTime: "08:00", endTime: "10:00" }],
  },
  {
    category: "Angosta",
    blocks: [
      { days: ["LUNES", "MIERCOLES", "VIERNES"], startTime: "20:00", endTime: "20:30" },
      { days: ["LUNES", "MIERCOLES", "VIERNES"], startTime: "20:30", endTime: "21:00" },
    ],
  },
];

async function gotoWithSchedules(page: Page, viewport: { width: number; height: number }): Promise<void> {
  await page.route("**/api/schedules", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SCHEDULE_PAYLOAD) }),
  );
  await page.setViewportSize(viewport);
  await page.goto("/");
  await expect(page.locator(".landing-sched")).toBeVisible();
}

/** A `boundingBox()` result, normalized to the edges `intersects` compares. */
type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };

/** True when two boxes share any pixel — a strict corner touch does not count. */
function intersects(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function box(locator: Locator): Promise<Box | null> {
  const value = await locator.boundingBox();
  if (!value) return null;
  return {
    left: value.x,
    right: value.x + value.width,
    top: value.y,
    bottom: value.y + value.height,
    width: value.width,
    height: value.height,
  };
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

test.describe("Schedule timeline range labels", () => {
  for (const viewport of VIEWPORTS) {
    test(`shows the compact range without clipping or overlap on ${viewport.name}`, async ({ page }) => {
      await gotoWithSchedules(page, viewport);

      const tablist = page.getByRole("tablist", { name: "Categorías" });

      // "Amplia": a real bar and its label always render with a non-empty box.
      await tablist.getByRole("tab", { name: /amplia/i }).click();
      const anchoBar = page.locator(".landing-day-bar").first();
      const anchoLabel = anchoBar.locator(".landing-day-bar-label");
      await expect(anchoLabel).toHaveText("08:00–10:00");
      const anchoLabelBox = await box(anchoLabel);
      expect(anchoLabelBox, "wide bar's label has a real box").not.toBeNull();
      expect(anchoLabelBox?.width ?? 0).toBeGreaterThan(0);
      expect(anchoLabelBox?.height ?? 0).toBeGreaterThan(0);

      // "Angosta": two narrow, back-to-back bars. Neither label may clip to
      // zero, overlap the other label, or overlap the neighbouring bar.
      await tablist.getByRole("tab", { name: /angosta/i }).click();
      const bars = page.locator(".landing-day-bar");
      await expect(bars).toHaveCount(2);
      const labels = page.locator(".landing-day-bar-label");
      await expect(labels.nth(0)).toHaveText("20:00–20:30");
      await expect(labels.nth(1)).toHaveText("20:30–21:00");

      const [bar0, bar1] = [bars.nth(0), bars.nth(1)];
      const [label0, label1] = [
        bar0.locator(".landing-day-bar-label"),
        bar1.locator(".landing-day-bar-label"),
      ];
      const [bar0Box, bar1Box, label0Box, label1Box] = await Promise.all([
        box(bar0),
        box(bar1),
        box(label0),
        box(label1),
      ]);

      for (const [name, rect] of [
        ["bar0", bar0Box],
        ["bar1", bar1Box],
        ["label0", label0Box],
        ["label1", label1Box],
      ] as const) {
        expect(rect, `${name} has a real box at ${viewport.name}`).not.toBeNull();
        expect(rect?.width ?? 0, `${name} not clipped to zero width`).toBeGreaterThan(0);
      }

      expect(intersects(label0Box, label1Box), `the two fallback labels overlap at ${viewport.name}`).toBe(false);
      expect(intersects(label0Box, bar1Box), `label0 overlaps the neighbouring bar at ${viewport.name}`).toBe(false);
      expect(intersects(label1Box, bar0Box), `label1 overlaps the neighbouring bar at ${viewport.name}`).toBe(false);

      // Existing title/data attributes survive untouched (issue #872 adds to
      // the bar, it does not replace what was already there).
      await expect(bar0).toHaveAttribute("title", "Angosta · 20:00 – 20:30 · Lunes, Miércoles y Viernes");
      await expect(bar0).toHaveAttribute("aria-label", "Angosta · 20:00 – 20:30 · Lunes, Miércoles y Viernes");
    });
  }

  test("keeps the label inside the bar on a wide desktop lane and steps it outside on a narrow phone lane", async ({
    page,
  }) => {
    await gotoWithSchedules(page, { width: 1440, height: 900 });
    await page.getByRole("tablist", { name: "Categorías" }).getByRole("tab", { name: /amplia/i }).click();
    const bar = page.locator(".landing-day-bar").first();
    const label = bar.locator(".landing-day-bar-label");
    const [desktopBarBox, desktopLabelBox] = await Promise.all([box(bar), box(label)]);
    expect(desktopBarBox).not.toBeNull();
    expect(desktopLabelBox).not.toBeNull();
    // Inside placement: the label's box sits within the bar's own box.
    expect(desktopLabelBox!.left).toBeGreaterThanOrEqual(desktopBarBox!.left - 1);
    expect(desktopLabelBox!.right).toBeLessThanOrEqual(desktopBarBox!.right + 1);

    await gotoWithSchedules(page, { width: 390, height: 844 });
    await page.getByRole("tablist", { name: "Categorías" }).getByRole("tab", { name: /amplia/i }).click();
    const phoneBar = page.locator(".landing-day-bar").first();
    const phoneLabel = phoneBar.locator(".landing-day-bar-label");
    const [phoneBarBox, phoneLabelBox] = await Promise.all([box(phoneBar), box(phoneLabel)]);
    expect(phoneBarBox).not.toBeNull();
    expect(phoneLabelBox).not.toBeNull();
    // Fallback placement: the label's box extends past the bar's own edge.
    expect(phoneLabelBox!.width).toBeGreaterThan(phoneBarBox!.width + 4);
  });
});
