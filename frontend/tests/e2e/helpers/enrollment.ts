/**
 * Alta pública de un Jugador (autoinscripción de un adulto), compartida entre
 * `activacion.live.spec.ts` y `recuperacion-contrasenia.live.spec.ts`.
 *
 * Los ids de campo y la secuencia de pasos están DECLARADOS acá, no
 * importados de `enroll-qa.spec.ts` ni del producto — mismo criterio que ya
 * documenta la tabla `F` de ese archivo y `helpers/birth-date.ts`: si el
 * producto le cambia el id a un campo, este helper tiene que enterarse
 * rompiéndose, no seguir apuntando a un selector que dejó de existir.
 */

import { randomInt } from "node:crypto";

import type { APIRequestContext, Page } from "@playwright/test";
import { fillBirthDate } from "./birth-date";
import { E2E_BASE_URL } from "../e2e-target";

const FIELD_ID = {
  nombres: "enroll-nombres",
  apellidos: "enroll-apellidos",
  fechaNacimiento: "enroll-fecha-nacimiento",
  cedula: "enroll-cedula",
  telefono: "enroll-telefono",
  correo: "enroll-correo",
  contrasenia: "enroll-contrasenia",
  contraseniaConfirmacion: "enroll-confirmar-contrasena",
  tipoSangre: "enroll-tipo-sangre",
  contactoEmergencia: "enroll-contacto-emergencia",
  telefonoEmergencia: "enroll-telefono-emergencia",
} as const;

/** Coeficientes del módulo 10, transcritos de `src/lib/identity-validation.ts`. */
const CEDULA_CHECK_COEFFICIENTS = [2, 1, 2, 1, 2, 1, 2, 1, 2];

function checkDigitFor(nineDigits: string): number {
  const sum = CEDULA_CHECK_COEFFICIENTS.reduce((total, coefficient, index) => {
    const product = Number(nineDigits[index]) * coefficient;
    return total + (product > 9 ? product - 9 : product);
  }, 0);
  const remainder = sum % 10;
  return remainder === 0 ? 0 : 10 - remainder;
}

/**
 * Una cédula ecuatoriana válida (provincia 17 = Pichincha, dígito
 * verificador módulo 10 real) y nueva en cada llamada: `persona.cedula` es
 * `unique` en la base, así que una corrida repetida sobre el mismo stack de
 * QA necesita una cédula que la corrida anterior no haya usado — el mismo
 * problema que `discounts.live.spec.ts` resuelve con un nombre `Date.now()`
 * para su descuento. el sufijo aleatorio además del reloj evita que dos llamadas
 * en el mismo milisegundo (dos specs live arrancando casi juntos) colisionen.
 */
export function uniqueValidCedula(): string {
  // `randomInt` de `node:crypto` y no `Math.random()`: Sonar marca el
  // generador pseudoaleatorio como sensible (S2245) y eso baja el rating de
  // seguridad del código nuevo. Acá el CSPRNG no cuesta nada.
  const suffix = `${Date.now()}${randomInt(1000)}`.slice(-7);
  const nineDigits = `17${suffix}`;
  return `${nineDigits}${checkDigitFor(nineDigits)}`;
}

/** Un adulto de 30 años, recalculado en cada corrida (mismo criterio que `enroll-qa.spec.ts`). */
function isoYearsAgo(years: number): string {
  const y = new Date().getFullYear() - years;
  return `${y}-05-20`;
}

export interface NewPlayer {
  nombres: string;
  apellidos: string;
  correo: string;
  contrasenia: string;
  cedula: string;
  telefono: string;
  fechaNacimiento: string;
}

/** Datos válidos de un Jugador nuevo; solo `correo` varía entre llamadas por defecto. */
export function newPlayer(correo: string, contrasenia = "clave-segura-8"): NewPlayer {
  return {
    nombres: "QA Jugador",
    apellidos: "Autoinscrito",
    correo,
    contrasenia,
    cedula: uniqueValidCedula(),
    // Forma canónica de cable (`canonicalStudentPhone`, `enroll-utils.ts`):
    // `09XXXXXXXX`, la misma que `EnrollmentAlumnoDTO.telefono` exige del
    // lado del backend. El asistente la pide SIN el `0` inicial (issue #225
    // en `enroll-qa.spec.ts`: el campo ya antepone "+593" como prefijo fijo),
    // así que `enrollNewPlayerViaWizard` recorta ese `0` recién al tipear.
    telefono: "0991234567",
    fechaNacimiento: isoYearsAgo(30),
  };
}

