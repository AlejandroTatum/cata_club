/**
 * El segundo spec E2E contra un backend REAL: el ciclo de vida de un pago
 * manual (issue #476).
 *
 * ## Qué prueba
 *
 * No existe ningún procesador de pago en línea: los métodos son manuales
 * (EFECTIVO / TRANSFERENCIA) y la validación la hace el club a mano. El único
 * flujo de pago que atraviesa el backend REAL sin depender de Cloudinary
 * (subir comprobante), de Celery (PDF del comprobante oficial al aprobar) ni
 * de SMTP (correos) es el pago en EFECTIVO: una declaración de quien entregó
 * el dinero, sin voucher adjunto. Por eso este spec:
 *
 *   1. se autentica como Pedro — el único alumno auto-gestionado MAYOR de edad
 *      que siembra `backend/scripts/seed_dev_base.py` (los menores quedan en
 *      solo-lectura financiera y no pueden registrar un pago propio);
 *   2. registra un pago en EFECTIVO de 1 mes desde `/student/payments`;
 *   3. comprueba las dos cosas que solo un backend real puede probar: que el
 *      toast de éxito aparece y que el pago sobrevive a una recarga.
 *
 * No intercepta `page.route` ni una vez. No sube ningún archivo, no aprueba
 * nada (eso dispararía la generación del PDF por Celery, que QA no corre) y no
 * depende de ningún correo saliente.
 *
 * ## Repetibilidad sobre el mismo stack
 *
 * `make qa-live` se corre varias veces sobre el mismo stack levantado, y el
 * backend no deja registrar un segundo pago mientras quede uno
 * `PENDIENTE_VALIDACION` para la misma membresía (no hay DELETE de pagos). Un
 * dato fijo —como el nombre del descuento en `discounts.live.spec.ts`— no
 * existe acá: el período y el monto los DERIVA el backend. Para que la corrida
 * sea repetible sin reseed, el `beforeEach` rechaza primero cualquier pago
 * pendiente previo de Pedro usando el endpoint REAL de validación del
 * administrador (`PUT /api/payments/:id`), que es una escritura pura en la
 * base (no dispara PDF ni correo). Es una limpieza de estado, no un backdoor:
 * el flujo que se certifica —el registro en efectivo— sigue siendo 100% UI de
 * navegador.
 *
 * ## Cómo se corre
 *
 *     make qa-up      # backend + base sembrada + frontend, en localhost:3000
 *     make qa-live
 *
 * Igual que el resto de los `*.live.spec.ts`, solo lo recoge el proyecto
 * `e2e-live` cuando `E2E_LIVE=1`.
 */
import { test, expect } from "@playwright/test";
import { rejectPendingPayments } from "./helpers/pending-payments";
import { loginViaUi } from "./helpers/live-login";
import { registerCashPayment } from "./helpers/register-cash-payment";

/** Sembrados por `backend/scripts/seed_dev_base.py`. */
const ADMIN_EMAIL = "admin@cataclub.com";
const ADMIN_PASSWORD = "admin12345";
const STUDENT_EMAIL = "pedro@cataclub.com";
const STUDENT_PASSWORD = "alumno123";
const STUDENT_FULL_NAME = "Pedro Salgado";

test.beforeEach(async ({ request }) => {
  // Extraído a `helpers/pending-payments.ts` (issue de duplicación de
  // SonarCloud, PR #1079): `discount-payment-effect.live.spec.ts` necesita
  // exactamente esta misma limpieza para Pedro.
  await rejectPendingPayments(request, ADMIN_EMAIL, ADMIN_PASSWORD, STUDENT_FULL_NAME);
});

test("un socio registra un pago en efectivo y el historial lo conserva tras recargar", async ({ page }) => {
  // ── Login real: el BFF llama a FastAPI y devuelve cookies HttpOnly ──
  // Un alumno mayor de edad aterriza en su portal, no en /dashboard —
  // extraído a `helpers/live-login.ts` (issue de duplicación de SonarCloud,
  // PR #1079).
  await loginViaUi(page, STUDENT_EMAIL, STUDENT_PASSWORD, /\/student/);

  // ── La pantalla de pagos ──
  await page.goto("/student/payments");
  // Sin pago pendiente previo (la limpieza lo garantiza), el formulario ofrece
  // "Registrar un pago". Si las credenciales o la membresía sembrada cambiaran,
  // la corrida muere acá y no en una aserción sobre el formulario.
  //
  // ── La mutación: EFECTIVO, el único método sin comprobante — extraído a
  // `helpers/register-cash-payment.ts` (issue de duplicación de SonarCloud,
  // PR #1079).
  await registerCashPayment(page);

  // ── Lo que ningún spec mockeado podía comprobar (1): el toast de éxito ──
  await expect(page.getByText("Pago registrado y en revisión")).toBeVisible({
    timeout: 15_000,
  });

  // ── (2): el estado persistido ──
  // La recarga es la parte que importa: sin ella, la fila visible podría venir
  // del estado local del componente y no de la base. Un pago recién registrado
  // queda PENDIENTE_VALIDACION y su fila muestra el método en efectivo.
  await page.reload();
  await expect(page.getByText("Pendiente de validación").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Efectivo/).first()).toBeVisible();
});
