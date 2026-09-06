/**
 * Módulo 4 — corrección real de asistencia (issue #389, slices 2 y 4b).
 *
 * ## Qué prueba, y por qué hacía falta
 *
 * `trainer-attendance-correction.spec.ts` (mockeado) ya prueba que las DOS
 * rutas — el "Corregir" del historial y el "Corregir" por fila del roster —
 * están de acuerdo en la URL/el payload que se pasan. Lo que ningún mock
 * puede probar es que la corrección se aplique DE VERDAD contra el backend
 * (`PATCH /asistencias/{id}/corregir`) y sobreviva a un reload — exactamente
 * el hueco que este spec cierra, contra `cataclub-qa` real.
 *
 * ## Por qué no fabrica la sesión a corregir
 *
 * A diferencia de `trainer-attendance-persistence.live.spec.ts` (que fija un
 * horario/fecha propios para no interferir con nada), este spec toma
 * CUALQUIERA sea la primera sesión corregible que el historial real muestre
 * — el `admin@cataclub.com` sembrado por `seed_dev_base.py` ya tiene sesiones
 * recientes cerradas por el bulk-seed dentro de la ventana de 30 días. Eso lo
 * hace robusto a un re-seed: no depende de un id de horario o de una fecha
 * fija, solo de que EXISTA al menos una sesión corregible, que es justamente
 * lo que el propio historial garantiza filtrando por la ventana.
 *
 * ## Repetibilidad
 *
 * La corrección no cierra nada — solo cambia el VALOR de una fila que ya
 * existía. El spec lee el estado ACTUAL de la fila antes de decidir a qué
 * corregirla (si está en "Presente" la manda a "Ausente"; si no, a
 * "Presente"), así que correr la suite una y otra vez sobre el mismo stack
 * simplemente alterna esos dos valores en cada corrida — nunca falla por
 * "ya está en ese estado" ni dejar la fila en un valor sorpresa.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

/** Sembrado por `backend/scripts/seed_dev_base.py`. */
const ADMIN_EMAIL = "admin@cataclub.com";
const ADMIN_PASSWORD = "admin12345";

const MOTIVO = "Verificación E2E en vivo (módulo 4): confirma que la corrección persiste tras un reload.";

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/correo electrónico/i).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: /contraseña/i }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
}

/** La primera fila de la lista de solo lectura que tiene un botón "Corregir" habilitado. */
function firstCorrectableRow(page: Page): Locator {
  return page
    .getByRole("list", { name: "Asistencia registrada (solo lectura)" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: "Corregir" }) })
    .first();
}

async function badgeTextOf(row: Locator): Promise<string> {
  return row.getByText(/^(Presente|Ausente|Tardanza|Justificado)$/, { exact: true }).innerText();
}

test("un administrador corrige una asistencia real y la corrección sobrevive a un reload (#389)", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await loginAsAdmin(page);

  // ── El historial real: cualquier sesión corregible sirve (ver encabezado) ──
  await page.goto("/trainer/attendance/history");
  const corregirLink = page.getByRole("link", { name: "Corregir" }).first();
  await expect(corregirLink).toBeVisible({ timeout: 20_000 });
  await corregirLink.click();

  await expect(page.getByText("Esta lista ya fue registrada.")).toBeVisible({ timeout: 20_000 });

  const row = firstCorrectableRow(page);
  await expect(row).toBeVisible({ timeout: 20_000 });
  const studentName = await row.locator("span.flex-1").innerText();

  const before = await badgeTextOf(row);
  const target = before === "Presente" ? "Ausente" : "Presente";

  // ── La mutación real: PATCH /api/attendance/records/{id}/correct ──
  await row.getByRole("button", { name: "Corregir" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: target, exact: true }).click();
  await dialog.getByPlaceholder("Por qué se corrige este registro").fill(MOTIVO);

  const correctionResponse = page.waitForResponse(
    (res) => res.url().includes("/attendance/records/") && res.url().includes("/correct") && res.request().method() === "PATCH",
  );
  await dialog.getByRole("button", { name: "Guardar corrección" }).click();
  const response = await correctionResponse;
  expect(response.ok(), `La corrección debía devolver 2xx, devolvió ${response.status()}`).toBe(true);

  await expect(page.getByText("Corrección guardada.")).toBeVisible({ timeout: 15_000 });
  expect(await badgeTextOf(row)).toBe(target);

  // ── El punto del spec: un reload literal, sobre la MISMA URL (a
  // diferencia del alta, corregir no redirige a otra pantalla) ──
  await page.reload();
  await expect(page.getByText("Esta lista ya fue registrada.")).toBeVisible({ timeout: 20_000 });

  const rowAfterReload = page
    .getByRole("list", { name: "Asistencia registrada (solo lectura)" })
    .getByRole("listitem")
    .filter({ hasText: studentName });
  await expect(rowAfterReload).toBeVisible({ timeout: 20_000 });
  expect(await badgeTextOf(rowAfterReload)).toBe(target);
});
