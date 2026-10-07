/**
 * El sexto spec E2E contra un backend REAL: alta de un dependiente por un
 * representante (módulo 3) y la frontera de autorización entre
 * representantes.
 *
 * ## Qué prueba, y por qué
 *
 * Los specs live existentes (`activacion.live.spec.ts`,
 * `recuperacion-contrasenia.live.spec.ts`) solo cubren la AUTOINSCRIPCIÓN --
 * un jugador adulto se da de alta a sí mismo. El otro camino de negocio --
 * un representante inscribe a un dependiente -- nunca corrió contra un
 * backend real: `enroll-qa.spec.ts` prueba la sección "R" del asistente con
 * la red mockeada (~90 casos campo a campo), pero eso certifica el
 * FORMULARIO, no que el alta real deja un dependiente que el representante
 * puede ver. Este archivo cubre esa otra mitad, en dos partes:
 *
 *   1. un representante inscribe a un dependiente (un menor gestionado, sin
 *      credenciales propias -- issue #1137, invariante B: un representado
 *      nunca tiene `Usuario` propio, así que este es el ÚNICO camino que
 *      existe) y lo ve en su panel;
 *   2. la frontera de autorización: un representante NO puede leer los
 *      datos del dependiente de otro representante.
 *
 * ## Por qué el vínculo se verifica contra `/personas/{id}/beneficio`
 *
 * `middleware.ts` bloquea `/student` (y toda ruta protegida) para cualquier
 * cuenta con el claim `activacion_completa: false` -- redirige, server-side,
 * a `/login/activacion` ANTES de que la página cargue. Un representante
 * recién inscripto siempre trae ese claim en false (`puede_acceder_modulos`
 * exige correo verificado Y `alta_presencial_completada`, y esta segunda
 * condición depende de una `Membresia` histórica sobre la persona del
 * REPRESENTANTE -- no la del dependiente -- que solo un administrador crea
 * al registrar el primer pago). Es la misma limitación que ya documenta
 * `activacion.live.spec.ts` para la autoinscripción de un Jugador.
 *
 * Desde #1643 `GET /api/student` ya no sirve de sonda: llama a
 * `GET /portal/alumno/{id}`, que el backend deja detrás del mismo gate de
 * activación (`decodificar_token`, 403 "Tu cuenta aún no está habilitada...")
 * y que, por tanto, un representante recién inscripto no puede leer. Solo
 * `/personas*` queda fuera del gate para una cuenta pendiente (carve-out de
 * autoservicio familiar, #790), y su ownership se impone por endpoint.
 *
 * La sonda es `GET /api/personas/{id}/beneficio` (BFF de
 * `GET /personas/{id}/beneficio`): responde 200 solo al dueño de la persona,
 * a su representante o a un administrador (`PoliticaAccesoPersona.
 * exigir_acceso`) y 403 a cualquier otro. Así:
 *
 *   - parte 1: el representante A recibe 200 sobre el id de SU dependiente;
 *   - parte 2: el representante B, con su propia sesión, recibe 403 sobre el
 *     id del dependiente de A -- y, como control de que ese 403 viene de la
 *     regla de ownership y no del gate de activación, 200 sobre el suyo.
 *
 * El id del dependiente no viaja al cliente (`POST /api/enrollment/` solo
 * devuelve `{ enrolled: true }`), así que se resuelve con una sesión de
 * administrador buscando por un apellido único por alta (solo letras: un
 * apellido no admite dígitos).
 *
 * ## Por qué la parte 1 y la parte 2 comparten un representante
 *
 * `POST /enrollment/` tiene `@limiter.limit("10/minute")` por IP (protección
 * real contra abuso, no un límite de QA). Este archivo llegó a inscribir
 * hasta SEIS identidades por corrida cuando todavía tenía una tercera parte
 * (un dependiente CON cuenta propia -- issue #1137 retiró ese camino: un
 * representado nunca tiene `Usuario` propio) y, sumadas a las dos altas que
 * ya hacían `activacion.live.spec.ts`/`recuperacion-contrasenia.live.spec.ts`,
 * dos corridas seguidas de la suite completa podían acumular más de diez
 * altas en la ventana de 60s y disparar un 429 real -- reproducido con los
 * logs del backend (`ratelimit 10 per 1 minute ... exceeded`). El síntoma en
 * el test era engañoso: un timeout esperando "Inscripción completada" con el
 * encabezado YA presente en el DOM, porque la alta simplemente tardaba en
 * volver a intentar contra un límite que no iba a ceder dentro del test.
 *
 * La parte 1 y el lado "A" de la parte 2 (frontera de autorización) son la
 * MISMA situación -- un representante con un dependiente -- así que
 * comparten una única alta hecha una vez en `beforeAll`
 * (`test.describe.serial`, para que la parte 1 corra antes y dependa del
 * mismo estado que la parte 2 lee después). Sigue siendo DOS
 * páginas/contextos de navegador distintos donde hace falta demostrar
 * aislamiento real (representante A vs B en la parte 2), y cada corrida
 * sigue generando identidades nuevas y únicas (`Date.now()` + cédula
 * aleatoria) -- lo que se comparte es la alta DENTRO de una corrida, nunca
 * entre corridas. Con esto la suite queda en DOS altas por corrida (una
 * compartida para las partes 1+2, una para el representante B de la parte
 * 2), un tercio de las seis que llegó a hacer.
 *
 * ## Cómo se corre
 *
 *     make qa-up      # backend + base sembrada + frontend, en localhost:3000
 *     make qa-live
 *
 * Igual que el resto de los `*.live.spec.ts`, solo lo recoge el proyecto
 * `e2e-live` cuando `E2E_LIVE=1`.
 */
