/**
 * Módulo 6 — pago por transferencia con comprobante y aprobación (el módulo
 * que `payments.live.spec.ts` deliberadamente evita, según su propio
 * encabezado: "subir el archivo depende de Cloudinary" y "aprobar un pago
 * dispara generación de PDF por Celery").
 *
 * ## Lo que la investigación encontró, con evidencia
 *
 * La primera versión de este archivo corrió `make qa-pdf-delivery-check`
 * (`backend/scripts/verificar_entrega_pdf.py`) contra un stack de QA local
 * con credenciales reales de Cloudinary en `.env` y confirmó en vivo que
 * `comprobanteOficialUrl` aparece en `GET /membresias/pagos/persona/:id`
 * segundos después de aprobar, con una URL que responde `HTTP 200` y bytes
 * `%PDF-1.4` reales. Eso sigue siendo cierto para un desarrollador con sus
 * propias credenciales -- pero NO para el cron programado: `.github/
 * workflows/e2e-live.yml` declara `permissions: contents: read` y ningún
 * `secrets:`/`secrets.` (candado propio en `tests/test_e2e_live_workflow.py`,
 * clase `TestSuperficieDeSecretos`) a propósito, así que su stack de QA NUNCA
 * tiene `CLOUDINARY_API_KEY` (issue #1341: los tres tests que suben un
 * voucher fallaban a diario con "Must supply api_key", 503, en
 * `POST /membresias/pagos/{id}/voucher`). En vez de mentir sobre el entorno
 * o pedirle un secreto al workflow, estos tres tests se SALTEAN cuando
 * `CLOUDINARY_CONFIGURED` da `false` -- ver su definición más abajo, que le
 * pregunta al backend YA LEVANTADO (nunca imprime el valor) en vez de
 * asumir. `make qa-live` calcula esa variable una sola vez por corrida.
 *
 * La generación del comprobante al aprobar (`PagoServicio.
 * _disparar_generacion_comprobante_pdf`, `membresia_pago_servicio.py`) no
 * pasa por un outbox que dependa de `celery-beat` -- llama a
 * `generar_comprobante_pdf_tarea.delay(pago_id)` DIRECTO contra Redis, y
 * `cataclub-qa-celery-worker-1` está `Up ... (healthy)` en este stack
 * (`docker compose ps`, sin ningún servicio `celery-beat`). Eso no cambia
 * con o sin Cloudinary: es el voucher/comprobante en sí lo que necesita el
 * proveedor externo.
 *
 * Esto es DISTINTO del patrón de la tercera cola de notificaciones (ver
 * `EnrollmentNotificacionOutbox`, sin `celery-beat` en QA) y del correo de
 * recuperación (que sí necesita `helpers/outbox-dispatch.ts`): acá no hace
 * falta ningún despacho manual porque no hay outbox de por medio. Por eso
 * este archivo puede cubrir en vivo lo que `payments.live.spec.ts` asumía
 * imposible -- incluyendo la generación real del PDF -- cuando Cloudinary
 * está configurado.
 *
 * Lo único que queda deliberadamente afuera es un modo de almacenamiento
 * LOCAL para el comprobante: no existe. `subir_voucher_pago`/
 * `subir_pdf_membresia` (`cloudinary_cliente.py`) son el único camino de
 * subida; sin credenciales de Cloudinary el backend no cae a disco, degrada
 * ruidosamente con un 503 (`ServicioNoDisponible`) -- de ahí el skip en vez
 * de un fallback silencioso.
 *
 * ## Por qué Pedro, otra vez
 *
 * Mismo hallazgo que documenta el encabezado de `discount-payment-effect.
 * live.spec.ts`: Pedro es el único alumno adulto autogestionado del seed
 * capaz de llegar a `/student/payments`, y `/members` no sirve para
 * encontrar a ningún otro alumno del seed en este entorno (miles de
 * personas de `enrollment-*.live.spec.ts` llenan sus 200 filas). El test de
 * autoservicio (el primero de este archivo) tiene que ser Pedro por eso.
 *
 * Los otros tres tests -- aprobar, rechazar, y la frontera de autorización
 * -- no ejercitan el formulario de registro (eso ya lo prueba el primer
 * test), así que registran el pago de PRECONDICIÓN vía API
 * (`registerTransferPaymentViaApi`, `helpers/register-transfer-payment.ts`):
 * `PagoServicio.registrar_pago` y `adjuntar_voucher` autorizan a un
 * ADMINISTRADOR a hacerlo a nombre de un tercero (ver sus propios
 * docstrings) -- es el mismo camino que el formulario "Registrar pago" de
 * `/members` ofrece, no un backdoor. Sigue siendo Pedro el sujeto (mismo
 * motivo: es el único alumno que este entorno deja encontrar), pero la
 * higiene de `rejectPendingPayments` en el `beforeEach` es la misma que ya
 * usan `payments.live.spec.ts` y `discount-payment-effect.live.spec.ts`
 * para él, así que compartir a Pedro entre estos cuatro tests y con esos
 * otros dos specs no dejaba estado nuevo sin resolver.
 *
 * ## Estado que este archivo deja
 *
 * Cada pago que aprueba o rechaza es permanente (no hay DELETE de pagos) y
 * cada aprobación avanza la cobertura real de la membresía de Pedro un mes
 * más -- mismo comportamiento ya documentado por los specs hermanos. El
 * `beforeEach` solo puede limpiar lo que queda PENDIENTE_VALIDACION.
 *
 * ## Cómo se corre
 *
 *     make qa-up      # backend + base sembrada + frontend, en localhost:3000
 *     make qa-live
 */
