/**
 * El quinto spec E2E contra un backend REAL: activación de cuenta por
 * verificación de correo (issue #790), de punta a punta — alta pública real,
 * correo real leído de Mailpit, el enlace seguido, y una sesión nueva que
 * recuerda la verificación.
 *
 * ## Qué prueba, y por qué el asistente completo
 *
 * El alta pasa por el asistente real (`/student/enroll`), no por un atajo a
 * la API: es exactamente la puerta de entrada que este spec certifica, y
 * `enroll-qa.spec.ts` ya prueba que el asistente en sí navega y valida bien
 * con la red mockeada — lo que ningún spec mockeado puede probar es que
 * `POST /enrollment/` deja una fila real en el outbox de verificación, que el
 * correo real sale, y que el enlace real que trae confirma la cuenta real.
 * Cinco pasos, uno por cada tramo que un mock no puede atravesar:
 *
 *   1. autoinscripción de un Jugador (adulto, sin representante) vía el
 *      asistente;
 *   2. el correo de verificación, despachado y leído de Mailpit;
 *   3. el enlace abierto en OTRA pestaña — el correo lleva un enlace, no un
 *      código, así que verificarlo no es una acción de `/login/activacion`
 *      sino de `/verificar-correo` en cualquier dispositivo (#1191);
 *   4. `/login/activacion` reconociendo la verificación al pedirle que
 *      vuelva a consultar su estado, y pasando de la pantalla de correo a la
 *      de inscripción presencial sin recargar;
 *   5. el estado de activación persistido tras cerrar sesión y volver a
 *      entrar con la cuenta nueva.
 *
 * ## Qué regresión real cubre
 *
 * `feat(activation): split the gate into email and enrolment screens
 * (#1191)`: antes de ese cambio, `/login/activacion` mostraba una sola
 * pantalla con las dos condiciones, un formulario de código/enlace y varias
 * salidas superpuestas. La aserción que importa acá no es que la cuenta
 * termine verificada — un mock ya podía fingir eso — es que
 * `/login/activacion` pasa de la pantalla de correo a la de inscripción
 * presencial EN EL LUGAR, sin navegar, apenas alguien pide "Ya verifiqué mi
 * correo" después de abrir el enlace real en otra pestaña.
 *
 * ## Por qué el despacho manual del outbox
 *
 * Igual que la recuperación de contraseña, la verificación de correo
 * (`_encolar_verificacion_de_correo`, `enrollment_servicio.py`) es un outbox
 * durable 100% despachado por `celery-beat`, que QA no levanta
 * (`Makefile:QA_SERVICIOS`). Sin publicar `despachar_verificaciones_pendientes`
 * a mano, la fila que deja el alta pública queda `PENDIENTE` para siempre y
 * este spec esperaría un correo que nunca sale. El razonamiento completo — y
 * por qué es `docker compose exec` y no otra cosa — vive en
 * `helpers/outbox-dispatch.ts`.
 *
 * ## Por qué NO llega a `alta_presencial_completada`
 *
 * `GestorAutenticacion.puede_acceder_modulos` exige AMBAS condiciones:
 * correo verificado Y una membresía que alguna vez estuvo ACTIVA. La segunda
 * la crea un ADMINISTRADOR al registrar el primer pago — está fuera del
 * alcance de un alta pública, y forzarla a mano volvería este spec en una
 * prueba de otra cosa. Por eso la sesión nueva del paso 4 vuelve a aterrizar
 * en `/login/activacion`, con el correo ya verificado y la inscripción
 * presencial todavía pendiente: ese es el estado REAL de un Jugador recién
 * autoinscrito, no un defecto de este spec.
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
import { enrollNewPlayerViaWizard, newPlayer } from "./helpers/enrollment";
import { extractTokenFromLink, purgeMessagesTo, waitForMessageTo } from "./helpers/mailpit";
import { dispatchPendingOutboxTask } from "./helpers/outbox-dispatch";

const ASUNTO_VERIFICACION = "Cata Club | Verificación de correo";

/** Correo nuevo por corrida: `persona.cedula` y el índice de correo son `unique` (ver `newPlayer`). */
const player = newPlayer(`qa-activacion-${Date.now()}@cataclub.com`);

