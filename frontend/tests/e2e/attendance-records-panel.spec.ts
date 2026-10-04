/**
 * «Registros» opens the session's detail right under the session (#1577).
 *
 * The unit tests pin the DOM shape per rendering; this spec proves it in a
 * real layout, with the middle session of three — the case where a panel at
 * the end of the list is visibly far from the row that was pressed.
 */

import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const MOCK_SESSION = {
  user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin" as const, representanteId: null },
  roles: ["ADMINISTRADOR"],
  loggedInAt: "2026-07-21T00:00:00.000Z",
};
const FIXED_NOW = new Date("2026-07-22T18:00:00.000Z");
const HORARIO_ID = 11;
const DATES = ["2026-07-20", "2026-07-13", "2026-07-06"];

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockHistory(page: Page): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW);
  await page.context().addCookies([
    { name: "access_token", value: "mock-header.mock-payload.mock-signature", url: E2E_BASE_URL },
  ]);
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, MOCK_SESSION));
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/dashboard", (route: Route) => fulfillJson(route, {}));
  await page.route("**/api/attendance/schedules", (route: Route) =>
    fulfillJson(route, [{ id: HORARIO_ID, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00" }]),
  );
  await page.route("**/api/attendance/records*", (route: Route) =>
    fulfillJson(
      route,
      DATES.map((fecha, i) => ({
        id: String(500 + i),
        fecha,
        horario: "Lunes 18:00 — 19:00",
        horarioId: HORARIO_ID,
        personaId: 9 + i,
        estudiante: `Alumno ${i + 1}`,
        estado: "present",
      })),
    ),
  );
}

const VIEWPORTS = [
  { name: "desktop", size: { width: 1280, height: 900 }, scope: "history-desktop-table" },
  { name: "mobile", size: { width: 390, height: 844 }, scope: "history-mobile-list" },
] as const;

for (const { name, size, scope } of VIEWPORTS) {
  test(`${name}: «Registros» opens the detail adjacent to the pressed session (#1577)`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockHistory(page);
    await page.goto("/attendance");

    const list = page.getByTestId(scope);
    const toggles = list.getByRole("button", { name: /^Registros/ });
    await expect(toggles).toHaveCount(3);
    await toggles.nth(1).click();

    const panel = page.getByTestId("session-detail");
    await expect(panel).toHaveCount(1);
    await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "true");
    await expect(toggles.nth(1)).toHaveAttribute("aria-controls", (await panel.getAttribute("id")) ?? "");

    const pressed = (await toggles.nth(1).boundingBox())!;
    const next = (await toggles.nth(2).boundingBox())!;
    const open = (await panel.boundingBox())!;
    // Below the pressed session and above the one after it, not at the end of the list.
    expect(open.y).toBeGreaterThan(pressed.y);
    expect(open.y + open.height).toBeLessThanOrEqual(next.y + 1);

    // Opening another session closes this one.
    await toggles.nth(0).click();
    await expect(panel).toHaveCount(1);
    await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "false");
  });
}
