/**
 * QA exhaustivo del alta pública de cuenta — el flujo al que se llega desde
 * "Inscríbase" en /login (`/student/enroll`).
 *
 * ## Qué prueba, y por qué así
 *
 * El asistente NO valida al enviar: valida mientras se escribe. Cada paso
 * calcula sus errores por campo (`validateEnrollFields`), deshabilita
 * "Siguiente" mientras quede alguno y nombra en `nextBlockedReason` los
 * campos que faltan. El mensaje concreto aparece AL LADO del campo, pero solo
 * una vez que el campo fue tocado (blur) — un formulario en blanco no es un
 * muro de rojo. Así que cada caso de borde aquí:
 *
 *   1. escribe el valor malo,
 *   2. hace blur para marcar el campo como tocado,
 *   3. afirma el mensaje exacto visible junto al campo,
 *   4. afirma que "Siguiente" quedó bloqueado,
 *   5. y guarda una captura con el id del caso.
 *
 * Afirmar el texto exacto y no un `/inválido/i` cualquiera es deliberado: el
 * mensaje ES el contrato con el usuario. Si alguien lo reescribe, este test
 * debe enterarse.
 *
 * ## Qué NO prueba
 *
 * El backend. Todo `/api/*` está interceptado, así que esto certifica la
 * compuerta del frontend y la traducción de errores de red — no la unicidad
 * real de una cédula. Esa parte vive en los `*.live.spec.ts` contra `make
 * qa-up`.
 *
 * ## Capturas
 *
 * Cada caso escribe `frontend/test-results/enroll-qa/<ID>-*.png`, que está
 * ignorado por git. Los ids (T1, P07, R03…) son los mismos que usa el informe
 * en `docs/archive/audits/2026-08-12/README.md`.
 *
 * Antes escribía DENTRO de `docs/archive/audits/2026-08-12/img/`, y eso hacía
 * que correr la suite reescribiera 84 archivos versionados de un audit
 * archivado. Un archivo es un registro congelado: son las capturas de la
 * corrida de ese día, no de la de hoy. El árbol quedaba sucio en cada corrida
 * y esas 84 modificaciones estaban a un `git add -A` de entrar al índice sin
 * que nadie las hubiera mirado.
 *
 * Para refrescar la evidencia de un audit hay que pedirlo explícitamente:
 *   ENROLL_QA_SHOT_DIR=../docs/archive/audits/2026-08-12/img pnpm exec playwright test enroll-qa
 */

import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import { birthDatePart, fillBirthDate } from "./helpers/birth-date";
// Importado, no copiado a mano (issue #999): un mock que repite el texto en
// vez de leerlo de la constante queda desactualizado en silencio la próxima
// vez que el mensaje cambie, exactamente lo que le pasó a este archivo.
import { MENSAJE_IDENTIDAD_DUPLICADA } from "../../src/lib/duplicate-identity";

const SHOT_DIR = process.env.ENROLL_QA_SHOT_DIR ?? "test-results/enroll-qa";

/** Captura de página completa nombrada por el id del caso del informe. */
async function shot(page: Page, caseId: string, slug: string): Promise<void> {
  await page.screenshot({ path: `${SHOT_DIR}/${caseId}-${slug}.png`, fullPage: true });
}

// ---------------------------------------------------------------------------
// Selectores
// ---------------------------------------------------------------------------

/**
 * Los ids de los campos, declarados — no derivados de la etiqueta.
 *
 * Este archivo tenía una RÉPLICA de `slugifyLabel` (src/components/
 * wizard-fields.tsx) y resolvía los ~40 casos con `#enroll-${slug(etiqueta)}`.
 * Eso convertía el texto visible en selector: renombrar "Nombres del
 * Representante" a "Nombres" —que es lo que pide la regla de las palabras,
 * porque la tarjeta ya se titula "Datos del representante"— movía
 * `#enroll-nombres-del-representante` debajo de cada caso que lo apuntaba, sin
 * que nada avisara.
 *
 * Ahora el id lo declara el producto en `ENROLL_FIELD_TOKEN` (enroll-utils.ts),
 * y esta tabla es su reflejo del lado del test. Se transcribe en vez de
 * importarse a propósito: si alguien cambia un id allá, este archivo tiene que
 * enterarse rompiéndose, que es justo lo que un espejo importado impediría.
 *
 * Se sigue resolviendo por id y no por `getByLabel`: varias etiquetas de este
 * asistente son prefijo de otra, y un match por texto ahí es ambiguo o frágil.
 */
const F = {
  nombres: "enroll-nombres",
  apellidos: "enroll-apellidos",
  fechaNacimiento: "enroll-fecha-nacimiento",
  cedula: "enroll-cedula",
  telefono: "enroll-telefono",
  correo: "enroll-correo",
  contrasenia: "enroll-contrasenia",
  contraseniaConfirmacion: "enroll-confirmar-contrasena",
  nombresRepresentante: "enroll-nombres-representante",
  apellidosRepresentante: "enroll-apellidos-representante",
  cedulaRepresentante: "enroll-cedula-representante",
  fechaNacimientoRepresentante: "enroll-fecha-nacimiento-representante",
  telefonoRepresentante: "enroll-telefono-representante",
  correoRepresentante: "enroll-correo-representante",
  contraseniaRepresentante: "enroll-contrasenia-representante",
  contraseniaRepresentanteConfirmacion: "enroll-confirmar-contrasena-representante",
  tipoSangre: "enroll-tipo-sangre",
  contactoEmergencia: "enroll-contacto-emergencia",
  telefonoEmergencia: "enroll-telefono-emergencia",
} as const;

type FieldId = (typeof F)[keyof typeof F];

function field(page: Page, id: FieldId): Locator {
  return page.locator(`#${id}`);
}

/**
 * El `<p>` de mensaje que `WizardInput` cuelga del campo.
 *
 * OJO: ese `#<id>-message` es el MISMO nodo para el error y para la pista
 * neutra ("Al menos 8 caracteres."). Existir no significa estar en error, así
 * que para afirmar ausencia de error se usa `expectFieldValid`, que mira
 * `aria-invalid` — el único discriminador real.
 */
function fieldError(page: Page, id: FieldId): Locator {
  return page.locator(`#${id}-message`);
}

/** El campo no está en error: sin `aria-invalid`, tenga o no una pista debajo. */
async function expectFieldValid(page: Page, id: FieldId): Promise<void> {
  await expect(field(page, id)).not.toHaveAttribute("aria-invalid", "true");
}

/**
 * La alerta de errores del PASO, y no cualquier `role="alert"` de la página:
 * conviven con ella el anunciador de rutas de Next y los toasts, y un
 * `getByRole("alert")` pelado choca contra los tres.
 */
function stepAlert(page: Page): Locator {
  return page.locator('div.alert-error[role="alert"]');
}

function nextButton(page: Page): Locator {
  return page.getByRole("button", { name: /siguiente/i });
}

/**
 * `BirthDateField` (issue #853) has no single input to `.fill()` — the two
 * birth-date ids route through `fillBirthDate` and blur its last part
 * (Año), the same control every fill ends on; every other field keeps the
 * original single-input path.
 */
const BIRTH_DATE_FIELDS: readonly FieldId[] = [F.fechaNacimiento, F.fechaNacimientoRepresentante];

/** Escribe un valor y hace blur, que es lo que destapa el mensaje del campo. */
async function fillAndBlur(page: Page, id: FieldId, value: string): Promise<void> {
  if (BIRTH_DATE_FIELDS.includes(id)) {
    await fillBirthDate(page, id, value);
    await birthDatePart(page, id, "anio").blur();
    return;
  }
  const input = field(page, id);
  await input.fill(value);
  await input.blur();
}

// ---------------------------------------------------------------------------
// Datos válidos de referencia
// ---------------------------------------------------------------------------

/**
 * Un adulto de 30 años, recalculado en cada corrida. Una fecha literal como
 * "1996-05-20" convierte a este test en una bomba de tiempo: el mismo dato
 * cruza el límite de 18 o el de 74 con solo dejar pasar los años.
 */
