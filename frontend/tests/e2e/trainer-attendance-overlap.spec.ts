import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

/**
 * Issue #318 / hallazgo #25 (cluster K9).
 *
 * At 1440×900, on the very first paint — before the trainer has scrolled at
 * all — the sticky commit bar (`data-testid="attendance-commit-bar"`) pins
 * itself to the viewport's bottom 74px whenever the page is taller than the
 * viewport, and whichever roster row's static position happens to land in
 * that band loses its tap to the bar underneath it: `document.elementFromPoint`
 * on that row returns the bar's own button, not the fiche — the audit's own
 * verification method, reused here for the same reason: a real tap is a hit
 * test, not a rectangle-intersection check, and a fiche the roster's own
 * internal scroll box has clipped away (see the fix below) is invisible, not
 * overlapping — only rows the box is actually showing right now are checked.
 *
 * This spec reproduces that viewport with a 15-alumno roster and asserts, in
 * a REAL rendered browser (jsdom does no layout, so this cannot live in the
 * vitest suite), that at scrollY 0 no VISIBLE fiche resolves a center-point
 * tap to the bar.
 *
 * Confirmed red against unmodified `main` (plus only the two `data-testid`s
 * this spec needs, which carry no behaviour): with the page's default 10-row
 * pagination, row #6 lands inside the bar's band. A `padding-bottom` reserve
 * on the list does not fix this — it only adds room AFTER the last row, and
 * this is a MIDDLE row whose position is set by everything ABOVE it. The fix
 * instead gives the roster its own bounded, internally-scrolling box, so the
 * page never needs to scroll past the bar and no row can ever share its
 * pixels with it.
 */

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
const BASE_URL = E2E_BASE_URL;
const MOCK_SESSION = {
  user: {
    id: "17",
    name: "Coach Torres",
    email: "trainer@cataclub.test",
    role: "trainer" as const,
    representanteId: null,
  },
  roles: ["ENTRENADOR"],
  loggedInAt: "2026-07-21T00:00:00.000Z",
};

const SCHEDULE_SLOT = /18:00\s*—\s*19:00/;

/** Wednesday, same pinning rationale as `trainer-attendance-selector.spec.ts`. */
const FIXED_NOW = new Date("2026-07-22T18:00:00.000Z");

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** 15 alumnos — the exact roster size the audit walked through for #25/#58. */
function buildRoster(): unknown[] {
  const names = [
    "Ana López", "Bruno Cedeño", "Carla Vera", "Diego Mendoza", "Elena Ruiz",
    "Fabián Solís", "Gabriela Ponce", "Hugo Zambrano", "Irene Salcedo", "Josue Mendoza Cedeno",
    "Karen Ortiz", "Luis Chávez", "Mónica Reyes", "Nicolás Andrade", "Oscar Villamar",
  ];
  return names.map((personaNombreCompleto, i) => ({
    id: i + 1,
    personaId: 100 + i,
    personaNombreCompleto,
    edad: 12,
    horarioId: 11,
    horarioDia: "lun",
    horarioHoraInicio: "18:00",
    horarioHoraFin: "19:00",
    fechaAsignacion: "2026-01-01T00:00:00Z",
  }));
}

async function mockTrainerAttendanceRuntime(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.context().addCookies([{
    name: "access_token",
    value: MOCK_ACCESS_TOKEN,
    url: BASE_URL,
  }]);
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, MOCK_SESSION));
  await page.route("**/api/attendance/schedules", (route: Route) => fulfillJson(route, [
    { id: 11, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00" },
  ]));
  await page.route("**/api/groups/horarios/11/alumnos*", (route: Route) => fulfillJson(route, {
    items: buildRoster(),
    total: 15,
    skip: 0,
    limit: 200,
  }));
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/attendance/records*", (route: Route) => fulfillJson(route, []));
}

test("ningún elemento de la barra de acciones se superpone a una ficha de alumno, en el primer pintado (1440×900)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockTrainerAttendanceRuntime(page);

  await page.goto("/trainer/attendance");
  await page.getByRole("button", { name: /lunes/i }).click();
  await page.getByRole("button", { name: SCHEDULE_SLOT }).click();
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page.getByText("Diego Mendoza", { exact: true })).toBeVisible();

  // Deliberately no scroll: this is the state the trainer sees the instant
  // the roster opens, exactly where the audit found the tap stolen. The
  // audit's own method — `document.elementFromPoint` on a fiche returning the
  // bar's button instead — is reused here rather than comparing raw layout
  // rectangles: a fiche partway through the roster's own internal scroll box
  // is legitimately CLIPPED there (invisible, not a tap target at all), and a
  // rectangle-only comparison cannot tell that apart from a real overlap.
  // `elementFromPoint` asks the same question a real tap does.
  const rosterBox = await page.getByTestId("attendance-roster-scroll").boundingBox();
  expect(rosterBox).not.toBeNull();
  if (!rosterBox) return;

  const fiches = page.locator("li[data-attendance]");
  const count = await fiches.count();
  expect(count).toBeGreaterThan(0);

  let checked = 0;
  for (let i = 0; i < count; i++) {
    const fiche = fiches.nth(i);
    const ficheBox = await fiche.boundingBox();
    expect(ficheBox).not.toBeNull();
    if (!ficheBox) continue;

    const centerX = ficheBox.x + ficheBox.width / 2;
    const centerY = ficheBox.y + ficheBox.height / 2;

    // A row clipped away by the roster's OWN internal scroll (needs a
    // scroll inside the box to reveal) is not on screen at all — a trainer
    // cannot tap what is not rendered, so this only checks rows the roster
    // box is actually showing right now.
    if (centerY < rosterBox.y || centerY > rosterBox.y + rosterBox.height) continue;
    checked++;

    const hitOnBar = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.closest('[data-testid="attendance-commit-bar"]') !== null : false;
      },
      [centerX, centerY] as const,
    );

    expect(
      hitOnBar,
      `un tap en el centro de la ficha #${i + 1} no debe caer en la barra de acciones`,
    ).toBe(false);
  }

  // A vacuous pass (every row clipped, none actually on screen) would prove
  // nothing — the whole point is that SOME rows are visibly near the bar.
  expect(checked).toBeGreaterThan(0);
});
