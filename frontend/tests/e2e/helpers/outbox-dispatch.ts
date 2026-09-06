/**
 * Despacho manual de una tarea de outbox pendiente en el `celery-worker` del
 * stack de QA (`make qa-up`).
 *
 * ## Por qué existe esto
 *
 * `Makefile:QA_SERVICIOS` excluye `celery-beat` a propósito (memoria de
 * costo: un proceso más solo para tickear cron diarios que el QA de
 * pantallas nunca necesita). Tanto la recuperación de contraseña como la
 * verificación de correo pasan por un outbox durable: el request HTTP solo
 * inserta una fila `PENDIENTE`, y el despacho — publicar la tarea de Celery
 * que de verdad manda el correo — es 100% responsabilidad de beat. Sin beat,
 * esa fila espera para siempre.
 *
 * `make qa-up` ya resuelve exactamente este problema para el smoke de
 * recuperación (ver el target `qa-up` en el `Makefile`, y
 * `scripts/qa_verify_recovery_delivery.py`): publica el despachador a mano,
 * una vez, con el mismo comando que beat correría. Este helper reproduce esa
 * misma solución para que los specs `*.live.spec.ts` puedan disparar
 * cualquiera de los dos despachadores (`despachar_recuperaciones_pendientes`,
 * `despachar_verificaciones_pendientes`) cuantas veces haga falta.
 *
 * ## Por qué `docker compose exec` y no otra cosa
 *
 * Se investigaron dos alternativas antes de esta, y ninguna existe hoy:
 *
 *   - Un endpoint HTTP que dispare el despacho a mano: no existe. El único
 *     código que llama `outbox_despacho.reclamar_y_publicar` para estas dos
 *     colas son las propias tareas de Celery (`recuperacion_tareas.py`,
 *     `verificacion_correo_tareas.py`), invocadas solo por `beat_schedule`
 *     (`celery_app.py`) o por la CLI de Celery.
 *   - Un comando de management independiente del contenedor: tampoco existe;
 *     el despachador SOLO corre dentro del proceso de Celery, que solo vive
 *     en el contenedor `celery-worker`.
 *
 * Así que la única forma de publicar la tarea sin agregar código de
 * producción nuevo es la CLI de Celery, dentro de ese contenedor — el mismo
 * comando que ya corre `make qa-up`. Esto acopla la suite a que Docker esté
 * disponible en el runner y a que el proyecto de Compose `cataclub-qa` ya
 * esté arriba; es una desventaja real, pero es la misma que ya asume
 * `qa_verify_recovery_delivery.py`, y evita duplicar en el frontend una
 * decisión de despacho que ya vive, documentada, en el Makefile.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Mismos tres archivos que `QA_COMPOSE` en el `Makefile`, en el mismo orden. */
const QA_COMPOSE_FILES = ["docker-compose.yml", "docker-compose.override.yml", "docker-compose.qa.yml"];

/**
 * Raíz del repo, derivada de este archivo
 * (`frontend/tests/e2e/helpers/outbox-dispatch.ts`) en vez de asumir el cwd
 * del proceso que corre Playwright — `qa-live` se invoca desde `frontend/`,
 * pero los `docker-compose.*.yml` viven en la raíz. Playwright transpila este
 * archivo a CommonJS (no hay `"type": "module"` en `package.json`), así que
 * `__dirname` es el global correcto acá — `import.meta.url` revienta con
 * `SyntaxError: Cannot use 'import.meta' outside a module`.
 */
const REPO_ROOT = path.resolve(__dirname, "../../../..");

const CELERY_APP = "app.infraestructura.tareas.celery_app";

/** Las dos únicas tareas de despacho que este helper tiene motivo de correr. */
export type OutboxDispatchTask =
  | "app.infraestructura.tareas.recuperacion_tareas.despachar_recuperaciones_pendientes"
  | "app.infraestructura.tareas.verificacion_correo_tareas.despachar_verificaciones_pendientes";

/**
 * Publica `task` en el `celery-worker` de QA, tal como lo hace `beat` en
 * producción. No espera el resultado de la tarea (igual que `celery call`
 * usado por `make qa-up`): solo confirma que la publicación salió bien.
 *
 * Falla con un mensaje que nombra exactamente qué falta -- Docker
 * inalcanzable, el proyecto `cataclub-qa` abajo, o el contenedor sin
 * `celery-worker` -- en vez de dejar que el spec agote su timeout esperando
 * un correo que nunca fue a salir.
 */
export async function dispatchPendingOutboxTask(task: OutboxDispatchTask): Promise<void> {
  const args = [
    "compose",
    ...QA_COMPOSE_FILES.flatMap((file) => ["-f", file]),
    "exec",
    "-T",
    "celery-worker",
    "uv",
    "run",
    "celery",
    "-A",
    CELERY_APP,
    "call",
    task,
  ];

  try {
    await execFileAsync("docker", args, {
      cwd: REPO_ROOT,
      timeout: 15_000,
      env: {
        ...process.env,
        // `docker-compose.yml` declara `JWT_SECRET_KEY: "${JWT_SECRET_KEY:?...}"`,
        // así que Compose exige la variable para poder RENDERIZAR el archivo
        // fusionado, incluso para un `exec` sobre un contenedor que ya está
        // corriendo con su propio valor real. El valor de acá nunca se usa en
        // tiempo de ejecución -- solo evita que Compose se niegue a leer el
        // archivo -- así que un valor aleatorio de usar una sola vez alcanza.
        JWT_SECRET_KEY: process.env.JWT_SECRET_KEY ?? randomBytes(32).toString("hex"),
      },
    });
  } catch (error: unknown) {
    const detalle = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No se pudo despachar "${task}" en celery-worker del stack de QA (proyecto cataclub-qa). ` +
        "Verifique que `make qa-up` esté corriendo, que Docker esté disponible para este proceso, " +
        `y que el contenedor celery-worker exista. Detalle: ${detalle}`,
    );
  }
}
