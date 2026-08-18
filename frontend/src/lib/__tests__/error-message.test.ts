/**
 * The single translator: every error the user reads comes out of here.
 *
 * These tests pin the two gates described in `error-message.ts` — the status
 * gate and the vocabulary gate — and, more importantly, the CASES that made
 * them necessary. Each block below names a message that was really reaching a
 * screen before this module existed.
 */

import { describe, it, expect } from "vitest";
import { GENERIC_FAILURE, STATUS_MESSAGES, isUserFacingText, toUserMessage } from "../error-message";
import { landingConfig, toWhatsAppLink } from "@/app/landing/landing-config";

/** Shapes an `ApiClientError` without importing the client into `lib/`. */
function apiError(message: string, status: number): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/**
 * Shapes an `ApiClientError` that also carries the `safe` marker
 * (`ApiClientError.safe`, `services/api.ts`) — the only thing that can make a
 * 5xx's own text survive `toUserMessage` instead of the generic fallback.
 */
function apiErrorConSeguro(
  message: string,
  status: number,
  safe: boolean,
): Error & { status: number; safe: boolean } {
  return Object.assign(new Error(message), { status, safe });
}

const FALLBACK = "No se pudo guardar el descuento.";

/**
 * The generic 5xx copy this module answers with whenever `safeOf(error)` is
 * false or the marked text fails gate 2. Read via `toUserMessage`'s own
 * output — not imported — because `SERVER_FAILURE` is module-private on
 * purpose (see `error-message.ts`'s "5xx exception").
 */
const SERVER_FAILURE_TEXT = toUserMessage(apiError("cualquier cosa", 500), FALLBACK);

describe("toUserMessage — the status gate", () => {
  it("never shows the client's own English default", () => {
    // The bug this module exists for. `request()` builds
    // `Request failed with status 502` when a 502 carries no JSON body — a
    // proxy dying, a gateway timing out — and 28 call sites rendered it raw.
    const message = toUserMessage(apiError("Request failed with status 502", 502), FALLBACK);

    expect(message).not.toContain("Request failed");
    expect(message).not.toContain("502");
    expect(message).toBe(SERVER_FAILURE_TEXT);
  });

  it("gives the generic answer to every 5xx with no safe marker, whatever the body said", () => {
    // A 500's `detail` describes the SERVER's failure, never the user's
    // business. There is nothing in it a person can act on, so the status
    // gate drops it before the vocabulary gate ever runs — UNLESS the
    // backend marked it safe (issue #355), which none of these do: a plain
    // `apiError` never sets `.safe`, so `safeOf` reads it as `false`.
    for (const status of [500, 502, 503, 504]) {
      expect(toUserMessage(apiError("psycopg2.OperationalError", status), FALLBACK)).toBe(
        SERVER_FAILURE_TEXT,
      );
    }
  });

  it("gives the generic answer to a 5xx explicitly marked NOT safe (issue #355)", () => {
    const detail =
      "No se pudo subir el archivo en este momento. Vuelva a intentarlo más tarde " +
      "o acérquese al club / escríbanos por WhatsApp.";

    expect(toUserMessage(apiErrorConSeguro(detail, 503, false), FALLBACK)).toBe(
      SERVER_FAILURE_TEXT,
    );
  });

  it("shows the backend's own text on a 5xx marked safe, when it passes the vocabulary gate (issue #355)", () => {
    // The regression this fix exists for: `cloudinary_cliente.py`'s
    // `_MENSAJE_SUBIDA_NO_DISPONIBLE`, the one message in the whole backend
    // marked `seguro_mostrar=True`. Before this fix `toUserMessage` discarded
    // it unconditionally — a legitimate, hand-authored, actionable sentence
    // thrown away for no reason other than its status being 503.
    const detail =
      "No se pudo subir el archivo en este momento. Vuelva a intentarlo más tarde " +
      "o acérquese al club / escríbanos por WhatsApp.";

    expect(toUserMessage(apiErrorConSeguro(detail, 503, true), FALLBACK)).toBe(detail);
  });

  it("still falls back to the generic answer when marked safe but the detail fails gate 2 (fail closed)", () => {
    // Proves the marker alone is never enough: a backend bug that raises
    // `seguro_mostrar=True` with a vendor-leaking string must not reach the
    // user just because the flag says "trust me".
    expect(
      toUserMessage(apiErrorConSeguro("ValueError: Must supply api_key", 503, true), FALLBACK),
    ).toBe(SERVER_FAILURE_TEXT);
  });

  it("still falls back to the generic answer when marked safe but the detail is blank (fail closed)", () => {
    expect(toUserMessage(apiErrorConSeguro("   ", 503, true), FALLBACK)).toBe(SERVER_FAILURE_TEXT);
  });

  it("answers auth and rate limits from the status alone", () => {
    expect(toUserMessage(apiError("Not authenticated", 401), FALLBACK)).toBe(
      "Su sesión expiró. Vuelva a iniciar sesión.",
    );
    expect(toUserMessage(apiError("Forbidden", 403), FALLBACK)).toBe(
      "No tiene permisos para realizar esta acción.",
    );
    expect(toUserMessage(apiError("Too Many Requests", 429), FALLBACK)).toBe(
      "Demasiados intentos. Espere un momento e intente nuevamente.",
    );
  });

  it("describes an upload problem instead of echoing the MIME type", () => {
    // There is no 415/413 in this stack — an oversized or wrong-format upload
    // is refused by `AuthServicio.actualizar_foto_perfil` as `OperacionInvalida`,
    // a 400 (see backend/app/servicios_negocio/auth_servicio.py:157-169). Its
    // Spanish detail is hand-authored, names no implementation, and passes
    // both gates through the INPUT_STATUSES branch — so the user reads it
    // as-is, never a generic line.
    expect(
      toUserMessage(apiError("Formato de archivo no permitido. Use JPG o PNG", 400), FALLBACK),
    ).toBe("Formato de archivo no permitido. Use JPG o PNG");
    expect(
      toUserMessage(apiError("El archivo excede el tamaño máximo de 5MB", 400), FALLBACK),
    ).toBe("El archivo excede el tamaño máximo de 5MB");

    // A raw MIME type would still be caught if one ever leaked into a detail:
    // the vocabulary gate rejects it (English vocabulary too, doubly so) and
    // the user gets the caller's fallback instead of "image/heic".
    expect(
      toUserMessage(apiError("Unsupported media type: image/heic", 400), FALLBACK),
    ).toBe(FALLBACK);
  });

  it("hands a 404 back to the caller, which knows what was missing", () => {
    // The call site's own sentence ("No se pudo cargar el catálogo de
    // descuentos.") beats anything generic this module could invent.
    expect(toUserMessage(apiError("Descuento no encontrado", 404), FALLBACK)).toBe(FALLBACK);
  });
});