/**
 * Completa el asistente público (`/student/enroll`) como Jugador (autoinscripción)
 * y confirma la inscripción. Termina con las cookies de sesión reales ya
 * puestas por el backend (`POST /enrollment/` autentica en el mismo request)
 * y la pantalla "Inscripción completada" visible.
 *
 * No usa `page.route` en ningún punto: el objetivo de `activacion.live.spec.ts`
 * es certificar la alta pública REAL, así que el alta en sí tiene que pasar
 * por el asistente de verdad, no por un atajo a la API.
 */
export async function enrollNewPlayerViaWizard(page: Page, player: NewPlayer): Promise<void> {
  await page.goto("/login");
  await page.getByRole("link", { name: /inscríbase/i }).click();
  await page.getByRole("heading", { name: /tipo de inscripción/i }).waitFor({ timeout: 20_000 });

  // Paso "Tipo de inscripción": Jugador es la opción por defecto, alcanza con avanzar.
  await page.getByRole("button", { name: /siguiente/i }).click();
  await page.locator(`#${FIELD_ID.nombres}`).waitFor({ state: "attached", timeout: 20_000 });

  // Paso "Datos del estudiante".
  await page.locator(`#${FIELD_ID.nombres}`).fill(player.nombres);
  await page.locator(`#${FIELD_ID.apellidos}`).fill(player.apellidos);
  await fillBirthDate(page, FIELD_ID.fechaNacimiento, player.fechaNacimiento);
  await page.locator(`#${FIELD_ID.cedula}`).fill(player.cedula);
  // El campo del asistente pide solo los 9 dígitos locales, sin el `0` de
  // `player.telefono` (ver el comentario de `newPlayer`).
  await page.locator(`#${FIELD_ID.telefono}`).fill(player.telefono.replace(/^0/, ""));
  await page.locator(`#${FIELD_ID.correo}`).fill(player.correo);
  await page.locator(`#${FIELD_ID.contrasenia}`).fill(player.contrasenia);
  await page.locator(`#${FIELD_ID.contraseniaConfirmacion}`).fill(player.contrasenia);
  await page.getByRole("button", { name: /siguiente/i }).click();

  // Paso "Salud y emergencia". El teléfono de emergencia debe DIFERIR del
  // propio (`emergencyPhoneDiffersRule`), de ahí el prefijo distinto.
  await page.locator(`#${FIELD_ID.tipoSangre}`).selectOption("O_POSITIVO");
  await page.locator(`#${FIELD_ID.contactoEmergencia}`).fill("Contacto QA");
  await page.locator(`#${FIELD_ID.telefonoEmergencia}`).fill("0987654321");
  await page.getByRole("button", { name: /siguiente/i }).click();

  // Paso "Resumen y confirmación".
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /confirmar inscripción/i }).click();
  await page.getByRole("heading", { name: /inscripción completada/i }).waitFor({ timeout: 20_000 });
}

/**
 * Crea el mismo Jugador que `enrollNewPlayerViaWizard`, pero por API
 * (`POST /api/enrollment/`) en vez de por UI.
 *
 * Solo lo usa `recuperacion-contrasenia.live.spec.ts`, donde el alta NO es lo
 * que el spec certifica -- necesita una cuenta real para pedirle una
 * recuperación, igual que `payments.live.spec.ts` usa `request.put` para
 * limpiar pagos pendientes sin que esa limpieza sea parte de lo que el test
 * mide. `activacion.live.spec.ts` es el que certifica el asistente en sí, y
 * ese sí pasa por la UI completa (`enrollNewPlayerViaWizard`).
 */
