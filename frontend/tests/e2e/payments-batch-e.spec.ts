/**
 * Payments screen fixes from the T14 audit, batch E (S13, S9, S4), measured in
 * a browser.
 *
 *  - RC6  the player's name keeps a readable column at 1440px: it does not wrap
 *         to three or four lines inside the table;
 *  - RC5  at 390px the queue is a list of cards that never pushes the page
 *         sideways, and its controls (filters, search, row actions, the
 *         member rows' «Pagos» / «Más») reach the 44px thumb floor;
 *  - RC2  «Bonificaciones» shows a short first batch with a count and a quiet
 *         receipt link per row, instead of fifty rows with a black button each.
 *
 * Like `shell-batch-a.spec.ts` it serves the BFF through `page.route`: the
 * subject is layout, so the fixtures carry the long names and the many rows
 * the audit needed a seeded database for. The phone is a 390px DESKTOP-pointer
 * window on purpose (that is how the owner reviews), the case the coarse-
 * pointer floor in `globals.css` does not cover.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const THUMB = 44;

const LONG_NAMES = [
  "Isabella Pilay Sabando",
  "Juan Sebastián Rodríguez Villamar",
  "María Fernanda Alcívar Vera",
  "Santiago Andrés Cevallos Intriago",
  "Valentina Mendoza Zambrano",
  "Mateo Alejandro Loor Delgado",
];

function pendingPayment(index: number) {
  const name = LONG_NAMES[index % LONG_NAMES.length];
  return {
    id: `pay-${index}`,
    studentName: name,
    responsablePagoName: index % 2 === 0 ? "Carmen Rosa Villamar Pazmiño" : name,
    membershipPeriod: "01/10/2026 – 31/10/2026",
    membershipType: "Mensual",
    expectedAmount: 1330 + index,
    paymentMethod: index % 3 === 0 ? "Efectivo" : "Transferencia",
    uploadedAt: "2026-10-02T10:00:00.000Z",
    currentMembershipStatus: "activa",
    proofFileType: "image",
    validationStatus: "pendiente",
    startDate: "2026-10-01",
    endDate: "2026-10-31",
  };
}

const PENDING = Array.from({ length: 14 }, (_, i) => pendingPayment(i));

const BONIFICACIONES_TOTAL = 60;

function bonificacion(index: number) {
  return {
    id: index + 1,
    personaId: 100 + index,
    personaNombreCompleto: `${LONG_NAMES[index % LONG_NAMES.length]} ${index + 1}`,
    membresiaId: 500 + index,
    monto: "0.00",
    fechaInicio: "2026-09-01",
    fechaFin: "2026-09-30",
    otorgadaEn: "2026-09-01T09:00:00Z",
  };
}

const SOFIA = {
  id: "10",
  nombres: "Sofía",
  apellidos: "Alcívar Vera",
  grupoId: null,
  activo: true,
  membresia: { tipo: "mensual", estado: "activa", fechaInicio: "2026-10-01", fechaFin: "2026-10-31", monto: 85 },
  ultimoPago: null,
};
const ACCOUNTS = ["Ana", "Luis", "Diego"].map((nombres, i) => ({
  id: String(i + 1),
  role: "alumno",
  nombres,
  apellidos: "Alcívar Vera",
  email: `${nombres.toLowerCase()}@example.test`,
  telefono: "0999999999",
  estudiantes: [{ ...SOFIA, id: String(10 + i), nombres }],
  dependientes: [],
}));

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

function pageOf<T>(url: string, all: readonly T[]): { items: T[]; total: number } {
  const params = new URL(url).searchParams;
  const skip = Number(params.get("skip") ?? 0);
  const limit = Number(params.get("limit") ?? all.length);
  return { items: all.slice(skip, skip + limit), total: all.length };
}

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
  await page.route("**/api/ranking/notificaciones/mias", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }));
  await page.route("**/api/dashboard", (route) =>
    fulfillJson(route, { totalPersonas: 120, totalAlumnos: 98, activeMemberships: 80, pendingPayments: 14, todaySchedules: 4, personasSinMembresia: 12 }),
  );
  await page.route("**/api/payments*", (route) => {
    const estado = new URL(route.request().url()).searchParams.get("estadoPago");
    const all = estado && estado !== "PENDIENTE_VALIDACION" ? [] : PENDING;
    return fulfillJson(route, pageOf(route.request().url(), all));
  });
  await page.route("**/api/membresias/coberturas/todas*", (route) =>
    fulfillJson(route, pageOf(route.request().url(), Array.from({ length: BONIFICACIONES_TOTAL }, (_, i) => bonificacion(i)))),
  );
  await page.route("**/api/members", (route) => fulfillJson(route, { accounts: ACCOUNTS, personasCapped: false }));
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
}

