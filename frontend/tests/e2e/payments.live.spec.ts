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
import { test, expect, type APIRequestContext } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";

/** Sembrados por `backend/scripts/seed_dev_base.py`. */
const ADMIN_EMAIL = "admin@cataclub.com";
const ADMIN_PASSWORD = "admin12345";
const STUDENT_EMAIL = "pedro@cataclub.com";
const STUDENT_PASSWORD = "alumno123";
const STUDENT_FULL_NAME = "Pedro Salgado";

/**
 * Rechaza cualquier pago pendiente previo de `studentName` (limpieza previa a
 * la corrida, ver el encabezado del archivo). Tolerante a "no hay nada que
 * limpiar": con el stack recién sembrado la cola de pendientes de Pedro está
 * vacía y esto no hace nada.
 */
async function rejectPendingPayments(
  request: APIRequestContext,
  studentName: string,
): Promise<void> {
  const login = await request.post(`${E2E_BASE_URL}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  if (!login.ok()) {
    throw new Error(`No se pudo iniciar sesión como admin para la limpieza: ${login.status()}`);
  }

  const list = await request.get(`${E2E_BASE_URL}/api/payments`, {
    params: { estadoPago: "PENDIENTE_VALIDACION" },
  });
  if (!list.ok()) {
    throw new Error(`No se pudo leer la cola de pendientes: ${list.status()}`);
  }

  const body = (await list.json()) as { items?: Array<{ id: string; studentName: string }> };
  for (const item of body.items ?? []) {
    if (item.studentName !== studentName) continue;
    const rejected = await request.put(`${E2E_BASE_URL}/api/payments/${item.id}`, {
      data: {
        action: "rejected",
        rejectionReason: "Reinicio QA para repetir el flujo de pago",
      },
    });
    if (!rejected.ok()) {
      throw new Error(`No se pudo reiniciar el pago pendiente ${item.id}: ${rejected.status()}`);
    }
  }
}

test.beforeEach(async ({ request }) => {
  await rejectPendingPayments(request, STUDENT_FULL_NAME);
});

test("un socio registra un pago en efectivo y el historial lo conserva tras recargar", async ({ page }) => {
  // ── Login real: el BFF llama a FastAPI y devuelve cookies HttpOnly ──
  await page.goto("/login");
  await expect(page.getByLabel(/correo electrónico/i)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel(/correo electrónico/i).fill(STUDENT_EMAIL);
  await page.getByRole("textbox", { name: /contraseña/i }).fill(STUDENT_PASSWORD);
  await page.getByRole("button", { name: /iniciar sesión/i }).click();

  // Un alumno mayor de edad aterriza en su portal, no en /dashboard.
  await expect(page).toHaveURL(/\/student/, { timeout: 20_000 });

  // ── La pantalla de pagos ──
  await page.goto("/student/payments");
  // Sin pago pendiente previo (la limpieza lo garantiza), el formulario ofrece
  // "Registrar un pago". Si las credenciales o la membresía sembrada cambiaran,
  // la corrida muere acá y no en una aserción sobre el formulario.
  await expect(page.getByRole("button", { name: "Registrar un pago" })).toBeVisible({
    timeout: 20_000,
  });

  // ── La mutación: EFECTIVO, el único método sin comprobante ──
  await page.getByRole("button", { name: "Registrar un pago" }).click();
  await page.getByLabel("Forma de pago").selectOption("EFECTIVO");
  await page.getByRole("button", { name: "Registrar pago", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar y registrar" }).click();

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
