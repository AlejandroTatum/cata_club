/**
 * El quinto spec E2E contra un backend REAL: activación de cuenta por
 * verificación de correo (issue #790), de punta a punta — alta pública real,
 * correo real leído de Mailpit, token seguido, y una sesión nueva que
 * recuerda la verificación.
 *
 * ## Qué prueba, y por qué el asistente completo
 *
 * El alta pasa por el asistente real (`/student/enroll`), no por un atajo a
 * la API: es exactamente la puerta de entrada que este spec certifica, y
 * `enroll-qa.spec.ts` ya prueba que el asistente en sí navega y valida bien
 * con la red mockeada — lo que ningún spec mockeado puede probar es que
 * `POST /enrollment/` deja una fila real en el outbox de verificación, que el
 * correo real sale, y que el token real que trae confirma la cuenta real.
 * Cinco pasos, uno por cada tramo que un mock no puede atravesar:
 *
 *   1. autoinscripción de un Jugador (adulto, sin representante) vía el
 *      asistente;
 *   2. el correo de verificación, despachado y leído de Mailpit;
 *   3. el token seguido desde `/login/activacion`, EN el lugar;
 *   4. el estado de activación persistido tras cerrar sesión y volver a
 *      entrar con la cuenta nueva.
 *
 * ## Qué regresión real cubre
 *
 * `feat(auth): verificar el correo sin salir de la pantalla de activacion
 * (#1050)`: antes de ese cambio, `/login/activacion` solo ofrecía navegar
 * HACIA AFUERA para verificar (a `/verificar-correo` o al cliente de correo).
 * La aserción que importa acá no es que la cuenta termine verificada — un
 * mock ya podía fingir eso — es que la URL nunca se mueve de
 * `/login/activacion` mientras el estado de la pantalla cambia en el lugar:
 * si alguien revierte #1050, este spec deja de ver el formulario
 * desaparecer sin navegación y falla ahí, no en un timeout genérico.
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

test("un jugador se autoinscribe, verifica su correo sin salir de /login/activacion, y la sesión nueva lo recuerda", async ({
  page,
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
    await expect(page.getByRole("heading", { name: /active su cuenta/i })).toBeVisible();
    const verificarButton = page.getByRole("button", { name: "Verificar correo" });
    await expect(verificarButton).toBeVisible();

    // ── 2. El correo real, despachado y leído de Mailpit ──
    await dispatchPendingOutboxTask(
      "app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes",
    );
    const mensaje = await waitForMessageTo(request, player.correo, ASUNTO_VERIFICACION);
    const token = extractTokenFromLink(mensaje, "/verificar-correo");

    // ── 3. El token seguido EN el lugar — regresión #1050 ──
    await page.getByLabel(/código o enlace de verificación/i).fill(token);
    await verificarButton.click();

    // La URL nunca se mueve: la pantalla se actualiza sola, sin navegar.
    await expect(page).toHaveURL(/\/login\/activacion$/);
    await expect(verificarButton).toHaveCount(0, { timeout: 15_000 });
    await expect(
      page.getByText("Complete la inscripción presencial en el club para habilitar el acceso a los módulos."),
    ).toBeVisible();

    // ── 4. Cerrar sesión y volver a entrar: el estado persistió, no era del cliente ──
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

    await page.getByLabel(/correo electrónico/i).fill(player.correo);
    await page.getByRole("textbox", { name: /contraseña/i }).fill(player.contrasenia);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();

    await expect(page.getByText("Hola, QA")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Antes de entrar, le faltan un par de pasos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login\/activacion$/, { timeout: 20_000 });
    // El formulario de verificación no reaparece: el correo verificado
    // sobrevivió al logout/login, no era un estado que vivía en el navegador.
    await expect(page.getByRole("button", { name: "Verificar correo" })).toHaveCount(0);
  } finally {
    await purgeMessagesTo(request, player.correo);
  }
});
