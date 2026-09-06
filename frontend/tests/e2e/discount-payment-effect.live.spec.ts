/**
 * Módulo 5 — el descuento que llega al pago (issue #398/#400, slice 06).
 *
 * ## Qué cubre esto que ningún otro spec live cubre
 *
 * `discounts.live.spec.ts` prueba la mitad del negocio: un admin CREA un
 * descuento y el catálogo lo conserva. Nadie había probado en vivo la otra
 * mitad — que un descuento ASIGNADO a un alumno cambie de verdad lo que ese
 * alumno paga. El cálculo vive en `PagoServicio._congelar_beneficio_activo`
 * (`membresia_pago_servicio.py`): resuelve el beneficio VIGENTE del pagador
 * (`AsignacionDescuento`), lo congela contra `monto_base = tarifa * meses`, y
 * el resultado es `Pago.monto` — nunca algo que el cliente calcule o envíe.
 * Este archivo lo verifica en los dos lugares que solo un backend real
 * prueba: el toast de éxito (que imprime `nuevoPago.monto`, no una
 * previsualización) y, tras recargar, el desglose que pinta la fila del
 * historial (`data-testid="pago-descuento"` en `/student/payments`).
 *
 * ## Por qué Pedro, y no una familia con representante (dos hallazgos en vivo)
 *
 * El plan original probaba esto con un representante pagando por un hijo
 * (Carlos/Diego, Laura/Martín — así aparecen en `seed_dev_base.py`). Dos
 * cosas verificadas EN VIVO contra este entorno de QA obligaron a cambiarlo:
 *
 * 1. **`GestorAutenticacion.alta_presencial_completada` bloquea a todo
 *    representante sin membresía PROPIA, para siempre.** Comprobado en vivo:
 *    `carlos@cataclub.com` y `laura@cataclub.com` — cuentas REPRESENTANTE
 *    puras, sin ningún `Membresia` propio porque nunca entrenan ellos mismos
 *    — inician sesión con éxito (200) pero `activacion_completa` da `false`
 *    y el login los manda a `/login/activacion` en vez de `/student`,
 *    indefinidamente: esa pantalla marca la condición como "se resuelve en
 *    el club" (issue #1045), no como algo que el representante pueda
 *    completar desde ahí. La función solo mira `Membresia.persona_id ==
 *    persona_id` del PROPIO usuario logueado (`gestor_auth.py`) — nunca la
 *    de sus representados — así que un padre que solo gestiona la cuenta de
 *    su hijo (el caso más común de "representante") queda excluido del
 *    self-service por completo. Esto es un hallazgo de producto serio, más
 *    allá de este módulo, y no se arregla acá.
 * 2. `GET /api/members` (`src/app/api/members/route.ts`) pide UNA sola
 *    página de `/personas/?limit=200`, sin `skip` y sin filtro por nombre,
 *    ordenada por `apellidos ASC` (`_ORDEN_NOMINA`,
 *    `persona_repositorio.py`). Este entorno acumuló miles de personas de
 *    `enrollment-*.live.spec.ts` que llenan las 200 filas por sí solas:
 *    verificado en vivo, NINGÚN alumno del seed original (ni Pedro, ni
 *    Diego, ni Martín) aparece hoy en `/api/members`. La pantalla
 *    "Miembros" es hoy inservible para encontrar a nadie del seed en este
 *    entorno compartido.
 *
 * Con (1) descartando a todo representante y (2) descartando la búsqueda por
 * `/members`, el único alumno adulto autogestionado del seed —Pedro, que ya
 * pasa `alta_presencial_completada` porque tiene su propia membresía— es el
 * único sujeto viable. La asignación/retiro del beneficio usa
 * `POST`/`DELETE /api/personas/:id/beneficio` directo — el MISMO endpoint
 * que `BeneficioSection` llama, con la MISMA sesión de admin que la UI ya
 * abrió (`page.request` comparte cookies con `page`) — en vez de navegar a
 * `/members`. Es una mutación real contra el backend real, no un mock; lo
 * único que no se ejercita es el clic en una pantalla que hoy no puede
 * encontrar a nadie. Todo lo demás — crear el descuento, y sobre todo el
 * lado que nadie había probado (que el pago del alumno refleje el
 * descuento) — sigue siendo 100% UI real.
 *
 * ## Compartir a Pedro con `payments.live.spec.ts`
 *
 * Ese spec ya usa a Pedro y corre DESPUÉS de este en orden alfabético
 * ("discount-" < "payments-"). No le importa el monto exacto de su propio
 * pago (solo el texto de estado), así que un beneficio parcial que este
 * archivo deje sin retirar no lo rompería — pero un beneficio del 100%
 * (test 3) SÍ reemplazaría su botón "Registrar un pago" por "Aplicar mi
 * beneficio". Por eso cada test que asigna un beneficio lo retira antes de
 * terminar, en un `finally`, pase o falle la aserción: Pedro queda sin
 * beneficio activo al salir de este archivo, siempre.
 *
 * ## Cobertura bonificada: un concepto DISTINTO, no el mismo descuento
 *
 * El seed menciona "coberturas bonificadas". Leyendo el dominio
 * (`CoberturaBonificada` en `modelos.py`, `PagoServicio.aplicar_beneficio_
 * bonificado`): un beneficio del 100% NUNCA pasa por `registrar_pago` — el
 * frontend lo detecta (`isFullBenefit`, `PaymentsContent`) y reemplaza el
 * formulario de pago por `ApplyBenefitForm`, que llama a
 * `POST /membresias/:id/aplicar-beneficio` y otorga cobertura sin crear
 * ningún `Pago`. Es una tabla y un camino de código aparte, así que el
 * tercer test de este archivo lo cubre por separado — y documenta, sin
 * arreglarlo, que la pantalla de cobertura del alumno (que solo lee `Pago`s
 * aprobados) no se entera de esa cobertura nueva.
 *
 * Efecto colateral PERMANENTE de ese test: a diferencia de un `Pago` (queda
 * `PENDIENTE_VALIDACION` y el `beforeEach` de este archivo lo rechaza), la
 * `CoberturaBonificada` que otorga no tiene ningún endpoint de baja — cada
 * corrida de este archivo avanza la cobertura real de Pedro un mes más. Es
 * el mismo comportamiento irreversible que ya documentan
 * `PaymentHistorySection`/`BeneficioSection` ("los pagos históricos no
 * cambian").
 *
 * **¿Se puede evitar usando otra persona del seed?** No — evaluado y
 * descartado. `aplicar_beneficio_bonificado` (el método que este test
 * ejercita) es "autoservicio del PAGADOR (dueño o su representante), NUNCA
 * un ADMINISTRADOR 'por él'" (docstring propio, `membresia_pago_servicio.
 * py`) — no hay forma de otorgarlo por API en nombre de un tercero, ni
 * siquiera como admin. Eso exige una sesión que llegue de verdad a
 * `/student/payments`, y ningún otro alumno del seed puede: los menores
 * (Diego, Martín, Sofía, Ana, Luis, María) quedan bloqueados como
 * `blockedAsMinor` al ver su PROPIO perfil, y sus representantes (Carlos,
 * Laura) quedan bloqueados por el hallazgo (1) de más arriba — un bloqueo
 * de BACKEND, no solo de ruteo: `GestorAutenticacion.decodificar_token`
 * (`gestor_auth.py`) rechaza con 403 casi cualquier endpoint para una
 * cuenta sin `activacion_completa`, `/personas/*` aparte. Pedro es
 * literalmente el único sujeto posible para este test tal como está
 * sembrada la base hoy.
 *
 * **Medido, no asumido:** confirmado contra la base real (`SELECT count(*),
 * min(fecha_inicio), max(fecha_fin) FROM cobertura_bonificada WHERE
 * persona_id = <Pedro>`) durante el desarrollo de este archivo — cada
 * aplicación real agrega exactamente UNA fila con un mes de cobertura,
 * encadenada a partir de la anterior (`_fecha_fin_maxima_combinada` ancla en
 * el máximo ya otorgado, nunca en "hoy" una vez que ese máximo ya está en el
 * futuro). Es lineal y predecible: la corrida N deja la cobertura de Pedro
 * N meses más adelante que su estado original, ni un día más. Se corrió la
 * suite completa CINCO veces seguidas sin resetear el stack (ver el PR) para
 * confirmar que ese avance no afecta a `payments.live.spec.ts` ni a ningún
 * otro spec — los 5 meses acumulados no rompieron ninguna aserción, porque
 * ninguna otra pantalla o gate lee la fecha de cobertura como "cuán lejos
 * en el futuro está": `registrar_pago` deriva su propio período desde el
 * mismo ancla combinado y no tiene techo de fecha, solo un techo de MESES
 * por pedido (`PagoCreateDTO.meses`, `le=12`), y `hasPendingPago`/
 * `canRegisterHere` (frontend) no leen esa fecha en absoluto.
 *
 * **Señal a mirar si algún día esto rompe algo:** el único lugar donde una
 * cobertura absurdamente lejana podría notarse es el rango de fechas que
 * `payments.live.spec.ts` ve en pantalla ("Cubre" / `pago.fechaInicio` /
 * `pago.fechaFin` de su propio pago) — si ese spec empezara a fallar sin
 * ningún cambio de código, lo primero a revisar es `SELECT max(fecha_fin)
 * FROM cobertura_bonificada WHERE persona_id = <Pedro>` contra la fecha de
 * hoy: si la diferencia es de años en vez de meses, ahí está la causa, y
 * limpiarla es una operación manual de base de datos (nunca un endpoint de
 * baja nuevo — no es el alcance de este archivo).
 *
 * ## Estado que este archivo deja, y cómo lo tolera
 *
 * Un beneficio asignado es un hecho vigente hasta que alguien lo retira
 * (`AsignacionDescuento.retirado_en IS NULL`), y solo puede haber uno activo
 * por persona. `make qa-live` corre esta suite más de una vez sobre el mismo
 * stack, así que el `beforeEach` retira cualquier beneficio activo que haya
 * dejado una corrida anterior (una que se haya interrumpido antes de su
 * propio `finally`) y rechaza cualquier pago pendiente de Pedro — mismo
 * mecanismo que `payments.live.spec.ts` ya usa para él.
 *
 * ## Cómo se corre
 *
 *     make qa-up      # backend + base sembrada + frontend, en localhost:3000
 *     make qa-live
 */
