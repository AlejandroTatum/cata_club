/**
 * El cuarto spec E2E contra un backend REAL: cerrar sesión (issue #33's live
 * suite había cubierto login, descuentos y pagos, pero nunca que un logout
 * cierre la sesión de VERDAD, del lado del servidor).
 *
 * ## Qué prueba
 *
 * Que un click en "Cerrar sesión" no es solo una navegación de React: borra
 * las cookies `HttpOnly` que emite `POST /api/auth/logout`. El assert que
 * importa no es que la URL cambie a `/login` — eso lo haría igual un logout
 * roto que solo limpia el estado del cliente sin avisarle al backend —, es
 * que DESPUÉS del logout, una visita de página completa (`page.goto`, no un
 * link de React) a una ruta protegida rebote a `/login`. Esa ruta pasa por el
 * middleware de Next (`src/middleware.ts`, `hasPlausibleAccessToken`) antes
 * de que cualquier componente de cliente llegue a montarse, así que solo
 * puede redirigir si la cookie de acceso ya no está.
 *
 * No intercepta `page.route` ni una vez.
 *
 * ## Qué regresión real cubre
 *
 * Dos fixes al mismo mecanismo (`AuthContext.logout`), ambos sobre la carrera
 * entre un logout y una petición de sesión que ya estaba en vuelo:
 *
 *   - `fix(auth): apagar la bandera de logout al terminar el cierre de sesión
 *     (#1047)`: `loggingOutRef` quedaba en `true` para siempre tras el primer
 *     logout de la pestaña, así que una sesión nueva después de ese logout se
 *     leía como no autenticada sin llegar a preguntarle al backend.
 *   - `fix(auth): abortar fetchSession en vuelo al cerrar sesión (#1054)`: una
 *     petición a `/api/auth/session` que ya estaba en vuelo cuando arrancaba
 *     el logout podía terminar sellando de nuevo la cookie de acceso con el
 *     token que el BFF le devuelve, DESPUÉS de que el logout ya la había
 *     borrado con `Max-Age=0`.
 *
 * Los dos son carreras de timing de red que este spec no reproduce byte a
 * byte (necesitarían controlar cuándo responde el backend real), pero los
 * dos comparten el mismo síntoma observable: la sesión sigue viva del lado
 * del servidor después de un logout que la UI ya dio por cerrado. Ese es
 * exactamente el contrato que la aserción de abajo certifica.
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

/** Sembradas por `backend/scripts/seed_dev_base.py`. */
const ADMIN_EMAIL = "admin@cataclub.com";
const ADMIN_PASSWORD = "admin12345";

test("un admin cierra sesión y el backend deja de reconocer la sesión", async ({ page }) => {
  // ── Login real ──
  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/correo electrónico/i).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: /contraseña/i }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });

  // ── El logout real: el botón permanente del riel lateral (issue #852), no
  // un menú emergente. `AuthContext.logout` llama a `POST /api/auth/logout`
  // (que bombea `version_sesion` server-side) antes de navegar. ──
  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

  // ── Lo que ningún spec mockeado podía comprobar: que la cookie de acceso
  // ya no sirve. Una navegación de página completa a una ruta protegida pasa
  // primero por el middleware de Next, que rebota a /login SOLO si no ve una
  // cookie de acceso plausible -- ningún componente de React llega a decidir
  // esto. Si el logout solo hubiera limpiado el estado del cliente, esta
  // misma navegación (con la cookie todavía viva) dejaría pasar el request y
  // el servidor la serviría igual, sin redirigir. ──
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
});
