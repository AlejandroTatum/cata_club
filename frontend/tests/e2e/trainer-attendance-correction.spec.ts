/**
 * "Corregir" crosses two routes, so it gets an end-to-end test (#95).
 *
 * The unit tests cover each half: the history builds the href, and the wizard
 * honours `?horario=&fecha=`. Neither can catch the two halves agreeing on a
 * URL that the OTHER one does not actually read the same way — which is the
 * only failure mode this feature really has. So this spec starts on the
 * history, clicks the button an administrator clicks, and follows it all the
 * way to the batch that gets POSTed.
 *
 * Issue #389, slice 4b adds a SECOND pair of routes that need the same
 * discipline: the new per-row "Corregir" button on the roster this deep-link
 * lands on, and its own BFF proxy (`PATCH /api/attendance/records/{id}/correct`).
 * The unit/route tests already cover each side in isolation; this spec's own
 * stated purpose — prove the two routes agree — extends naturally to prove
 * this third route pair agrees too, in the same flow this file already sets
 * up.
 */

import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
const BASE_URL = E2E_BASE_URL;
const MOCK_SESSION = {
  user: {
    id: "1",
    name: "Admin Demo",
    email: "admin@cataclub.com",
    role: "admin" as const,
    representanteId: null,
  },
  roles: ["ADMINISTRADOR"],
  loggedInAt: "2026-07-21T00:00:00.000Z",
};

/**
 * Wednesday 2026-07-22, 13:00 in `America/Guayaquil`, same reasoning as
 * `trainer-attendance-selector.spec.ts`: the picker narrows to the current
 * weekday, so the clock has to be pinned or the run varies by day.
 *
 * The session being corrected is Monday the 20th — deliberately NOT today,
 * which is the entire point. A wizard that quietly used today would file
 * 2026-07-22 and this spec would catch it.
 */
const FIXED_NOW = new Date("2026-07-22T18:00:00.000Z");
const SESSION_DATE = "2026-07-20";
const HORARIO_ID = 11;

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** The one already-filed record of the session being corrected. */
const FILED_RECORD = {
  id: "501",
  fecha: SESSION_DATE,
  horario: "Lunes 18:00 — 19:00",
  horarioId: HORARIO_ID,
  personaId: 9,
  estudiante: "Ana López",
  estado: "absent",
};

interface CorrectionRuntime {
  /** Bodies of every `POST /api/attendance/records`, in order. */
  postedBatches: unknown[];
}

async function mockCorrectionRuntime(page: Page): Promise<CorrectionRuntime> {
  const postedBatches: unknown[] = [];

  await page.clock.setFixedTime(FIXED_NOW);
  await page.context().addCookies([{
    name: "access_token",
    value: MOCK_ACCESS_TOKEN,
    url: BASE_URL,
  }]);
  await page.route("**/api/auth/session", (route: Route) => fulfillJson(route, MOCK_SESSION));
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) =>
    fulfillJson(route, { items: [], total: 0, skip: 0, limit: 20 }),
  );
  // AppShell's admin-only pending-payments badge calls this on every screen.
  // Unmocked, it escaped to the real BFF, got a 401, and the app's global
  // session handling redirected to /login mid-navigation.
  await page.route("**/api/dashboard", (route: Route) => fulfillJson(route, {}));
  await page.route("**/api/attendance/schedules", (route: Route) => fulfillJson(route, [
    { id: HORARIO_ID, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00" },
  ]));
  await page.route(`**/api/groups/horarios/${HORARIO_ID}/alumnos*`, (route: Route) => fulfillJson(route, {
    items: [
      {
        id: 1,
        personaId: 9,
        personaNombreCompleto: "Ana López",
        edad: 12,
        horarioId: HORARIO_ID,
        horarioDia: "lun",
        horarioHoraInicio: "18:00",
        horarioHoraFin: "19:00",
        fechaAsignacion: "2026-01-01T00:00:00Z",
      },
    ],
    total: 1,
    skip: 0,
    limit: 200,
  }));

  await page.route("**/api/attendance/records*", async (route: Route) => {
    const request = route.request();
    if (request.method() === "POST") {
      postedBatches.push(request.postDataJSON());
      await fulfillJson(route, { createdCount: 1, failed: [] });
      return;
    }
    // The wizard's prefill asks for ONE day. Answering it with the record only
    // when that day is the corrected one is what makes "the wizard opened the
    // right session" observable from the outside: get the date wrong and the
    // roster comes back empty instead of showing Ana as absent.
    const params = new URL(request.url()).searchParams;
    const asksForTheSession =
      params.get("fechaInicio") === SESSION_DATE && params.get("fechaFin") === SESSION_DATE;
    const isSingleDay = params.get("fechaInicio") === params.get("fechaFin");
    await fulfillJson(route, asksForTheSession || !isSingleDay ? [FILED_RECORD] : []);
  });

  return { postedBatches };
}