function isoYearsAgo(years: number, month = 5, day = 20): string {
  const y = new Date().getFullYear() - years;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const VALID_STUDENT = {
  nombres: "Juan Carlos",
  apellidos: "Pérez Mora",
  fechaNacimiento: isoYearsAgo(30),
  cedula: "1798765432",
  telefono: "991234567",
};

const VALID_CREDENTIALS = {
  correo: "juan.perez@example.com",
  contrasenia: "clave-segura-8",
  contraseniaConfirmacion: "clave-segura-8",
};

const VALID_REPRESENTATIVE = {
  nombres: "María Fernanda",
  apellidos: "Mora Salas",
  cedula: "1798765432",
  fechaNacimiento: isoYearsAgo(38),
  telefono: "0987654321",
  correo: "maria.mora@example.com",
  contrasenia: "clave-segura-8",
  contraseniaConfirmacion: "clave-segura-8",
};

const VALID_HEALTH = {
  tipoSangre: "O_POSITIVO",
  contacto: "Ana Salas",
  telefono: "0999888777",
};

// ---------------------------------------------------------------------------
// Red simulada
// ---------------------------------------------------------------------------

/**
 * El asistente es público, así que la sesión responde 401 y nada redirige.
 * El catálogo de instituciones se sirve vacío para que el paso no dependa de
 * datos sembrados; la institución es opcional y ningún caso de acá la usa.
 */
async function mockBaseRoutes(page: Page): Promise<void> {
  await page.route("**/api/auth/session", (route: Route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  // El sobre paginado que el cliente real espera (`{items, total, skip,
  // limit}`), no un arreglo pelado. Con el arreglo, `fetchInstituciones`
  // lanzaba `ApiClientError("Respuesta inválida de instituciones.")` y el
  // catálogo quedaba vacío POR ERROR: el paso se veía igual porque el fallo era
  // mudo, que es exactamente el sub-estado que este cambio destapa. Un mock que
  // no responde como el servidor certifica una pantalla que nadie tiene.
  await page.route("**/api/personas/instituciones**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, skip: 0, limit: 200 }),
    }),
  );
}

/** Respuesta del alta. Por defecto, éxito. */
async function mockEnrollment(
  page: Page,
  response: { status: number; body: unknown },
): Promise<void> {
  await page.route("**/api/enrollment/", (route: Route) =>
    route.fulfill({
      status: response.status,
      contentType: "application/json",
      body: JSON.stringify(response.body),
    }),
  );
}

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

/**
 * La entrada que pidió el encargo: se llega al alta CLICKEANDO "Inscríbase" en
 * el login, no navegando a la URL. Si ese enlace se rompe, el flujo entero es
 * inalcanzable para un visitante y ningún test de la página lo notaría.
 */
async function enterFromLogin(page: Page): Promise<void> {
  await mockBaseRoutes(page);
  await page.goto("/login");
  await expect(page.getByRole("link", { name: /inscríbase/i })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("link", { name: /inscríbase/i }).click();
  await expect(page).toHaveURL(/\/student\/enroll/);
  await expect(page.getByRole("heading", { name: /tipo de inscripción/i })).toBeVisible({
    timeout: 20_000,
  });
}

/** Elige el tipo y avanza al paso "Datos del Estudiante". */
async function goToPersonal(page: Page, type: "Jugador" | "Representante"): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${type}`) }).click();
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: /datos del estudiante/i })).toBeVisible();
}

/** Completa el paso del estudiante con datos válidos, sin avanzar. */
async function fillValidStudent(page: Page): Promise<void> {
  await field(page, F.nombres).fill(VALID_STUDENT.nombres);
  await field(page, F.apellidos).fill(VALID_STUDENT.apellidos);
  await fillBirthDate(page, F.fechaNacimiento, VALID_STUDENT.fechaNacimiento);
  await field(page, F.cedula).fill(VALID_STUDENT.cedula);
  await field(page, F.telefono).fill(VALID_STUDENT.telefono);
}

async function fillValidRepresentative(page: Page): Promise<void> {
  await field(page, F.nombresRepresentante).fill(VALID_REPRESENTATIVE.nombres);
  await field(page, F.apellidosRepresentante).fill(VALID_REPRESENTATIVE.apellidos);
  await field(page, F.cedulaRepresentante).fill(VALID_REPRESENTATIVE.cedula);
  await fillBirthDate(page, F.fechaNacimientoRepresentante, VALID_REPRESENTATIVE.fechaNacimiento);
  await field(page, F.telefonoRepresentante).fill(VALID_REPRESENTATIVE.telefono);
  await field(page, F.correoRepresentante).fill(VALID_REPRESENTATIVE.correo);
  await field(page, F.contraseniaRepresentante).fill(VALID_REPRESENTATIVE.contrasenia);
  await field(page, F.contraseniaRepresentanteConfirmacion).fill(VALID_REPRESENTATIVE.contraseniaConfirmacion);
}

/** El correo y la contraseña (con su confirmación) de la autoinscripción, sin avanzar. */
async function fillValidCredentials(page: Page): Promise<void> {
  await field(page, F.correo).fill(VALID_CREDENTIALS.correo);
  await field(page, F.contrasenia).fill(VALID_CREDENTIALS.contrasenia);
  await field(page, F.contraseniaConfirmacion).fill(VALID_CREDENTIALS.contraseniaConfirmacion);
}

async function fillValidHealth(page: Page): Promise<void> {
  await field(page, F.tipoSangre).selectOption(VALID_HEALTH.tipoSangre);
  await field(page, F.contactoEmergencia).fill(VALID_HEALTH.contacto);
  await field(page, F.telefonoEmergencia).fill(VALID_HEALTH.telefono);
}

// ===========================================================================
// T — Paso "Tipo de Inscripción" y la entrada desde el login
// ===========================================================================

test.describe("T · Entrada desde el login y tipo de inscripción", () => {
  test("T1 · el enlace Inscríbase del login abre el alta pública sin sesión", async ({ page }) => {
    await enterFromLogin(page);
    await shot(page, "T1", "entrada-desde-login");
  });

  test("T2 · el tipo por defecto es Jugador y se puede cambiar a Representante", async ({ page }) => {
    await enterFromLogin(page);

    const jugador = page.getByRole("button", { name: /^Jugador/ });
    const representante = page.getByRole("button", { name: /^Representante/ });
    await expect(jugador).toHaveAttribute("aria-pressed", "true");
    await expect(representante).toHaveAttribute("aria-pressed", "false");

    await representante.click();
    await expect(representante).toHaveAttribute("aria-pressed", "true");
    await expect(jugador).toHaveAttribute("aria-pressed", "false");
    await shot(page, "T2", "cambio-de-tipo");
  });

  test("T3 · el paso de tipo nunca bloquea: Siguiente está habilitado desde el inicio", async ({ page }) => {
    await enterFromLogin(page);
    await expect(nextButton(page)).toBeEnabled();
    await shot(page, "T3", "tipo-siempre-valido");
  });
});

// ===========================================================================
// P — Paso "Datos del Estudiante", inscripción propia (Jugador)
// ===========================================================================

test.describe("P · Datos del estudiante (autoinscripción)", () => {
  test.beforeEach(async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");
  });

  test("P01 · un paso en blanco bloquea Siguiente y nombra lo que falta", async ({ page }) => {
    await expect(nextButton(page)).toBeDisabled();
    // El motivo lista los campos por su nombre visible — no "hay errores".
    await expect(page.getByText(/^Para continuar, revise:/)).toBeVisible();
    await shot(page, "P01", "paso-en-blanco");
  });

  test("P02 · nombres de menos de 3 caracteres", async ({ page }) => {
    await fillAndBlur(page, F.nombres, "Al");
    await expect(fieldError(page, F.nombres)).toHaveText(
      "Los nombres deben tener al menos 3 caracteres.",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "P02", "nombres-cortos");
  });

  test("P03 · nombres con dígitos", async ({ page }) => {
    await fillAndBlur(page, F.nombres, "Juan123");
    await expect(fieldError(page, F.nombres)).toHaveText(
      "Los nombres tienen un carácter que no reconocemos en un nombre de persona.",
    );
    await shot(page, "P03", "nombres-con-digitos");
  });

  test("P04 · nombres con símbolos", async ({ page }) => {
    await fillAndBlur(page, F.nombres, "Juan@Carlos");
    await expect(fieldError(page, F.nombres)).toHaveText(
      "Los nombres tienen un carácter que no reconocemos en un nombre de persona.",
    );
    await shot(page, "P04", "nombres-con-simbolos");
  });

  test("P05 · nombres con tildes y ñ son válidos", async ({ page }) => {
    await fillAndBlur(page, F.nombres, "José Ñandú");
    await expectFieldValid(page, F.nombres);
    await shot(page, "P05", "nombres-con-tildes-validos");
  });

  test("P06 · apellidos de menos de 3 caracteres", async ({ page }) => {
    await fillAndBlur(page, F.apellidos, "Pé");
    await expect(fieldError(page, F.apellidos)).toHaveText(
      "Los apellidos deben tener al menos 3 caracteres.",
    );
    await shot(page, "P06", "apellidos-cortos");
  });

  test("P07 · apellidos con dígitos", async ({ page }) => {
    await fillAndBlur(page, F.apellidos, "Pérez2");
    await expect(fieldError(page, F.apellidos)).toHaveText(
      "Los apellidos tienen un carácter que no reconocemos en un nombre de persona.",
    );
    await shot(page, "P07", "apellidos-con-digitos");
  });

  test("P08 · cédula de 9 dígitos", async ({ page }) => {
    await fillAndBlur(page, F.cedula, "123456789");
    await expect(fieldError(page, F.cedula)).toHaveText(
      "La cédula de identidad debe tener 10 dígitos.",
    );
    await shot(page, "P08", "cedula-corta");
  });

  test("P09 · un 11º dígito de cédula no entra, y el límite se anuncia (#225, QA 2026-08-12)", async ({ page }) => {
    // El `maxLength` original (#225) se comía el 11º dígito en silencio: el
    // campo quedaba en 10, pero nada le decía al visitante por qué. Esta
    // vuelta de QA pidió el tope de vuelta ("no puede tipear 11"), pero nunca
    // silencioso: el 11º dígito sigue sin entrar, y ahora un aviso explícito
    // (`aria-live`) dice por qué — ver `numeric-input.ts`.
    const cedula = field(page, F.cedula);
    await cedula.fill("17123456789");
    await expect(cedula).toHaveValue("1712345678");
    await expect(page.getByText(/alcanzó el máximo de 10 dígitos/i)).toBeVisible();
    await shot(page, "P09", "cedula-11o-digito-no-entra");

    // Al salir del campo, el aviso transitorio cede el paso al veredicto
    // definitivo de la regla: "1712345678" es EL PLACEHOLDER que el propio
    // formulario sugiere (ver V03) — 10 dígitos, pero con el verificador
    // equivocado.
    await cedula.blur();
    await expect(fieldError(page, F.cedula)).toHaveText(
      "La cédula de identidad no es válida.",
    );
  });

  test("P10 · cédula con letras", async ({ page }) => {
    await fillAndBlur(page, F.cedula, "17A2345678");
    await expect(fieldError(page, F.cedula)).toHaveText(
      "La cédula de identidad debe tener 10 dígitos.",
    );
    await shot(page, "P10", "cedula-con-letras");
  });

  test("P11 · teléfono de 6 dígitos", async ({ page }) => {
    // #1028 (round 3): este paso espera los 9 dígitos tras el +593; una
    // entrada con 0 inicial se rechaza nombrando el error, sin normalizar.
    await fillAndBlur(page, F.telefono, "099123");
    await expect(fieldError(page, F.telefono)).toHaveText(
      "No incluya el 0 inicial: escriba solo los 9 dígitos que siguen al +593.",
    );
    await shot(page, "P11", "telefono-corto");
  });

  test("P12 · teléfono con guiones: los separadores siguen siendo válidos", async ({ page }) => {
    // #1028 (round 3): la entrada de este paso son los 9 dígitos tras el
    // +593, y la regla del paso tolera los separadores de tipeo (espacio,
    // guion, paréntesis) igual que antes — "991-234-567" limpia a los
    // mismos 9 dígitos y sigue pasando; lo que ya no pasa es repetir el
    // 593 ni incluir el 0 inicial (ver P11/V01/V02).
    await fillAndBlur(page, F.telefono, "991-234-567");
    await expectFieldValid(page, F.telefono);
    await shot(page, "P12", "telefono-con-guiones-valido");
  });

  test("P13 · fecha de nacimiento vacía", async ({ page }) => {
    await birthDatePart(page, F.fechaNacimiento, "dia").focus();
    await birthDatePart(page, F.fechaNacimiento, "dia").blur();
    await expect(fieldError(page, F.fechaNacimiento)).toHaveText(
      "La fecha de nacimiento es obligatoria.",
    );
    await shot(page, "P13", "fecha-vacia");
  });

  test("P14 · un menor de edad no puede autoinscribirse", async ({ page }) => {
    await fillAndBlur(page, F.fechaNacimiento, isoYearsAgo(12));
    await expect(fieldError(page, F.fechaNacimiento)).toContainText(
      "Los menores de edad no pueden autoinscribirse.",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "P14", "menor-autoinscripcion");
  });

  test("P15 · el límite inferior es 18 exactos, y 18 pasa", async ({ page }) => {
    await fillAndBlur(page, F.fechaNacimiento, isoYearsAgo(18, 1, 1));
    await expectFieldValid(page, F.fechaNacimiento);
    await shot(page, "P15", "borde-18-anios-valido");
  });

  test("P16 · 17 años y 11 meses todavía es menor", async ({ page }) => {
    // Un año menos un día: el cálculo de edad tiene que restar el año que aún
    // no cumplió, no redondear hacia arriba.
    const today = new Date();
    const y = today.getFullYear() - 18;
    const almost = new Date(y, today.getMonth(), today.getDate() + 1);
    const iso = `${almost.getFullYear()}-${String(almost.getMonth() + 1).padStart(2, "0")}-${String(almost.getDate()).padStart(2, "0")}`;
    await fillAndBlur(page, F.fechaNacimiento, iso);
    await expect(fieldError(page, F.fechaNacimiento)).toContainText(
      "Los menores de edad no pueden autoinscribirse.",
    );
    await shot(page, "P16", "borde-17-anios-11-meses");
  });

  test("P17 · correo sin arroba", async ({ page }) => {
    await fillAndBlur(page, F.correo, "juanexample.com");
    await expect(fieldError(page, F.correo)).toHaveText(
      "El correo electrónico no es válido.",
    );
    await shot(page, "P17", "correo-sin-arroba");
  });

  test("P18 · correo sin dominio de primer nivel", async ({ page }) => {
    await fillAndBlur(page, F.correo, "juan@example");
    await expect(fieldError(page, F.correo)).toHaveText(
      "El correo electrónico no es válido.",
    );
    await shot(page, "P18", "correo-sin-tld");
  });

  test("P19 · correo con espacios", async ({ page }) => {
    await fillAndBlur(page, F.correo, "juan perez@example.com");
    await expect(fieldError(page, F.correo)).toHaveText(
      "El correo electrónico no es válido.",
    );
    await shot(page, "P19", "correo-con-espacios");
  });

  test("P20 · contraseña de 7 caracteres", async ({ page }) => {
    await fillAndBlur(page, F.contrasenia, "1234567");
    await expect(fieldError(page, F.contrasenia)).toHaveText(
      "La contraseña debe tener al menos 8 caracteres.",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "P20", "contrasenia-corta");
  });

  test("P21 · contraseña de 8 caracteres exactos pasa el borde de largo", async ({ page }) => {
    // "12345678" ya no sirve para este borde: es una contraseña común y la
    // rechaza esa regla (ver V08), no la de largo. Este caso necesita un valor
    // que sea exactamente 8 caracteres Y no esté en la lista de comunes, para
    // medir el borde de largo en aislamiento.
    await fillAndBlur(page, F.contrasenia, "Xk9mQr2p");
    await expectFieldValid(page, F.contrasenia);
    await shot(page, "P21", "borde-contrasenia-8");
  });

  test("P22 · con todo válido, Siguiente se habilita y el paso avanza", async ({ page }) => {
    await fillValidStudent(page);
    await fillValidCredentials(page);
    await expect(nextButton(page)).toBeEnabled();
    await shot(page, "P22", "paso-completo-valido");

    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: /salud y emergencia/i })).toBeVisible();
  });

  test("P23 · la autoinscripción salta el paso de representante", async ({ page }) => {
    await fillValidStudent(page);
    await fillValidCredentials(page);
    await nextButton(page).click();
    // Un jugador no tiene representante: el paso no debe existir en su recorrido.
    await expect(page.getByRole("heading", { name: /datos del representante/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /salud y emergencia/i })).toBeVisible();
    await shot(page, "P23", "salto-de-paso-representante");
  });

  test("P24 · la confirmación que no repite la contraseña bloquea Siguiente (#876)", async ({ page }) => {
    await fillValidStudent(page);
    await field(page, F.correo).fill(VALID_CREDENTIALS.correo);
    await field(page, F.contrasenia).fill(VALID_CREDENTIALS.contrasenia);
    await fillAndBlur(page, F.contraseniaConfirmacion, "otra-clave-9");
    await expect(fieldError(page, F.contraseniaConfirmacion)).toHaveText(
      "Las contraseñas no coinciden.",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "P24", "confirmacion-no-coincide");

    await field(page, F.contraseniaConfirmacion).fill(VALID_CREDENTIALS.contrasenia);
    await expect(nextButton(page)).toBeEnabled();
  });
});

// ===========================================================================
// C — Paso "Datos del Estudiante", inscripción de un dependiente
// ===========================================================================

test.describe("C · Datos del estudiante (inscripción de un dependiente)", () => {
  test.beforeEach(async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Representante");
  });

  test("C01 · sin credenciales del estudiante el paso es válido: son opcionales", async ({ page }) => {
    await fillValidStudent(page);
    await expect(nextButton(page)).toBeEnabled();
    await shot(page, "C01", "credenciales-opcionales-vacias");
  });

  test("C02 · el estudiante dependiente puede ser menor de edad", async ({ page }) => {
    await fillValidStudent(page);
    await fillAndBlur(page, F.fechaNacimiento, isoYearsAgo(9));
    await expectFieldValid(page, F.fechaNacimiento);
    await expect(nextButton(page)).toBeEnabled();
    await shot(page, "C02", "menor-dependiente-valido");
  });

  test("C03 · credenciales a medias: solo el correo bloquea Siguiente en el campo (#226)", async ({ page }) => {
    await fillValidStudent(page);
    await field(page, F.correo).fill("hijo@example.com");
    // La regla ahora es de CAMPO, como el resto del asistente: "Siguiente" se
    // deshabilita apenas el correo queda solo, sin esperar a que se clickee.
    await expect(nextButton(page)).toBeDisabled();
    await expect(page.getByText(/^Para continuar, revise:/)).toContainText("Contraseña");

    await field(page, F.contrasenia).focus();
    await field(page, F.contrasenia).blur();
    await expect(fieldError(page, F.contrasenia)).toHaveText(
      "La contraseña del estudiante es obligatoria si se desea crear una cuenta.",
    );
    await expect(page.getByRole("heading", { name: /datos del estudiante/i })).toBeVisible();
    await shot(page, "C03", "credenciales-a-medias-solo-correo");
  });

  test("C04 · credenciales a medias: solo la contraseña bloquea Siguiente en el campo", async ({ page }) => {
    await fillValidStudent(page);
    await field(page, F.contrasenia).fill("clave-segura-8");
    await expect(nextButton(page)).toBeDisabled();

    await field(page, F.correo).focus();
    await field(page, F.correo).blur();
    await expect(fieldError(page, F.correo)).toHaveText(
      "El correo del estudiante es obligatorio si se desea crear una cuenta.",
    );
    await shot(page, "C04", "credenciales-a-medias-solo-clave");
  });

  test("C05 · correo del estudiante inválido cuando sí se piden credenciales", async ({ page }) => {
    await fillValidStudent(page);
    await fillAndBlur(page, F.correo, "hijo@example");
    await field(page, F.contrasenia).fill("clave-segura-8");
    await expect(fieldError(page, F.correo)).toHaveText(
      "El correo del estudiante no es válido.",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "C05", "correo-estudiante-invalido");
  });

  test("C06 · contraseña del estudiante de menos de 8 caracteres", async ({ page }) => {
    await fillValidStudent(page);
    await field(page, F.correo).fill("hijo@example.com");
    await fillAndBlur(page, F.contrasenia, "1234567");
    await expect(fieldError(page, F.contrasenia)).toHaveText(
      "La contraseña del estudiante debe tener al menos 8 caracteres.",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "C06", "clave-estudiante-corta");
  });
});

// ===========================================================================
// R — Paso "Datos del Representante"
// ===========================================================================

test.describe("R · Datos del representante", () => {
  test.beforeEach(async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Representante");
    await fillValidStudent(page);
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: /datos del representante/i })).toBeVisible();
  });

  test("R01 · el paso en blanco bloquea Siguiente", async ({ page }) => {
    await expect(nextButton(page)).toBeDisabled();
    await expect(page.getByText(/^Para continuar, revise:/)).toBeVisible();
    await shot(page, "R01", "representante-en-blanco");
  });

  test("R02 · cédula del representante de 9 dígitos", async ({ page }) => {
    await fillAndBlur(page, F.cedulaRepresentante, "123456789");
    await expect(fieldError(page, F.cedulaRepresentante)).toHaveText(
      "La cédula del representante debe tener 10 dígitos.",
    );
    await shot(page, "R02", "cedula-representante-corta");
  });

  test("R03 · un representante de 17 años queda fuera del piso de edad", async ({ page }) => {
    await fillAndBlur(page, F.fechaNacimientoRepresentante, isoYearsAgo(17));
    await expect(fieldError(page, F.fechaNacimientoRepresentante)).toHaveText(
      "El representante debe tener entre 18 y 74 años (calculado: 17).",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "R03", "representante-menor");
  });

  test("R04 · un representante de 80 años queda fuera del techo de edad", async ({ page }) => {
    await fillAndBlur(page, F.fechaNacimientoRepresentante, isoYearsAgo(80));
    await expect(fieldError(page, F.fechaNacimientoRepresentante)).toHaveText(
      "El representante debe tener entre 18 y 74 años (calculado: 80).",
    );
    await shot(page, "R04", "representante-sobre-el-techo");
  });

  test("R05 · un año implausible (1750) ya no se cuela: se calcula y se rechaza", async ({ page }) => {
    // El defecto histórico: `calculateAge` devolvía NaN fuera de 1900-2200 y
    // `NaN >= 18` es false, así que la comparación no fallaba… pero tampoco
    // atajaba. Hoy devuelve el número real y el techo lo frena.
    await fillAndBlur(page, F.fechaNacimientoRepresentante, "1750-03-15");
    await expect(fieldError(page, F.fechaNacimientoRepresentante)).toContainText(
      "El representante debe tener entre 18 y 74 años",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "R05", "anio-implausible-1750");
  });

  test("R06 · fecha del representante vacía", async ({ page }) => {
    await birthDatePart(page, F.fechaNacimientoRepresentante, "dia").focus();
    await birthDatePart(page, F.fechaNacimientoRepresentante, "dia").blur();
    // "(18+)" salió del mensaje: era una abreviatura de la propia frase que lo
    // contenía, y la regla de las palabras no admite abreviaturas. El número
    // sigue estando, en la rama que sí puede nombrarlo (R05, "entre 18 y 74").
    await expect(fieldError(page, F.fechaNacimientoRepresentante)).toHaveText(
      "El representante debe ser mayor de edad.",
    );
    await shot(page, "R06", "fecha-representante-vacia");
  });

  test("R07 · correo del representante inválido", async ({ page }) => {
    await fillAndBlur(page, F.correoRepresentante, "maria@correo");
    await expect(fieldError(page, F.correoRepresentante)).toHaveText(
      "El correo del representante no es válido.",
    );
    await shot(page, "R07", "correo-representante-invalido");
  });

  test("R08 · contraseña del representante de menos de 8 caracteres", async ({ page }) => {
    await fillAndBlur(page, F.contraseniaRepresentante, "corta");
    await expect(fieldError(page, F.contraseniaRepresentante)).toHaveText(
      "La contraseña del representante debe tener al menos 8 caracteres.",
    );
    await shot(page, "R08", "clave-representante-corta");
  });

  test("R09 · nombres del representante con dígitos", async ({ page }) => {
    await fillAndBlur(page, F.nombresRepresentante, "María3");
    await expect(fieldError(page, F.nombresRepresentante)).toHaveText(
      "Los nombres del representante tienen un carácter que no reconocemos en un nombre de persona.",
    );
    await shot(page, "R09", "nombres-representante-con-digitos");
  });

  test("R10 · con el representante completo el paso avanza a salud", async ({ page }) => {
    await fillValidRepresentative(page);
    await expect(nextButton(page)).toBeEnabled();
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: /salud y emergencia/i })).toBeVisible();
    await shot(page, "R10", "representante-completo");
  });
});

// ===========================================================================
// H — Paso "Salud y Emergencia"
// ===========================================================================

test.describe("H · Salud y emergencia", () => {
  test.beforeEach(async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");
    await fillValidStudent(page);
    await fillValidCredentials(page);
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: /salud y emergencia/i })).toBeVisible();
  });

  test("H01 · la ficha médica no es opcional: en blanco bloquea", async ({ page }) => {
    await expect(nextButton(page)).toBeDisabled();
    await expect(page.getByText(/^Para continuar, revise:/)).toBeVisible();
    await shot(page, "H01", "salud-en-blanco");
  });

  test("H02 · tipo de sangre sin elegir", async ({ page }) => {
    const select = field(page, F.tipoSangre);
    await select.focus();
    await select.blur();
    await expect(page.getByText("El tipo de sangre es obligatorio.")).toBeVisible();
    await shot(page, "H02", "tipo-de-sangre-vacio");
  });

  test("H03 · contacto de emergencia de menos de 3 caracteres", async ({ page }) => {
    await fillAndBlur(page, F.contactoEmergencia, "Ma");
    await expect(fieldError(page, F.contactoEmergencia)).toHaveText(
      "El nombre del contacto de emergencia debe tener al menos 3 caracteres.",
    );
    await shot(page, "H03", "contacto-emergencia-corto");
  });

  test("H04 · teléfono de emergencia de 5 dígitos", async ({ page }) => {
    await fillAndBlur(page, F.telefonoEmergencia, "12345");
    await expect(fieldError(page, F.telefonoEmergencia)).toHaveText(
      "El teléfono de emergencia debe ser un celular (09 y 8 dígitos más) o un fijo (0, código de área y 7 dígitos, 9 en total).",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "H04", "telefono-emergencia-corto");
  });

  test("H05 · condiciones, alergias y observaciones sí son opcionales", async ({ page }) => {
    await fillValidHealth(page);
    await expect(nextButton(page)).toBeEnabled();
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: /resumen y confirmación/i })).toBeVisible();
    await shot(page, "H05", "salud-minima-valida");
  });
});

// ===========================================================================
// S — Paso "Resumen y Confirmación" y el envío
// ===========================================================================

/** Deja la página en el resumen, con una autoinscripción válida cargada. */
async function goToSummary(page: Page): Promise<void> {
  await enterFromLogin(page);
  await goToPersonal(page, "Jugador");
  await fillValidStudent(page);
  await fillValidCredentials(page);
  await nextButton(page).click();
  await fillValidHealth(page);
  await nextButton(page).click();
  await expect(page.getByRole("heading", { name: /resumen y confirmación/i })).toBeVisible();
}

test.describe("S · Resumen, envío y errores del servidor", () => {
  test("S01 · sin marcar la casilla de revisión, confirmar está deshabilitado", async ({ page }) => {
    await goToSummary(page);
    await expect(page.getByRole("button", { name: /confirmar inscripción/i })).toBeDisabled();
    await shot(page, "S01", "resumen-sin-confirmar");
  });

  test("S02 · el resumen muestra los datos cargados antes de enviarlos", async ({ page }) => {
    await goToSummary(page);
    await expect(page.getByText(VALID_STUDENT.cedula)).toBeVisible();
    await expect(page.getByText(VALID_CREDENTIALS.correo)).toBeVisible();
    // La contraseña nunca se muestra en claro, ni siquiera en el resumen.
    await expect(page.getByText(VALID_CREDENTIALS.contrasenia)).toHaveCount(0);
    await shot(page, "S02", "resumen-datos-visibles");
  });

  /**
   * Status VERIFICADO contra el backend real (`POST /api/v1/enrollment/` con
   * una cédula ya sembrada): responde **400**, no 409, con `{detail, message}`.
   *
   * La primera versión de este test inventaba un 409 y un texto propio. Pasaba
   * igual, que es lo peligroso: un mock infiel certifica la traducción de una
   * respuesta que el servidor nunca manda. Es el mismo error que ya se pagó una
   * vez en este repo con los mocks sin `status`.
   *
   * El TEXTO ya no se copia a mano acá: issue #999 cambió el mensaje y este
   * archivo quedó con el anterior, indetectado, hasta que `isDuplicateIdentityError`
   * dejó de reconocerlo en CI (dejaba de ofrecer "Iniciar sesión" / "Recuperar
   * contraseña" en S08). `MENSAJE_IDENTIDAD_DUPLICADA` es la MISMA constante que
   * usa `duplicate-identity.ts` en producción — si vuelve a cambiar, este mock
   * cambia solo. Lo que sigue sin poder derivarse de código es que el backend
   * real siga devolviendo exactamente esa constante con status 400: eso solo lo
   * prueba `tests/e2e/*.live.spec.ts` (`make qa-live`) o correrlo a mano contra
   * QA.
   */
  const DUPLICADO_REAL = MENSAJE_IDENTIDAD_DUPLICADA;

  test("S03 · identidad ya registrada: el 400 real del backend llega al visitante", async ({ page }) => {
    await goToSummary(page);
    await mockEnrollment(page, {
      status: 400,
      body: { detail: DUPLICADO_REAL, message: DUPLICADO_REAL },
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();

    await expect(stepAlert(page)).toContainText(DUPLICADO_REAL);
    // Y no se declara éxito por un error.
    await expect(page.getByRole("heading", { name: /inscripción completada/i })).toHaveCount(0);
    await shot(page, "S03", "identidad-duplicada-400");
  });

  test("S08 · el mensaje de duplicado ofrece una salida, no solo el problema", async ({ page }) => {
    await goToSummary(page);
    await mockEnrollment(page, {
      status: 400,
      body: { detail: DUPLICADO_REAL, message: DUPLICADO_REAL },
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();

    // `isDuplicateIdentityError` reconoce el texto del backend y engancha la
    // ayuda de `audience="self-service"`: quien ya se inscribió no tiene que
    // volver a hacerlo, tiene que entrar. Un error que solo repite el problema
    // es un callejón sin salida.
    const alerta = stepAlert(page);
    await expect(alerta).toContainText("Si ya se inscribió antes, no necesita volver a hacerlo");
    await expect(alerta.getByRole("link", { name: /iniciar sesión/i })).toBeVisible();
    await expect(alerta.getByRole("link", { name: /recuperar contraseña/i })).toBeVisible();
    await shot(page, "S08", "duplicado-ofrece-salida");
  });

  test("S09 · el mensaje de duplicado no dice CUÁL dato está tomado", async ({ page }) => {
    await goToSummary(page);
    await mockEnrollment(page, {
      status: 400,
      body: { detail: DUPLICADO_REAL, message: DUPLICADO_REAL },
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();

    // Verificado en el backend: cédula de alumno, cédula de representante y
    // correo de representante devuelven los tres el MISMO mensaje. Es
    // deliberado — distinguirlos convierte el alta pública en un oráculo para
    // averiguar si una cédula o un correo están registrados.
    //
    // Issue #999: el mensaje SÍ nombra el CONJUNTO de campos que pueden chocar
    // ("cédula o correo") — eso no reabre el oráculo, porque quien ataca ya
    // sabe que el conjunto es ese. Lo que sigue sin poder aparecer es el DATO
    // que de verdad delataría cuál coincidió: el valor que el visitante
    // escribió. Antes de #999 esta afirmación era "no menciona los campos";
    // ahora es "no repite el valor".
    const alerta = stepAlert(page);
    await expect(alerta).not.toContainText(VALID_STUDENT.cedula);
    await expect(alerta).not.toContainText(VALID_CREDENTIALS.correo);
    await shot(page, "S09", "duplicado-no-divulga-cual-dato");
  });

  test("S04 · un 500 no filtra la respuesta cruda: se traduce a un mensaje legible", async ({ page }) => {
    await goToSummary(page);
    await mockEnrollment(page, {
      status: 500,
      body: { detail: "Traceback (most recent call last): psycopg2.OperationalError" },
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();

    const alert = stepAlert(page);
    await expect(alert).toBeVisible();
    // El detalle interno de un 500 no es texto para el usuario.
    await expect(alert).not.toContainText("Traceback");
    await expect(alert).not.toContainText("psycopg2");
    await shot(page, "S04", "error-500-traducido");
  });

  test("S05 · un 422 tampoco vuelca la lista de errores de FastAPI en pantalla", async ({ page }) => {
    await goToSummary(page);
    await mockEnrollment(page, {
      status: 422,
      body: {
        detail: [
          { loc: ["body", "alumno", "cedula"], msg: "string does not match regex", type: "value_error.str.regex" },
        ],
      },
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();

    const alert = stepAlert(page);
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText("value_error");
    await expect(alert).not.toContainText("loc");
    await shot(page, "S05", "error-422-traducido");
  });

  test("S06 · el camino feliz termina en la pantalla de inscripción completada", async ({ page }) => {
    await goToSummary(page);
    await mockEnrollment(page, {
      status: 201,
      body: { enrolled: true },
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();

    await expect(page.getByRole("heading", { name: /inscripción completada/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(`${VALID_STUDENT.nombres} ${VALID_STUDENT.apellidos}`)).toBeVisible();
    await shot(page, "S06", "camino-feliz");
  });

  test("S07 · doble clic en confirmar no envía la inscripción dos veces", async ({ page }) => {
    await goToSummary(page);
    let calls = 0;
    await page.route("**/api/enrollment/", async (route: Route) => {
      calls += 1;
      // Una respuesta lenta es justo donde un segundo clic tiene tiempo de entrar.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ enrolled: true }),
      });
    });

    await page.getByRole("checkbox").check();
    const confirm = page.getByRole("button", { name: /confirmar inscripción/i });
    await confirm.click();

    /*
     * La guarda del doble envío es OBSERVABLE, y se afirma como tal: mientras
     * el pedido viaja, el mismo botón queda `disabled` y rotulado
     * "Inscribiendo…". Eso es lo que impide el segundo envío, así que es lo
     * que hay que clavar — si alguien saca el `disabled`, esta línea se pone
     * roja sola.
     *
     * El segundo clic va con `force` a propósito: sin él, Playwright espera a
     * que el botón se habilite y el caso muere por timeout en vez de medir
     * nada. `force` saltea la espera y despacha el evento igual, que es justo
     * el visitante impaciente que se quiere simular. Lo que NO lleva es
     * `trial` —que no cliquea— ni un `.catch()` que se trague el fallo: con
     * los dos puestos, `calls` no podía valer otra cosa que 1 y el caso pasaba
     * hubiera o no guarda.
     */
    const enviando = page.getByRole("button", { name: /inscribiendo/i });
    await expect(enviando).toBeDisabled();
    await enviando.click({ force: true });

    await expect(page.getByRole("heading", { name: /inscripción completada/i })).toBeVisible({
      timeout: 20_000,
    });
    expect(calls).toBe(1);
    await shot(page, "S07", "doble-envio-evitado");
  });
});

// ===========================================================================
test.describe("S07 · idempotencia de reintentos", () => {
        test("un reintento tras un fallo conserva la clave y permite el replay", async ({ page }) => {
        await goToSummary(page);
        let calls = 0;
        let retryCookie = "";
        await page.route("**/api/enrollment/", async (route: Route) => {
          calls += 1;
          const cookie = route.request().headers().cookie ?? "";
          if (calls === 1) {
            await route.fulfill({
              status: 503,
              contentType: "application/json",
              headers: { "set-cookie": "enrollment_attempt_key=replay-key; Path=/api/enrollment; HttpOnly" },
              body: JSON.stringify({ detail: "Servicio temporalmente no disponible." }),
            });
            return;
          }
          retryCookie = cookie;
          await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ enrolled: true }) });
        });
        await page.getByRole("checkbox").check();
        await page.getByRole("button", { name: /confirmar inscripción/i }).click();
        await expect(stepAlert(page)).toBeVisible();
        await page.getByRole("button", { name: /confirmar inscripción/i }).click();
        await expect(page.getByRole("heading", { name: /inscripción completada/i })).toBeVisible({ timeout: 20_000 });
        expect(calls).toBe(2);
        expect(retryCookie).toContain("enrollment_attempt_key=replay-key");
        await shot(page, "S07", "reintento-replay-idempotente");
      });
    });

    // M — Cómo se presentan los mensajes de error del servidor
//
// No qué dicen —eso ya está en S03-S09— sino cómo llegan a la pantalla.
// ===========================================================================

    test.describe("M · Presentación de los mensajes", () => {
  // Misma constante que S03/S08/S09 arriba — ver el comentario ahí (issue #999).
  const DUPLICADO = MENSAJE_IDENTIDAD_DUPLICADA;

  async function fallarConDuplicado(page: Page): Promise<void> {
    await goToSummary(page);
    await mockEnrollment(page, {
      status: 400,
      body: { detail: DUPLICADO, message: DUPLICADO },
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();
    await expect(stepAlert(page)).toBeVisible();
  }

  test("M01 · el mensaje aparece una sola vez, en la alerta del paso", async ({ page }) => {
    await fallarConDuplicado(page);

    // `handleConfirm` ya no dispara `showError`: el error del alta vive
    // solo en la alerta del paso, junto al botón «Corregir» que pide usar.
    //
    // El timeout corto es deliberado: el toast, si existiera, dura ~4.8s
    // (`toastDurationFor` para este mensaje) antes de auto-descartarse, más
    // que el default de 5s de `expect`. Sin acortar la espera, esta
    // aserción terminaría coincidiendo con su propio auto-dismiss y pasaría
    // igual con el bug presente — un candado que nunca se pone rojo no es
    // candado.
    const toast = page.locator('[role="alert"].toast-error');
    await expect(toast).toHaveCount(0, { timeout: 1000 });
    await expect(stepAlert(page)).toContainText(DUPLICADO);
    await shot(page, "M01", "mensaje-duplicado-solo-en-alerta");
  });

  test("M02 · sin toast, ningún «Corregir» del resumen queda tapado", async ({ page }) => {
    await fallarConDuplicado(page);

    // Sin `showError` no hay toast que pueda solaparse con nada. Se mide
    // igual, por si algún otro elemento flotante llegara a ocupar ese lugar.
    // Ver M01 sobre por qué el timeout es corto.
    const toast = page.locator('[role="alert"].toast-error');
    await expect(toast).toHaveCount(0, { timeout: 1000 });

    const corregir = page.getByRole("button", { name: /corregir/i });
    const total = await corregir.count();
    expect(total).toBeGreaterThan(0);
    for (let i = 0; i < total; i++) {
      await expect(corregir.nth(i)).toBeVisible();
    }
    await shot(page, "M02", "sin-toast-boton-corregir-visible");
  });
});

// ===========================================================================
// N — Navegación entre pasos
// ===========================================================================

test.describe("N · Navegación del asistente", () => {
  test("N01 · Atrás conserva lo ya cargado", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");
    await fillValidStudent(page);
    await fillValidCredentials(page);
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: /salud y emergencia/i })).toBeVisible();

    await page.getByRole("button", { name: /atrás/i }).click();
    await expect(page.getByRole("heading", { name: /datos del estudiante/i })).toBeVisible();
    await expect(field(page, F.cedula)).toHaveValue(VALID_STUDENT.cedula);
    await shot(page, "N01", "atras-conserva-datos");
  });

  test("N02 · el Atrás del navegador es el mismo Atrás del asistente", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");
    await fillValidStudent(page);
    await fillValidCredentials(page);
    await nextButton(page).click();
    await expect(page.getByRole("heading", { name: /salud y emergencia/i })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { name: /datos del estudiante/i })).toBeVisible();
    await expect(field(page, F.cedula)).toHaveValue(VALID_STUDENT.cedula);
    await shot(page, "N02", "back-del-navegador");
  });

  test("N03 · no se puede saltar a un paso posterior desde el indicador", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");
    /*
     * Con el paso incompleto, el indicador no debe ser un atajo al resumen.
     *
     * Y no lo es por construcción, no por una guarda: `Stepper` renderiza un
     * `<ol>` de `<li>` sin un solo control, así que no hay nada que clickear.
     * Eso es lo que se afirma.
     *
     * La versión anterior buscaba un pill "Confirmar" dentro de un
     * `if (count())`. Ese pill NO existe —verificado contra la app real, el
     * único "Confirmar" del flujo es el botón "Confirmar inscripción" del
     * resumen—, así que el clic nunca ocurría y la aserción de abajo pasaba
     * en vacío: quedarse en el mismo paso es obvio si no se clickeó nada.
     */
    const stepper = page.getByRole("list", { name: /pasos de la inscripción/i });
    await expect(stepper).toBeVisible();
    await expect(stepper.getByRole("button")).toHaveCount(0);
    await expect(stepper.getByRole("link")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /datos del estudiante/i })).toBeVisible();
    await shot(page, "N03", "sin-salto-de-pasos");
  });
});

// ===========================================================================
// G — Huecos de validación
//
// Estos casos NO celebran el comportamiento: lo dejan clavado tal cual es hoy,
// con su captura, para que el informe pueda mostrarlo. Cada uno afirma lo que
// la app HACE, no lo que debería hacer. Si mañana se cierra el hueco, el test
// se pone rojo y obliga a actualizar el informe — que es justo lo que se quiere
// de un registro de hallazgos.
// ===========================================================================

test.describe("G · Huecos de validación — CERRADOS (issues #224, #225, #226)", () => {
  test("G01 · una fecha de nacimiento FUTURA ahora se rechaza con su propio mensaje", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");

    const nextYear = new Date().getFullYear() + 1;
    await fillAndBlur(page, F.fechaNacimiento, `${nextYear}-06-15`);

    // La regla compartida (#224) rechaza una fecha futura POR SER futura, con
    // su propio mensaje — ya no se enruta por la regla de mayoría de edad, que
    // antes leía la edad negativa como "menor de edad" sobre alguien que
    // todavía no nació.
    await expect(fieldError(page, F.fechaNacimiento)).toHaveText(
      "La fecha de nacimiento no puede ser en el futuro.",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "G01", "fecha-futura-mensaje-correcto");
  });

  test("G02 · una fecha FUTURA en un dependiente ahora también se rechaza", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Representante");
    await fillValidStudent(page);

    const nextYear = new Date().getFullYear() + 1;
    await fillAndBlur(page, F.fechaNacimiento, `${nextYear}-06-15`);

    // La regla de fecha de nacimiento del alumno ya no depende de si es
    // autoinscripción o dependiente: corre siempre (#224). Un alumno con
    // fecha de nacimiento del año que viene bloquea el paso, no lo pasa.
    await expect(fieldError(page, F.fechaNacimiento)).toHaveText(
      "La fecha de nacimiento no puede ser en el futuro.",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "G02", "dependiente-fecha-futura-rechazada");
  });

  test("G03 · ahora SÍ hay techo de edad para autoinscribirse: 120 años se rechaza", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");
    await fillValidStudent(page);
    await fillValidCredentials(page);
    await fillAndBlur(page, F.fechaNacimiento, isoYearsAgo(120));

    // El estudiante que se autoinscribe ahora comparte el mismo techo que ya
    // tenía el representante (74 años) — la regla compartida no distingue por
    // tipo de inscripción, así que la misma persona ya no puede ser rechazada
    // como representante y aceptada como jugador (ver también G04).
    await expect(fieldError(page, F.fechaNacimiento)).toContainText(
      "La edad del alumno debe estar entre 5 y 74 años",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "G03", "techo-de-edad-jugador-120");
  });

  test("G04 · el mismo 1750 que el representante rechaza, ahora el jugador también lo rechaza", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");
    await fillValidStudent(page);
    await fillAndBlur(page, F.fechaNacimiento, "1750-03-15");

    await expect(fieldError(page, F.fechaNacimiento)).toContainText(
      "La edad del alumno debe estar entre 5 y 74 años",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "G04", "jugador-anio-1750-rechazado");
  });

  test("G05 · el 11º dígito de la cédula no entra, y ahora lo dice en voz alta", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");

    // QA 2026-08-12 le devolvió el tope al campo ("no puede tipear 11"), pero
    // sin repetir #225: el 11º dígito no entra, y un aviso `aria-live` explica
    // por qué en el momento — no un keystroke que desaparece sin explicación.
    const cedula = field(page, F.cedula);
    await cedula.fill("17123456789");
    await expect(cedula).toHaveValue("1712345678");
    await expect(page.getByText(/alcanzó el máximo de 10 dígitos/i)).toBeVisible();
    await shot(page, "G05", "cedula-11o-digito-avisado");

    // Al salir del campo, el veredicto definitivo de la regla reemplaza el
    // aviso transitorio.
    await cedula.blur();
    await expect(fieldError(page, F.cedula)).toHaveText(
      "La cédula de identidad no es válida.",
    );
  });

  test("G06 · credenciales a medias ahora bloquea en el campo, ya no hace falta clickear", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Representante");
    await fillValidStudent(page);
    await field(page, F.correo).fill("hijo@example.com");

    // La regla de "ambos o ninguno" corre ahora desde `validateEnrollFields`,
    // igual que el resto del modelo de prevención de errores (#226): ya no es
    // la única regla de paso del asistente. "Siguiente" se deshabilita apenas
    // el correo queda solo.
    await expect(nextButton(page)).toBeDisabled();
    await expect(page.getByText(/^Para continuar, revise:/)).toContainText("Contraseña");
    await shot(page, "G06a", "siguiente-deshabilitado-consistente");

    await field(page, F.contrasenia).focus();
    await field(page, F.contrasenia).blur();
    await expect(fieldError(page, F.contrasenia)).toHaveText(
      "La contraseña del estudiante es obligatoria si se desea crear una cuenta.",
    );
    await expect(page.getByRole("heading", { name: /datos del estudiante/i })).toBeVisible();
    await shot(page, "G06b", "mensaje-en-el-campo");
  });

  test("G08 · un dependiente de 3 años ya no pasa: el piso de 5 años ahora se aplica", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Representante");
    await fillValidStudent(page);
    await fillAndBlur(page, F.fechaNacimiento, isoYearsAgo(3));

    // La regla compartida trae el mismo piso que ya exigía el backend (#224):
    // un dependiente de 3 años bloquea en el primer paso, no en el resumen.
    await expect(fieldError(page, F.fechaNacimiento)).toContainText(
      "La edad del alumno debe estar entre 5 y 74 años",
    );
    await expect(nextButton(page)).toBeDisabled();
    await shot(page, "G08", "dependiente-menor-de-5-rechazado");
  });

  test("G07 · un nombre de solo espacios se rechaza como vacío, no como corto", async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");
    await fillAndBlur(page, F.nombres, "     ");
    await expect(fieldError(page, F.nombres)).toHaveText("Los nombres son obligatorios.");
    await shot(page, "G07", "nombres-solo-espacios");
  });
});

