/**
 * Módulo 4 — asistencia real del entrenador: toma y PERSISTENCIA (issue #389).
 *
 * ## Qué prueba, y por qué hacía falta
 *
 * Los tres specs mockeados que ya existían (`trainer-attendance-selector`,
 * `-overlap`, `-correction`) miden geometría y selección contra rutas
 * interceptadas: nunca tocan el backend real. Ninguno prueba lo único que de
 * verdad importa de "pasar lista" — que lo marcado QUEDE guardado. Este spec
 * corre contra el backend real (`docker compose -p cataclub-qa`) y cierra ese
 * hueco: un entrenador marca asistencia de una sesión real, se recarga la
 * página, y lo marcado sigue ahí.
 *
 * ## Por qué esta fecha, y no "hoy"
 *
 * El seed NO crea horarios para todos los días: `FORMATIVO`/`INFANTIL`/
 * `ADULTOS` corren Lun-Vie y `COMPETITIVO` Lun-Sáb — nunca domingo. El día
 * real en que este spec puede correr no está garantizado (hoy mismo, al
 * escribirlo, es domingo), así que "hoy" no es una fecha válida para NINGÚN
 * horario. `beforeAll` verifica contra la API real — no lo asume — que
 * `HORARIO_ID` cae en `LUNES` y que `SESSION_DATE` es efectivamente un lunes.
 *
 * `SESSION_DATE` es fija y deliberadamente vieja (un lunes de enero de 2025):
 * ni "hoy" ni "el lunes más próximo" sirven para una fecha REPETIBLE, porque
 * `registrar_asistencia` cierra la sesión (horario_id, fecha) de forma
 * PERMANENTE en el primer alta exitoso — no hay "volver a tomarla", ni para un
 * administrador. Una fecha relativa a "hoy" colisionaría con el bulk-seed, que
 * ya cerró los últimos cuatro lunes de este horario (10, 17, 24 y 31 de
 * agosto). 2025-01-06 queda fuera de ese rango y, verificado contra la API
 * antes de escribir este spec, no tiene ninguna `Asistencia` registrada.
 *
 * ## Repetibilidad — incluida la corrida DOS VECES seguidas que pide la ronda de QA
 *
 * La primera vez que este spec corre en un stack, la sesión (horario 6,
 * 2025-01-06) está abierta: marca a Ana García como "Ausente", envía el lote
 * completo y confirma que sobrevive a un reload. Desde la SEGUNDA corrida en
 * adelante — incluida la segunda de la ronda de "corré la suite dos veces
 * seguidas" — esa sesión ya quedó cerrada por la corrida anterior (el mismo
 * cierre permanente de arriba). El spec detecta esto (`readOnly` ya viene en
 * `true` al abrir la sesión) y en vez de fallar, verifica DIRECTAMENTE que el
 * valor persistido es el que esta misma corrida anterior dejó — que es, en sí
 * mismo, la prueba de persistencia más fuerte posible: sobrevivió no solo a un
 * reload sino a un reinicio completo del proceso de Playwright.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/** Sembrados por `backend/scripts/seed_dev_base.py`. */
const TRAINER_EMAIL = "entrenador@cataclub.com";
const TRAINER_PASSWORD = "trainer12345";

/** INFANTIL, LUNES 16:00–17:00 — ver el catálogo real en `GET /asistencias/horarios`. */
const HORARIO_ID = 6;
const SESSION_DATE = "2025-01-06";
const STUDENT_NAME = "Ana Garcia";
const MARKED_STATE = "Ausente";

const DEEP_LINK = `/trainer/attendance?horario=${HORARIO_ID}&fecha=${SESSION_DATE}&paso=lista`;

/**
 * Verificación real (no asumida) de que la sesión elegida es utilizable:
 * `SESSION_DATE` cae en un LUNES real, `HORARIO_ID` es efectivamente un
 * horario de los lunes, y el alumno que el spec va a marcar sigue asignado a
 * él. Si el seed cambiara mañana, este spec falla acá — con un mensaje que
 * dice exactamente qué dejó de ser cierto — en vez de perderse en un timeout
 * silencioso más abajo.
 */
