/**
 * El tercer spec E2E contra un backend REAL: el login (issue #33's live suite
 * había cubierto descuentos y pagos, pero nunca autenticación en sí misma —
 * los dos specs existentes solo la ATRAVIESAN como paso previo a su propia
 * mutación, nunca la ponen a prueba).
 *
 * ## Qué prueba
 *
 * Que `POST /api/auth/login` (el BFF real, contra FastAPI real) autentica a
 * los tres roles que siembra `backend/scripts/seed_dev_base.py` y cada uno
 * aterriza en el destino que le corresponde — `getDefaultRoute` en
 * `src/lib/auth-utils.ts` — y que el rechazo de credenciales inválidas
 * muestra el mensaje real que devuelve el backend, no uno mockeado.
 *
 * No intercepta `page.route` ni una vez.
 *
 * ## Qué regresión real cubre
 *
 * `fix(login): derivar el aviso de bienvenida del destino real (#1048)`: el
 * toast de bienvenida solía escribirse con una descripción fija
 * ("Le llevamos a su panel") calculada ANTES que la ruta real de destino.
 * Este spec fija, para los tres roles, el título ("Hola, {nombre}") Y la
 * descripción del toast, así que un desacople futuro entre el texto y el
 * destino real rompe la corrida en vez de pasar en silencio.
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
const TRAINER_EMAIL = "entrenador@cataclub.com";
const TRAINER_PASSWORD = "trainer12345";
const STUDENT_EMAIL = "pedro@cataclub.com";
const STUDENT_PASSWORD = "alumno123";

/**
 * Un rol por caso: correo, contraseña, primer nombre (el toast solo muestra
 * el primer nombre, ver `firstNameOf` en `src/app/login/page.tsx`) y la ruta
 * de destino que decide `getDefaultRoute` para ese rol.
 */
const ROLES = [
  { rol: "admin", email: ADMIN_EMAIL, password: ADMIN_PASSWORD, firstName: "Admin", destino: /\/dashboard$/ },
  { rol: "entrenador", email: TRAINER_EMAIL, password: TRAINER_PASSWORD, firstName: "Carlos", destino: /\/trainer$/ },
  // El portal de alumno agrega `?alumno=<id>` al aterrizar (selecciona el
  // primer hijo/alumno gestionado por defecto), así que la ruta no termina
  // en `/student` a secas como sí hacen `/dashboard` y `/trainer`.
  { rol: "alumno", email: STUDENT_EMAIL, password: STUDENT_PASSWORD, firstName: "Pedro", destino: /\/student(\?|$)/ },
] as const;

for (const { rol, email, password, firstName, destino } of ROLES) {
  test(`un ${rol} inicia sesión y aterriza en su destino real`, async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
    await page.getByLabel(/correo electrónico/i).fill(email);
    await page.getByRole("textbox", { name: /contraseña/i }).fill(password);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();

    // ── Regresión #1048: el título y la descripción del toast tienen que
    // corresponder al MISMO destino al que la corrida termina llegando, no a
    // uno fijo escrito antes de calcularlo. ──
    await expect(page.getByText(`Hola, ${firstName}`)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Su sesión quedó iniciada. Le llevamos a su panel.")).toBeVisible();

    await expect(page).toHaveURL(destino, { timeout: 20_000 });
  });
}

test("credenciales inválidas no entran y muestran el error real del backend", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/correo electrónico/i).fill(ADMIN_EMAIL);
  await page.getByRole("textbox", { name: /contraseña/i }).fill("una-contrasenia-que-no-es");
  await page.getByRole("button", { name: /iniciar sesión/i }).click();

  // El backend real (no un mock) responde 401 `invalid_credentials`, y el
  // formulario lo traduce en el toast Y en el mensaje fijo bajo el campo de
  // contraseña (`data-testid="credentials-error"`), sin decir cuál de los dos
  // datos fue el que falló.
  await expect(page.getByText("Credenciales incorrectas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("credentials-error")).toHaveText(
    "El correo y la contraseña no coinciden. Verifique los dos e intente nuevamente.",
  );

  // Sin sesión: la URL nunca se mueve del formulario.
  await expect(page).toHaveURL(/\/login$/);
});
