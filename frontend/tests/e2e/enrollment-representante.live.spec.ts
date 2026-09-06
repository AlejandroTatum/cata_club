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
 * puede ver. Este archivo cubre esa otra mitad, en tres partes:
 *
 *   1. un representante inscribe a un dependiente SIN cuenta propia (el
 *      camino común: un menor gestionado, sin credenciales propias) y lo ve
 *      en su panel;
 *   2. la diferencia real entre eso y un dependiente CON cuenta propia es
 *      un solo flag del lado del backend (`EnrollmentAlumnoDTO.correo`/
 *      `contrasenia`, Opción B) -- confirmado leyendo `enrollment_schemas.py`
 *      y `enroll-utils.ts`, no asumido. No hay un segundo camino de UI que
 *      certificar, así que no hay un segundo spec completo: el mismo alta
 *      con esos dos campos llenos, más UNA aserción extra (el dependiente
 *      inicia sesión por su cuenta, de forma independiente);
 *   3. la frontera de autorización: un representante NO puede leer los
 *      datos del dependiente de otro representante.
 *
 * ## Por qué "el panel" se verifica contra el endpoint y no contra la página
 *
 * `middleware.ts` bloquea `/student` (y toda ruta protegida) para cualquier
 * cuenta con el claim `activacion_completa: false` -- redirige, server-side,
 * a `/login/activacion` ANTES de que la página cargue. Un representante
 * recién inscripto siempre trae ese claim en false (`puede_acceder_modulos`
 * exige correo verificado Y `alta_presencial_completada`, y esta segunda
 * condición depende de una `Membresia` histórica sobre la persona del
 * REPRESENTANTE -- no la del dependiente -- que solo un administrador crea
 * al registrar el primer pago). Es la misma limitación que ya documenta
 * `activacion.live.spec.ts` para la autoinscripción de un Jugador ("Por qué
 * NO llega a alta_presencial_completada"): forzarla a mano con una membresía
 * fabricada convertiría este spec en una prueba de otra cosa.
 *
 * `GET /api/student?personaId=<id>` en cambio NO está detrás de ese
 * middleware (su ruta es `/api/student`, no `/student`, y el matcher de
 * `middleware.ts` no la alcanza) -- es la MISMA llamada que la página real
 * hace para llenar el panel, y responde con los datos reales sin importar
 * el estado de activación. Por eso este archivo verifica "lo ve en su
 * panel" contra esa respuesta real, no contra el render de la página, y deja
 * documentado (sin fingir lo contrario) que la página en sí queda detrás de
 * la puerta de activación como cualquier alta pública nueva.
 *
 * ## El hallazgo de autorización (verificado, no asumido)
 *
 * Antes de escribir la aserción de la parte 3 se reprodujo a mano contra el
 * stack real (dos representantes reales, vía `curl`, ver la sesión que
 * escribió este archivo): `GET /api/student?personaId=<id>` reenvía
 * `personaId` -- un query param que el CLIENTE controla -- tal cual a
 * `GET /personas/{id}/representados` del lado del backend. Ese endpoint
 * exige `PoliticaAccesoPersona.exigir_acceso_directo` (dueño o
 * administrador, SIN la rama de representante), así que un representante B
 * que le cambia el número a `personaId` para apuntar al dependiente de A
 * recibe un 403 limpio ("Permisos insuficientes para esta operación"), no
 * los datos de A.
 *
 * No es un hallazgo nuevo: es la misma superficie ("¿qué cadena de llamadas
 * legítimas lleva de un solicitante cualquiera a este dato?", auditoría de
 * producción #790) vuelta a probar después del arreglo, con un query param
 * libre en vez de un rol. El resultado es el esperado -- BLOQUEADO -- así
 * que el test de la parte 3 afirma eso, no lo contrario.
 *
 * ## Cómo se corre
 *
 *     make qa-up      # backend + base sembrada + frontend, en localhost:3000
 *     make qa-live
 *
 * Igual que el resto de los `*.live.spec.ts`, solo lo recoge el proyecto
 * `e2e-live` cuando `E2E_LIVE=1`.
 */
import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import { enrollDependentViaWizard, newDependent, newRepresentative } from "./helpers/enrollment";

/** Forma mínima de lo que `GET /api/student` devuelve -- solo lo que este archivo lee. */
interface StudentPortalProbe {
  self: { personaId: string; nombres: string; apellidos: string } | null;
  representados: Array<{ personaId: string; nombres: string; apellidos: string }>;
}

/**
 * El id de la cuenta detrás de la sesión real ya puesta por el alta (cookie
 * `access_token`, HttpOnly -- invisible para `page.evaluate`, pero legible
 * por la automatización, que no está sujeta a esa restricción de navegador).
 * Ningún endpoint del cliente devuelve este id directamente: `POST
 * /api/enrollment/` lo omite a propósito (`route.ts`: "Only { enrolled: true
 * } ever reaches client JS"), así que decodificar el claim `persona_id` del
 * propio JWT es la única vía. No se verifica la firma -- no hace falta para
 * leer un dato de un token que el mismo test acaba de recibir del backend.
 */
async function ownPersonaIdFromSession(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const accessToken = cookies.find((cookie) => cookie.name === "access_token");
  if (!accessToken) {
    throw new Error("No hay cookie de sesión (access_token) en este contexto de navegador.");
  }
  const [, payloadSegment] = accessToken.value.split(".");
  const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { persona_id?: number };
  if (typeof payload.persona_id !== "number") {
    throw new Error("El token de sesión no trae el claim persona_id.");
  }
  return String(payload.persona_id);
}

/**
 * El mismo `GET /api/student?personaId=<id>` que llena el panel real,
 * pedido directo (sin pasar por la página `/student`, ver el comentario del
 * encabezado). El resultado es lo que el representante vería una vez que su
 * cuenta esté activada -- los datos son reales, la página que los pinta es
 * lo único fuera de alcance de un alta pública recién hecha.
 */
async function fetchOwnStudentPortal(page: Page): Promise<StudentPortalProbe> {
  const personaId = await ownPersonaIdFromSession(page);
  const response = await page.request.get(`/api/student?personaId=${personaId}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test.describe("Alta de un dependiente por un representante", () => {
  test("un representante inscribe a un dependiente sin cuenta propia y lo ve en su panel", async ({ page }) => {
    test.setTimeout(60_000);
    const suffix = Date.now();
    const representative = newRepresentative(`qa-rep-sin-cuenta-${suffix}@cataclub.com`);
    const dependent = newDependent();

    await enrollDependentViaWizard(page, representative, dependent);

    // El dependiente existe y el representante -- con su propia sesión
    // recién autenticada -- lo ve: un solo representado, el que acaba de
    // inscribir. El nombre no se compara contra lo tipeado en el asistente
    // porque el backend lo normaliza a título ("QA Dependiente" queda "Qa
    // Dependiente"); el valor esperado sale siempre de la respuesta real.
    const portal = await fetchOwnStudentPortal(page);
    expect(portal.representados).toHaveLength(1);
    expect(portal.representados[0].apellidos).toBe(dependent.apellidos);

    // Documentado, no fingido: la PÁGINA `/student` queda detrás de la
    // puerta de activación para cualquier alta pública recién hecha (ver el
    // comentario del encabezado) -- el representante recién inscripto
    // aterriza en `/login/activacion`, igual que un Jugador autoinscrito en
    // `activacion.live.spec.ts`.
    await page.goto("/student");
    await expect(page).toHaveURL(/\/login\/activacion$/, { timeout: 20_000 });
  });

  test("un representante inscribe a un dependiente CON cuenta propia, que además inicia sesión por su cuenta", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const suffix = Date.now();
    const representative = newRepresentative(`qa-rep-con-cuenta-${suffix}@cataclub.com`);
    const credencialesDependiente = {
      correo: `qa-hijo-con-cuenta-${suffix}@cataclub.com`,
      contrasenia: "clave-segura-8",
    };
    const dependent = newDependent({ credenciales: credencialesDependiente });

    await enrollDependentViaWizard(page, representative, dependent);

    const portal = await fetchOwnStudentPortal(page);
    expect(portal.representados).toHaveLength(1);
    const [seen] = portal.representados;

    // La única diferencia real con el caso anterior (Opción B,
    // `EnrollmentAlumnoDTO.correo`/`contrasenia` en el backend): el
    // dependiente TAMBIÉN tiene una cuenta propia. Se verifica con la única
    // prueba que de verdad la distingue -- un login independiente, sin la
    // sesión del representante -- en vez de un segundo spec completo que
    // repetiría todo el camino de alta para probar el mismo flag.
    //
    // La pantalla de confirmación no tiene botón de cerrar sesión (solo "Ir
    // a mi cuenta" y "Nueva inscripción"); `/login` ya autenticado redirige a
    // `/login/activacion` (ver el comentario del encabezado), que sí lo tiene.
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login\/activacion$/, { timeout: 20_000 });
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

    await page.getByLabel(/correo electrónico/i).fill(credencialesDependiente.correo);
    await page.getByRole("textbox", { name: /contraseña/i }).fill(credencialesDependiente.contrasenia);
    await page.getByRole("button", { name: /iniciar sesión/i }).click();

    // El correo del dependiente no está verificado (recién nace en este
    // alta), así que aterriza en la puerta de activación -- no en `/student`
    // directo. Lo que este assert certifica no es el destino, es que la
    // cuenta PROPIA del dependiente autentica sola, sin la contraseña del
    // representante.
    const primerNombre = seen.nombres.split(" ")[0];
    await expect(page.getByText(`Hola, ${primerNombre}`)).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/login\/activacion$/, { timeout: 20_000 });
  });
});

test.describe("Frontera de autorización entre representantes", () => {
  test("un representante no puede leer los datos del dependiente de otro representante", async ({ page, browser }) => {
    test.setTimeout(90_000);
    const suffix = Date.now();

    // Representante A y su dependiente, en la sesión del test.
    const representanteA = newRepresentative(`qa-rep-a-${suffix}@cataclub.com`);
    const dependienteA = newDependent();
    await enrollDependentViaWizard(page, representanteA, dependienteA);
    const portalA = await fetchOwnStudentPortal(page);
    const dependienteAId = portalA.representados[0].personaId;

    // Representante B, en un contexto de navegador SEPARADO -- ninguna
    // cookie de A sobrevive al cambio de contexto, así que lo único que B
    // puede usar para cruzar es el id numérico que su propia sesión conoce.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    try {
      const representanteB = newRepresentative(`qa-rep-b-${suffix}@cataclub.com`);
      const dependienteB = newDependent();
      await enrollDependentViaWizard(pageB, representanteB, dependienteB);
      const portalB = await fetchOwnStudentPortal(pageB);

      // Punto de partida sano: B ve a SU PROPIO dependiente, nunca al de A.
      expect(portalB.representados).toHaveLength(1);
      expect(portalB.representados[0].personaId).not.toBe(dependienteAId);

      // El cruce: B pide, con su PROPIA sesión autenticada, el portal del
      // dependiente de A por id -- exactamente lo que un representante
      // podría intentar cambiando el número en `?alumno=` de su propia URL.
      // `pageB.request` comparte las cookies de `pageB` (la sesión real de
      // B), a diferencia del fixture `request` suelto.
      const cruce = await pageB.request.get(`/api/student?personaId=${dependienteAId}`);
      expect(cruce.status()).toBe(403);
      const cuerpoCruce = (await cruce.json()) as { message?: string };
      expect(cuerpoCruce.message).toBe("Permisos insuficientes para esta operación");
    } finally {
      await contextB.close();
    }
  });
});
