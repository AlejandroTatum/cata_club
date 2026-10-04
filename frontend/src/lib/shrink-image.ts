/**
 * Shrinks a phone photo in the browser (canvas, JPEG) so it fits an upload cap.
 *
 * Phone cameras produce photos well over 5 MB, and a receipt only has to stay
 * readable, so the long side is capped at `MAX_IMAGE_SIDE` and the JPEG quality
 * is lowered step by step until the result fits. It rejects when it cannot
 * (no canvas support, an undecodable image, still too big at the lowest
 * quality); callers fall back to their regular size message.
 */

/** Long side, in pixels, a shrunk image is scaled down to. */
export const MAX_IMAGE_SIDE = 2000;

const QUALITIES = [0.85, 0.7, 0.55, 0.4];

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function shrinkImage(file: File, maxBytes: number): Promise<File> {
  if (typeof createImageBitmap !== "function") throw new Error("Image decoding is not supported");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not supported");
    // A PNG with transparency would turn black as a JPEG.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of QUALITIES) {
      const blob = await toJpeg(canvas, quality);
      if (blob && blob.size <= maxBytes) {
        return new File([blob], file.name.replace(/\.[^./\\]+$/, "") + ".jpg", { type: "image/jpeg" });
      }
    }
    throw new Error("The image is still over the limit at the lowest quality");
  } finally {
    bitmap.close?.();
  }
}