// ===========================================================================
// V — Laxitud frente a la norma ecuatoriana
//
// Los casos de arriba miden el formulario contra SUS PROPIAS reglas. Estos lo
// miden contra la realidad: cédula de 10 dígitos con verificador módulo 10
// (código de provincia 01-24, más 30 para el exterior), celular de 10 dígitos
// y fijo de 9. Todos PASAN hoy, y por eso están acá.
// ===========================================================================

test.describe("V · Laxitud frente a la norma ecuatoriana — CERRADA (issues #228, #229, #230)", () => {
  test.beforeEach(async ({ page }) => {
    await enterFromLogin(page);
    await goToPersonal(page, "Jugador");
  });

  test("V01 · un teléfono con letras adentro ahora se rechaza: ya no se descartan antes de medir", async ({ page }) => {
    // #1028 (round 3): las letras se descartan al medir y lo que queda
    // empieza en 0 — el rechazo nombra el 0 inicial, el primer error que
    // un visitante real necesita corregir.
    await fillAndBlur(page, F.telefono, "099abc1234");
    await expect(fieldError(page, F.telefono)).toHaveText(
      "No incluya el 0 inicial: escriba solo los 9 dígitos que siguen al +593.",
    );
    await shot(page, "V01", "telefono-con-letras-rechazado");
  });

  test("V02 · un teléfono de 7 dígitos ahora se rechaza: no existe en la numeración ecuatoriana", async ({ page }) => {
    // #1028 (round 3): el paso solo acepta los 9 dígitos del móvil tras el
    // +593; un residuo corto con 0 inicial recibe el mensaje que enseña el
    // formato esperado.
    await fillAndBlur(page, F.telefono, "0991234");
    await expect(fieldError(page, F.telefono)).toHaveText(
      "No incluya el 0 inicial: escriba solo los 9 dígitos que siguen al +593.",
    );
    await shot(page, "V02", "telefono-de-7-digitos-rechazado");
  });

  test("V03 · una cédula con dígito verificador incorrecto ahora se rechaza", async ({ page }) => {
    // 1712345678 es EL PLACEHOLDER que el propio formulario sugería. Su
    // verificador debería ser 5, no 8: no es una cédula que exista, y la
    // regla compartida (#228) ya la reconoce como inválida.
    await fillAndBlur(page, F.cedula, "1712345678");
    await expect(fieldError(page, F.cedula)).toHaveText(
      "La cédula de identidad no es válida.",
    );
    await shot(page, "V03", "cedula-verificador-invalido-rechazado");
  });

  test("V04 · una cédula con código de provincia inexistente ahora se rechaza", async ({ page }) => {
    // Las provincias van de 01 a 24, más 30 para registrados en el exterior.
    // 99 no es ninguna, y la regla compartida (#228) ahora la revisa.
    await fillAndBlur(page, F.cedula, "9912345678");
    await expect(fieldError(page, F.cedula)).toHaveText(
      "La cédula de identidad no es válida.",
    );
    await shot(page, "V04", "cedula-provincia-99-rechazada");
  });

  test("V05 · una cédula de puros ceros ahora se rechaza", async ({ page }) => {
    await fillAndBlur(page, F.cedula, "0000000000");
    await expect(fieldError(page, F.cedula)).toHaveText(
      "La cédula de identidad no es válida.",
    );
    await shot(page, "V05", "cedula-ceros-rechazada");
  });

  test("V07 · un apellido con guion ahora se ACEPTA — la regla vieja rechazaba un apellido real (#230)", async ({ page }) => {
    // La regla compartida acepta letras, tildes, apóstrofo, guion e interpunto
    // como conectores de un nombre de persona. "Pérez-Mora" y "D'Angelo" son
    // apellidos reales que la regla vieja rechazaba; ya no.
    await fillAndBlur(page, F.apellidos, "Pérez-Mora");
    await expectFieldValid(page, F.apellidos);
    await shot(page, "V07", "apellido-con-guion-aceptado");
  });

  test("V08 · la contraseña más previsible del mundo ahora se rechaza (#230)", async ({ page }) => {
    // La regla compartida agrega una lista de contraseñas comunes además del
    // piso de largo. "12345678" tiene 8 caracteres —pasa el piso— pero es una
    // de las más usadas del mundo, así que la lista la ataja igual.
    await fillAndBlur(page, F.contrasenia, "12345678");
    await expect(fieldError(page, F.contrasenia)).toHaveText(
      "La contraseña es una de las más usadas y fácil de adivinar; elija otra.",
    );
    await shot(page, "V08", "contrasenia-debil-rechazada");
  });

  test("V06 · control: una cédula real y bien formada sigue pasando", async ({ page }) => {
    // Sin este control, los cuatro casos de arriba podrían estar pasando
    // porque la validación de cédula no corre nunca, y no porque sea estricta.
    await fillAndBlur(page, F.cedula, "1798765432");
    await expectFieldValid(page, F.cedula);
    await fillAndBlur(page, F.cedula, "17987654");
    await expect(fieldError(page, F.cedula)).toHaveText(
      "La cédula de identidad debe tener 10 dígitos.",
    );
    await shot(page, "V06", "control-la-validacion-si-corre");
  });
});

