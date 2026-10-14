/**
 * Non-payment block (#1768): a blocked profile reaches only Payments.
 *
 * A player whose coverage lapsed more than the grace ago opens the portal and
 * lands on Payments with the banner, with every other portal page sending them
 * back there; a coach in the same situation keeps their whole player section.
 *
 * BFF-mocked on purpose, like `staff-player-side.spec.ts`: what is under test
 * is the session → route chain in the browser. The block rule itself (and who
 * is blocked) is the backend's, covered in its own tests.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";
import { mockClubPaymentInfo } from "./helpers/club-payment-info";

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
const BANNER = "Tu membresía venció el 30/09/2026. Paga para volver a entrenar.";

const LAPSED_MEMBERSHIP = {
  id: 90,
  estado: "VENCIDA",
  personaId: 9,
  montoAplicado: "30.00",
  categoria: "Adultos",
  modalidad: "MENSUAL",
  fechaActivacion: "2026-01-01",
  fechaFin: null,
  cubiertoHasta: "2026-09-30",
};

const BLOCKED_PORTAL = {
  self: {
    personaId: "9",
    nombres: "Diego",
    apellidos: "Mora",
    fechaNacimiento: "1990-05-01",
    recentSessions: [],
    membership: LAPSED_MEMBERSHIP,
    representante: null,
    representanteId: null,
    bloqueadoPorImpago: true,
    cubiertoHasta: "2026-09-30",
  },
  representados: [],
  membershipPlans: [],
};

function session(role: "estudiante" | "trainer") {
  return {
    user: {
      id: "9",
      name: "Diego Mora",
      email: "diego@cataclub.test",
      role,
      representanteId: null,
      fechaNacimiento: "1990-05-01",
      ...(role === "estudiante" ? { activo: true } : {}),
    },
    roles: [role === "estudiante" ? "ALUMNO" : "ENTRENADOR"],
    isStaffPlayer: role === "trainer",
    staffAwaitsFirstPayment: false,
    correoVerificado: true,
    altaPresencialCompletada: true,
    activacionCompleta: true,
    loggedInAt: "2026-10-13T00:00:00.000Z",
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockBlockedSession(page: Page, role: "estudiante" | "trainer"): Promise<void> {
  await page.context().addCookies([{ name: "access_token", value: MOCK_ACCESS_TOKEN, url: E2E_BASE_URL }]);
  // Registered first so every specific route below wins over it; anything this
  // spec does not care about fails softly (500) instead of bouncing to /login.
  await page.route("**/api/**", (route: Route) => fulfillJson(route, { message: "not mocked" }, 500));
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, session(role)));
  await page.route("**/api/student?*", (route: Route) => fulfillJson(route, BLOCKED_PORTAL));
  await page.route("**/api/membresias/pagos/persona/*", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/membresias/coberturas/persona/*", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/personas/*/beneficio", (route: Route) => fulfillJson(route, null));
  await page.route("**/api/asistencias/alumnos/*/horarios", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await mockClubPaymentInfo(page);
}

test("a blocked player is sent to Payments from every other portal page, and can pay from there", async ({ page }) => {
  await mockBlockedSession(page, "estudiante");

  for (const path of ["/student", "/student/attendance", "/student/medical-record"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/student\/payments(\?alumno=9)?$/);
    await expect(page.getByText(BANNER)).toBeVisible();
  }

  // The whole payment module is there: nothing about going to the club first.
  await expect(page.getByRole("button", { name: /registrar un pago/i })).toBeVisible();
});

test("a coach whose own membership is blocked keeps the whole player section", async ({ page }) => {
  await mockBlockedSession(page, "trainer");

  await page.goto("/student/attendance");

  await expect(page).toHaveURL(/\/student\/attendance/);
  await expect(page.getByText(BANNER)).toHaveCount(0);

  await page.goto("/student/payments");
  await expect(page.getByText(BANNER)).toBeVisible();
});
