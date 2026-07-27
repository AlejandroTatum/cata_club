import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
/** Resolved in ONE place — see `e2e-target.ts` for why it is not port 3000. */
const BASE_URL = E2E_BASE_URL;
const MOCK_SESSION = {
  user: {
    id: "2",
    name: "Carla Entrenadora",
    email: "trainer@cataclub.test",
    role: "trainer" as const,
    representanteId: null,
  },
  roles: ["ENTRENADOR"],
  loggedInAt: "2026-07-21T00:00:00.000Z",
};

/**
 * The one mocked slot, as the selector labels it: an em dash between the two
 * times, then the trainer's name ("18:00 — 19:00 Carla Entrenadora").
 *
 * Anchored on the times rather than on the whole label so the assertion is
 * about the SLOT the trainer is picking — the same thing `18:00 a 19:00` used
 * to identify before the label was reworded — and does not break when the
 * trailing trainer name changes.
 */
const SCHEDULE_SLOT = /18:00\s*—\s*19:00/;

/**
 * Wednesday 2026-07-22, 13:00 in `America/Guayaquil` (the club time zone).
 *
 * The screen reads the CURRENT weekday twice — `selectVisibleSchedules` narrows
 * the picker to today, and an effect auto-expands today's accordion panel — and
 * the only mocked schedule is a `lun` one. Left on the real clock, this spec
 * therefore ran a DIFFERENT path every Monday: the panel was already open, the
 * unconditional "lunes" click below closed it, and the slot button never
 * appeared. That is a genuine test bug and it red CI once a week.
 *
 * Pinning is preferred over making the click conditional on `aria-expanded`,
 * because a conditional click would keep the branch taken varying by weekday —
 * the same non-determinism, just no longer failing loudly. A defect in either
 * branch would then surface on one day in seven. With the clock fixed, the spec
 * exercises exactly one path on every run, and it is the collapsed-by-default
 * path these assertions were written for. The auto-expand default itself is
 * covered by the unit tests around `selectVisibleSchedules` / `todayDiaSemana`.
 *
 * The instant is chosen after `MOCK_SESSION.loggedInAt` so a pinned "now" never
 * predates the session it is paired with.
 */
const FIXED_NOW = new Date("2026-07-22T18:00:00.000Z");

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockTrainerAttendanceRuntime(page: Page): Promise<void> {
  /* Before the first `goto`, so the page never observes the real clock. */
  await page.clock.setFixedTime(FIXED_NOW);
  await page.context().addCookies([{
    name: "access_token",
    value: MOCK_ACCESS_TOKEN,
    url: BASE_URL,
  }]);
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, MOCK_SESSION));
  await page.route("**/api/attendance/schedules", (route: Route) => fulfillJson(route, [
    {
      id: 11,
      diaSemana: "lun",
      horaInicio: "18:00",
      horaFin: "19:00",
      entrenadorId: 2,
      entrenadorNombre: "Carla Entrenadora",
    },
  ]));
  await page.route("**/api/groups/horarios/11/alumnos", (route: Route) => fulfillJson(route, [
    {
      id: 1,
      personaId: 9,
      personaNombreCompleto: "Ana López",
      edad: 12,
      horarioId: 11,
      horarioDia: "lun",
      horarioHoraInicio: "18:00",
      horarioHoraFin: "19:00",
      fechaAsignacion: "2026-01-01T00:00:00Z",
    },
  ]));
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/attendance/records*", (route: Route) => fulfillJson(route, []));
}

test("trainer directly selects every attendance state at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTrainerAttendanceRuntime(page);

  await page.goto("/trainer/attendance");
  await page.getByRole("button", { name: /lunes/i }).click();
  await page.getByRole("button", { name: SCHEDULE_SLOT }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  /*
   * The four states are now a `radiogroup` of `role="radio"` controls, not a
   * `group` of `aria-pressed` toggles: they are mutually exclusive, and four
   * independent toggle buttons never conveyed that. The behaviour this test
   * guards is unchanged and is asserted just as strictly — every state is
   * reachable in one tap and reports itself as the selected one — through the
   * roles and the selection attribute the controls actually expose now.
   *
   * The group's accessible name still comes from the RENDERED student name
   * (`aria-labelledby` pointing at the sr-only prefix plus the name element),
   * so this also keeps pinning that the group cannot drift from what is on
   * screen.
   */
  const stateGroup = page.getByRole("radiogroup", { name: "Estado de asistencia de Ana López" });
  await expect(stateGroup).toBeVisible();

  for (const name of ["Presente", "Ausente", "Tardanza", "Justificado"]) {
    const stateControl = stateGroup.getByRole("radio", { name, exact: true });
    await expect(stateControl).toBeVisible();
    await stateControl.click();
    await expect(stateControl).toHaveAttribute("aria-checked", "true");
  }
});

test("trainer discovers mobile navigation and Justificado guidance at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockTrainerAttendanceRuntime(page);

  await page.goto("/trainer/attendance");

  const menu = page.getByRole("button", { name: "Abrir menú principal" });
  await expect(menu).toHaveText("Menú");
  await menu.click();
  await expect(page.getByRole("navigation", { name: "Navegación principal" })).toBeVisible();
  await page.getByRole("button", { name: "Cerrar menú" }).click();

  await page.getByRole("button", { name: /lunes/i }).click();
  await page.getByRole("button", { name: SCHEDULE_SLOT }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByText("Ana López", { exact: true })).toBeVisible();
});
