/**
 * Registrar un pago en EFECTIVO desde `/student/payments` (issue de
 * duplicación de SonarCloud, PR #1079): `payments.live.spec.ts` y los dos
 * primeros tests de `discount-payment-effect.live.spec.ts` ejercitan
 * exactamente esta misma secuencia — abrir el formulario, elegir EFECTIVO
 * (el único método sin comprobante) y confirmar — cada uno con su propia
 * copia byte a byte idéntica.
 *
 * El monto y el período los deriva el backend (`PagoServicio.registrar_
 * pago`); esta función no lee ni afirma nada sobre el resultado — cada
 * caller sigue verificando su propio toast/fila con el monto real que
 * espera.
 */

import { expect, type Page } from "@playwright/test";

export async function registerCashPayment(page: Page): Promise<void> {
  const abrirFormulario = page.getByRole("button", { name: "Registrar un pago" });
  await expect(abrirFormulario).toBeVisible({ timeout: 20_000 });
  await abrirFormulario.click();
  await page.getByLabel("Forma de pago").selectOption("EFECTIVO");
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar y registrar" }).click();
}