import {
  expect,
  request as apiRequestModule,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { E2E_BASE_URL } from "./e2e-target";
import { enrollDependentViaWizard, newDependent, newRepresentative, type NewDependent } from "./helpers/enrollment";

const ADMIN_EMAIL = "admin@cataclub.com";
const ADMIN_PASSWORD = "admin12345";

/** Un apellido único por alta, solo letras (el backend rechaza dígitos en un apellido). */
function uniqueSurname(): string {
  const token = Array.from(`${Date.now()}`, (digit) => "abcdefghij"[Number(digit)]).join("");
  return `Representante ${token.charAt(0).toUpperCase()}${token.slice(1)}`;
}

/**
 * El id de la persona del dependiente, resuelto con una sesión de
 * administrador DESCARTABLE (nunca la de un representante: el id no viaja al
 * cliente). Falla si la búsqueda no devuelve exactamente una persona -- un id
 * ambiguo haría vacía la sonda de ownership.
 */
async function findDependentPersonaId(dependent: NewDependent): Promise<number> {
  const admin = await apiRequestModule.newContext({ baseURL: E2E_BASE_URL });
  try {
    const login = await admin.post("/api/auth/login", { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    expect(login.ok(), `Login de admin para resolver el dependiente: ${login.status()}`).toBe(true);
    const token = dependent.apellidos.split(" ").at(-1) ?? dependent.apellidos;
    const search = await admin.get(`/api/personas/buscar?q=${encodeURIComponent(token)}&limit=50`);
    expect(search.ok(), await search.text()).toBe(true);
    const matches = (await search.json()) as Array<{ id: number }>;
    expect(matches, `Se esperaba exactamente una persona con el apellido ${dependent.apellidos}`).toHaveLength(1);
    return matches[0].id;
  } finally {
    await admin.dispose();
  }
}

/**
 * `GET /api/personas/{id}/beneficio` con la sesión real de `page`: la sonda de
 * ownership descrita en el encabezado. Devuelve el status, nunca lanza.
 */
async function probeBeneficioStatus(page: Page, personaId: number): Promise<{ status: number; body: string }> {
  const response = await page.request.get(`/api/personas/${personaId}/beneficio`);
  return { status: response.status(), body: await response.text() };
}

/** Un representante con un dependiente sin cuenta propia, en un contexto de navegador propio. */
async function enrollFreshRepresentative(
  browser: Browser,
  correoPrefix: string,
  dependentOverrides: Partial<NewDependent> = {},
): Promise<{ context: BrowserContext; page: Page; dependentId: number; dependent: NewDependent }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const suffix = Date.now();
  const representative = newRepresentative(`${correoPrefix}-${suffix}@cataclub.com`);
  const dependent = newDependent({ apellidos: uniqueSurname(), ...dependentOverrides });
  await enrollDependentViaWizard(page, representative, dependent);
  const dependentId = await findDependentPersonaId(dependent);
  return { context, page, dependentId, dependent };
}

test.describe.serial("Alta de un dependiente sin cuenta propia y frontera de autorización", () => {
  // Compartido entre las dos partes de este bloque -- ver "Por qué la parte
  // 1 y la parte 2 comparten un representante" en el encabezado del archivo:
  // una sola alta real, reusada, en vez de una por test.
  let contextA: BrowserContext | undefined;
  let pageA: Page;
  let dependienteAId: number;

  test.beforeAll(async ({ browser }) => {
    // El backoff de `confirmEnrollmentWithRateLimitBackoff` (ver
    // `helpers/enrollment.ts`) puede esperar hasta ~50s si choca con el rate
    // limit real de `POST /enrollment/`; el timeout por defecto de un hook
    // (30s) no le alcanza.
    test.setTimeout(120_000);
    const enrolled = await enrollFreshRepresentative(browser, "qa-rep-a");
    contextA = enrolled.context;
    pageA = enrolled.page;
    dependienteAId = enrolled.dependentId;
  });

  test.afterAll(async () => {
    await contextA?.close();
  });

  test("un representante inscribe a un dependiente sin cuenta propia y lo ve en tu panel", async () => {
    // El dependiente existe y el representante -- con su propia sesión
    // recién autenticada -- tiene acceso a él: la sonda de ownership da 200
    // sobre el id de SU dependiente (resuelto por un apellido único, ver el
    // encabezado). Un dependiente que no quedó vinculado a este representante
    // daría 403 acá.
    const propio = await probeBeneficioStatus(pageA, dependienteAId);
    expect(propio.status, propio.body).toBe(200);

    // Documentado, no fingido: la PÁGINA `/student` queda detrás de la
    // puerta de activación para cualquier alta pública recién hecha (ver el
    // comentario del encabezado) -- el representante recién inscripto
    // aterriza en `/login/activacion`, igual que un Jugador autoinscrito en
    // `activacion.live.spec.ts`.
    await pageA.goto("/student");
    await expect(pageA).toHaveURL(/\/login\/activacion$/, { timeout: 20_000 });
  });

  test("un representante no puede leer los datos del dependiente de otro representante", async ({ browser }) => {
    // Mismo margen que el `beforeAll` de arriba -- ver su comentario.
    test.setTimeout(120_000);

    // Representante B, en un contexto de navegador SEPARADO -- ninguna
    // cookie de A sobrevive al cambio de contexto, así que lo único que B
    // puede usar para cruzar es el id numérico del dependiente de A.
    const {
      context: contextB,
      page: pageB,
      dependentId: dependienteBId,
    } = await enrollFreshRepresentative(browser, "qa-rep-b");
    try {
      // Punto de partida sano: B tiene acceso a SU PROPIO dependiente (200) y
      // ese dependiente no es el de A. Con esto el 403 de abajo no puede ser el
      // gate de activación -- que bloquearía también esta lectura -- sino la
      // regla de ownership.
      expect(dependienteBId).not.toBe(dependienteAId);
      const propio = await probeBeneficioStatus(pageB, dependienteBId);
      expect(propio.status, propio.body).toBe(200);

      // El cruce: B pide, con su PROPIA sesión autenticada, el recurso del
      // dependiente de A por id -- exactamente lo que un representante
      // podría intentar cambiando el número de una URL propia.
      const cruce = await probeBeneficioStatus(pageB, dependienteAId);
      expect(cruce.status, cruce.body).toBe(403);
      const cuerpoCruce = JSON.parse(cruce.body) as { message?: string };
      expect(cuerpoCruce.message).toBe(
        "Solo la propia persona, su representante, o un administrador pueden ver este beneficio",
      );
    } finally {
      await contextB.close();
    }
  });
});