import { expect, test, request as apiRequestModule, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";
import { loginViaUi } from "./helpers/live-login";
import { rejectPendingPayments } from "./helpers/pending-payments";

/** Sembrados por `backend/scripts/seed_dev_base.py`. */
const ADMIN_EMAIL = "admin@cataclub.com";
const ADMIN_PASSWORD = "admin12345";
/** Único alumno adulto autogestionado del seed — ver el encabezado del archivo
 *  para por qué es el único sujeto viable en este entorno. */
const PEDRO_EMAIL = "pedro@cataclub.com";
const PEDRO_PASSWORD = "alumno123";
const PEDRO_FULL_NAME = "Pedro Salgado";

/** Nombre único por corrida — el catálogo de descuentos persiste entre corridas
 *  de `make qa-live` (mismo criterio que `discounts.live.spec.ts`). */
function nombreUnico(prefijo: string): string {
  return `${prefijo} ${Date.now()}`;
}

/** Resuelve el `persona_id` propio iniciando sesión como el alumno mismo —
 *  `/api/members` no sirve para esto en este entorno (ver el encabezado del
 *  archivo), pero la respuesta de `POST /api/auth/login` ya trae el id. Usa
 *  un contexto DESCARTABLE, nunca el `request` de admin del `beforeEach` ni
 *  el de `page` — pisaría la sesión de admin que ambos necesitan después. */
async function personaIdViaOwnLogin(email: string, password: string): Promise<string> {
  const ctx = await apiRequestModule.newContext({ baseURL: E2E_BASE_URL });
  try {
    const res = await ctx.post("/api/auth/login", { data: { email, password } });
    expect(res.ok(), `No se pudo iniciar sesión como ${email} para resolver su persona_id: ${res.status()}`).toBe(
      true,
    );
    const body = (await res.json()) as { user: { id: string } };
    return body.user.id;
  } finally {
    await ctx.dispose();
  }
}

// ---------------------------------------------------------------------------
// Limpieza de estado vía API — no es el flujo bajo prueba, es higiene entre
// corridas. `rejectPendingPayments` vive en `helpers/pending-payments.ts`
// (issue de duplicación de SonarCloud, PR #1079): era casi un calco de la
// versión local que tenía `payments.live.spec.ts`, así que ahora es una sola
// copia que ambos specs reusan.
// ---------------------------------------------------------------------------

/** Retira el beneficio activo de `personaId`, si una corrida anterior dejó uno
 *  (una interrumpida antes de su propio `finally`) — `BeneficioServicio.
 *  asignar` rechaza una segunda asignación mientras la primera siga vigente.
 *  Tolerante a "no hay nada que retirar". */
async function retireActiveBenefitIfAny(request: APIRequestContext, personaId: string): Promise<void> {
  const res = await request.get(`${E2E_BASE_URL}/api/personas/${personaId}/beneficio`);
  if (!res.ok()) return;
  const beneficio: unknown = await res.json();
  if (!beneficio) return;
  const deleted = await request.delete(`${E2E_BASE_URL}/api/personas/${personaId}/beneficio`);
  expect(deleted.ok(), `No se pudo retirar el beneficio previo de la persona ${personaId}: ${deleted.status()}`).toBe(
    true,
  );
}

test.beforeEach(async ({ request }) => {
  const pedroId = await personaIdViaOwnLogin(PEDRO_EMAIL, PEDRO_PASSWORD);
  await rejectPendingPayments(request, ADMIN_EMAIL, ADMIN_PASSWORD, PEDRO_FULL_NAME);
  await retireActiveBenefitIfAny(request, pedroId);
});

// ---------------------------------------------------------------------------
// Flujo de UI — admin
// ---------------------------------------------------------------------------

/** Crea un descuento porcentual desde `/discounts` — mismo flujo que
 *  `discounts.live.spec.ts`, parametrizado por valor — y devuelve su id
 *  (necesario para asignarlo por API, ver el encabezado del archivo). */
async function crearDescuentoPorcentaje(page: Page, nombre: string, porcentaje: number): Promise<number> {
  await page.goto("/discounts");
  await page.getByRole("button", { name: /nuevo descuento/i }).first().click();
  await page.getByLabel("Nombre").fill(nombre);
  // "Tipo" ya nace en "Porcentaje (%)" (`EMPTY_FORM.modalidad`) — no hace falta tocarlo.
  await page.getByLabel("Valor").fill(String(porcentaje));
  await page.getByRole("button", { name: "Crear", exact: true }).click();
  await expect(page.getByText("Descuento creado correctamente.")).toBeVisible({ timeout: 15_000 });

  const catalogo = await page.request.get("/api/descuentos?limit=200");
  expect(catalogo.ok(), `No se pudo leer el catálogo de descuentos: ${catalogo.status()}`).toBe(true);
  const body = (await catalogo.json()) as { items: Array<{ id: number; nombre: string }> };
  const creado = body.items.find((d) => d.nombre === nombre);
  expect(creado, `El descuento "${nombre}" no aparece en el catálogo recién leído`).toBeTruthy();
  return creado!.id;
}

/** Asigna `descuentoId` a `personaId` — `POST /api/personas/:id/beneficio`, el
 *  mismo endpoint que `BeneficioSection.handleAssign` llama, con la sesión de
 *  admin que `page` ya tiene abierta. */
async function asignarBeneficio(page: Page, personaId: string, descuentoId: number): Promise<void> {
  const res = await page.request.post(`/api/personas/${personaId}/beneficio`, {
    data: { descuentoId },
  });
  expect(res.ok(), `No se pudo asignar el beneficio: ${res.status()} ${await res.text()}`).toBe(true);
}

/** Retira el beneficio activo de `personaId` — `DELETE /api/personas/:id/beneficio`,
 *  mismo endpoint que el botón "Retirar beneficio" de `BeneficioSection`. */
async function retirarBeneficio(page: Page, personaId: string): Promise<void> {
  const res = await page.request.delete(`/api/personas/${personaId}/beneficio`);
  expect(res.ok(), `No se pudo retirar el beneficio: ${res.status()} ${await res.text()}`).toBe(true);
}

test("un beneficio asignado a un alumno reduce el monto que paga, y la reducción persiste tras recargar", async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000);
  const discountName = nombreUnico("QA descuento pago");
  const pedroId = await personaIdViaOwnLogin(PEDRO_EMAIL, PEDRO_PASSWORD);

  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/dashboard/);
  const descuentoId = await crearDescuentoPorcentaje(page, discountName, 20);
  // Pedro paga "Mensual Adultos" ($40): 20% de descuento son $8, monto final $32.
  await asignarBeneficio(page, pedroId, descuentoId);

  const alumnoContext = await browser.newContext();
  const alumnoPage = await alumnoContext.newPage();
  try {
    await loginViaUi(alumnoPage, PEDRO_EMAIL, PEDRO_PASSWORD, /\/student/);
    await alumnoPage.goto("/student/payments");
    const abrirFormulario = alumnoPage.getByRole("button", { name: "Registrar un pago" });
    await expect(abrirFormulario).toBeVisible({ timeout: 20_000 });
    await abrirFormulario.click();
    await alumnoPage.getByLabel("Forma de pago").selectOption("EFECTIVO");
    await alumnoPage.getByRole("button", { name: "Registrar pago", exact: true }).click();
    await alumnoPage.getByRole("button", { name: "Confirmar y registrar" }).click();

    // El monto REAL que el backend calculó (`nuevoPago.monto`), no una
    // previsualización del cliente — ver el comentario de `RenewPaymentForm`.
    await expect(alumnoPage.getByText("$32,00 por el período")).toBeVisible({ timeout: 15_000 });

    // Persistencia: recargar y leer el desglose desde la fila del historial,
    // nunca del estado local del formulario que ya se cerró.
    await alumnoPage.reload();
    const table = alumnoPage.getByTestId("student-payments-table");
    // Corridas previas de este mismo spec dejan pagos RECHAZADOS que también
    // llevan su descuento congelado (`descuento_valor_aplicado` sobrevive al
    // rechazo) — `pago-descuento` sin acotar resuelve más de uno. El botón
    // "Detalle" de la fila más nueva (`.first()`, orden desc por fecha) sabe
    // exactamente qué panel abre vía su propio `aria-controls`.
    const detalleBoton = table.getByRole("button", { name: "Detalle" }).first();
    await detalleBoton.click();
    const panelId = await detalleBoton.getAttribute("aria-controls");
    expect(panelId, "El botón Detalle no declaró aria-controls").toBeTruthy();
    const detalle = alumnoPage.locator(`#${panelId}`).getByTestId("pago-descuento");
    await expect(detalle).toBeVisible();
    await expect(detalle).toContainText("$40,00"); // precio de lista, tachado
    await expect(detalle).toContainText("−$8,00 (20%)"); // U+2212, no un guión — ver PagoDetailPanel
    await expect(detalle).toContainText("$32,00"); // monto final
  } finally {
    await alumnoContext.close();
    await retirarBeneficio(page, pedroId);
  }
});

