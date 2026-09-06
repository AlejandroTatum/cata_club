/**
 * El sexto spec E2E contra un backend REAL: recuperación de contraseña
 * (E01-RF003), de punta a punta — solicitud desde la UI, correo real leído
 * de Mailpit, enlace seguido, contraseña nueva establecida, y login con la
 * contraseña nueva (la vieja, rechazada).
 *
 * ## Por qué el alta es por API y no por el asistente
 *
 * A diferencia de `activacion.live.spec.ts` — que certifica el asistente de
 * alta en sí —, acá la cuenta es un INSUMO: lo que este spec mide es la
 * recuperación, no la inscripción. Mismo criterio que
 * `payments.live.spec.ts` usa `request.put` para rechazar pagos pendientes
 * sin que esa limpieza cuente como parte de lo medido: `enrollNewPlayerViaApi`
 * (`helpers/enrollment.ts`) llega al mismo estado real — una `Persona` y un
 * `Usuario` reales en la base — sin los ~10 segundos que cuesta atravesar
 * cinco pasos de wizard que ya certifica el otro spec.
 *
 * ## Por qué el despacho manual del outbox
 *
 * Desde que la recuperación pasa por un outbox durable, el request solo deja
 * una fila `PENDIENTE`; el despacho real es 100% responsabilidad de
 * `celery-beat`, que QA no levanta (`Makefile:QA_SERVICIOS`). `make qa-up` ya
 * resuelve exactamente este problema para su propio smoke
 * (`scripts/qa_verify_recovery_delivery.py`) publicando el despachador a
 * mano; este spec reproduce la misma solución vía
 * `helpers/outbox-dispatch.ts`, que documenta por qué no hay una alternativa
 * más liviana (no existe endpoint ni comando de management para esto hoy).
 *
 * ## Aislamiento entre corridas
 *
 * Correo y cédula son `unique` en la base — `enrollNewPlayerViaApi` genera
 * los dos nuevos en cada corrida (`newPlayer`, `helpers/enrollment.ts`), así
 * que dos corridas sobre el mismo stack de QA nunca compiten por la misma
 * cuenta. `finally` purga de Mailpit el correo de esta corrida para que una
 * corrida repetida no encuentre el mensaje viejo en vez del propio.
 *
 * ## Cómo se corre
 *
 *     make qa-up      # backend + base sembrada + frontend, en localhost:3000
 *     make qa-live
 *
 * Igual que el resto de los `*.live.spec.ts`, solo lo recoge el proyecto
 * `e2e-live` cuando `E2E_LIVE=1`.
 */
import { expect, test } from "@playwright/test";
import { enrollNewPlayerViaApi, newPlayer } from "./helpers/enrollment";
import { extractTokenFromLink, purgeMessagesTo, waitForMessageTo } from "./helpers/mailpit";
import { dispatchPendingOutboxTask } from "./helpers/outbox-dispatch";

const ASUNTO_RECUPERACION = "Cata Club | Recuperación de contraseña";
const CONTRASENIA_NUEVA = "clave-recuperada-9";

const player = newPlayer(`qa-recuperacion-${Date.now()}@cataclub.com`, "clave-original-8");

test("un jugador recupera su contraseña por correo y entra con la nueva; la vieja queda rechazada", async ({
  page,
  request,
}) => {
  // Mismo motivo que `activacion.live.spec.ts`: alta + solicitud + despacho
  // real del outbox + sondeo de Mailpit + dos logins no entra en el timeout
  // por defecto de Playwright (30s).
  test.setTimeout(90_000);
  try {
    // ── Insumo: una cuenta real, creada por API (ver el docstring del archivo) ──
    await enrollNewPlayerViaApi(request, player);
    // `enrollNewPlayerViaApi` autentica en el mismo request que crea la
    // cuenta; ese contexto de API es independiente del navegador, pero se
    // limpia igual por si acaso — esta prueba necesita el formulario de
    // /login en blanco, no una sesión ya iniciada.
    await page.context().clearCookies();

    // ── La solicitud, desde la UI real ──
    await page.goto("/forgot-password");
    await page.getByLabel(/correo electrónico/i).fill(player.correo);
    await page.getByRole("button", { name: /enviar enlace de recuperación/i }).click();
    await expect(page.getByRole("heading", { name: /revise su correo/i })).toBeVisible({
      timeout: 15_000,
    });

    // ── El correo real, despachado y leído de Mailpit ──
    await dispatchPendingOutboxTask(
      "app.infraestructura.tareas.recuperacion_tareas.despachar_recuperaciones_pendientes",
    );
    const mensaje = await waitForMessageTo(request, player.correo, ASUNTO_RECUPERACION);
    const token = extractTokenFromLink(mensaje, "/reset-password");

    // ── El enlace seguido, y la contraseña nueva establecida ──
    await page.goto(`/reset-password?token=${token}`);
    await page.locator("#password").fill(CONTRASENIA_NUEVA);
    await page.locator("#confirmPassword").fill(CONTRASENIA_NUEVA);
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await expect(page.getByRole("heading", { name: /contraseña actualizada/i })).toBeVisible({
      timeout: 15_000,
    });
    // `exact: true`: el shell tiene además "Volver a Iniciar sesión" (el
    // coal shoulder de `AuthShell`), que también matchea `/iniciar sesión/i`.
    await page.getByRole("link", { name: "Iniciar sesión", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);

    // ── Bonus: la contraseña vieja ya no entra ──
    await page.getByLabel(/correo electrónico/i).fill(player.correo);
    await page.getByRole("textbox", { name: /contraseña/i }).fill(player.contrasenia);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await expect(page.getByText("Credenciales incorrectas")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/login$/);

    // ── Login exitoso con la contraseña nueva ──
    await page.getByRole("textbox", { name: /contraseña/i }).fill(CONTRASENIA_NUEVA);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await expect(page.getByText("Hola, QA")).toBeVisible({ timeout: 20_000 });
    // Correo sin verificar y sin inscripción presencial: aterriza en el
    // mismo lugar que un jugador recién autoinscrito (ver
    // `activacion.live.spec.ts`), no en su panel — la recuperación cambia la
    // contraseña, no el estado de activación de la cuenta.
    await expect(page).toHaveURL(/\/login\/activacion$/, { timeout: 20_000 });
  } finally {
    await purgeMessagesTo(request, player.correo);
  }
});