// ===========================================================================
// X — Robustez del envío
// ===========================================================================

test.describe("X · Robustez del envío", () => {
  test("X01 · si la red se cae al confirmar, el visitante recibe un mensaje y no una pantalla muerta", async ({ page }) => {
    await goToSummary(page);
    await page.route("**/api/enrollment/", (route: Route) => route.abort("failed"));

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();

    await expect(stepAlert(page)).toBeVisible();
    // Y el botón vuelve a estar disponible: el intento no queda colgado.
    await expect(page.getByRole("button", { name: /confirmar inscripción/i })).toBeEnabled();
    await shot(page, "X01", "caida-de-red-al-confirmar");
  });

  test("X02 · un 401 en el alta pública tampoco expulsa al visitante del formulario", async ({ page }) => {
    await goToSummary(page);
    await mockEnrollment(page, { status: 401, body: { detail: "No autenticado." } });

    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();

    await expect(stepAlert(page)).toBeVisible();
    // No debe redirigir a /login y perder todo lo cargado.
    await expect(page).toHaveURL(/\/student\/enroll/);
    await shot(page, "X02", "401-no-expulsa");
  });

  test("X04 · un 429 se explica solo, aunque el cuerpo no traiga detail ni message", async ({ page }) => {
    await goToSummary(page);
    // Cuerpo VERIFICADO contra el backend real: slowapi responde con la clave
    // `error`, no con el `{detail, message}` que usa el resto de la API. El
    // traductor igual acierta porque contesta por STATUS y no por cuerpo — que
    // es exactamente para lo que se hizo así.
    await mockEnrollment(page, {
      status: 429,
      body: { error: "Rate limit exceeded: 10 per 1 minute" },
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: /confirmar inscripción/i }).click();

    const alerta = stepAlert(page);
    await expect(alerta).toContainText("Demasiados intentos");
    // Y no se filtra la jerga del limitador.
    await expect(alerta).not.toContainText("Rate limit");
    await shot(page, "X04", "429-traducido");
  });

  test("X03 · corregir desde el resumen vuelve al paso correcto con los datos puestos", async ({ page }) => {
    await goToSummary(page);
    // El resumen ofrece "Corregir" por bloque — es el atajo que evita rehacer
    // el asistente entero por un dígito.
    await page.getByRole("button", { name: /corregir/i }).nth(1).click();
    await expect(page.getByRole("heading", { name: /datos del estudiante/i })).toBeVisible();
    await expect(field(page, F.cedula)).toHaveValue(VALID_STUDENT.cedula);
    await shot(page, "X03", "corregir-desde-resumen");
  });
});