export async function enrollNewPlayerViaApi(
  request: APIRequestContext,
  player: NewPlayer,
): Promise<void> {
  const response = await request.post(`${E2E_BASE_URL}/api/enrollment/`, {
    data: {
      alumno: {
        nombres: player.nombres,
        apellidos: player.apellidos,
        cedula: player.cedula,
        fechaNacimiento: player.fechaNacimiento,
        telefono: player.telefono,
      },
      credencialesAlumno: {
        correo: player.correo,
        contrasenia: player.contrasenia,
      },
      fichaMedica: {
        tipoSangre: "O_POSITIVO",
        condicionesSalud: "",
        alergias: "",
        contactoEmergencia: "Contacto QA",
        telefonoEmergencia: "0987654321",
      },
      aceptaConsentimientos: true,
    },
  });
  if (!response.ok()) {
    throw new Error(
      `No se pudo crear la cuenta de QA ${player.correo} vía /api/enrollment/: ${response.status()} ${await response.text()}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Alta de un dependiente por un representante (módulo 3)
// ---------------------------------------------------------------------------

/** Ids del paso "Datos del representante" -- distintos de `FIELD_ID`, que es el estudiante. */
const REPRESENTATIVE_FIELD_ID = {
  nombres: "enroll-nombres-representante",
  apellidos: "enroll-apellidos-representante",
  cedula: "enroll-cedula-representante",
  fechaNacimiento: "enroll-fecha-nacimiento-representante",
  telefono: "enroll-telefono-representante",
  correo: "enroll-correo-representante",
  contrasenia: "enroll-contrasenia-representante",
  contraseniaConfirmacion: "enroll-confirmar-contrasena-representante",
} as const;

export interface NewRepresentative {
  nombres: string;
  apellidos: string;
  correo: string;
  contrasenia: string;
  cedula: string;
  telefono: string;
  fechaNacimiento: string;
}

/** Datos válidos de un representante nuevo; solo `correo` varía entre llamadas por defecto. */
export function newRepresentative(correo: string, contrasenia = "clave-segura-8"): NewRepresentative {
  return {
    nombres: "QA Representante",
    apellidos: "Responsable",
    correo,
    contrasenia,
    cedula: uniqueValidCedula(),
    telefono: "0991234567",
    fechaNacimiento: isoYearsAgo(35),
  };
}

export interface NewDependent {
  nombres: string;
  apellidos: string;
  cedula: string;
  telefono: string;
  fechaNacimiento: string;
  /**
   * Presente solo cuando el dependiente TAMBIÉN recibe su propia cuenta
   * (Opción B, `EnrollmentAlumnoDTO.correo`/`contrasenia` en el backend). Es
   * el único campo que distingue "hijo gestionado" de "hijo con cuenta
   * propia" -- ver el DTO: mismo alumno, mismo representante, un `Usuario`
   * de más si esto viene presente.
   */
  credenciales?: { correo: string; contrasenia: string };
}

/** Un dependiente menor de edad nuevo; el llamador decide si lleva `credenciales`. */
export function newDependent(overrides: Partial<NewDependent> = {}): NewDependent {
  return {
    nombres: "QA Dependiente",
    apellidos: "De Representante",
    cedula: uniqueValidCedula(),
    telefono: "0991234568",
    fechaNacimiento: isoYearsAgo(9),
    ...overrides,
  };
}

/**
 * Completa el asistente público (`/student/enroll`) como Representante --
 * dependiente + representante, con o sin cuenta propia del dependiente según
 * `dependent.credenciales` -- y confirma la inscripción. Termina con las
 * cookies de sesión reales del REPRESENTANTE ya puestas (mismo auto-login que
 * `enrollNewPlayerViaWizard`) y la pantalla "Inscripción completada" visible.
 */
export async function enrollDependentViaWizard(
  page: Page,
  representative: NewRepresentative,
  dependent: NewDependent,
): Promise<void> {
  await page.goto("/login");
  await page.getByRole("link", { name: /inscríbase/i }).click();
  await page.getByRole("heading", { name: /tipo de inscripción/i }).waitFor({ timeout: 20_000 });

  // Paso "Tipo de inscripción": Representante, no el Jugador por defecto.
  await page.getByRole("button", { name: /^Representante/ }).click();
  await page.getByRole("button", { name: /siguiente/i }).click();
  await page.locator(`#${FIELD_ID.nombres}`).waitFor({ state: "attached", timeout: 20_000 });

  // Paso "Datos del estudiante" -- acá describe al DEPENDIENTE, no al representante.
  await page.locator(`#${FIELD_ID.nombres}`).fill(dependent.nombres);
  await page.locator(`#${FIELD_ID.apellidos}`).fill(dependent.apellidos);
  await fillBirthDate(page, FIELD_ID.fechaNacimiento, dependent.fechaNacimiento);
  await page.locator(`#${FIELD_ID.cedula}`).fill(dependent.cedula);
  await page.locator(`#${FIELD_ID.telefono}`).fill(dependent.telefono.replace(/^0/, ""));
  if (dependent.credenciales) {
    await page.locator(`#${FIELD_ID.correo}`).fill(dependent.credenciales.correo);
    await page.locator(`#${FIELD_ID.contrasenia}`).fill(dependent.credenciales.contrasenia);
    await page.locator(`#${FIELD_ID.contraseniaConfirmacion}`).fill(dependent.credenciales.contrasenia);
  }
  await page.getByRole("button", { name: /siguiente/i }).click();

  // Paso "Datos del representante".
  await page.getByRole("heading", { name: /datos del representante/i }).waitFor({ timeout: 20_000 });
  await page.locator(`#${REPRESENTATIVE_FIELD_ID.nombres}`).fill(representative.nombres);
  await page.locator(`#${REPRESENTATIVE_FIELD_ID.apellidos}`).fill(representative.apellidos);
  await fillBirthDate(page, REPRESENTATIVE_FIELD_ID.fechaNacimiento, representative.fechaNacimiento);
  await page.locator(`#${REPRESENTATIVE_FIELD_ID.cedula}`).fill(representative.cedula);
  // A diferencia del campo del estudiante (que antepone "+593" como prefijo
  // fijo y pide los 9 dígitos locales SIN el `0`), el campo del representante
  // no tiene ese prefijo: `enroll-qa.spec.ts::fillValidRepresentative` llena
  // `VALID_REPRESENTATIVE.telefono` completo, con el `0` inicial incluido.
  await page.locator(`#${REPRESENTATIVE_FIELD_ID.telefono}`).fill(representative.telefono);
  await page.locator(`#${REPRESENTATIVE_FIELD_ID.correo}`).fill(representative.correo);
  await page.locator(`#${REPRESENTATIVE_FIELD_ID.contrasenia}`).fill(representative.contrasenia);
  await page.locator(`#${REPRESENTATIVE_FIELD_ID.contraseniaConfirmacion}`).fill(representative.contrasenia);
  await page.getByRole("button", { name: /siguiente/i }).click();

  // Paso "Salud y emergencia" -- ficha médica del dependiente. El teléfono de
  // emergencia debe DIFERIR del propio del dependiente (mismo criterio que
  // `enrollNewPlayerViaWizard`).
  await page.getByRole("heading", { name: /salud y emergencia/i }).waitFor({ timeout: 20_000 });
  await page.locator(`#${FIELD_ID.tipoSangre}`).selectOption("O_POSITIVO");
  await page.locator(`#${FIELD_ID.contactoEmergencia}`).fill("Contacto QA");
  await page.locator(`#${FIELD_ID.telefonoEmergencia}`).fill("0987654321");
  await page.getByRole("button", { name: /siguiente/i }).click();

  // Paso "Resumen y confirmación". `POST /enrollment/` hashea hasta DOS
  // contraseñas con bcrypt acá (representante + dependiente, si trae cuenta
  // propia) -- más lento que cualquier paso anterior, y esta función se
  // llama dos veces seguidas en el spec de la frontera de autorización, así
  // que un timeout ajustado al resto de los pasos flaqueaba bajo carga
  // (suite completa, varias altas ya corridas) sin que la corrida tuviera
  // nada mal: la pantalla de confirmación llegaba con los datos correctos,
  // solo tarde.
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /confirmar inscripción/i }).click();
  await page.getByRole("heading", { name: /inscripción completada/i }).waitFor({ timeout: 45_000 });
}
