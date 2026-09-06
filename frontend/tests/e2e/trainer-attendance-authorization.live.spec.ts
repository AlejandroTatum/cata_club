/**
 * Módulo 4 — la frontera de autorización de asistencia (issue #389 / #13).
 *
 * ## Lo que el código dice, verificado en vivo
 *
 * `AsistenciaServicio.registrar_asistencia` (backend/app/servicios_negocio/
 * asistencia_servicio.py) es explícito en su propio docstring: "cualquier
 * entrenador opera cualquier horario y el dato no tiene consumidor (issue
 * #13, docs/product/concepto-alcance-modelo.md §4)". La migración
 * `e7c3a1b9d5f2_remover_entrenador_de_horario_y_asistencia` borró la columna
 * que hubiera permitido esa relación. No existe, en ningún lado del dominio,
 * un concepto de "horario del entrenador X" — un `HorarioEntrenamiento` no
 * tiene entrenador asignado, así que no hay "sesión ajena" que un entrenador
 * pueda intentar tocar. Esto NO es un descuido: es una decisión de producto
 * documentada, y el spec de abajo la confirma tal cual es, sin fingir un
 * límite que el dominio no modela.
 *
 * ### AVISO PARA REVISIÓN HUMANA
 * El primer test de este archivo confirma un límite que SÍ existe y está
 * cerrado (corregir es exclusivo de ADMINISTRADOR). El segundo confirma,
 * en cambio, la AUSENCIA de un límite: un entrenador puede leer y operar
 * CUALQUIER horario, no solo "el suyo" — porque "el suyo" no es un concepto
 * que este dominio tenga. Si el club espera que un entrenador solo opere
 * sus propias clases, este es el lugar donde esa expectativa chocaría con
 * el código real, y quien lo decide es el dueño del producto, no este spec.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

/** Sembrados por `backend/scripts/seed_dev_base.py`. */
const TRAINER_EMAIL = "entrenador@cataclub.com";
const TRAINER_PASSWORD = "trainer12345";

/** Dos horarios de categorías DISTINTAS — ninguno "pertenece" al entrenador de prueba
 *  en ningún sentido, porque el modelo no tiene esa relación (ver el encabezado). */
const HORARIO_A = 6; // INFANTIL, LUNES
const HORARIO_B = 21; // COMPETITIVO, SÁBADO

async function loginAsTrainer(request: APIRequestContext): Promise<void> {
  const login = await request.post("/api/auth/login", {
    data: { email: TRAINER_EMAIL, password: TRAINER_PASSWORD },
  });
  expect(login.ok(), `No se pudo iniciar sesión como entrenador: ${login.status()}`).toBe(true);
}

test("un entrenador NO puede corregir una asistencia — sigue siendo exclusivo de administrador (cerrado)", async ({
  request,
}) => {
  await loginAsTrainer(request);

  // Cualquier fila real y correctable alcanza para probar el 403 — no hace
  // falta que la corrección se aplique, solo que el permiso la rechace antes.
  const records = (await request
    .get("/api/attendance/records?fechaInicio=2026-09-03&fechaFin=2026-09-05&horarioId=" + HORARIO_B)
    .then((r) => r.json())) as Array<{ id: string }>;
  expect(records.length, "No hay ninguna Asistencia sembrada para probar el 403 de corrección").toBeGreaterThan(0);

  const attempt = await request.patch(`/api/attendance/records/${records[0].id}/correct`, {
    data: {
      estado: "present",
      justificativo: null,
      estadoJustificativo: null,
      motivo: "Intento de corrección por un entrenador — debe rechazarse.",
    },
  });

  expect(attempt.status(), "Un entrenador logró corregir una asistencia — el gate de ADMINISTRADOR se rompió").toBe(
    403,
  );
});

test("HALLAZGO: un entrenador puede leer/operar CUALQUIER horario — no existe 'horario propio' (issue #13, intencional)", async ({
  request,
}) => {
  await loginAsTrainer(request);

  // Dos horarios sin relación entre sí, sin ninguna asignación previa del
  // entrenador de prueba a ninguno de los dos — porque esa asignación no
  // existe como concepto. Ambos responden 200: no hay frontera que cruzar.
  const rosterA = await request.get(`/api/groups/horarios/${HORARIO_A}/alumnos?limit=1`);
  const rosterB = await request.get(`/api/groups/horarios/${HORARIO_B}/alumnos?limit=1`);

  expect(rosterA.status(), "El horario A debería ser legible por cualquier entrenador").toBe(200);
  expect(rosterB.status(), "El horario B debería ser legible por cualquier entrenador").toBe(200);
});