test("Corregir opens that session's roll call, and the row-level Corregir actually corrects it (issue #389)", async ({ page }) => {
  const runtime = await mockCorrectionRuntime(page);

  await page.goto("/trainer/attendance/history");

  // One row per session, and its Corregir addresses that session.
  const corregir = page.getByRole("link", { name: "Corregir" }).first();
  await expect(corregir).toBeVisible();
  await corregir.click();

  // Landed on the roll call, not on "Elija el horario".
  await expect(page).toHaveURL(
    new RegExp(`/trainer/attendance\\?horario=${HORARIO_ID}&fecha=${SESSION_DATE}&paso=lista$`),
  );
  await expect(page.getByText("Elija el horario")).toBeHidden();

  // The marks already filed for THAT day are on screen — proof the wizard
  // asked the API for the corrected session and not for today.
  await expect(page.getByText("Ana López")).toBeVisible();
  await expect(page.getByText("Ausente", { exact: true }).first()).toBeVisible();

  // Issue #389: closing a session is now permanent for EVERY role, admin
  // included. This link used to land on an EDITABLE roster an admin could
  // resubmit (issue #95's original "Corregir" mechanism) — that mechanism
  // was removed on purpose. The WIZARD's own controls stay a dead end that
  // tells the truth: read-only, no radios of its own, no way to resubmit
  // from here.
  await expect(page.getByText("Esta lista ya fue registrada.")).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Revisar y confirmar" })).toBeDisabled();

  expect(runtime.postedBatches).toHaveLength(0);

  // The real working door lives beside Ana's row instead: this slice's
  // per-row "Corregir" (motivo + traza, PATCH /asistencias/{id}/corregir
  // through its own BFF proxy). Prove it end to end — click it, submit a
  // motivo, and check the button + its own BFF route agree on the payload.
  let correctionRequestBody: unknown = null;
  await page.route(`**/api/attendance/records/${FILED_RECORD.id}/correct`, async (route: Route) => {
    correctionRequestBody = route.request().postDataJSON();
    await fulfillJson(route, {
      asistencia: { ...FILED_RECORD, estado: "present" },
      corregidoPorId: 1,
      corregidoPorNombre: "Admin Demo",
      corregidoEn: "2026-07-22T18:00:00Z",
      motivo: "Se confirmó presencia con el profesor.",
      estadoAnterior: "absent",
    });
  });

  await page.getByRole("button", { name: "Corregir" }).click();
  await page.getByRole("radio", { name: "Presente" }).click();
  await page
    .getByPlaceholder("Por qué se corrige este registro")
    .fill("Se confirmó presencia con el profesor.");
  await page.getByRole("button", { name: "Guardar corrección" }).click();

  await expect(page.getByText("Corrección guardada.")).toBeVisible();
  expect(correctionRequestBody).toMatchObject({
    estado: "present",
    motivo: "Se confirmó presencia con el profesor.",
  });
  // Updated in place — the badge next to Ana's name now reads her new state.
  await expect(page.getByText("Presente", { exact: true })).toBeVisible();
});
