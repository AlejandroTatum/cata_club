/**
 * #1668 — «Pagos» is a page of its own (`/members/[id]/pagos`), not a dialog.
 *
 * E2E and not jsdom because the questions are about RENDERED GEOMETRY and real
 * navigation: that the row's trigger really changes the URL and the back link
 * really returns, that nothing spills sideways at 390px, and that every
 * control is a hittable target (WCAG 2.2 SC 2.5.8, 24x24 — issue #707, which
 * used to be asserted on the dialog). The runtime is fully mocked (no
 * backend), so the numbers are a property of the CSS, not of the QA database.
 *
 * The page loads ONE account by id (`GET /api/members/:id`); the direct-URL
 * case below is the one a reload or a shared link takes.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const BASE_URL = E2E_BASE_URL;
const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

/** A membership with debt: the state that renders the most controls at once. */
const ACCOUNT = {
  id: "1",
  role: "representante",
  // The list opens on «Jugador»; a lapsed player still holds the ALUMNO role.
  backendRoles: ["ALUMNO"],
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

/** An approved payment: the row that offers «Corregir monto o meses». */
const PAGO_APROBADO = {
  id: 9,
  monto: "50.00",
  motivoRechazo: null,
  estadoPago: "APROBADO",
  tipoPago: "TRANSFERENCIA",
  fechaRegistro: "2026-06-01T10:00:00",
  fechaValidacion: "2026-06-02T10:00:00",
  fechaInicio: "2026-05-01",
  fechaFin: "2026-06-30",
  personaId: 10,
  membresiaId: 10,
  voucherUrl: null,
  voucherFormato: null,
  comprobanteOficialUrl: null,
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockMembersRuntime(page: Page): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: MOCK_ACCESS_TOKEN, url: BASE_URL }]);
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, {
    user: { id: "1", name: "Admin Dev", email: "admin@example.test", role: "admin", representanteId: null },
    roles: ["ADMINISTRADOR"],
    loggedInAt: "2026-07-21T00:00:00.000Z",
  }));
  // AppShell's pending-payments badge calls this; unmocked it 401s, the refresh
  // 401s too, and the session is dropped before the page can render.
  await page.route("**/api/dashboard", (route: Route) => fulfillJson(route, {}));
  await page.route("**/api/members", (route: Route) =>
    fulfillJson(route, { accounts: [ACCOUNT], personasCapped: false }),
  );
  await page.route("**/api/members/*", (route: Route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    return id === "1"
      ? fulfillJson(route, { account: ACCOUNT })
      : fulfillJson(route, { message: "No se encontró a este miembro." }, 404);
  });
  await page.route("**/api/ranking/notificaciones/mias*", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/personas/*/beneficio", (route: Route) => fulfillJson(route, null));
  await page.route("**/api/membresias/pagos/persona/*", (route: Route) => fulfillJson(route, [PAGO_APROBADO]));
  await page.route("**/api/membresias/pagos/9", (route: Route) => fulfillJson(route, PAGO_APROBADO));
  await page.route("**/api/membresias/pagos/9/correcciones", (route: Route) => fulfillJson(route, []));
}

test("Miembros → Pagos opens the member's page, fits a 390px phone, and the back link returns", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMembersRuntime(page);

  await page.goto("/members");
  await page.getByRole("button", { name: "Pagos de María González" }).first().click();

  // A page, not a dialog.
  await expect(page).toHaveURL(/\/members\/1\/pagos$/);
  await expect(page.getByRole("heading", { name: "Pagos", level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Plain-language state and ONE obvious primary action, inside the viewport.
  await expect(page.getByText("Debe 2 meses").first()).toBeVisible();
  const primary = page.locator("[data-primary-action]");
  await expect(primary).toHaveCount(1);
  await expect(primary).toHaveAttribute("data-primary-action", "registrar-pago");
  await expect(primary.getByRole("button", { name: "Registrar pago" })).toBeVisible();
  // Months are owed, so the catch-up is offered next to it.
  await expect(primary.getByRole("button", { name: "Cargar pagos atrasados" })).toBeVisible();

  // 390px: nothing spills sideways.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);

  // Every control is a hittable target (#707, now measured on the page).
  const main = page.getByRole("main");
  const undersized = await main
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

  // The way back says where it goes, and goes there.
  await page.getByRole("link", { name: /volver a miembros/i }).click();
  await expect(page).toHaveURL(/\/members$/);
});

test("a direct URL loads the member by id, and an unknown member says so", async ({ page }) => {
  await mockMembersRuntime(page);

  await page.goto("/members/1/pagos");
  await expect(page.getByRole("heading", { name: "Sofía González" })).toBeVisible();
  await expect(page.locator("[data-primary-action]")).toHaveCount(1);

  await page.goto("/members/999/pagos");
  await expect(page.getByText("No encontramos a este miembro")).toBeVisible();
  await expect(page.getByRole("link", { name: /volver a miembros/i })).toHaveAttribute("href", "/members");
});

test("correcting an approved payment fits a 390px phone: amount, months, dates and reason, nothing clipped", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockMembersRuntime(page);

  await page.goto("/members/1/pagos");
  await page.getByRole("button", { name: "Corregir monto o meses" }).click();

  const form = page.locator("form").filter({ has: page.getByLabel(/^meses/i) });
  await expect(form).toBeVisible();
  for (const label of [/^monto/i, /^meses/i, /^desde/i, /^hasta/i, /^motivo/i]) {
    await expect(form.getByLabel(label)).toBeVisible();
  }

  // Nothing spills sideways, and the date pair stays inside the form.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  const overflow = await form.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