describe("toUserMessage — the vocabulary gate", () => {
  it("keeps a business rule the user can act on", () => {
    // The regression this module must NOT cause. A duplicate cédula is the
    // one thing the backend knows and the frontend does not, and it names a
    // field the user filled in by hand.
    const detail = "Ya existe una persona con la cédula 0912345678";

    expect(toUserMessage(apiError(detail, 400), FALLBACK)).toBe(detail);
    expect(toUserMessage(apiError(detail, 409), FALLBACK)).toBe(detail);
  });

  it("drops a message addressed to whoever wrote the endpoint", () => {
    // Same status as the case above, opposite audience. `motivo_rechazo` is a
    // column name; the person reading it never typed those characters.
    expect(
      toUserMessage(apiError("motivo_rechazo es obligatorio al rechazar un pago", 422), FALLBACK),
    ).toBe(FALLBACK);
  });

  it("rejects every shape of implementation vocabulary the backend leaks today", () => {
    // The live inventory, verbatim from the backend's error paths. Fixing
    // them at the source is a separate change; this gate is the last line, so
    // none of them can reach a screen while that fix is pending.
    const leaks = [
      "tipo_cuenta inválido",
      "representante_id no existe",
      "persona_id es obligatorio",
      "fecha_inicio debe ser anterior a fecha_fin",
      "El archivo debe ser image/jpeg o application/pdf",
      "tipo_sangre debe ser uno de TIPO_SANGRE",
      "[{'loc': ['body', 'monto'], 'msg': 'field required'}]",
      "Object of type Decimal is not JSON serializable",
      "Request failed with status 400",
      "value is not a valid integer",
    ];

    for (const leak of leaks) {
      expect(`${leak} → ${toUserMessage(apiError(leak, 422), FALLBACK)}`).toBe(
        `${leak} → ${FALLBACK}`,
      );
    }
  });

  it("refuses a dump even when every word of it is Spanish", () => {
    // Length is its own signal: a paragraph is a log line that escaped, not a
    // sentence somebody wrote for a form.
    const dump = `No se pudo procesar la solicitud. ${"Detalle del contexto. ".repeat(20)}`;

    expect(toUserMessage(apiError(dump, 400), FALLBACK)).toBe(FALLBACK);
  });

  it("puts the length gate where the comment says it is", () => {
    // Pinning both sides of the boundary, because a ceiling far above the
    // longest real message is an untested window, not a safety margin.
    const longest = "Ya existe una persona con esa cédula en el padrón del club.";

    expect(isUserFacingText(longest)).toBe(true);
    expect(isUserFacingText(longest.padEnd(200, "."))).toBe(true);
    expect(isUserFacingText(longest.padEnd(201, "."))).toBe(false);
  });

  it("lets through the longest hand-authored refusal the backend actually sends", () => {
    // The message that moved the ceiling from 120 to 200. Copied verbatim from
    // rol_servicio._asegurar_que_queda_otro_administrador — if the backend
    // rewrites it longer, this goes red before a user loses it to the fallback.
    const refusal =
      "No se puede quitar el rol ADMINISTRADOR: es el último administrador activo del " +
      "sistema y quedaría sin acceso de administración. Asigne el rol " +
      "ADMINISTRADOR a otra cuenta activa antes de continuar.";

    expect(refusal.length).toBeLessThanOrEqual(200);
    expect(toUserMessage(apiError(refusal, 400), FALLBACK)).toBe(refusal);
  });

  it("treats a blank detail as no detail", () => {
    expect(toUserMessage(apiError("   ", 400), FALLBACK)).toBe(FALLBACK);
  });

  it("does not by itself reject the client's own generic placeholder", () => {
    // `GENERIC_FAILURE` passes THIS gate on its own merits: it is short,
    // plain Spanish, and names no implementation. That is exactly the
    // problem this gate cannot solve — it asks "was this written for a
    // person", and a client-authored placeholder answers yes even though no
    // server ever wrote it. The fix has to live in `toUserMessage`, which
    // knows WHERE the text came from; this gate only ever sees the text.
    expect(isUserFacingText(GENERIC_FAILURE)).toBe(true);
  });
});

