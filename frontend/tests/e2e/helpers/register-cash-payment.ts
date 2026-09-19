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
  // Issue #1341: `payments.live.spec.ts:66` failed in CI with `locator.click:
  // Test timeout of 30000ms exceeded` after "element was detached from the
  // DOM, retrying". What the click was racing: `PaymentOrBenefitForm`
  // (`student/payments/page.tsx`) is NOT gated by `pagosState` -- it mounts
  // immediately, and `hasPendingPago` (which decides whether this renders as
  // the "Registrar un pago" button or as the "Ya hay un pago... esperando
  // validación" text) reads `pagos`, which is still `[]` until the
  // `GET /membresias/pagos/persona/{id}` fetch behind `pagosState` resolves
  // (`fetchPagosDePersona`, same async gate `leerTextoEstable`'s docstring in
  // `discount-payment-effect.live.spec.ts` already documents for the
  // coverage heading). `toBeVisible()` on the button proves only that THIS
  // render has it, not that it is the settled one: the button can be
  // scrolled into view and mid-click exactly when that fetch resolves and
  // React swaps the subtree.
  //
  // The "Historial de pagos" heading (`#pagos-title`) renders in the SAME
  // `pagosState.status === "ready"` branch, in the SAME commit as the now-real
  // `hasPendingPago` — waiting for it first means the button's next render is
  // the stable one.
  await expect(page.getByRole("heading", { name: "Historial de pagos" })).toBeVisible({
    timeout: 20_000,
  });

  const abrirFormulario = page.getByRole("button", { name: "Registrar un pago" });
  await expect(abrirFormulario).toBeVisible({ timeout: 20_000 });
  await abrirFormulario.click();
  await page.getByLabel("Forma de pago").selectOption("EFECTIVO");
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar y registrar" }).click();
}
