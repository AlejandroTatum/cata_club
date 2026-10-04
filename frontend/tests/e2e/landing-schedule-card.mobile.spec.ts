/**
 * Horarios fichas on a real mobile engine.
 *
 * jsdom performs no layout, so it can never prove the page stays inside a
 * 390px viewport. Only a layout engine answers that, which is this
 * `mobile-chromium` spec's reason to exist.
 *
 * Six categories, one with a long name, so a card that overflowed its
 * column would show up as horizontal page scroll.
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

test.describe("Schedule cards on a real mobile engine", () => {
  test("renders one card per category with age headline, time, days and WhatsApp link, and never scrolls horizontally at 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/schedules", (route: Route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SCHEDULE_PAYLOAD) }),
    );

    await page.goto("/");

    const layout = page.locator(".landing-schedule-layout");
    await expect(layout).toBeVisible();

    // One card per category, plus the help card.
    const tiles = layout.locator(".landing-schedule-tile");
    await expect(tiles).toHaveCount(SCHEDULE_PAYLOAD.length + 1);
    await expect(layout.locator(".landing-schedule-tile:not(.landing-schedule-help)")).toHaveCount(SCHEDULE_PAYLOAD.length);

    const infantil = tiles.filter({ has: page.getByRole("heading", { level: 3, name: "Infantil" }) });
    await expect(infantil.locator(".landing-schedule-ages")).toContainText("8 a 12 años");
    await expect(infantil.locator(".landing-schedule-time")).toContainText("16:00");
    await expect(infantil.locator(".landing-schedule-days")).not.toBeEmpty();

    const cta = page.getByRole("link", { name: "Preguntar por cupos en Infantil por WhatsApp" });
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toHaveAttribute("href", /wa\.me|whatsapp/i);
    const ctaBox = await cta.boundingBox();
    expect(ctaBox).not.toBeNull();
    expect(ctaBox!.height).toBeGreaterThanOrEqual(44);
    await cta.click({ trial: true });

    // The help card is always the last one and links to WhatsApp too.
    const help = layout.locator(".landing-schedule-help");
    await expect(help.getByRole("heading", { level: 3, name: "¿No sabes cuál elegir?" })).toBeVisible();
    await expect(help.getByRole("link", { name: /abrir whatsapp/i })).toHaveAttribute("href", /wa\.me|whatsapp/i);

    // No horizontal scroll on the page, and every card sits inside the viewport.
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    const count = await tiles.count();
    for (let index = 0; index < count; index += 1) {
      const box = await tiles.nth(index).boundingBox();
      expect(box, `tile ${index}`).not.toBeNull();
      expect(box!.x, `tile ${index} left`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `tile ${index} right`).toBeLessThanOrEqual(390.5);
    }
  });
});
