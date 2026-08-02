/**
 * "Corregir" crosses two routes, so it gets an end-to-end test (#95).
 *
 * The unit tests cover each half: the history builds the href, and the wizard
 * honours `?horario=&fecha=`. Neither can catch the two halves agreeing on a
 * URL that the OTHER one does not actually read the same way — which is the
 * only failure mode this feature really has. So this spec starts on the
 * history, clicks the button a trainer clicks, and follows it all the way to
 * the batch that gets POSTed.
 */

import { expect, test, type Page, type Route } from "@playwright/test";

import { E2E_BASE_URL } from "./e2e-target";

const MOCK_ACCESS_TOKEN = "mock-header.mock-payload.mock-signature";
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
  await page.route("**/api/ranking/notificaciones/mias", (route: Route) => fulfillJson(route, []));
  await page.route("**/api/attendance/schedules", (route: Route) => fulfillJson(route, [
    { id: HORARIO_ID, diaSemana: "lun", horaInicio: "18:00", horaFin: "19:00", nivelRankingId: null },
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

test("Corregir opens that session's roll call and files the fix on its own date", async ({ page }) => {
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
  const stateGroup = page.getByRole("radiogroup", { name: "Estado de asistencia de Ana López" });
  await expect(stateGroup.getByRole("radio", { name: "Ausente", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  // Correct it, and file.
  await stateGroup.getByRole("radio", { name: "Presente", exact: true }).click();
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await page.getByRole("button", { name: /Confirmar Asistencia/ }).click();
  await expect(page.getByText("Asistencia Registrada")).toBeVisible();

  expect(runtime.postedBatches).toHaveLength(1);
  expect(runtime.postedBatches[0]).toMatchObject({
    horarioId: HORARIO_ID,
    // The whole point. On the default this would be 2026-07-22 and the
    // session the trainer meant to fix would still be wrong.
    fechaEntrenamiento: SESSION_DATE,
    students: [{ personaId: 9, estado: "present" }],
  });
});