async function verifySessionIsUsable(request: APIRequestContext): Promise<{ studentPersonaId: number }> {
  const weekday = new Date(`${SESSION_DATE}T12:00:00Z`).getUTCDay();
  expect(weekday, `${SESSION_DATE} debería ser un lunes (getUTCDay()===1), pero da ${weekday}`).toBe(1);

  const login = await request.post("/api/auth/login", {
    data: { email: TRAINER_EMAIL, password: TRAINER_PASSWORD },
  });
  expect(login.ok(), `No se pudo iniciar sesión como entrenador: ${login.status()}`).toBe(true);

  const schedules = (await request
    .get("/api/attendance/schedules")
    .then((r) => r.json())) as Array<{ id: number; diaSemana: string }>;
  const horario = schedules.find((h) => h.id === HORARIO_ID);
  expect(horario, `El horario ${HORARIO_ID} ya no existe en /api/attendance/schedules`).toBeDefined();
  expect(
    horario?.diaSemana,
    `El horario ${HORARIO_ID} dejó de ser "lun" (ahora es "${horario?.diaSemana}") — ` +
      "esta fecha ya no le corresponde y el spec necesita otro horario/fecha.",
  ).toBe("lun");

  const roster = (await request
    .get(`/api/groups/horarios/${HORARIO_ID}/alumnos?limit=200`)
    .then((r) => r.json())) as { items: Array<{ personaId: number; personaNombreCompleto: string }> };
  const student = roster.items.find((i) => i.personaNombreCompleto === STUDENT_NAME);
  expect(
    student,
    `${STUDENT_NAME} ya no está asignada al horario ${HORARIO_ID} — el spec necesita otra alumna real.`,
  ).toBeDefined();

  return { studentPersonaId: student!.personaId };
}

async function loginAsTrainer(page: Page): Promise<void> {
  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/correo electrónico/i).fill(TRAINER_EMAIL);
  await page.getByRole("textbox", { name: /contraseña/i }).fill(TRAINER_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/trainer/, { timeout: 20_000 });
}

/** El estado que la fila de Ana muestra en la vista de solo lectura, o `null` si la fila no está. */
async function readAnaBadge(page: Page): Promise<string | null> {
  const row = page
    .getByRole("list", { name: "Asistencia registrada (solo lectura)" })
    .getByRole("listitem")
    .filter({ hasText: STUDENT_NAME });
  if ((await row.count()) === 0) return null;
  const badge = row.getByText(/^(Presente|Ausente|Tardanza|Justificado)$/, { exact: true });
  return badge.innerText();
}

test("un entrenador marca asistencia de una sesión real y, tras reload, lo marcado sigue ahí (#389)", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { studentPersonaId } = await verifySessionIsUsable(request);

  await loginAsTrainer(page);
  await page.goto(DEEP_LINK);

  // Se espera a que el roster termine de cargar (aparece en las DOS ramas:
  // de solo lectura o marcable) ANTES de decidir la bifurcación — `isVisible()`
  // sin esperar primero corre el riesgo de mirar el DOM a mitad de un fetch
  // todavía en vuelo y leer "no cerrada" por las puras.
  await expect(page.getByText(STUDENT_NAME, { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  // Punto de bifurcación: primera corrida (sesión abierta) vs. cualquier
  // corrida posterior (ya cerrada por una corrida anterior de ESTE spec —
  // ver el encabezado del archivo).
  const alreadyClosed = await page.getByText("Esta lista ya fue registrada.").isVisible();

  if (!alreadyClosed) {
    // ── Sesión abierta: la marcamos de verdad ──────────────────────────
    const stateGroup = page.getByRole("radiogroup", { name: `Estado de asistencia de ${STUDENT_NAME}` });
    await stateGroup.getByRole("radio", { name: MARKED_STATE, exact: true }).click();
    await expect(stateGroup.getByRole("radio", { name: MARKED_STATE, exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await page.getByRole("button", { name: "Revisar y confirmar" }).click();
    await expect(page.getByText(`Se registrará la asistencia de`)).toBeVisible({ timeout: 10_000 });

    const registerResponse = page.waitForResponse(
      (res) => res.url().includes("/api/attendance/records") && res.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Confirmar asistencia" }).click();
    await registerResponse;
    await expect(page.getByText("Asistencia registrada", { exact: true })).toBeVisible({ timeout: 15_000 });
  }

  // ── La prueba real: una navegación COMPLETAMENTE fresca a la misma
  // sesión (el envío exitoso reemplaza la URL por el selector, así que no
  // hay nada que "recargar" ahí — reabrir el deep link es la forma correcta
  // de forzar un remount contra el servidor), y ENCIMA un reload literal. ──
  await page.goto(DEEP_LINK);
  await expect(page.getByText("Esta lista ya fue registrada.")).toBeVisible({ timeout: 20_000 });
  expect(await readAnaBadge(page)).toBe(MARKED_STATE);

  await page.reload();
  await expect(page.getByText("Esta lista ya fue registrada.")).toBeVisible({ timeout: 20_000 });
  expect(await readAnaBadge(page)).toBe(MARKED_STATE);

  // ── Y la confirmación independiente de la UI: el registro real en la
  // base, leído directo por la API — no solo lo que React decidió pintar. ──
  const recorded = (await request
    .get(
      `/api/attendance/records?fechaInicio=${SESSION_DATE}&fechaFin=${SESSION_DATE}&horarioId=${HORARIO_ID}&personaId=${studentPersonaId}`,
    )
    .then((r) => r.json())) as Array<{ estado: string }>;
  expect(recorded).toHaveLength(1);
  expect(recorded[0].estado).toBe("absent");
});
