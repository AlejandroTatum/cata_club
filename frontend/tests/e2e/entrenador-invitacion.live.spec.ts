/**
 * E2E contra un backend REAL del alta de un entrenador por el administrador
 * (issue #1575): el admin llena «Nuevo entrenador» → sale el correo de
 * invitación (Mailpit) → el entrenador abre el enlace, acepta los términos y
 * crea su contraseña → entra con rol Entrenador.
 *
 * Mismo andamiaje que `recuperacion-contrasenia.live.spec.ts`: el despacho
 * del outbox lo hace a mano `helpers/outbox-dispatch.ts` porque QA no levanta
 * `celery-beat`, y `finally` purga el correo de esta corrida de Mailpit. La
 * cédula y el correo son nuevos en cada corrida (`unique` en la base).
 *
 * También verifica los dos errores del flujo: un correo ya registrado no crea
 * nada, y el entrenador no puede fijar la contraseña sin aceptar los términos.
 *
 * ## Cómo se corre
 *
 *     make qa-up      # backend + base sembrada + frontend
 *     make qa-live
 *
 * Solo lo recoge el proyecto `e2e-live` cuando `E2E_LIVE=1`.
 */
import { expect, test } from "@playwright/test";
import { uniqueValidCedula } from "./helpers/enrollment";
import { loginViaUi } from "./helpers/live-login";
import { extractTokenFromLink, purgeMessagesTo, waitForMessageTo } from "./helpers/mailpit";
import { dispatchPendingOutboxTask } from "./helpers/outbox-dispatch";

/** Sembrado por `backend/scripts/seed_dev_base.py`. */
const ADMIN_EMAIL = "admin@cataclub.com";
const ADMIN_PASSWORD = "admin12345";

const ASUNTO_INVITACION = "Cata Club | Te invitamos como entrenador";
const CONTRASENIA = "clave-entrenador-9";
const correo = `qa-entrenador-${Date.now()}@cataclub.com`;

test("el administrador crea un entrenador, que acepta los términos, crea su contraseña y entra", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  try {
    // ── El administrador crea al entrenador desde Miembros ──
    await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/dashboard/);
    await page.goto("/members");
    await page.getByRole("button", { name: "Nuevo entrenador" }).click();
    const dialog = page.getByRole("dialog", { name: "Nuevo entrenador" });
    await dialog.getByLabel(/^Nombres/).fill("Marta");
    await dialog.getByLabel(/^Apellidos/).fill("Zambrano");
    await dialog.getByLabel(/^Cédula/).fill(uniqueValidCedula());
    await dialog.getByLabel(/^Fecha de nacimiento/).fill("1988-03-02");
    await dialog.getByLabel(/^Correo/).fill(correo);
    await dialog.getByLabel(/^Celular/).fill("991234567");
    await dialog.getByRole("button", { name: "Crear y enviar invitación" }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // ── La cuenta aparece como «Invitación pendiente» ──
    await page.getByRole("searchbox", { name: "Buscar miembros" }).fill("Zambrano");
    await expect(page.getByText("Invitación pendiente").first()).toBeVisible({ timeout: 15_000 });

    // ── Un correo repetido no crea nada y lo dice claro ──
    await page.getByRole("button", { name: "Nuevo entrenador" }).click();
    const repetido = page.getByRole("dialog", { name: "Nuevo entrenador" });
    await repetido.getByLabel(/^Nombres/).fill("Otra");
    await repetido.getByLabel(/^Apellidos/).fill("Persona");
    await repetido.getByLabel(/^Cédula/).fill(uniqueValidCedula());
    await repetido.getByLabel(/^Fecha de nacimiento/).fill("1990-01-01");
    await repetido.getByLabel(/^Correo/).fill(correo);
    await repetido.getByLabel(/^Celular/).fill("991234568");
    await repetido.getByRole("button", { name: "Crear y enviar invitación" }).click();
    await expect(repetido.getByText(/Ya existe una persona o una cuenta/)).toBeVisible({ timeout: 15_000 });
    await repetido.getByRole("button", { name: "Cancelar" }).click();
    await page.context().clearCookies();

    // ── El correo real, despachado y leído de Mailpit ──
    await dispatchPendingOutboxTask(
      "app.infraestructura.tareas.recuperacion_tareas.despachar_recuperaciones_pendientes",
    );
    const mensaje = await waitForMessageTo(request, correo, ASUNTO_INVITACION);
    const token = extractTokenFromLink(mensaje, "/reset-password");

    // ── El enlace: sin aceptar los términos no deja guardar ──
    await page.goto(`/reset-password?token=${token}&invitacion=1`);
    await page.locator("#password").fill(CONTRASENIA);
    await page.locator("#confirmPassword").fill(CONTRASENIA);
    await expect(page.getByRole("button", { name: "Guardar contraseña" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /Acepto los términos y condiciones/ }).check();
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByRole("heading", { name: "Tu cuenta está lista" })).toBeVisible({ timeout: 15_000 });

    // ── El enlace es de un solo uso ──
    await page.goto(`/reset-password?token=${token}&invitacion=1`);
    await page.locator("#password").fill("otra-clave-entrenador-7");
    await page.locator("#confirmPassword").fill("otra-clave-entrenador-7");
    await page.getByRole("checkbox", { name: /Acepto los términos y condiciones/ }).check();
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByRole("heading", { name: "Enlace no válido" })).toBeVisible({ timeout: 15_000 });

    // ── Entra con rol Entrenador ──
    await loginViaUi(page, correo, CONTRASENIA, /\/(dashboard|trainer|attendance)/);
    await expect(page.getByText("Hola, Marta")).toBeVisible({ timeout: 20_000 });
  } finally {
    await purgeMessagesTo(request, correo);
  }
});