test("retirar el beneficio de un alumno restaura el monto completo en su siguiente pago", async ({ page, browser }) => {
  test.setTimeout(60_000);
  const discountName = nombreUnico("QA descuento restaurado");
  const pedroId = await personaIdViaOwnLogin(PEDRO_EMAIL, PEDRO_PASSWORD);

  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/dashboard/);
  const descuentoId = await crearDescuentoPorcentaje(page, discountName, 20);
  await asignarBeneficio(page, pedroId, descuentoId);
  // El camino inverso: retirar ANTES de que Pedro pague nada con este
  // beneficio — si el retiro no funcionara, el pago de abajo seguiría
  // saliendo descontado.
  await retirarBeneficio(page, pedroId);

  const alumnoContext = await browser.newContext();
  const alumnoPage = await alumnoContext.newPage();
  try {
    await loginViaUi(alumnoPage, PEDRO_EMAIL, PEDRO_PASSWORD, /\/student/);
    await alumnoPage.goto("/student/payments");
    const abrirFormulario = alumnoPage.getByRole("button", { name: "Registrar un pago" });
    await expect(abrirFormulario).toBeVisible({ timeout: 20_000 });
    await abrirFormulario.click();
    await alumnoPage.getByLabel("Forma de pago").selectOption("EFECTIVO");
    await alumnoPage.getByRole("button", { name: "Registrar pago", exact: true }).click();
    await alumnoPage.getByRole("button", { name: "Confirmar y registrar" }).click();

    // Sin beneficio vigente, el monto real vuelve a ser el de lista ($40).
    await expect(alumnoPage.getByText("$40,00 por el período")).toBeVisible({ timeout: 15_000 });

    await alumnoPage.reload();
    const table = alumnoPage.getByTestId("student-payments-table");
    const primeraFila = table.locator("tbody tr").first();
    await expect(primeraFila).toContainText("$40,00");
    // Sin descuento, sin voucher, sin rechazo: la fila no tiene nada que
    // desplegar (`pagoHasDetail`), así que no hay botón "Detalle" que abrir.
    await expect(primeraFila).not.toContainText("Detalle");
  } finally {
    await alumnoContext.close();
  }
});

