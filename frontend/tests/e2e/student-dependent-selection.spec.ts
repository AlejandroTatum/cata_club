/**
 * Issue #44 — the dependent selection must survive sidebar navigation.
 *
 * A guardian with two children picks one on "Mi cuenta", opens "Pagos" from the
 * sidebar, and the screen must still be about the SAME child: same plan, same
 * amount, same history. The reported failure mode was a silent revert to the
 * first dependent, which is one click away from registering money against the
 * wrong child.
 *
 * The revert itself no longer happens: `ManagedStudentPicker` moved the
 * selection into `?alumno=` with a per-account `sessionStorage` fallback, and
 * this journey was already green when the spec was written. What was missing is
 * the guard — the mechanism spans three routes and nothing pinned it end to end,
 * so any of the three screens could have drifted back without a red test.
 *
 * It is a real E2E rather than a component test on purpose. The load-bearing
 * step is cross-ROUTE: the sidebar's "Pagos"/"Asistencias" rows are plain
 * `/student/...` links that carry no query string, so `?alumno=` alone cannot
 * survive them and the storage fallback is what does. A component test with a
 * router double never unmounts one screen and mounts the next against the same
 * tab storage, so it cannot observe that hand-off at all — it would assert the
 * double's behaviour, not the app's. Deleting the fallback and rebuilding fails
 * this spec at exactly the sidebar → Pagos step, which is what makes it a guard
 * rather than a description.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
/** Resolved in ONE place — see `e2e-target.ts` for why it is not port 3000. */
const BASE_URL = E2E_BASE_URL;

/** The guardian herself has no ALUMNO profile — she only manages the two. */
const MOCK_SESSION = {
  user: {
    id: "7",
    name: "Laura Vera",
    email: "laura@cataclub.test",
    role: "representante" as const,
    representanteId: null,
  },
  roles: ["REPRESENTANTE"],
  loggedInAt: "2026-07-21T00:00:00.000Z",
};

/**
 * `representados` order matters: Sofía is first, so "the first dependent" and
 * "the selected dependent" are different profiles. Selecting Sofía would make
 * every assertion below pass by accident, whatever the code did.
 */
function dependent(personaId: string, nombres: string, fechaNacimiento: string) {
  return {
    personaId,
    nombres,
    apellidos: "Vera",
    fechaNacimiento,
    ranking: { status: "unavailable" as const, reason: "error" as const },
    recentSessions: [],
    membership: {
      id: Number(personaId),
      estado: "ACTIVA",
      personaId: Number(personaId),
      montoAplicado: "40.00",
      categoria: `Plan de ${nombres}`,
      modalidad: "MENSUAL",
      franjaHoraria: "TARDE",
      fechaActivacion: "2026-01-10",
      fechaFin: "2026-12-31",
    },
    representante: { nombres: "Laura", apellidos: "Vera" },
    representanteId: 7,
  };
}

const PORTAL = {
  self: null,
  representados: [
    dependent("41", "Sofía", "2016-03-02"),
    dependent("42", "Martín", "2010-08-19"),
  ],
  membershipPlans: [],
};

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockGuardianPortal(page: Page): Promise<void> {
  await page.context().addCookies([{
    name: "access_token",
    value: MOCK_ACCESS_TOKEN,
    url: BASE_URL,
  }]);
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, MOCK_SESSION));
  await page.route("**/api/student?*", (route: Route) => fulfillJson(route, PORTAL));
  await page.route("**/api/membresias/pagos/persona/*", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/asistencias/alumnos/*/horarios", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) => fulfillJson(route, []));
}

/** The sidebar row a guardian actually clicks — not a scripted `goto`. */
function sidebarLink(page: Page, label: string) {
  return page
    .getByRole("navigation", { name: "Navegación principal" })
    .getByRole("link", { name: label, exact: true });
}

test("the dependent selection survives Mi cuenta → Pagos → Asistencias", async ({ page }) => {
  await mockGuardianPortal(page);

  await page.goto("/student");

  // Step 2 of the issue's reproduction: switch to the SECOND child.
  const picker = page.getByLabel("Estudiante");
  await expect(picker).toBeVisible();
  await picker.selectOption("42");
  await expect(page.getByTestId("student-carnet")).toHaveAttribute(
    "aria-label",
    "Carnet de socio de Martín Vera",
  );

  // Step 3: "Pagos" from the sidebar — a bare `/student/payments` link that
  // cannot carry `?alumno=`. This is the exact navigation that broke.
  await sidebarLink(page, "Pagos").click();
  await expect(page).toHaveURL(/\/student\/payments/);

  // Step 4: whose data is on screen. The screen's own answer, not the select's.
  await expect(page.getByText("Membresía de Martín")).toBeVisible();
  await expect(page.getByText("Plan de Martín")).toBeVisible();
  await expect(page.getByLabel("Estudiante")).toHaveValue("42");

  // The third section named by the acceptance criterion.
  await sidebarLink(page, "Asistencias").click();
  await expect(page).toHaveURL(/\/student\/attendance/);
  await expect(page.getByText("Asistencia de Martín", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Estudiante")).toHaveValue("42");

  // And back, because a selection that only survives forwards is not kept.
  await sidebarLink(page, "Mi cuenta").click();
  await expect(page.getByTestId("student-carnet")).toHaveAttribute(
    "aria-label",
    "Carnet de socio de Martín Vera",
  );
});
