/**
 * Issue #1368 — reviewing the grouped legal documents from the enrolment
 * wizard must never navigate away and must never lose state.
 *
 * Until #1368 the consent sentence carried three links to the public pages.
 * Following one unmounted the wizard: every entered field AND the consent
 * decision itself were gone. The journey below walks a REPRESENTATIVE
 * enrolment (dependent + representative — the longest data path the wizard
 * has) to the summary step, agrees, and then opens all three documents the
 * way a visitor would: Escape, the Cerrar button, and a backdrop tap.
 *
 * After each close it proves the summary is the SAME summary: same URL, the
 * dependent's and representative's data still on screen, the consent box
 * still checked, and "Confirmar inscripción" still enabled.
 *
 * ## Qué NO prueba
 *
 * El backend. Todo `/api/*` está interceptado (mismo criterio que
 * `enroll-qa.spec.ts`): el sujeto es la ronda revisar-volver del asistente,
 * no el alta real — esa vive en los `*.live.spec.ts` contra `make qa-up`.
 *
 * The dialog's own mechanics (focus trap, Escape, scroll lock) are unit
 * tested in `src/components/legal/__tests__/LegalReviewDialog.test.tsx`;
 * this journey checks them once through the REAL built app.
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { fillBirthDate } from "./helpers/birth-date";
import { uniqueValidCedula } from "./helpers/enrollment";

/**
 * Los ids de los campos que este journey toca, transcritos de la tabla `F`
 * de `enroll-qa.spec.ts` — declarados acá, no importados: si el producto le
 * cambia un id, este archivo se entera rompiéndose.
 */
const F = {
  nombres: "enroll-nombres",
  apellidos: "enroll-apellidos",
  fechaNacimiento: "enroll-fecha-nacimiento",
  cedula: "enroll-cedula",
  nombresRepresentante: "enroll-nombres-representante",
  apellidosRepresentante: "enroll-apellidos-representante",
  cedulaRepresentante: "enroll-cedula-representante",
  fechaNacimientoRepresentante: "enroll-fecha-nacimiento-representante",
  telefonoRepresentante: "enroll-telefono-representante",
  correoRepresentante: "enroll-correo-representante",
  contraseniaRepresentante: "enroll-contrasenia-representante",
  contraseniaRepresentanteConfirmacion: "enroll-confirmar-contrasena-representante",
  tipoSangre: "enroll-tipo-sangre",
} as const;

const DEPENDENT = {
  nombres: "Nina QA",
  apellidos: "Prueba Legal",
  // Menor de nueve años, recalculada por corrida.
  fechaNacimiento: `${new Date().getFullYear() - 9}-05-20`,
};

const REPRESENTATIVE = {
  nombres: "Reina QA",
  apellidos: "Responsable Legal",
  telefono: "0991234567",
  correo: "reina.legal@example.com",
  contrasenia: "clave-segura-8",
};

/** El asistente es público: sin sesión, catálogos servidos y deterministas. */
async function mockWizardRoutes(page: Page): Promise<void> {
  await page.route("**/api/auth/session", (route: Route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/personas/instituciones**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, skip: 0, limit: 200 }),
    }),
  );
  await page.route("**/api/membresias/tarifas**", (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ categoria: "Categoria QA", precio: "10.00" }]),
    }),
  );
}

/**
 * Entra al asistente y lo deja en el paso "Resumen y confirmación" con una
 * inscripción de representante válida cargada y el consentimiento marcado.
 */
async function reachSummaryAsRepresentative(page: Page): Promise<void> {
  await mockWizardRoutes(page);
  await page.goto("/student/enroll");
  await expect(page.getByRole("heading", { name: /tipo de inscripción/i })).toBeVisible({
    timeout: 20_000,
  });

  // Paso "Tipo de inscripción": Representante, no el Jugador por defecto.
  await page.getByRole("button", { name: /^Representante/ }).click();
  await page.getByRole("button", { name: /siguiente/i }).click();

  // Paso "Datos del estudiante" — describe al DEPENDIENTE (sin teléfono:
  // issue #1197). La cédula necesita el dígito verificador módulo 10 real.
  await expect(page.getByRole("heading", { name: /datos del estudiante/i })).toBeVisible();
  await page.locator(`#${F.nombres}`).fill(DEPENDENT.nombres);
  await page.locator(`#${F.apellidos}`).fill(DEPENDENT.apellidos);
  await fillBirthDate(page, F.fechaNacimiento, DEPENDENT.fechaNacimiento);
  await page.locator(`#${F.cedula}`).fill(uniqueValidCedula());
  await page.getByRole("button", { name: /siguiente/i }).click();

  // Paso "Datos del representante".
  await expect(page.getByRole("heading", { name: /datos del representante/i })).toBeVisible();
  await page.locator(`#${F.nombresRepresentante}`).fill(REPRESENTATIVE.nombres);
  await page.locator(`#${F.apellidosRepresentante}`).fill(REPRESENTATIVE.apellidos);
  await page
    .locator(`#${F.cedulaRepresentante}`)
    .fill(uniqueValidCedula());
  await fillBirthDate(
    page,
    F.fechaNacimientoRepresentante,
    `${new Date().getFullYear() - 35}-05-20`,
  );
  await page.locator(`#${F.telefonoRepresentante}`).fill(REPRESENTATIVE.telefono);
  await page.locator(`#${F.correoRepresentante}`).fill(REPRESENTATIVE.correo);
  await page.locator(`#${F.contraseniaRepresentante}`).fill(REPRESENTATIVE.contrasenia);
  await page
    .locator(`#${F.contraseniaRepresentanteConfirmacion}`)
    .fill(REPRESENTATIVE.contrasenia);
  await page.getByRole("button", { name: /siguiente/i }).click();

  // Paso "Salud y emergencia" — en la ruta de representado solo pide el tipo
  // de sangre (el contacto de emergencia se deriva del representante, #1138).
  await expect(page.getByRole("heading", { name: /salud y emergencia/i })).toBeVisible();
  await page.locator(`#${F.tipoSangre}`).selectOption("O_POSITIVO");
  await page.getByRole("button", { name: /siguiente/i }).click();

  await expect(page.getByRole("heading", { name: /resumen y confirmación/i })).toBeVisible();

  // El visitante marca el consentimiento ANTES de revisar los documentos —
  // el orden exacto que la reproducción de #1368 castigaba.
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("button", { name: /confirmar inscripción/i })).toBeEnabled();
}

