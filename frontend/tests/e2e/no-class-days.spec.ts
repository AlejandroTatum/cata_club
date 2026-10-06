/**
 * No-class days (issue #1665): the admin announces them, members read them in
 * their panel, and the public landing never shows them.
 *
 * Like `admin-smoke.spec.ts`, this intercepts the same-origin /api/* routes: the
 * BFF contract is covered by route-handler unit tests, and this environment has
 * no seeded backend. What is exercised for real is the frontend flow.
 */

import { test, expect, type Page, type Route } from "@playwright/test";

const ADMIN_SESSION = {
  user: { id: "1", name: "Admin Demo", email: "admin@cataclub.com", role: "admin" as const, representanteId: null },
  roles: ["ADMINISTRADOR"],
  loggedInAt: new Date().toISOString(),
};

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";

interface Day { id: number; fechaInicio: string; fechaFin: string; motivo: string }

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** A signed-in admin plus a stateful in-memory `/api/dias-sin-clase`. */
async function mockAdminAndDays(page: Page, days: Day[]): Promise<void> {
  await page.context().addCookies([
    { name: "access_token", value: MOCK_ACCESS_TOKEN, url: "http://localhost" },
  ]);
  // Catch-all first (last-registered wins): unanswered shell calls would reach
  // the real BFF, fail, and log the session out.
  await page.route("**/api/**", (route) =>
    route.request().method() === "GET" ? fulfillJson(route, []) : fulfillJson(route, {}),
  );
  await page.route("**/api/ranking/notificaciones/mias", (route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  await page.route("**/api/auth/session", (route) => fulfillJson(route, ADMIN_SESSION));
  await page.route("**/api/dias-sin-clase**", async (route) => {
    const request = route.request();
    const id = /\/dias-sin-clase\/(\d+)/.exec(request.url())?.[1];
    if (request.method() === "GET") return fulfillJson(route, days);
    if (request.method() === "DELETE") {
      days.splice(days.findIndex((d) => d.id === Number(id)), 1);
      return route.fulfill({ status: 204 });
    }
    const body = request.postDataJSON() as { fecha_inicio: string; fecha_fin: string | null; motivo: string };
    const day = { id: Number(id ?? 100), fechaInicio: body.fecha_inicio, fechaFin: body.fecha_fin ?? body.fecha_inicio, motivo: body.motivo };
    if (request.method() === "POST") days.push(day);
    else days.splice(days.findIndex((d) => d.id === day.id), 1, day);
    return fulfillJson(route, day, request.method() === "POST" ? 201 : 200);
  });
}

test.describe("No-class days", () => {
  test("admin creates, edits and deletes a day", async ({ page }) => {
    await mockAdminAndDays(page, []);
    await page.goto("/admin/dias-sin-clase");
    await expect(page.getByRole("heading", { name: "Días sin clase", level: 1 })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Aún no hay días sin clase")).toBeVisible();

    await page.getByLabel(/^Desde/).fill("2029-07-04");
    await page.getByLabel(/^Motivo/).fill("Feriado nacional");
    await page.getByRole("button", { name: "Publicar día sin clase" }).click();
    await expect(page.getByText("04/07/2029", { exact: true })).toBeVisible();
    await expect(page.getByText("Feriado nacional")).toBeVisible();

    await page.getByRole("button", { name: "Editar 04/07/2029" }).click();
    await page.getByLabel(/^Motivo/).fill("Evento del club");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Evento del club")).toBeVisible();

    await page.getByRole("button", { name: "Eliminar 04/07/2029" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Eliminar" }).click();
    await expect(page.getByText("Aún no hay días sin clase")).toBeVisible();
  });

  test("the admin screen fits a phone without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockAdminAndDays(page, [
      { id: 1, fechaInicio: "2029-07-10", fechaFin: "2029-07-12", motivo: "Cancha cerrada por mantenimiento del club durante esos días" },
    ]);
    await page.goto("/admin/dias-sin-clase");
    await expect(page.getByText("10/07/2029 – 12/07/2029")).toBeVisible({ timeout: 20_000 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("the public landing neither requests nor shows them", async ({ page }) => {
    const requested: string[] = [];
    await page.route("**/api/dias-sin-clase**", (route) => {
      requested.push(route.request().url());
      return fulfillJson(route, [{ id: 1, fechaInicio: "2999-01-01", fechaFin: "2999-01-01", motivo: "Motivo secreto del club" }]);
    });
    await page.goto("/");
    await expect(page.locator("a.landing-logo img")).toBeVisible();
    await page.waitForLoadState("networkidle");

    expect(requested).toEqual([]);
    await expect(page.getByText("Motivo secreto del club")).toHaveCount(0);
  });
});
