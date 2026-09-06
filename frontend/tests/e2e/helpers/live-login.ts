/**
 * Login real por UI, compartido entre specs `.live.spec.ts` (issue de
 * duplicación de SonarCloud, PR #1079): `payments.live.spec.ts` y
 * `discount-payment-effect.live.spec.ts` tenían cada uno su propia copia de
 * esta misma secuencia — llenar correo/contraseña, enviar, y esperar la URL
 * de destino según el rol — para admin, alumno y familia por igual. Un solo
 * formulario, una sola espera; lo que cambia entre roles es solo el destino.
 */

import { expect, type Page } from "@playwright/test";

/**
 * Inicia sesión desde `/login` y espera a que la sesión real (cookies
 * HttpOnly puestas por el BFF) aterrice en `expectedUrlPattern`. Si las
 * credenciales sembradas cambiaran, la corrida muere acá y no en una
 * aserción sobre la pantalla que vino después — mismo criterio que ya
 * documentaba cada copia de este bloque.
 */
export async function loginViaUi(
  page: Page,
  email: string,
  password: string,
  expectedUrlPattern: RegExp,
): Promise<void> {
  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/correo electrónico/i).fill(email);
  await page.getByRole("textbox", { name: /contraseña/i }).fill(password);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(expectedUrlPattern, { timeout: 20_000 });
}
