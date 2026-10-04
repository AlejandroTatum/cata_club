import { toUserMessage } from "@/lib/error-message";

/** Mirrors the backend upload rules (JPG/PNG up to 5 MB). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_SERVICE_UNAVAILABLE =
  "El servicio de imágenes no está disponible en este momento. Intenta de nuevo más tarde.";

/** Client-side gate for an image upload: a specific message, or null when the
 * file is acceptable. `noun` is the subject of the sentence ("La foto"). */
export function imageFileError(file: File, noun: string): string | null {
  if (file.type !== "image/jpeg" && file.type !== "image/png")
    return `${noun} debe ser un archivo JPG o PNG.`;
  if (file.size > MAX_IMAGE_BYTES)
    return `${noun} supera el límite de 5 MB. Elige una imagen más liviana.`;
  return null;
}

function statusOf(error: unknown): number | null {
  const status =
    error instanceof Error
      ? (error as Error & { status?: unknown }).status
      : null;
  return typeof status === "number" ? status : null;
}

/**
 * Reports a failed image upload by its cause, never by blaming the file for a
 * server problem: provider/gateway failures read as a service outage; only
 * 400/413/415/422 talk about the file. Session, network and timeout wording
 * comes from the shared translator.
 */
export function uploadErrorMessage(error: unknown, generic: string): string {
  const status = statusOf(error);
  if (status === null) return toUserMessage(error, generic);
  if (status >= 500) return IMAGE_SERVICE_UNAVAILABLE;
  if (status === 400 || status === 422)
    return toUserMessage(error, "Revisa el archivo e intenta de nuevo.");
  if (status === 413)
    return "La imagen supera el tamaño permitido. Elige una imagen más liviana.";
  if (status === 415)
    return "Formato de imagen no admitido. Usa un archivo JPG o PNG.";
  if (status === 401 || status === 403) return toUserMessage(error, generic);
  return generic;
}