test("HALLAZGO: un beneficio del 100% aplica cobertura sin generar ningún pago, y la pantalla del alumno no lo refleja", async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(60_000);
  const discountName = nombreUnico("QA beneficio total");
  const pedroId = await personaIdViaOwnLogin(PEDRO_EMAIL, PEDRO_PASSWORD);

  await loginViaUi(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/dashboard/);
  const descuentoId = await crearDescuentoPorcentaje(page, discountName, 100);
  await asignarBeneficio(page, pedroId, descuentoId);

  // `request` ya quedó autenticado como admin en el `beforeEach` — se
  // reutiliza para leer el historial de Pedro antes y después, sin tocar la
  // cookie de `page` (sigue siendo admin) ni la de `alumnoPage` (Pedro).
  const pagosAntes = (await request
    .get(`${E2E_BASE_URL}/api/membresias/pagos/persona/${pedroId}`)
    .then((r) => r.json())) as unknown[];

  const alumnoContext = await browser.newContext();
  const alumnoPage = await alumnoContext.newPage();
  try {
    await loginViaUi(alumnoPage, PEDRO_EMAIL, PEDRO_PASSWORD, /\/student/);
    await alumnoPage.goto("/student/payments");

    const cobertura = alumnoPage.locator("#membership-status-title");
    await expect(cobertura).toBeVisible({ timeout: 20_000 });
    const coberturaAntes = await cobertura.textContent();

    // Domain fact verificado en el código real (`PaymentsContent.isFullBenefit`):
    // un beneficio del 100% reemplaza el formulario de pago por "Aplicar mi
    // beneficio" — nunca se llega a `RenewPaymentForm`/`registrarPago`.
    const abrirAplicar = alumnoPage.getByRole("button", { name: "Aplicar mi beneficio" });
    await expect(abrirAplicar).toBeVisible({ timeout: 20_000 });
    await abrirAplicar.click();
    await alumnoPage.getByRole("button", { name: "Aplicar beneficio", exact: true }).click();
    await alumnoPage.getByRole("button", { name: "Confirmar y aplicar" }).click();

    await expect(alumnoPage.getByText("cobertura activa")).toBeVisible({ timeout: 15_000 });
    await expect(alumnoPage.getByText("No se generó ningún pago: el beneficio cubrió el 100%.")).toBeVisible();

    // HALLAZGO: `resolveCoverageEnd` (student-utils.ts) solo mira `Pago`s
    // APROBADOS — la `CoberturaBonificada` recién otorgada vive en una tabla
    // aparte que `fetchPagosDePersona` nunca toca, así que la pantalla del
    // propio alumno sigue mostrando exactamente la misma fecha de cobertura
    // que antes de aplicar el beneficio, pese a que el toast de arriba
    // acaba de confirmar un período nuevo. No es un defecto que este spec
    // arregle — es el comportamiento real, para que el dueño del producto
    // decida si el frontend debe unificar las dos fuentes de cobertura.
    await alumnoPage.reload();
    await expect(alumnoPage.locator("#membership-status-title")).toHaveText(coberturaAntes ?? "", {
      timeout: 20_000,
    });
  } finally {
    await alumnoContext.close();
    // Ver el encabezado del archivo: un beneficio del 100% le cambia a Pedro
    // el botón de pago entero — `payments.live.spec.ts` corre después y
    // necesita encontrarlo sin beneficio activo, pase o falle esta aserción.
    await retirarBeneficio(page, pedroId);
  }

  const pagosDespues = (await request
    .get(`${E2E_BASE_URL}/api/membresias/pagos/persona/${pedroId}`)
    .then((r) => r.json())) as unknown[];
  expect(pagosDespues.length, "Aplicar un beneficio del 100% no debería crear ningún Pago").toBe(pagosAntes.length);
});