describe("toUserMessage — the client's own placeholder is not a server sentence", () => {
  it("prefers the caller's fallback over GENERIC_FAILURE, even at an input status", () => {
    // `GENERIC_FAILURE` is what `services/api.ts` sets as an `ApiClientError`'s
    // message when a non-2xx response body does not match `isApiErrorBody` —
    // it carries no information from the server, only the client's own "there
    // was nothing to say". At 400/409/422 it used to reach both gates and win:
    // short enough, plain Spanish, no implementation vocabulary. It beat the
    // caller's own fallback, which at least names the operation ("No se pudo
    // guardar el descuento."). The client's placeholder is "no detail", not
    // "a sentence written for a person" — so it must lose to the fallback the
    // same way a blank `detail` already does.
    expect(toUserMessage(apiError(GENERIC_FAILURE, 409), FALLBACK)).toBe(FALLBACK);
  });

  it("still lets a real business rule through at the same status", () => {
    // Guards the guard: the fix above is an identity check against ONE known
    // string, not a new reason to distrust every INPUT_STATUSES detail.
    const detail = "Ya existe una persona con la cédula 0912345678";

    expect(toUserMessage(apiError(detail, 409), FALLBACK)).toBe(detail);
  });
});

describe("toUserMessage — anything that is not an API error", () => {
  it("never renders a network failure's own words", () => {
    // `request()` does not catch fetch's TypeError, so "Failed to fetch" (or
    // Firefox's "NetworkError when attempting to fetch resource") propagated
    // straight to `err.message` at 28 call sites.
    expect(toUserMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(
      "No pudimos conectar. Revise su conexión a internet e intente nuevamente.",
    );
  });

  it("names the cancellation instead of the DOM exception", () => {
    const aborted = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

    expect(toUserMessage(aborted, FALLBACK)).toBe("La operación se canceló.");
  });

  it("does not call a timeout a cancellation", () => {
    // Both arrive as an abort, and until the client named them apart every
    // slow server read as "se canceló" — a sentence that describes the USER
    // leaving (a navigation, a closed form) and points at no useful action.
    // The two are not interchangeable: one says try again, the other says you
    // already decided not to.
    const timedOut = Object.assign(new Error("The operation was aborted."), {
      name: "TimeoutError",
    });

    expect(toUserMessage(timedOut, FALLBACK)).toBe(
      "Esto está tardando más de lo normal y no pudimos terminarlo. " +
        `Escríbanos por WhatsApp y lo ayudamos: ${toWhatsAppLink(landingConfig.contact.whatsapp[0])}`,
    );
    expect(toUserMessage(timedOut, FALLBACK)).not.toBe("La operación se canceló.");
  });

  it("falls back for a bare Error, which carries a developer's sentence", () => {
    expect(toUserMessage(new Error("Cannot read properties of undefined"), FALLBACK)).toBe(FALLBACK);
  });

  it("falls back for anything that was never an Error at all", () => {
    for (const thrown of [undefined, null, "boom", 42, {}, { status: 400 }]) {
      expect(toUserMessage(thrown, FALLBACK)).toBe(FALLBACK);
    }
  });
});

describe("STATUS_MESSAGES — the table promises nothing this stack cannot send", () => {
  /**
   * Every canned status, with the path that produces it. A message sitting
   * here for a status nobody sends is not a defense: it is a promise the
   * product cannot keep, and it hides the fact that the real failure has no
   * message of its own. That is exactly how `408` survived — it read as "the
   * timeout is handled" while the browser's own 10 s abort, which carries no
   * status at all, was reaching the user as "se canceló".
   *
   * Adding a key without adding its producer here turns this red. If a
   * producer ever disappears, the row goes with it.
   */
  const PRODUCERS: Readonly<Record<number, string>> = {
    401: "backend/app/main.py maps CredencialesInvalidas; every BFF route forwards it",
    403: "backend/app/main.py maps PermisosInsuficientes (e.g. EFECTIVO registered by an admin)",
    429: "backend/app/servicios_negocio/chatbot_servicio.py:162, and the password-recovery routes",
  };

  it("carries a producer for every message it can show", () => {
    expect(Object.keys(STATUS_MESSAGES).sort()).toEqual(Object.keys(PRODUCERS).sort());
  });

  it("leaves an unsendable status to the caller's own sentence", () => {
    // 413 and 415 shared 408's defect. An oversized or wrong-format upload is
    // rejected by `AuthServicio.actualizar_foto_perfil` as `OperacionInvalida`
    // — a 400, whose Spanish detail ("El archivo excede el tamaño máximo de
    // 5MB") already passes both gates and is more specific than the canned
    // line ever was.
    for (const status of [408, 413, 415]) {
      expect(toUserMessage(apiError("", status), FALLBACK)).toBe(FALLBACK);
    }
  });
});

describe("isUserFacingText — the gate on its own", () => {
  it("passes the sentences the product really shows", () => {
    // Guards the guard: if this list ever went empty the gate could reject
    // everything and every test above would still pass on the fallback.
    const real = [
      "Ya existe una persona con la cédula 0912345678",
      "El alumno ya está inscrito en este horario.",
      "No hay cupos disponibles en el nivel seleccionado.",
      "La contraseña actual no es correcta.",
    ];

    for (const text of real) expect(`${text} → ${isUserFacingText(text)}`).toBe(`${text} → true`);
  });

  it("does not mistake an ordinary Spanish slash for a MIME type", () => {
    // This is the case the first version of the gate got wrong, and the first
    // version of THIS test missed it: `01/03/2026` has digits before the
    // slash, so it never exercised the branch that matched letters. Spanish
    // writes `word/word` constantly, and a club's schedules write it most of
    // all — a validation message naming a weekday pair was being swallowed.
    const spanish = [
      "El pago del 01/03/2026 ya fue registrado.",
      "Debe ingresar teléfono y/o correo electrónico.",
      "El horario lunes/miércoles no tiene cupos.",
      "La distancia se registra en km/h.",
      "El campo señor/a es obligatorio.",
    ];

    for (const text of spanish) expect(`${text} → ${isUserFacingText(text)}`).toBe(`${text} → true`);
  });

  it("still catches a real MIME type — the assertion above is not vacuous", () => {
    // The other half. Loosening the pattern until Spanish passes is only a fix
    // if the thing it was written for still fails.
    const mime = [
      "El archivo debe ser image/jpeg.",
      "Solo se acepta application/pdf.",
      "Formato text/csv no soportado.",
    ];

    for (const text of mime) expect(`${text} → ${isUserFacingText(text)}`).toBe(`${text} → false`);
  });

  it("passes the voucher upload's rejected-file-type message (PAG-3), and nothing else moved", () => {
    // The fix for PAG-3 lives in the route that authors this sentence
    // (`app/api/membresias/pagos/[pagoId]/voucher/route.ts`), not here: it
    // stopped echoing the raw MIME type of the rejected file. This test pins
    // the gate's side of the contract — the reworded sentence has to pass —
    // and, just as importantly, that every other real product message this
    // gate was already letting through still does. Six real sentences went
    // into the verification that found PAG-3; five already passed, and this
    // is the sixth, now fixed rather than the gate loosened.
    const realProductMessages = [
      "Ese tipo de archivo no se puede subir. Adjunte una foto (JPG o PNG) o un PDF.", // PAG-3, fixed
      "Ya existe una persona con la cédula 0912345678",
      "El alumno ya está inscrito en este horario.",
      "No hay cupos disponibles en el nivel seleccionado.",
      "La contraseña actual no es correcta.",
      "El horario lunes/miércoles no tiene cupos.",
    ];

    for (const text of realProductMessages) {
      expect(`${text} → ${isUserFacingText(text)}`).toBe(`${text} → true`);
    }
  });
});

describe("the rewritten copy speaks to a member, not to a machine (issue #355)", () => {
  // "servidor" / "operación" / "solicitud" are exactly the system vocabulary
  // the old copy used ("El servidor no pudo completar la operación...",
  // "Demasiadas solicitudes...") — plain-language stand-ins for "internal
  // implementation noun". A standalone 3-digit HTTP-status-like number is the
  // other tell (`\b[1-5]\d{2}\b`, word-bounded on both sides).
  const SYSTEM_WORDS = ["servidor", "operación", "solicitud"];
  const STATUS_LIKE_NUMBER = /\b[1-5]\d{2}\b/;

  function assertPlainLanguage(label: string, text: string): void {
    for (const word of SYSTEM_WORDS) {
      expect(text.toLowerCase(), `${label} contains "${word}": ${text}`).not.toContain(word);
    }
    expect(text, `${label} contains a bare status-like number: ${text}`).not.toMatch(
      STATUS_LIKE_NUMBER,
    );
  }

  it("the word-boundary regex does not false-positive on the WhatsApp digit run", () => {
    // Verifying the reasoning, not just asserting it: the WhatsApp link is a
    // long contiguous digit run with no separators, so a naive "any 3
    // digits" check would flag it as a fake HTTP status. `\b` only lands at
    // the ends of that run, never in its middle, so a WORD-BOUNDED 3-digit
    // match can never land fully inside it.
    const sampleLink = toWhatsAppLink(landingConfig.contact.whatsapp[0]);

    expect(STATUS_LIKE_NUMBER.test(sampleLink)).toBe(false);
    // The check still catches the real thing it exists for.
    expect(STATUS_LIKE_NUMBER.test("hubo un fallo con código 503")).toBe(true);
  });

  it("SERVER_FAILURE (any unmarked 5xx) speaks plainly and points at WhatsApp", () => {
    const text = toUserMessage(apiError("cualquier cosa", 500), FALLBACK);

    assertPlainLanguage("SERVER_FAILURE", text);
    expect(text).toContain(toWhatsAppLink(landingConfig.contact.whatsapp[0]));
  });

  it("TIMED_OUT speaks plainly and points at WhatsApp", () => {
    const timedOut = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const text = toUserMessage(timedOut, FALLBACK);

    assertPlainLanguage("TIMED_OUT", text);
    expect(text).toContain(toWhatsAppLink(landingConfig.contact.whatsapp[0]));
  });

  it("GENERIC_FAILURE (the client's own placeholder) speaks plainly and points at WhatsApp", () => {
    // Exported, unlike the other four — imported directly rather than
    // derived through `toUserMessage`, which never returns it as-is (see
    // "the client's own placeholder is not a server sentence" above).
    assertPlainLanguage("GENERIC_FAILURE", GENERIC_FAILURE);
    expect(GENERIC_FAILURE).toContain(toWhatsAppLink(landingConfig.contact.whatsapp[0]));
  });

  it("NETWORK_FAILURE speaks plainly and keeps the advice, not the club contact", () => {
    const text = toUserMessage(new TypeError("Failed to fetch"), FALLBACK);

    assertPlainLanguage("NETWORK_FAILURE", text);
    // Can-act family: the member can act on their own connection, so this
    // one does NOT need to send them to WhatsApp.
    expect(text).not.toContain("wa.me");
  });

  it("the 429 message speaks plainly", () => {
    assertPlainLanguage("STATUS_MESSAGES[429]", STATUS_MESSAGES[429]);
  });
});
