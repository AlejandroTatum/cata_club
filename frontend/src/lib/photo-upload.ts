/**
 * The one place a persona photo upload's pre-flight and failure handling live.
 *
 * There are TWO endpoints behind this module, and they are deliberately not
 * one: `POST /auth/me/foto` (`subirFotoPerfil`) is always the caller's OWN
 * photo, while `POST /personas/{id}/foto` (`subirFotoPersona`) may be a
 * represented minor's and is authorized differently. What must NOT differ
 * between them is everything around the request — which files may be sent,
 * and what a failure reads like. Before this module each surface re-derived
 * that for itself: `/profile` carried the MIME/size allow-list inline, the
 * carnet uploaded with no pre-check at all, and the two `catch` blocks held
 * two near-identical sentences. A third upload surface would have made it
 * three, which is the point at which "remember to copy the validation" stops
 * working.
 *
 * ## What is shared, and what is not
 *
 * `subirFotoDeArchivo` owns the request and its failure: it runs the upload
 * and turns anything thrown into one sentence through `toUserMessage`, using
 * the caller's own fallback (only the caller knows whether the operation was
 * "su foto de perfil" or "la foto de un dependiente"). `revisarFoto` exposes
 * the allow-list so a surface can refuse an invalid file without a round trip.
 *
 * The pre-check stays OPT-IN, and that asymmetry is preserved rather than
 * flattened: `/profile` calls `revisarFoto` before uploading, the carnet does
 * not. Sending the file and letting the backend refuse it is the behavior the
 * carnet has today (the backend re-validates the same allow-list either way),
 * and this refactor is not the place to change which sentence a guardian
 * reads. Unifying the code must not silently reword an error.
 *
 * ## Why the messages are constants
 *
 * The two refusals are user-facing copy, and `/profile` renders them inline.
 * Exporting them keeps the wording in one place — the same reason the
 * allow-list is here and not at each call site.
 */
import { toUserMessage } from "@/lib/error-message";

/**
 * Mirrors the backend's own allow-list (`TIPOS_MIME_PERMITIDOS_FOTO_PERFIL` /
 * `TAMANO_MAXIMO_FOTO_PERFIL_BYTES` in `auth_servicio.py`) so an invalid file
 * is rejected immediately, without a round trip to the server.
 */
export const TIPOS_FOTO_PERMITIDOS: ReadonlySet<string> = new Set(["image/jpeg", "image/png"]);
export const TAMANO_MAXIMO_FOTO_BYTES = 5 * 1024 * 1024;

/** The two refusals `revisarFoto` can make before any request leaves the browser. */
export const FOTO_FORMATO_INVALIDO = "Formato no válido. Solo se permiten imágenes JPG o PNG.";
export const FOTO_TAMANO_EXCEDIDO = "La imagen supera el tamaño máximo permitido (5 MB).";

/**
 * Whether a file may go to the server, as the sentence to show when it may
 * not, or `null` when it may.
 *
 * Returns the message rather than a boolean so a caller cannot forget which
 * refusal it is reporting, and so the copy has exactly one home.
 */
export function revisarFoto(archivo: File): string | null {
  if (!TIPOS_FOTO_PERMITIDOS.has(archivo.type)) return FOTO_FORMATO_INVALIDO;
  if (archivo.size > TAMANO_MAXIMO_FOTO_BYTES) return FOTO_TAMANO_EXCEDIDO;
  return null;
}

/**
 * What an upload attempt produced: the caller's own success value, or the one
 * sentence the reader should see.
 *
 * A result rather than a throw, because the callers own their own UI state
 * (`uploading`, inline error, toast) and a re-thrown error would arrive at
 * their `catch` stripped of the status and `safe` marker `toUserMessage`
 * reads — the fallback would then replace the backend's own specific sentence.
 */
export type FotoUploadResult<T> =
  | { status: "uploaded"; value: T }
  | { status: "failed"; message: string };

/**
 * Runs one photo upload and normalizes every way it can fail.
 *
 * @param archivo      The file the user picked. The caller has already read it
 *                     out of the input and cleared the input's value.
 * @param subir        The endpoint call. Passed as a function so the two
 *                     endpoints above (and any future surface) share this
 *                     outcome shape without sharing a route.
 * @param mensajeError What THIS operation says when the error carries nothing
 *                     the user can act on.
 */
export async function subirFotoDeArchivo<T>(
  archivo: File,
  subir: (archivo: File) => Promise<T>,
  mensajeError: string,
): Promise<FotoUploadResult<T>> {
  try {
    return { status: "uploaded", value: await subir(archivo) };
  } catch (error: unknown) {
    return { status: "failed", message: toUserMessage(error, mensajeError) };
  }
}
