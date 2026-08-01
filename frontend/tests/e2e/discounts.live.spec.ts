/**
 * El primer spec E2E que atraviesa un backend REAL (issue #33).
 *
 * ## Qué lo distingue del resto de la carpeta
 *
 * Los otros seis specs interceptan la API a nivel de red (`page.route`), así
 * que prueban el render del cliente contra respuestas inventadas y nada de lo
 * que ocurre DESPUÉS de un envío queda cubierto: el toast de éxito, el estado
 * "Guardando…" y la persistencia real nunca se ejercitan. Ese es exactamente
 * el hueco que documenta `docs/ux/evaluacion-usabilidad-rediseno.md`.
 *
 * Este spec no llama a `page.route` ni una vez. Se autentica con las
 * credenciales que siembra `backend/scripts/seed_dev_base.py`, crea un
 * descuento y comprueba las dos cosas que solo un backend real puede probar:
 * que el toast de éxito aparece, y que el dato sobrevive a una recarga.
 *
 * ## Cómo se corre
 *
 *     make qa-up      # backend + base sembrada + frontend, en localhost:3000
 *     make qa-live
 *
 * Fuera de eso no se recoge: `playwright.config.ts` solo declara el proyecto
 * `e2e-live` cuando `E2E_LIVE=1`, y el proyecto `chromium` ignora los
 * `*.live.spec.ts`. Una suite normal, sin Docker, sigue corriendo igual.
 *
 * ## Por qué el catálogo de descuentos
 *
 * Es la mutación más barata que sigue siendo real: tres campos, sin archivos
 * adjuntos, sin dependencias de otras entidades sembradas y sin efectos sobre
 * pagos históricos. Cuando este spec falla, la causa es el backend o el
 * guardado, no un dato de contorno que cambió de forma.
 */
import { expect, test } from "@playwright/test";

/** Sembradas por `backend/scripts/seed_dev_base.py`. */
const ADMIN_EMAIL = "admin@cataclub.com";
const ADMIN_PASSWORD = "admin12345";

/**
 * Nombre único por corrida. El entorno de QA es desechable, pero `make qa-live`
 * se corre varias veces sobre el mismo stack levantado, y el catálogo persiste
 * entre corridas: un nombre fijo haría que la segunda corrida chocara con el
 * descuento que dejó la primera.
 */
function nombreUnico(): string {
  return `QA descuento ${Date.now()}`;
}

test("un admin crea un descuento y el catalogo lo conserva tras recargar", async ({ page }) => {
  const nombre = nombreUnico();

  // ── Login real: el BFF llama a FastAPI y devuelve cookies HttpOnly ──
  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/correo electrónico/i).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: /contraseña/i }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();

  // Si las credenciales sembradas cambiaran, la corrida muere acá y no en una
  // aserción sobre el formulario de descuentos.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

  // ── La mutación ──
  await page.goto("/discounts");
  await page.getByRole("button", { name: /nuevo descuento/i }).first().click();
  await page.getByLabel("Nombre").fill(nombre);
  await page.getByLabel("Valor").fill("15");
  await page.getByRole("button", { name: "Crear", exact: true }).click();

  // ── Lo que ningún spec mockeado podía comprobar (1): el toast de éxito ──
  await expect(page.getByText("Descuento creado correctamente.")).toBeVisible({
    timeout: 15_000,
  });

  // ── (2): el estado persistido ──
  // La recarga es la parte que importa. Sin ella, la fila visible podría venir
  // del estado local del componente y no de la base: es justo la diferencia
  // entre "el formulario se limpió" y "el backend lo guardó".
  await page.reload();
  await expect(page.getByText(nombre)).toBeVisible({ timeout: 15_000 });
});
