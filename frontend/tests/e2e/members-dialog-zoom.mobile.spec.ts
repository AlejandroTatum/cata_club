/**
 * Issue #767 on a real mobile engine.
 *
 * The bug is invisible to every test this repo had. `MembersPage.test.tsx` runs
 * in jsdom, which evaluates no media query and computes no cascade, so it can
 * assert that a class is written and never that a field renders at 20px. And
 * the one e2e that visits `/members` runs under `devices["Desktop Chrome"]`
 * with `isMobile: false` and `hasTouch: false` — a 390px desktop window, which
 * is exactly the configuration in which this defect does not exist. That is why
 * 132 green tests said nothing.
 *
 * So this file is the `mobile-chromium` project's whole reason to exist, and it
 * asserts the two things only a mobile engine can answer:
 *
 *   1. `(pointer: coarse)` — the carrier the floor in `globals.css` is written
 *      behind — actually matches on a phone. A floor behind a predicate that
 *      never fires is not a floor, and this is the one assumption in the fix
 *      that no amount of source reading can settle.
 *   2. Every field inside the Pagos dialog COMPUTES to at least 16px, cascade
 *      resolved. That is the part the specificity argument in `globals.css`
 *      claims and this measures: the Beneficio select writes
 *      `input-field text-xs`, two classes deep, and a floor written on the bare
 *      element would lose to it silently.
 *
 * Pagos, and not one of the other two, because it holds the widest spread of
 * field shapes in the product: a `.input-field` select that overrides its own
 * size (`BeneficioSection`), a hand-rolled `h-ctl … text-sm` number input
 * (`RegisterPaymentForm`), and a debt field beside them.
 *
 * ONE `page.goto`, for the reason `members-payments-dialog.spec.ts` gives: CI
 * runs on a 4-vCPU runner. Everything after the navigation is a click or a
 * viewport change, and the 320px clipping check reuses the same loaded page
 * rather than paying for a second one.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const BASE_URL = E2E_BASE_URL;
const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

/** The size at which iOS and Android stop zooming into a focused field. */
const ZOOM_FLOOR_PX = 16;

/** Debt present, so the dialog renders the most controls it ever does. */
const ACCOUNT = {
  id: "1",
  role: "representante",
  nombres: "María",
  apellidos: "González",
  email: "maria@example.test",
  telefono: "0999999999",
  estudiantes: [{
    id: "10",
    nombres: "Sofía",
    apellidos: "González",
    grupoId: null,
    activo: true,
    membresia: {
      id: "10",
      tipo: "Mensual",
      estado: "vencida",
      fechaInicio: "2026-06-01",
      fechaFin: "2026-06-30",
      monto: 25,
      esGratuidadFamiliar: false,
      mesesAdeudados: 2,
      montoAdeudado: 50,
    },
    ultimoPago: null,
  }],
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockMembersRuntime(page: Page): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: MOCK_ACCESS_TOKEN, url: BASE_URL }]);
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, {
    user: { id: "1", name: "Admin Dev", email: "admin@example.test", role: "admin", representanteId: null },
    roles: ["ADMINISTRADOR"],
    loggedInAt: "2026-07-21T00:00:00.000Z",
  }));
  await page.route("**/api/members", (route: Route) =>
    fulfillJson(route, { accounts: [ACCOUNT], personasCapped: false }),
  );
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/personas/*/beneficio", (route: Route) => fulfillJson(route, null));
  await page.route("**/api/personas/*/pagos**", (route: Route) => fulfillJson(route, { items: [], total: 0 }));
  // A non-empty catalogue, or the Beneficio picker renders "no hay descuentos"
  // instead of the `<select>` — which is the single most important field here.
  await page.route("**/api/descuentos**", (route: Route) =>
    fulfillJson(route, [{ id: 1, nombre: "Hermanos", tipo: "PORCENTAJE", valor: 20, activo: true }]),
  );
}

test("no field in the Pagos dialog is small enough to make a phone zoom", async ({ page }) => {
  await mockMembersRuntime(page);
  await page.goto("/members");

  // The premise, asserted rather than assumed: this project really is a coarse
  // pointer, so the floor's media query fires here. If Playwright's emulation
  // ever stopped reporting it, every measurement below would pass for the wrong
  // reason — a desktop-shaped page with desktop-sized fields.
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

  await page.getByRole("button", { name: "Pagos de María González" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Reveal the two fields that are behind a disclosure. Both are clicks on the
  // page already loaded, so neither costs a navigation.
  await dialog.getByRole("button", { name: /asignar beneficio/i }).click();
  await expect(dialog.locator("select")).toBeVisible();
  await dialog.getByRole("button", { name: /registrar pago/i }).click();

  const undersized = await dialog
    .locator(
      "input:visible:not([type=checkbox]):not([type=radio]):not([type=file]), select:visible, textarea:visible",
    )
    .evaluateAll((els, floor) =>
      els
        .map((el) => ({
          field: `${el.tagName.toLowerCase()}${el.getAttribute("type") ? `[${el.getAttribute("type")}]` : ""} .${el.className}`.slice(0, 70),
          px: Number.parseFloat(getComputedStyle(el).fontSize),
        }))
        .filter((f) => f.px < floor),
      ZOOM_FLOOR_PX,
    );

  expect(undersized).toEqual([]);

  // Not vacuous: an empty selector would also produce an empty offender list.
  const measured = await dialog
    .locator("input:visible:not([type=checkbox]):not([type=radio]):not([type=file]), select:visible, textarea:visible")
    .count();
  expect(measured).toBeGreaterThan(1);

  /*
   * The third defect in the same issue: the row's three actions.
   *
   * At 320px the group needs more line than the card has, and `card
   * overflow-hidden` on the page clips whatever does not fit WITHOUT a
   * scrollbar — "Editar" stops existing. jsdom can assert `flex-wrap` is
   * written; only a layout engine can say the button is inside the card.
   */
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 800 });

  const editar = page.getByRole("button", { name: "Editar María González" }).first();
  await expect(editar).toBeVisible();
  const overflow = await editar.evaluate((el) => {
    const card = el.closest("[class*='overflow-hidden']") ?? document.body;
    return Math.round(el.getBoundingClientRect().right - card.getBoundingClientRect().right);
  });

  expect(overflow).toBeLessThanOrEqual(0);
});
