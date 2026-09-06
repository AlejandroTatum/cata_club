/**
 * Lectura de correo desde un spec E2E contra el Mailpit local de QA.
 *
 * El patrón de leer Mailpit por su API REST (`http://localhost:8025/api/v1`)
 * ya existía, pero solo en Python (`scripts/qa_verify_recovery_delivery.py`):
 * ese script confirma que un correo LLEGÓ, nunca lee su cuerpo. Los flujos de
 * activación de cuenta y recuperación de contraseña necesitan además el
 * TOKEN que el enlace lleva adentro, así que este helper agrega esa mitad:
 * buscar el último mensaje de un destinatario, extraer el enlace de su
 * cuerpo, y limpiar la bandeja una vez consumido.
 *
 * ## Por qué la limpieza no es opcional
 *
 * Mailpit es un contenedor del stack de QA, no algo que el spec levanta o
 * destruye — sobrevive entre corridas de `qa-live` igual que la base de
 * datos. Dos cosas lo vuelven un problema si nadie lo vacía:
 *
 *   1. Un correo de una corrida anterior, con el MISMO asunto, puede seguir
 *      en la bandeja cuando la corrida siguiente busca "el último mensaje" —
 *      si esa corrida anterior murió después de disparar el correo pero
 *      antes de leerlo, el mensaje viejo queda ahí, sin leer, esperando.
 *   2. Nada limita cuánto crece la bandeja: sin purga, cada `qa-live` deja
 *      más mensajes que el próximo `search` tiene que atravesar.
 *
 * `waitForMessageTo` ya filtra por destinatario (`to:<correo>`), y este
 * proyecto genera un correo NUEVO por corrida (`Date.now()`), así que un
 * mensaje ajeno normalmente no puede colarse. La purga de `purgeMessagesTo`
 * es la segunda capa: no depende de que el correo sea único para dejar la
 * bandeja como la encontró, y dos specs que casualmente compartieran
 * destinatario (o una corrida repetida a mano, con el reloj empatado) no se
 * leen el correo cruzado.
 */

import type { APIRequestContext } from "@playwright/test";

/**
 * Solo loopback: igual que `scripts/qa_verify_recovery_delivery.py`, este
 * helper no acepta una URL configurable — nunca debe poder apuntar a un
 * proveedor SMTP real ni a otro host.
 */
const MAILPIT_BASE_URL = "http://localhost:8025";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

interface MailpitMessageSummary {
  ID: string;
  Subject: string;
  Created: string;
}

export interface MailpitMessage extends MailpitMessageSummary {
  Text: string;
}

interface MailpitSearchResponse {
  messages?: MailpitMessageSummary[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Mensajes de `to`, más nuevos primero (orden que Mailpit ya devuelve). */
async function searchMessagesTo(
  request: APIRequestContext,
  to: string,
): Promise<MailpitMessageSummary[]> {
  const response = await request.get(`${MAILPIT_BASE_URL}/api/v1/search`, {
    params: { query: `to:${to}` },
  });
  if (!response.ok()) {
    throw new Error(
      `No se pudo consultar Mailpit local (http://localhost:8025) para ${to}: ${response.status()}`,
    );
  }
  const body = (await response.json()) as MailpitSearchResponse;
  return body.messages ?? [];
}

async function fetchMessage(request: APIRequestContext, id: string): Promise<MailpitMessage> {
  const response = await request.get(`${MAILPIT_BASE_URL}/api/v1/message/${id}`);
  if (!response.ok()) {
    throw new Error(`No se pudo leer el mensaje ${id} de Mailpit: ${response.status()}`);
  }
  return (await response.json()) as MailpitMessage;
}

/**
 * Sondea Mailpit hasta que aparezca un mensaje para `to` con el asunto
 * `subject` exacto, y devuelve su cuerpo completo (incluido `Text`, donde
 * vive el enlace). El primero de los dos pasos de
 * `scripts/qa_verify_recovery_delivery.py` (`wait_for_recovery_message`),
 * hecho genérico para servir a cualquier cola de correo saliente, no solo la
 * de recuperación.
 */
export async function waitForMessageTo(
  request: APIRequestContext,
  to: string,
  subject: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<MailpitMessage> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const startedAt = Date.now();

  while (true) {
    const messages = await searchMessagesTo(request, to);
    const match = messages.find((message) => message.Subject === subject);
    if (match) return fetchMessage(request, match.ID);

    if (Date.now() - startedAt >= timeoutMs) {
      const asuntosVistos = [...new Set(messages.map((message) => message.Subject))];
      const detalle = asuntosVistos.length > 0 ? `; asuntos que sí llegaron: ${asuntosVistos.join(", ")}` : "";
      throw new Error(
        `Mailpit no recibió "${subject}" para ${to} en ${timeoutMs / 1000}s${detalle}. ` +
          "Verifique que celery-worker haya despachado la fila del outbox.",
      );
    }
    await sleep(pollIntervalMs);
  }
}

/**
 * Extrae el token de `?token=...` de un enlace `.../<pathname>?token=...` en
 * el cuerpo de texto plano del mensaje. Mismo criterio que
 * `extractVerificationToken` (`src/lib/verification-token.ts`) del lado del
 * producto: el enlace es la fuente, el token es lo que el formulario necesita.
 */
export function extractTokenFromLink(message: MailpitMessage, pathname: string): string {
  const match = message.Text.match(new RegExp(`${pathname}\\?token=([^\\s"'<>]+)`));
  if (!match) {
    throw new Error(
      `El correo con asunto "${message.Subject}" no contiene un enlace de ${pathname} reconocible.`,
    );
  }
  return match[1];
}

/**
 * Borra de Mailpit todos los mensajes dirigidos a `to`. Se llama al final de
 * cada test (no en un `beforeEach`, que correría antes de que el correo de
 * ESTA corrida siquiera exista): deja la bandeja como la encontró la corrida
 * siguiente, sin tocar mensajes de otro destinatario.
 */
export async function purgeMessagesTo(request: APIRequestContext, to: string): Promise<void> {
  const messages = await searchMessagesTo(request, to);
  if (messages.length === 0) return;
  await request.delete(`${MAILPIT_BASE_URL}/api/v1/messages`, {
    data: { IDs: messages.map((message) => message.ID) },
  });
}