async function heights(locator: ReturnType<Page["locator"]>): Promise<number[]> {
  return locator.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
}

test.describe("Payments batch E", () => {
  test("RC6: a long player name keeps a readable column on the desktop table", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await mockAdminRuntime(page);
    await page.goto("/payments");

    const table = page.getByTestId("payments-table");
    await expect(table.getByText("Isabella Pilay Sabando").first()).toBeVisible({ timeout: 20_000 });

    const cells = table.locator("tbody tr > td:first-child");
    const widths = await cells.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(208);

    // Name + «Paga: …» line: two lines of text, not four.
    const names = table.locator("tbody tr > td:first-child > span:first-child");
    const lines = await names.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(el).lineHeight))),
    );
    expect(Math.max(...lines)).toBeLessThanOrEqual(2);
    expect(Math.max(...(await heights(table.locator("tbody tr"))))).toBeLessThanOrEqual(84);
    // The wide name column must not push the table into its own scroller.
    expect(await table.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await noHorizontalOverflow(page);
  });

  test("RC5: the queue is cards that fit a phone and every control reaches 44px", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await mockAdminRuntime(page);
    await page.goto("/payments");

    const cards = page.getByTestId("payments-cards");
    await expect(cards.getByText("Isabella Pilay Sabando").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("payments-table")).toBeHidden();
    await noHorizontalOverflow(page);

    // KPI figures are not clipped by their own tile.
    const clipped = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid="payments-stats"] [data-tone], [data-testid="payments-stats"] > *'))
        .filter((tile) => tile.scrollWidth > tile.clientWidth + 1)
        .map((tile) => (tile.textContent ?? "").slice(0, 30)),
    );
    expect(clipped).toEqual([]);

    const small = await page.evaluate((floor) => {
      const sel = ['[data-testid="payments-cards"] button', 'main input:not([type="checkbox"])', 'main button[aria-pressed]'];
      return Array.from(document.querySelectorAll<HTMLElement>(sel.join(",")))
        .map((el) => ({ el, rect: el.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.height < floor - 0.5)
        .map(({ el }) => ({ el, rect: (el.closest("label") ?? el).getBoundingClientRect() }))
        .filter(({ rect }) => rect.height < floor - 0.5)
        .map(({ el, rect }) => `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}:${Math.round(rect.height)}`);
    }, THUMB);
    expect(small).toEqual([]);
  });

  test("RC5: the member rows' «Pagos» and «Más» reach 44px on a phone", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await mockAdminRuntime(page);
    await page.goto("/members");

    const pagos = page.getByRole("button", { name: /^Pagos de / });
    await expect(pagos.first()).toBeVisible({ timeout: 20_000 });
    const more = page.getByRole("button", { name: /^Más acciones para / });
    for (const button of [pagos, more]) {
      for (const h of await heights(button)) expect(h).toBeGreaterThanOrEqual(THUMB);
    }
    await noHorizontalOverflow(page);
  });

  for (const viewport of [PHONE, DESKTOP]) {
    test(`RC2: Bonificaciones shows a short batch with a count at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockAdminRuntime(page);
      await page.goto("/payments");

      const section = page.getByTestId("bonificaciones-section");
      await expect(section).toBeVisible({ timeout: 20_000 });
      await section.scrollIntoViewIfNeeded();

      await expect(section.getByRole("listitem")).toHaveCount(10);
      await expect(section.getByText("10 de 60")).toBeVisible();

      // The row's receipt is a quiet link, not a black block per row.
      const link = section.getByRole("link", { name: /recibo oficial/i }).first();
      const [r, g, b] = (await link.evaluate((el) => getComputedStyle(el).backgroundColor)).match(/\d+/g)!.map(Number);
      expect(r + g + b).toBeGreaterThan(600);
      if (viewport === PHONE) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(THUMB);

      const more = section.getByRole("button", { name: /cargar más/i });
      if (viewport === PHONE) expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(THUMB);

      await more.click();
      await expect(section.getByRole("listitem")).toHaveCount(20);
      await expect(section.getByText("20 de 60")).toBeVisible();
      await noHorizontalOverflow(page);
    });
  }
});
