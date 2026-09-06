/**
 * Registrar un pago por TRANSFERENCIA con comprobante adjunto -- módulo 6
 * (pago con comprobante y aprobación). Dos formas de llegar al mismo estado
 * (`Pago` PENDIENTE_VALIDACION con un `ComprobantePago`... no, con un
 * `voucher_url` -- el comprobante OFICIAL en PDF solo existe tras aprobar,
 * ver `membresia_pago_servicio.py::_disparar_generacion_comprobante_pdf`):
 *
 *   - `registerTransferPaymentWithVoucher` hace el flujo 100% UI, la única
 *     forma honesta de probar que un socio puede autoservirse esto desde
 *     `/student/payments`.
 *   - `registerTransferPaymentViaApi` llama a los mismos dos endpoints
 *     directo (`POST /api/membresias/pagos` + `POST .../voucher`), para
 *     specs que necesitan un pago pendiente CON comprobante como
 *     PRECONDICIÓN (aprobar/rechazar desde la cola de admin) sin repetir el
 *     flujo de registro que ya certifica el primero -- misma idea que
 *     `rejectPendingPayments` resolviendo higiene de estado por API en vez
 *     de UI.
 */

import { expect, type Page } from "@playwright/test";

/**
 * PDF mínimo pero válido -- mismo criterio que `_PDF_MINIMO` en
 * `backend/scripts/verificar_entrega_pdf.py`: alcanza para que la firma
 * binaria real (`es_firma_valida`, REQ-SEC-3) lo reconozca como PDF, y
 * ningún archivo se lee del disco para que la corrida no dependa de un
 * fixture que alguien pueda mover.
 */
const COMPROBANTE_PDF_MINIMO = Buffer.from(
  "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n" +
    "%%EOF\n",
);

const COMPROBANTE_ARCHIVO = {
  name: "comprobante.pdf",
  mimeType: "application/pdf",
  buffer: COMPROBANTE_PDF_MINIMO,
};

/**
 * Registra un pago por transferencia con comprobante desde
 * `/student/payments`, por UI. TRANSFERENCIA ya es el método por defecto del
 * formulario (`RenewPaymentForm`), así que no hace falta tocar el `<select>`
 * de "Forma de pago" -- a diferencia de `registerCashPayment`, que sí lo
 * cambia a EFECTIVO.
 */
export async function registerTransferPaymentWithVoucher(page: Page): Promise<void> {
  const abrirFormulario = page.getByRole("button", { name: "Registrar un pago" });
  await expect(abrirFormulario).toBeVisible({ timeout: 20_000 });
  await abrirFormulario.click();
  await page.getByTestId("renew-voucher-input").setInputFiles(COMPROBANTE_ARCHIVO);
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar y registrar" }).click();
}

/**
 * Registra un pago por transferencia con comprobante directo contra el
 * backend, vía `page.request` (comparte cookies con `page` -- la sesión que
 * el caller ya abrió por UI, típicamente admin). `PagoServicio.registrar_
 * pago` y `adjuntar_voucher` autorizan a un ADMINISTRADOR a hacer esto a
 * nombre de un tercero (ver sus propios docstrings); no es un backdoor, es
 * el mismo camino que el formulario "Registrar pago" de `/members` ofrece.
 *
 * Devuelve el id del pago creado, ya con su comprobante adjunto.
 */
export async function registerTransferPaymentViaApi(
  page: Page,
  personaId: string,
  membresiaId: number,
): Promise<string> {
  const registrado = await page.request.post("/api/membresias/pagos", {
    data: { meses: 1, tipoPago: "TRANSFERENCIA", personaId: Number(personaId), membresiaId },
  });
  if (!registrado.ok()) {
    throw new Error(`No se pudo registrar el pago por transferencia: ${registrado.status()}`);
  }
  const pago = (await registrado.json()) as { id: number };

  const conComprobante = await page.request.post(`/api/membresias/pagos/${pago.id}/voucher`, {
    multipart: { archivo: COMPROBANTE_ARCHIVO },
  });
  if (!conComprobante.ok()) {
    throw new Error(`No se pudo adjuntar el comprobante al pago ${pago.id}: ${conComprobante.status()}`);
  }
  return String(pago.id);
}
