/**
 * /members/carnets picker, measured in a browser (T14B / RC7, S9, S12, S4).
 *
 *  - «Representado por» is the app's own face at 12px under the name, and is on
 *    screen at 390px (family names repeat: it is how two "Alcivar Vera" differ);
 *  - the search is not a card inside a card, and the list does not scroll inside
 *    the page;
 *  - the selection bar sits above the tab bar on a phone and beside the list on
 *    a desktop, the report launcher does not cover it, and the primary action
 *    is visibly disabled — with its reason — until someone is chosen;
 *  - 60 is the ceiling, with 154 players on the list.
 *
 * The BFF is intercepted like `shell-batch-a.spec.ts`: the subject is layout.
 * The phone is a 390px DESKTOP-pointer window, as the owner reviews it.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const LIMIT = 60;

const SESSION = {
  user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin", representanteId: null },
  roles: ["ADMINISTRADOR"],
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

function accounts(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    role: "estudiante",
    nombres: `Jugador${index + 1}`,
    apellidos: "Alcivar Vera",
    telefono: "0999999999",
    estudiantes: [],
    backendRoles: ["ALUMNO"],
    ...(index % 2 === 0 ? { representadoPor: "Rosa Vera Maldonado" } : {}),
  }));
}

async function openPicker(page: Page, size: { width: number; height: number }, count: number): Promise<void> {
  await page.setViewportSize(size);
  await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
  await page.route("**/api/**", (route) => fulfillJson(route, []));
  await page.route("**/api/ranking/notificaciones/mias*", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }));
  await page.route("**/api/dashboard", (route) => fulfillJson(route, {}));
  await page.route("**/api/members", (route) => fulfillJson(route, { accounts: accounts(count), stats: {} }));
  await page.route("**/api/auth/session", (route) => fulfillJson(route, { ...SESSION, loggedInAt: new Date().toISOString() }));
  await page.goto("/members/carnets");
  await expect(page.getByTestId("carnet-picker")).toBeVisible({ timeout: 20_000 });
}

const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe("Carnet picker", () => {
  test("phone: the family name is visible under the player, readable, in the app's face", async ({ page }) => {
    await openPicker(page, PHONE, 7);

    const note = page.getByText("Representado por Rosa Vera Maldonado").first();
    await expect(note).toBeVisible();
    const style = await note.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { size: parseFloat(cs.fontSize), family: cs.fontFamily, spacing: cs.letterSpacing, top: el.getBoundingClientRect().top };
    });
    expect(style.size).toBeGreaterThanOrEqual(12);
    expect(style.family).toMatch(/switzer/i);
    expect(parseFloat(style.spacing) || 0).toBeLessThanOrEqual(0);
    const nameTop = (await page.getByText("Jugador1 Alcivar Vera").first().boundingBox())!.y;
    expect(style.top).toBeGreaterThan(nameTop);

    const row = (await page.getByRole("listitem").first().boundingBox())!;
    expect(row.height).toBeGreaterThanOrEqual(44);
    const box = (await page.getByRole("checkbox").first().boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(20);
    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(widths[0]).toBeLessThanOrEqual(widths[1]);
  });

  test("phone: flat search, bar above the tab bar and the launcher, disabled with a reason until chosen", async ({ page }) => {
    await openPicker(page, PHONE, 7);

    expect(await page.getByRole("searchbox").evaluate((el) => el.closest(".card") === null)).toBe(true);
    const bar = page.getByTestId("carnet-selection-bar");
    const generate = page.getByRole("button", { name: /^generar/i });
    await expect(generate).toBeDisabled();
    await expect(bar.getByText("Elige al menos un jugador.")).toBeVisible();

    await page.getByRole("checkbox", { name: /Jugador1 / }).check();
    await expect(generate).toBeEnabled();
    await expect(bar.getByRole("status")).toContainText("1 de 7 seleccionados");

    const barBox = (await bar.boundingBox())!;
    const tabs = (await page.getByRole("navigation", { name: /móvil/i }).boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(tabs.y + 1);
    expect(barBox.y + barBox.height).toBeGreaterThan(PHONE.height - 62 - 2);
    const fab = await page.locator("button[data-report-ignore]").boundingBox();
    if (fab) expect(intersects(fab, barBox)).toBe(false);
    expect((await generate.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    // The last row is reachable above the bar (the page reserves its height).
    await page.getByRole("listitem").last().scrollIntoViewIfNeeded();
    const last = (await page.getByRole("listitem").last().boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(barBox.y + 1);
  });

  test("154 players: chooses up to the ceiling, the list scrolls with the page", async ({ page }) => {
    await openPicker(page, PHONE, 154);

    const list = page.getByRole("list", { name: "Jugadores" });
    expect(await list.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
    await page.getByRole("button", { name: "Elegir visibles (154)" }).click();
    await expect(page.getByTestId("carnet-selection-bar").getByRole("status")).toContainText(`${LIMIT} de 154 seleccionados`);
    await expect(page.getByText(/Llegaste al máximo/)).toBeVisible();
    await expect(page.getByRole("button", { name: `Generar ${LIMIT} carnets` })).toBeEnabled();
    await page.getByRole("button", { name: "Quitar selección" }).click();
    await expect(page.getByTestId("carnet-selection-bar").getByRole("status")).toContainText("0 de 154 seleccionados");
  });

  test("desktop: the selection panel sits beside the list and stays in view while scrolling", async ({ page }) => {
    await openPicker(page, DESKTOP, 154);

    // The placeholder is the instruction: it must not be clipped by the buttons beside it.
    const search = page.getByRole("searchbox");
    expect((await search.boundingBox())!.width).toBeGreaterThanOrEqual(220);
    const bar = page.getByTestId("carnet-selection-bar");
    const list = (await page.getByRole("list", { name: "Jugadores" }).boundingBox())!;
    const before = (await bar.boundingBox())!;
    expect(before.x).toBeGreaterThanOrEqual(list.x + list.width);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(300);
    const after = (await bar.boundingBox())!;
    expect(after.y).toBeGreaterThanOrEqual(0);
    expect(after.y + after.height).toBeLessThanOrEqual(DESKTOP.height);
    const fab = await page.locator("button[data-report-ignore]").boundingBox();
    if (fab) expect(intersects(fab, after)).toBe(false);
  });

  test("zero players: an empty state, no dead toolbar or disabled bar", async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.context().addCookies([{ name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL }]);
    await page.route("**/api/**", (route) => fulfillJson(route, []));
    await page.route("**/api/ranking/notificaciones/mias*", (route) => fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }));
    await page.route("**/api/dashboard", (route) => fulfillJson(route, {}));
    await page.route("**/api/members", (route) => fulfillJson(route, { accounts: [], stats: {} }));
    await page.route("**/api/auth/session", (route) => fulfillJson(route, { ...SESSION, loggedInAt: new Date().toISOString() }));
    await page.goto("/members/carnets");
    await expect(page.getByText("Aún no hay jugadores")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("carnet-selection-bar")).toHaveCount(0);
  });
});
