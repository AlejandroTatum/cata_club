/**
 * Staff who also play: one role per account, player side from an own membership.
 *
 * An ADMINISTRADOR whose own Persona holds a membership that allows training
 * (`isStaffPlayer`, computed by the BFF from `/auth/me`'s `puedeEntrenar`) sees
 * the player section next to the admin sections and opens their own payments;
 * one who is not a player sees nothing of it and is sent back to the dashboard
 * when they open /student.
 *
 * BFF-mocked on purpose: what is under test is the session → rail → route
 * guard chain in the browser. What the backend lets each caller read is
 * covered through the public API in `backend/tests/test_staff_jugador_portal.py`.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";
import { mockClubPaymentInfo } from "./helpers/club-payment-info";

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

function adminSession(isStaffPlayer: boolean, staffAwaitsFirstPayment = false) {
  return {
    user: {
      id: "9",
      name: "Diego Mora",
      email: "diego@cataclub.test",
      role: "admin" as const,
      representanteId: null,
      fechaNacimiento: "1990-05-01",
    },
    roles: ["ADMINISTRADOR"],
    isStaffPlayer,
    staffAwaitsFirstPayment,
    correoVerificado: true,
    altaPresencialCompletada: true,
    activacionCompleta: true,
    loggedInAt: "2026-10-09T00:00:00.000Z",
  };
}

const OWN_MEMBERSHIP = {
  id: 90,
  estado: "ACTIVA",
  personaId: 9,
  montoAplicado: "30.00",
  categoria: "Adultos",
  modalidad: "MENSUAL",
  fechaActivacion: "2026-09-01",
  fechaFin: "2026-12-31",
};

const PORTAL = {
  self: {
    personaId: "9",
    nombres: "Diego",
    apellidos: "Mora",
    fechaNacimiento: "1990-05-01",
    recentSessions: [],
    membership: OWN_MEMBERSHIP,
    representante: null,
    representanteId: null,
  },
  representados: [],
  membershipPlans: [],
};

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockSession(
  page: Page,
  isStaffPlayer: boolean,
  { staffAwaitsFirstPayment = false, membership = OWN_MEMBERSHIP }: { staffAwaitsFirstPayment?: boolean; membership?: object } = {},
): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: MOCK_ACCESS_TOKEN, url: E2E_BASE_URL }]);
  // Registered first, so every specific route below wins over it: any call the
  // admin home makes that this spec does not care about fails softly (500),
  // never as a 401 that would bounce the session to /login mid-assertion.
  await page.route("**/api/**", (route: Route) => fulfillJson(route, { message: "not mocked" }, 500));
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, adminSession(isStaffPlayer, staffAwaitsFirstPayment)));
  await page.route("**/api/student?*", (route: Route) => fulfillJson(route, { ...PORTAL, self: { ...PORTAL.self, membership } }));
  await page.route("**/api/membresias/pagos/persona/*", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/membresias/coberturas/persona/*", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/personas/*/beneficio", (route: Route) => fulfillJson(route, null));
  await page.route("**/api/asistencias/alumnos/*/horarios", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await mockClubPaymentInfo(page);
}

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Navegación principal" });
}

test("an admin who is also a player sees the player section and opens their own payments", async ({ page }) => {
  await mockSession(page, true);

  await page.goto("/student");

  // The staff sections are still there: the player section is additive.
  await expect(sidebar(page).locator('a[href="/members"]')).toBeVisible();
  await expect(sidebar(page).locator('a[href="/student"]')).toBeVisible();
  await expect(sidebar(page).locator('a[href="/student/attendance"]')).toBeVisible();

  await sidebar(page).locator('a[href="/student/payments"]').click();

  await expect(page).toHaveURL(/\/student\/payments(\?alumno=9)?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pagos" })).toBeVisible();
});

test("an admin who is not a player gets no player section and is sent home from /student", async ({ page }) => {
  await mockSession(page, false);

  await page.goto("/student");

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(sidebar(page).locator('a[href="/members"]')).toBeVisible();
  await expect(sidebar(page).locator('a[href^="/student"]')).toHaveCount(0);
});

test("an admin whose own membership awaits its first payment gets only Pagos", async ({ page }) => {
  await mockSession(page, false, {
    staffAwaitsFirstPayment: true,
    membership: { ...OWN_MEMBERSHIP, estado: "INACTIVA", fechaFin: null },
  });

  await page.goto("/student/payments");

  await expect(page).toHaveURL(/\/student\/payments(\?alumno=9)?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Pagos" })).toBeVisible();
  await expect(sidebar(page).locator('a[href="/members"]')).toBeVisible();
  await expect(sidebar(page).locator('a[href="/student/payments"]')).toBeVisible();
  for (const href of ["/student", "/student/attendance", "/student/medical-record"]) {
    await expect(sidebar(page).locator(`a[href="${href}"]`)).toHaveCount(0);
  }

  // The other player pages stay closed: back to the dashboard.
  await page.goto("/student");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/student/attendance");
  await expect(page).toHaveURL(/\/dashboard$/);
});