import { expect, test, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";
import { loginViaUi } from "./helpers/live-login";
import { membresiaIdDe, personaIdViaOwnLogin } from "./helpers/persona-lookup";
import { rejectPendingPayments } from "./helpers/pending-payments";
import {
  registerTransferPaymentViaApi,
  registerTransferPaymentWithVoucher,
} from "./helpers/register-transfer-payment";

/** Sembrados por `backend/scripts/seed_dev_base.py`. */
const ADMIN_EMAIL = "admin@cataclub.com";
const ADMIN_PASSWORD = "admin12345";
const STUDENT_EMAIL = "pedro@cataclub.com";
const STUDENT_PASSWORD = "alumno123";
const STUDENT_FULL_NAME = "Pedro Salgado";

/**
 * `true` solo cuando el backend YA LEVANTADO reporta `CLOUDINARY_API_KEY` no
 * vacío -- `make qa-live` (`Makefile`) lo calcula una sola vez consultando
 * al contenedor (nunca imprime el valor, mismo criterio que el resto del
 * repo para medir un secreto sin leerlo) y lo exporta como
 * `E2E_CLOUDINARY_CONFIGURED=1`/`0`. El cron programado nunca lo tiene
 * (issue #1341, ver el encabezado del archivo).
 *
 * Un `.env` local con credenciales reales NO alcanza por sí solo (revisión
 * nativa de #1352, R2-004/R3-cloudinary-gate-defaults-to-skip):
 * `E2E_CLOUDINARY_CONFIGURED` solo llega definida corriendo `make qa-live`
 * -- invocar `pnpm exec playwright test` directo (el mismo runner que este
 * encabezado documenta más arriba) deja la variable sin definir y saltea
 * estos tres tests igual, tenga o no credenciales reales el backend.
 */
const CLOUDINARY_CONFIGURED = process.env.E2E_CLOUDINARY_CONFIGURED === "1";
const SIN_CLOUDINARY_MOTIVO =
  "Requiere E2E_CLOUDINARY_CONFIGURED=1 -- lo fija `make qa-live` (issue #1341) " +
  "cuando el backend de QA ya levantado reporta CLOUDINARY_API_KEY no vacío. " +
  "Correr Playwright directo saltea este test igual, tenga o no credenciales reales en .env.";

test.beforeEach(async ({ request }) => {
  // Mismo mecanismo que `payments.live.spec.ts`/`discount-payment-effect.
  // live.spec.ts`: el backend no deja un segundo pago PENDIENTE_VALIDACION
  // para la misma membresía, así que cada corrida arranca limpiando el
  // pendiente que la corrida anterior (o la interrumpida) haya dejado.
  await rejectPendingPayments(request, ADMIN_EMAIL, ADMIN_PASSWORD, STUDENT_FULL_NAME);
});

test("un socio registra un pago por transferencia con comprobante y queda pendiente de validación, y ese estado persiste tras recargar", async ({
  page,
}) => {
  test.skip(!CLOUDINARY_CONFIGURED, SIN_CLOUDINARY_MOTIVO);
  await loginViaUi(page, STUDENT_EMAIL, STUDENT_PASSWORD, /\/student/);

  await page.goto("/student/payments");
  await registerTransferPaymentWithVoucher(page);

  // ── Lo que ningún spec mockeado podía comprobar (1): el toast de éxito ──
  await expect(page.getByText("Pago registrado y en revisión")).toBeVisible({
    timeout: 15_000,
  });

  // ── (2): el estado persistido, incluyendo el comprobante ──
  // La recarga es la parte que importa: sin ella, la fila visible podría
  // venir del estado local del componente y no de la base.
  await page.reload();
  await expect(page.getByText("Pendiente de validación").first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(/Transferencia/).first()).toBeVisible();
  // Prueba positiva de que el comprobante se adjuntó de verdad: el backend
  // solo marca "Falta el comprobante" cuando `voucher_url` sigue vacío
  // (`pagoFaltaComprobante`, `payments-utils.ts`) -- si la subida a
  // Cloudinary hubiera fallado en silencio, esta insignia aparecería.
  await expect(page.getByText("Falta el comprobante")).toHaveCount(0);
});

/**
 * El arranque común de "aprobar" y "rechazar" (issue de duplicación de
 * SonarCloud, medido con `jscpd`): las dos ramas necesitan exactamente el
 * mismo pago PENDIENTE_VALIDACION con comprobante, ya abierto en el detalle
 * de la fila que se va a decidir -- lo que hacen DESPUÉS es lo único que las
 * distingue. Requiere que `page` ya tenga la sesión de admin abierta
 * (`loginViaUi`).
 */
async function prepararPagoEnColaDeAdmin(page: Page): Promise<{ pedroId: string; pagoId: string }> {
  const pedroId = await personaIdViaOwnLogin(STUDENT_EMAIL, STUDENT_PASSWORD);
  const membresiaId = await membresiaIdDe(page.request, pedroId);
  const pagoId = await registerTransferPaymentViaApi(page, pedroId, membresiaId);

  await page.goto("/payments");
  await page.getByLabel("Buscar estudiante").fill(STUDENT_FULL_NAME);
  const fila = page.getByTestId("payments-table").locator(`[data-payment-action="${pagoId}"]`);
  await expect(fila).toBeVisible({ timeout: 15_000 });
  await fila.click();

  return { pedroId, pagoId };
}

test("un admin aprueba un pago por transferencia con comprobante desde la cola, y Celery genera un PDF real en Cloudinary", async ({
  page,
}) => {
  test.skip(!CLOUDINARY_CONFIGURED, SIN_CLOUDINARY_MOTIVO);
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/dashboard/);
  const { pedroId, pagoId } = await prepararPagoEnColaDeAdmin(page);

  // ── El checklist de "Antes de aprobar" (transferencia CON comprobante:
  // leer el voucher ES la revisión, sin ítem de período -- ver
  // `buildApprovalChecklist`, `payments-utils.ts`) ──
  await page.getByLabel(/El comprobante es legible/).check();
  await page.getByLabel(/El monto del comprobante coincide/).check();
  await page.getByLabel(/La fecha de la transferencia cae dentro del período/).check();

  await page.getByRole("button", { name: "Aprobar pago" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();

  // ── Lo que ningún spec mockeado podía comprobar: el toast real y la
  // membresía activándose ──
  await expect(page.getByText("Pago aprobado. La membresía ahora está activa.")).toBeVisible({
    timeout: 15_000,
  });

  // ── Lo que NINGÚN otro spec live de este proyecto había probado: que la
  // tarea Celery realmente corrió y subió un PDF real a Cloudinary. Con
  // polling porque el despacho es asíncrono (`.delay()`, ver el encabezado
  // del archivo) -- en la medición manual tardó bajo un segundo, pero el
  // margen es generoso para no acoplar el test a esa latencia exacta. ──
  await expect(async () => {
    const res = await page.request.get(`${E2E_BASE_URL}/api/membresias/pagos/persona/${pedroId}`);
    expect(res.ok()).toBe(true);
    const pagos = (await res.json()) as Array<{ id: number; comprobanteOficialUrl: string | null }>;
    const pago = pagos.find((p) => String(p.id) === pagoId);
    expect(pago?.comprobanteOficialUrl).toBeTruthy();
  }).toPass({ timeout: 20_000 });
});

test("un admin rechaza un pago pendiente por transferencia con motivo, y el estado y el motivo persisten", async ({
  page,
}) => {
  test.skip(!CLOUDINARY_CONFIGURED, SIN_CLOUDINARY_MOTIVO);
  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/dashboard/);
  const { pedroId, pagoId } = await prepararPagoEnColaDeAdmin(page);

  await page.getByRole("button", { name: "Rechazar pago…" }).click();
  await page.getByRole("radio", { name: "El comprobante no se lee" }).check();
  await page.getByRole("button", { name: "Rechazar y avisar" }).click();

  await expect(
    page.getByText("Pago rechazado. Se le avisó al responsable con el motivo elegido."),
  ).toBeVisible({ timeout: 15_000 });

  // ── El estado persistido, y el motivo que el socio va a leer ──
  const detalle = await page.request.get(`${E2E_BASE_URL}/api/membresias/pagos/persona/${pedroId}`);
  expect(detalle.ok()).toBe(true);
  const pagos = (await detalle.json()) as Array<{
    id: number;
    estadoPago: string;
    motivoRechazo: string | null;
  }>;
  const pago = pagos.find((p) => String(p.id) === pagoId);
  expect(pago?.estadoPago).toBe("RECHAZADO");
  expect(pago?.motivoRechazo).toContain("El comprobante no se lee");
});

test("un alumno no puede aprobar ni rechazar un pago propio directamente contra el backend", async ({
  request,
}) => {
  // Frontera de autorización, ya cerrada por el backend hoy
  // (`GestorPermisos(ROL_ADMIN)` en `PATCH /membresias/pagos/{id}/validar`,
  // `membresias_pagos_router.py`): este test la mantiene cerrada, no la
  // arregla. Confirmado en vivo antes de escribirlo: la misma llamada desde
  // este mismo entorno responde 403 con "Permisos insuficientes para esta
  // operación".
  const loginAdmin = await request.post(`${E2E_BASE_URL}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(loginAdmin.ok(), `No se pudo iniciar sesión como admin: ${loginAdmin.status()}`).toBe(true);

  const pedroId = await personaIdViaOwnLogin(STUDENT_EMAIL, STUDENT_PASSWORD);
  const membresiaId = await membresiaIdDe(request, pedroId);

  // Registrado con la sesión de admin que este `request` ya tiene abierta.
  const registrado = await request.post(`${E2E_BASE_URL}/api/membresias/pagos`, {
    data: { meses: 1, tipoPago: "TRANSFERENCIA", personaId: Number(pedroId), membresiaId },
  });
  expect(registrado.ok(), `No se pudo registrar el pago de precondición: ${registrado.status()}`).toBe(true);
  const pago = (await registrado.json()) as { id: number };

  // Pedro intenta aprobar (y luego rechazar) SU PROPIO pago, en su propia
  // sesión -- ni siquiera el dueño del pago puede saltarse la validación
  // administrativa.
  const loginPedro = await request.post(`${E2E_BASE_URL}/api/auth/login`, {
    data: { email: STUDENT_EMAIL, password: STUDENT_PASSWORD },
  });
  expect(loginPedro.ok(), `No se pudo iniciar sesión como ${STUDENT_EMAIL}: ${loginPedro.status()}`).toBe(true);

  const intentoAprobar = await request.put(`${E2E_BASE_URL}/api/payments/${pago.id}`, {
    data: { action: "approved" },
  });
  expect(intentoAprobar.status()).toBe(403);

  const intentoRechazar = await request.put(`${E2E_BASE_URL}/api/payments/${pago.id}`, {
    data: { action: "rejected", rejectionReason: "Intento no autorizado" },
  });
  expect(intentoRechazar.status()).toBe(403);
});
