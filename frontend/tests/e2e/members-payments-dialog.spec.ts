/**
 * The Pagos dialog's two layout contracts — issues #706 and #707.
 *
 * Both are e2e and not jsdom because both are questions about RENDERED
 * GEOMETRY: jsdom computes no layout, so every height it reports is 0 and a
 * wheel gesture there moves nothing. `MembersPage.test.tsx` can assert that a
 * class is present; only a real engine can say a control is 24px tall or that
 * the page behind stayed still.
 *
 * ONE `page.goto` covers both — CI runs this on a 4-vCPU runner and a second
 * navigation buys nothing here, since both assertions read the same open
 * dialog. The runtime is fully mocked (no backend), so the numbers below are
 * a property of the CSS, not of whatever the QA database happens to hold.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const BASE_URL = E2E_BASE_URL;
const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

/**
 * A membership in the state that renders the MOST controls at once: an
 * existing membership with debt, so "Regularizar deuda", "Registrar pago"
 * and the suspend/plan actions are all present — which is also what gives
 * the dialog body enough content to scroll.
 */
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
}

test("the Pagos dialog contains its own scrolling and keeps every control hittable", async ({ page }) => {
  // The viewport issue #706 was measured at: a phone held sideways, where the
  // members page behind the dialog is long enough to scroll.
  await page.setViewportSize({ width: 844, height: 390 });
  await mockMembersRuntime(page);

  await page.goto("/members");

  await page.getByRole("button", { name: "Pagos de María González" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  /*
   * --- Issue #707: WCAG 2.2 SC 2.5.8, 24x24 ---------------------------------
   *
   * Every control in the dialog, measured, not a spot check of the two that
   * were reported: "Historial de pagos" was 18.8px and "Regularizar deuda"
   * 23px while their siblings were 26.8px, and fixing only those two would
   * have left the same accident in place for the next control. Failure names
   * the offenders and their heights so the report is actionable.
   */
  const undersized = await dialog
    .locator("button:visible, a[href]:visible")
    .evaluateAll((els) =>
      els
        .map((el) => ({
          label: (el.getAttribute("aria-label") || el.textContent || "?").trim().replace(/\s+/g, " ").slice(0, 40),
          height: Math.round(el.getBoundingClientRect().height * 10) / 10,
        }))
        .filter((c) => c.height > 0 && c.height < 24),
    );

  expect(undersized).toEqual([]);

  /*
   * --- Issue #706: the scroll stops at the dialog's edge ---------------------
   *
   * Two facts, because only the pair distinguishes "contained" from "not
   * scrollable at all": the body MUST move under the wheel, and the page
   * behind MUST NOT — including after the body has hit its bottom, which is
   * where the chaining happened (WebKit 682 → 1297, Chromium 681 → 1296;
   * Firefox contained it, and this asserts it still does).
   */
  const body = dialog.locator("div.overflow-y-auto").first();
  await expect(body).toHaveCSS("overscroll-behavior-y", "contain");

  // Enough content to scroll, or the containment assertion below is vacuous.
  const bodyScrollable = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(bodyScrollable).toBeGreaterThan(0);
  const pageScrollable = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  expect(pageScrollable).toBeGreaterThan(0);

  await page.evaluate(() => window.scrollTo(0, 0));
  const box = (await body.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  // Wheel well past the body's own end, so the gesture keeps pushing at the
  // boundary — a single flick would not reach it.
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 600);
  await page.waitForTimeout(500);

  // The body took the scroll…
  expect(await body.evaluate((el) => el.scrollTop)).toBe(bodyScrollable);
  // …and the page behind never moved, which is the whole of #706.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
