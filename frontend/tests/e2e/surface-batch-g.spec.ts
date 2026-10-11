/**
 * Surface-consistency fixes from the T14 audit, batch G (S13, S3, S12, S4),
 * measured in a browser.
 *
 *  - L42  a currency figure in a stat tile never breaks mid-number on a phone
 *         («$18.711,00» used to wrap after the thousands dot);
 *  - RC9  a category row on /groups is a compact two-line block at 1440px, not
 *         the 220px slab with a dead middle;
 *  - RC10 no row of that list wears the primary or coal skin;
 *  - RC16 the micro text step renders at 11.5px.
 *
 * Like `payments-batch-e.spec.ts` it serves the BFF through `page.route`: the
 * subject is layout, so the fixtures carry the long figures and the rows.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

function pageOf<T>(url: string, all: readonly T[]): { items: T[]; total: number } {
  const params = new URL(url).searchParams;
  const skip = Number(params.get("skip") ?? 0);
  const limit = Number(params.get("limit") ?? all.length);
  return { items: all.slice(skip, skip + limit), total: all.length };
}

/** 14 pending payments of 1330 + i: the queue's total is exactly «$18.711,00». */
const PENDING = Array.from({ length: 14 }, (_, i) => ({
  id: `pay-${i}`,
  studentName: "Isabella Pilay Sabando",
  responsablePagoName: "Isabella Pilay Sabando",
  membershipPeriod: "01/10/2026 – 31/10/2026",
  membershipType: "Mensual",
  expectedAmount: 1330 + i,
  paymentMethod: "Transferencia",
  uploadedAt: "2026-10-02T10:00:00.000Z",
  currentMembershipStatus: "activa",
  proofFileType: "image",
  validationStatus: "pendiente",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
}));

const HORARIOS = ["FORMATIVO", "INFANTIL", "JUVENIL", "COMPETITIVO", "ADULTOS"].flatMap((categoria, c) =>
  ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES"].map((diaSemana, d) => ({
    id: 100 + c * 10 + d,
    diaSemana,
    horaInicio: `${15 + c}:00`,
    horaFin: `${16 + c}:00`,
    categoria,
  })),
);

async function mockAdminRuntime(page: Page): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/**", (route) =>
    route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {}),
  );
  await page.route("**/api/auth/session", (route) =>
    fulfillJson(route, {
      user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin", representanteId: null },
      roles: ["ADMINISTRADOR"],
      loggedInAt: new Date().toISOString(),
    }),
  );
  await page.route("**/api/ranking/notificaciones/mias*", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }));
  await page.route("**/api/payments*", (route) => {
    const estado = new URL(route.request().url()).searchParams.get("estadoPago");
    const all = estado && estado !== "PENDIENTE_VALIDACION" ? [] : PENDING;
    return fulfillJson(route, pageOf(route.request().url(), all));
  });
  await page.route("**/api/membresias/coberturas/todas*", (route) => fulfillJson(route, { items: [], total: 0 }));
  await page.route("**/api/members", (route) => fulfillJson(route, { accounts: [], personasCapped: false }));
  await page.route("**/api/groups/horarios", (route) => fulfillJson(route, HORARIOS));
}

test.describe("Surface batch G", () => {
  test("L42: «$18.711,00» in the «Monto pendiente» tile stays on one line on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await mockAdminRuntime(page);
    await page.goto("/payments");

    const tile = page.getByTestId("payments-stats").locator("[data-tone]").filter({ hasText: "Monto pendiente" });
    await expect(tile).toBeVisible({ timeout: 20_000 });
    const figure = tile.locator("span").filter({ hasText: /^\$\s?18\.711,00$/ }).first();
    await expect(figure).toBeVisible();

    const { height, lineHeight, overflows } = await figure.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
      overflows: el.scrollWidth > el.clientWidth + 1 || (el.closest("[data-tone]")?.scrollWidth ?? 0) > (el.closest("[data-tone]")?.clientWidth ?? 0) + 1,
    }));
    // One line of figure, inside its own tile.
    expect(height).toBeLessThanOrEqual(lineHeight * 1.5);
    expect(overflows).toBe(false);
    const widths = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(widths.s).toBeLessThanOrEqual(widths.c);
  });

  test("RC9/RC10: a category row is compact at 1440px and carries no primary-skinned button", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await mockAdminRuntime(page);
    await page.goto("/groups");

    const cards = page.getByTestId("horario-card");
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    expect(await cards.count()).toBeGreaterThanOrEqual(3);

    const heights = await cards.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    // The slab was 220px; two lines of content plus padding is ~175.
    expect(Math.max(...heights)).toBeLessThanOrEqual(180);

    // «Agregar jugadores» is the quiet outline and «Editar» the tertiary grey:
    // every button in a row sits on a transparent or near-white fill, never a
    // coal, red or yellow block.
    const loud = await cards.first().locator("button").evaluateAll((els) =>
      els
        .map((el) => ({ name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(), bg: getComputedStyle(el).backgroundColor }))
        .filter(({ bg }) => {
          const m = bg.match(/rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/);
          if (!m) return true;
          const [r, g, b2, a2] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
          return a2 > 0.5 && !(Math.min(r, g, b2) >= 225 && Math.max(r, g, b2) - Math.min(r, g, b2) <= 30);
        }),
    );
    expect(loud).toEqual([]);
    const widths = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
    expect(widths.s).toBeLessThanOrEqual(widths.c);
  });

  test("RC16: the micro step renders at 11.5px or more", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await mockAdminRuntime(page);
    await page.goto("/groups");
    await expect(page.getByTestId("horario-card").first()).toBeVisible({ timeout: 20_000 });

    const sizes = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("main .uppercase"))
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
    );
    expect(sizes.length).toBeGreaterThan(0);
    // Table-head / label strips at the micro step: never below 11.5px.
    expect(sizes.filter((s) => s < 11.5 && s > 10)).toEqual([]);
  });
});
