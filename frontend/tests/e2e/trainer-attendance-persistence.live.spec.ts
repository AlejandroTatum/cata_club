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
 * ## Por qué la sesión se descubre en cada corrida
 *
 * El backend solo registra asistencia entre «hoy» (día del club) y 30 días
 * atrás, y solo en la fecha cuyo día de semana es el del horario. Una fecha
 * fija (este spec usó `2025-01-06`) sale de esa ventana y el alta responde 400
 * `ventana=30`. Y "hoy" tampoco sirve solo: el seed no crea horarios los
 * domingos, y `registrar_asistencia` cierra la sesión (horario_id, fecha) de
 * forma PERMANENTE en el primer alta exitoso, mientras que el bulk-seed ya
 * cerró las últimas 4 ocurrencias de cada horario.
 *
 * Por eso `findOpenAttendanceSession` (`helpers/attendance-session.ts`) recorre
 * la ventana desde hoy hacia atrás y elige la sesión más reciente de un horario
 * de Ana que NO tiene ninguna asistencia. Verifica contra la API real — no lo
 * asume — que el día de semana y el roster son los correctos.
 *
 * ## Repetibilidad — incluida la corrida DOS VECES seguidas que pide la ronda de QA
 *
 * Cada corrida cierra una sesión distinta (la siguiente libre). Si ya no queda
 * ninguna libre, el spec usa la más reciente donde una corrida anterior dejó a
 * Ana como "Ausente" (`readOnly` ya viene en `true` al abrirla) y verifica
 * DIRECTAMENTE que el valor persistido es el que esa corrida dejó — que es, en
 * sí mismo, la prueba de persistencia más fuerte posible: sobrevivió no solo a
 * un reload sino a un reinicio completo del proceso de Playwright.
 */
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { findOpenAttendanceSession } from "./helpers/attendance-session";

/** Sembrados por `backend/scripts/seed_dev_base.py`. */
const TRAINER_EMAIL = "entrenador@cataclub.com";
const TRAINER_PASSWORD = "trainer12345";

const STUDENT_NAME = "Ana Garcia";
const MARKED_STATE = "Ausente";

/**
 * Inicia sesión como entrenador y descubre la sesión (horario + fecha dentro de
 * la ventana de 30 días) que este spec va a marcar. Si el seed cambiara y Ana
 * dejara de estar en un horario, falla acá con un mensaje que lo dice.
 */
async function resolveSession(request: APIRequestContext) {
  const login = await request.post("/api/auth/login", {
    data: { email: TRAINER_EMAIL, password: TRAINER_PASSWORD },
  });
  expect(login.ok(), `No se pudo iniciar sesión como entrenador: ${login.status()}`).toBe(true);
  return findOpenAttendanceSession(request, STUDENT_NAME, "absent");
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
  const badge = row.getByText(/^(Presente|Ausente|Tardanza|Enfermo|Competencia)$/, { exact: true });
  return badge.innerText();
}

test("un entrenador marca asistencia de una sesión real y, tras reload, lo marcado sigue ahí (#389)", async ({
  page,
  request,
}) => {
  test.setTimeout(60_000);
  const { horarioId, fecha, studentPersonaId } = await resolveSession(request);
  const deepLink = `/trainer/attendance?horario=${horarioId}&fecha=${fecha}&paso=lista`;

  await loginAsTrainer(page);
  await page.goto(deepLink);

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
  await page.goto(deepLink);
  await expect(page.getByText("Esta lista ya fue registrada.")).toBeVisible({ timeout: 20_000 });
  expect(await readAnaBadge(page)).toBe(MARKED_STATE);

  await page.reload();
  await expect(page.getByText("Esta lista ya fue registrada.")).toBeVisible({ timeout: 20_000 });
  expect(await readAnaBadge(page)).toBe(MARKED_STATE);

  // ── Y la confirmación independiente de la UI: el registro real en la
  // base, leído directo por la API — no solo lo que React decidió pintar. ──
  const recorded = (await request
    .get(
      `/api/attendance/records?fechaInicio=${fecha}&fechaFin=${fecha}&horarioId=${horarioId}&personaId=${studentPersonaId}`,
    )
    .then((r) => r.json())) as Array<{ estado: string }>;
  expect(recorded).toHaveLength(1);
  expect(recorded[0].estado).toBe("absent");
});