test("un jugador se autoinscribe, verifica su correo en otra pestaña, y /login/activacion pasa de una pantalla a la otra sin recargar", async ({
  page,
  context,
  request,
}) => {
  // El flujo completo — alta, despacho real del outbox, sondeo de Mailpit,
  // verificación, logout y un segundo login — corre bien por encima del
  // timeout por defecto de Playwright (30s) sin que ningún paso individual
  // esté colgado.
  test.setTimeout(90_000);
  try {
    // ── 1. Alta pública real, por el asistente completo ──
    await enrollNewPlayerViaWizard(page, player);

    // El alta ya dejó cookies de sesión reales (`POST /enrollment/` autentica
    // en el mismo request). Visitar /login estando ya autenticado dispara el
    // efecto de `routeForSession` (`src/app/login/page.tsx`), que manda a
    // `/login/activacion` porque el correo todavía no está verificado.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login\/activacion$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Verifique su correo" })).toBeVisible();
    const yaVerifiqueButton = page.getByRole("button", { name: "Ya verifiqué mi correo" });
    await expect(yaVerifiqueButton).toBeVisible();

    // ── 2. El correo real, despachado y leído de Mailpit ──
    await dispatchPendingOutboxTask(
      "app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes",
    );
    const mensaje = await waitForMessageTo(request, player.correo, ASUNTO_VERIFICACION);
    const token = extractTokenFromLink(mensaje, "/verificar-correo");

    // ── 3. El enlace, abierto en OTRA pestaña — el correo lleva un enlace,
    // no un código (#1191), así que verificarlo no es una acción de
    // /login/activacion sino de /verificar-correo, posiblemente en otro
    // dispositivo. La pestaña original queda intacta en /login/activacion.
    const verificationPage = await context.newPage();
    await verificationPage.goto(`/verificar-correo?token=${token}`);
    await expect(verificationPage.getByText(/correo.*verificad/i)).toBeVisible({ timeout: 15_000 });
    await verificationPage.close();

    // ── 4. De vuelta en la pestaña original: pedirle que vuelva a
    // consultar su estado mueve la pantalla de correo a la de inscripción
    // presencial, EN EL LUGAR — regresión #1191 ──
    await yaVerifiqueButton.click();

    await expect(page).toHaveURL(/\/login\/activacion$/);
    await expect(page.getByRole("heading", { name: "Complete su inscripción en el club" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Correo verificado")).toBeVisible();
    await expect(page.getByText("Su correo quedó verificado.")).toBeVisible();
    await expect(yaVerifiqueButton).toHaveCount(0);

    // ── 5. Cerrar sesión y volver a entrar: el estado persistió, no era del cliente ──
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

    await page.getByLabel(/correo electrónico/i).fill(player.correo);
    await page.getByRole("textbox", { name: /contraseña/i }).fill(player.contrasenia);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();

    await expect(page.getByText("Hola, QA")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Antes de entrar, le faltan un par de pasos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login\/activacion$/, { timeout: 20_000 });
    // La pantalla de correo no reaparece: el correo verificado sobrevivió al
    // logout/login, no era un estado que vivía en el navegador. Al ser un
    // load nuevo — no una transición desde "Ya verifiqué mi correo" — el
    // aviso puntual de la sesión anterior tampoco reaparece.
    await expect(page.getByRole("heading", { name: "Complete su inscripción en el club" })).toBeVisible();
    await expect(page.getByText("Su correo quedó verificado.")).toHaveCount(0);
  } finally {
    await purgeMessagesTo(request, player.correo);
  }
});
