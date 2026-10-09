/**
 * Dark sticker depth from the T14 audit, batch H (RC8; S7, S8, S4), measured
 * in a browser on computed styles.
 *
 * In dark the card outline sat at ~1.3:1 and the hard shadow was black on a
 * near-black page, so cards read as flat panels; the yellow KPI slab was a
 * dimmed mustard and the coal slab a hole. The same screen in light must not
 * move: the outline and the shadow stay coal and the slabs stay brand fills.
 *
 * Like `surface-batch-g.spec.ts` it serves the BFF through `page.route`: the
 * subject is paint, so the fixtures only need cards and KPI tiles on screen.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

const DESKTOP = { width: 1440, height: 900 };

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

const PENDING = Array.from({ length: 6 }, (_, i) => ({
  id: `pay-${i}`,
  studentName: "Isabella Pilay Sabando",
  responsablePagoName: "Isabella Pilay Sabando",
  membershipPeriod: "01/10/2026 – 31/10/2026",
  membershipType: "Mensual",
  expectedAmount: 30 + i,
  paymentMethod: "Transferencia",
  uploadedAt: "2026-10-02T10:00:00.000Z",
  currentMembershipStatus: "activa",
  proofFileType: "image",
  validationStatus: "pendiente",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
}));

async function openPayments(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), ["cata_theme", theme]);
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/**", (route) => (route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {})));
  await page.route("**/api/auth/session", (route) =>
    fulfillJson(route, {
      user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin", representanteId: null },
      roles: ["ADMINISTRADOR"],
      loggedInAt: new Date().toISOString(),
    }),
  );
  await page.route("**/api/ranking/notificaciones/mias", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }));
  await page.route("**/api/payments*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const estado = params.get("estadoPago");
    const all = estado && estado !== "PENDIENTE_VALIDACION" ? [] : PENDING;
    const skip = Number(params.get("skip") ?? 0);
    const limit = Number(params.get("limit") ?? all.length);
    return fulfillJson(route, { items: all.slice(skip, skip + limit), total: all.length });
  });
  await page.route("**/api/membresias/coberturas/todas*", (route) => fulfillJson(route, { items: [], total: 0 }));
  await page.goto("/payments");
  await expect(page.getByTestId("payments-stats")).toBeVisible({ timeout: 20_000 });
}

/** Paint facts the assertions need, read once from the page. */
async function paint(page: Page) {
  return page.evaluate(() => {
    const rgb = (value: string): [number, number, number, number] => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      const parts = (m?.[1] ?? "0,0,0").split(/[ ,/]+/).filter(Boolean).map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const lum = ([r, g, b]: number[]): number => {
      const lin = (c: number): number => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: number[], b: number[]): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const canvas = rgb(getComputedStyle(document.querySelector(".app-shell") ?? document.body).backgroundColor);
    const shadowColor = (el: Element): number[] => {
      // Tailwind stacks empty ring layers before the sticker: take the offset one.
      const layer = Array.from(getComputedStyle(el).boxShadow.matchAll(/(rgba?\([^)]+\))\s+(-?\d+)px\s+(-?\d+)px/g)).find(
        (m) => Number(m[2]) !== 0 || Number(m[3]) !== 0,
      );
      return layer ? rgb(layer[1]) : [0, 0, 0, 0];
    };

    // A card: the paper-filled sticker box, not a KPI slab.
    const cardEl = Array.from(document.querySelectorAll<HTMLElement>("main *")).find((el) => {
      const cs = getComputedStyle(el);
      return !el.closest("[data-tone]") && el.getBoundingClientRect().width > 300 && cs.borderTopWidth === "2px" && /rgba?\([^)]+\) [1-9]\d*px [1-9]\d*px 0px 0px/.test(cs.boxShadow);
    });
    const slabs = Array.from(document.querySelectorAll<HTMLElement>("[data-testid='payments-stats'] [data-tone]")).map((el) => {
      const cs = getComputedStyle(el);
      return { tone: el.dataset.tone ?? "", bg: rgb(cs.backgroundColor), border: rgb(cs.borderTopColor), shadow: shadowColor(el) };
    });
    return {
      canvas,
      card: cardEl
        ? {
            border: rgb(getComputedStyle(cardEl).borderTopColor),
            shadow: shadowColor(cardEl),
            borderOnCanvas: ratio(rgb(getComputedStyle(cardEl).borderTopColor), canvas),
            borderOnPaper: ratio(rgb(getComputedStyle(cardEl).borderTopColor), rgb(getComputedStyle(cardEl).backgroundColor)),
            shadowOnCanvas: ratio(shadowColor(cardEl), canvas),
          }
        : null,
      slabs: slabs.map((s) => ({ ...s, onCanvas: ratio(s.bg, canvas), shadowOnCanvas: ratio(s.shadow, canvas) })),
    };
  });
}

test.describe("Dark sticker depth (batch H)", () => {
  test("RC8 dark: the card edge is a 3:1 outline and its hard shadow is visible on the page", async ({ page }) => {
    await openPayments(page, "dark");
    const facts = await paint(page);
    expect(facts.card, "a sticker card is on screen").not.toBeNull();
    expect(facts.card!.borderOnCanvas).toBeGreaterThanOrEqual(3);
    expect(facts.card!.borderOnPaper).toBeGreaterThanOrEqual(3);
    expect(facts.card!.shadowOnCanvas).toBeGreaterThanOrEqual(1.5);
  });

  test("RC8 dark: the KPI slabs keep brand fills and none is darker than the page", async ({ page }) => {
    await openPayments(page, "dark");
    const { slabs, canvas } = await paint(page);
    expect(slabs.length).toBeGreaterThan(0);
    for (const slab of slabs) {
      // Every slab separates from the page by its fill (>= 1.2:1) or, for the
      // coal one, sits above it: never the 12/12/14 hole.
      // (A neutral tile is a paper card: its edge, not its fill, frames it.)
      if (slab.tone !== "neutral") expect(slab.onCanvas, `${slab.tone} slab on the canvas`).toBeGreaterThanOrEqual(1.2);
      expect(slab.shadowOnCanvas, `${slab.tone} slab shadow on the canvas`).toBeGreaterThanOrEqual(1.5);
      const yellowish = slab.bg[0] > 200 && slab.bg[1] > 150 && slab.bg[2] < 60;
      if (yellowish) expect(slab.bg.slice(0, 3), "the yellow slab is the brand ball").toEqual([255, 214, 0]);
    }
    expect(canvas[0]).toBeLessThan(40);
  });

  test("light stays as it was: coal outline, coal shadow, brand fills", async ({ page }) => {
    await openPayments(page, "light");
    const { card, slabs } = await paint(page);
    expect(card, "a sticker card is on screen").not.toBeNull();
    expect(card!.border.slice(0, 3)).toEqual([19, 19, 22]);
    expect(card!.shadow.slice(0, 3)).toEqual([19, 19, 22]);
    for (const slab of slabs) {
      expect(slab.border.slice(0, 3), `${slab.tone} slab edge`).toEqual([19, 19, 22]);
      expect(slab.shadow.slice(0, 3), `${slab.tone} slab shadow`).toEqual([19, 19, 22]);
    }
  });
});
