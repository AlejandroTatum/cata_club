/**
 * POST /api/chatbot — BFF proxy to the backend's public (no auth),
 * burst-rate-limited `POST /chatbot/consultar`. Static-FAQ helper for
 * navigating the app — no personal/sensitive data involved, so this proxy
 * skips auth entirely (no `backendFetchAuthed`).
 *
 * Does NOT use the shared `backendFetch` helper: that hardcodes a 10s abort
 * timeout tuned for fast DB-backed CRUD calls. An LLM completion — especially
 * the free-tier model currently wired up, which spends tokens on internal
 * reasoning before answering — can legitimately take longer, so 10s caused
 * intermittent false-timeout failures. This route uses its own longer
 * timeout instead of widening the shared default for every other BFF route.
 */

import { NextResponse } from "next/server";
import { getBackendApiUrl } from "@/lib/server/auth";
import { passthroughBackendError } from "@/lib/server/backend-client";

/**
 * LLM completions can run longer than typical CRUD calls — see module
 * docstring. The backend's own openai client is budgeted to stay under this
 * (TIMEOUT_LLM_SEGUNDOS * (1 + MAX_REINTENTOS_LLM) = 24s, see
 * backend/app/servicios_negocio/chatbot_servicio.py), so changing this number
 * means redoing that arithmetic too.
 */
const CHATBOT_TIMEOUT_MS = 30_000;

interface ChatbotRequestBody {
  mensaje: string;
  historial?: Array<{ rol: "usuario" | "asistente"; texto: string }>;
}

interface BackendChatbotResponse {
  respuesta: string;
}

function isChatbotRequestBody(value: unknown): value is ChatbotRequestBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.mensaje !== "string" || v.mensaje.trim().length === 0) return false;
  if (v.historial === undefined) return true;
  if (!Array.isArray(v.historial)) return false;
  return v.historial.every(
    (turno) =>
      typeof turno === "object" &&
      turno !== null &&
      (turno as Record<string, unknown>).rol !== undefined &&
      typeof (turno as Record<string, unknown>).texto === "string",
  );
}

function isBackendChatbotResponse(value: unknown): value is BackendChatbotResponse {
  return typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).respuesta === "string";
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }

  if (!isChatbotRequestBody(body)) {
    return NextResponse.json({ message: "El mensaje del chat es inválido o está vacío." }, { status: 400 });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHATBOT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${getBackendApiUrl()}/chatbot/consultar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mensaje: body.mensaje, historial: body.historial }),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json({ message: "El asistente tardó demasiado en responder." }, { status: 504 });
    }
    return NextResponse.json({ message: "No se pudo contactar al asistente." }, { status: 503 });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    return passthroughBackendError(response, "No se pudo contactar al asistente.");
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return NextResponse.json({ message: "Respuesta del asistente inválida." }, { status: 502 });
  }
  if (!isBackendChatbotResponse(json)) {
    return NextResponse.json({ message: "Respuesta del asistente con forma inesperada." }, { status: 502 });
  }

  return NextResponse.json({ reply: json.respuesta });
}