test.describe("Revisión legal desde el asistente de inscripción (#1368)", () => {
  test("revisar los tres documentos no navega ni pierde los datos cargados", async ({ page }) => {
    await reachSummaryAsRepresentative(page);

    // Los datos del representante están en el resumen ANTES de revisar nada.
    await expect(page.getByText(`${DEPENDENT.nombres} ${DEPENDENT.apellidos}`)).toBeVisible();
    await expect(page.getByText(`${REPRESENTATIVE.nombres} ${REPRESENTATIVE.apellidos}`)).toBeVisible();

    // --- Documento 1: abrir, contenido real, Escape devuelve al resumen.
    await page.getByRole("button", { name: "Términos de uso" }).click();
    const terminos = page.getByRole("dialog", { name: "Términos de uso de Cata Club" });
    await expect(terminos).toBeVisible();
    // El texto revisado es el documento público, no una copia: una oración
    // transcrita de `src/app/terminos/content.ts`.
    await expect(
      terminos.getByText(
        "La aceptación agrupada debe registrar por separado cada documento o versión cubierta, timestamp, cuenta y representante cuando aplique. No debe activarse por defecto ni permitir continuar sin una acción afirmativa.",
      ),
    ).toBeVisible();
    // El cuerpo largo se desplaza dentro del panel (contenido > ventana).
    const cuerpo = terminos.locator(".overflow-y-auto");
    const scroll = await cuerpo.evaluate((el) => ({
      alto: el.scrollHeight,
      ventana: el.clientHeight,
    }));
    expect(scroll.alto).toBeGreaterThan(scroll.ventana);
    // El documento canónico queda a un click, sin salir del asistente.
    await expect(terminos.getByRole("link", { name: /ver documento completo/i })).toHaveAttribute(
      "href",
      "/terminos",
    );

    await page.keyboard.press("Escape");
    await expect(terminos).not.toBeVisible();
    // El foco vuelve al disparador que abrió la revisión.
    await expect(page.getByRole("button", { name: "Términos de uso" })).toBeFocused();

    // --- Documento 2: cerrar con el botón Cerrar.
    await page.getByRole("button", { name: "Aviso de privacidad" }).click();
    const privacidad = page.getByRole("dialog", { name: "Aviso de privacidad de Cata Club" });
    await expect(privacidad).toBeVisible();
    await privacidad.getByRole("button", { name: "Cerrar" }).click();
    await expect(privacidad).not.toBeVisible();

    // --- Documento 3: cerrar tocando el fondo fuera del panel.
    await page.getByRole("button", { name: "Permiso de imagen FETM" }).click();
    const permiso = page.getByRole("dialog", { name: "Permiso público de difusión de imagen FETM" });
    await expect(permiso).toBeVisible();
    await page.getByTestId("legal-review-backdrop").click({ position: { x: 10, y: 10 } });
    await expect(permiso).not.toBeVisible();

    // La ronda completa terminó donde empezó: mismo paso, mismos datos,
    // misma decisión de consentimiento, y la URL nunca salió del asistente.
    await expect(page).toHaveURL(/\/student\/enroll/);
    await expect(page.getByRole("heading", { name: /resumen y confirmación/i })).toBeVisible();
    await expect(page.getByText(`${DEPENDENT.nombres} ${DEPENDENT.apellidos}`)).toBeVisible();
    await expect(page.getByText(`${REPRESENTATIVE.nombres} ${REPRESENTATIVE.apellidos}`)).toBeVisible();
    await expect(page.getByText(REPRESENTATIVE.correo)).toBeVisible();
    await expect(page.getByRole("checkbox")).toBeChecked();
    await expect(page.getByRole("button", { name: /confirmar inscripción/i })).toBeEnabled();
  });
});
