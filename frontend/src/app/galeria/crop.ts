/**
 * Client-side crop for the gallery photo (ADMB-37).
 *
 * The landing shows each gallery photo in a 3:2 slide, so the admin frames the
 * photo at that ratio before uploading and the file the backend stores is
 * already the framed one. No new image pipeline: the pure geometry lives here,
 * and the canvas export is the only browser-bound step.
 */

/** The ratio the gallery accepts (width / height). */
export const GALERIA_ASPECT = 3 / 2;

/** Widest photo kept after cropping; the cap keeps the file well under 5 MB. */
const MAX_ANCHO_SALIDA = 1800;

/** Tolerance when deciding that a photo is already at the allowed ratio. */
const TOLERANCIA_RATIO = 0.01;

export interface CropView {
  /** 1 = the largest 3:2 window; higher zooms in. */
  zoom: number;
  /** Window position along the free horizontal travel, 0 (left) … 1 (right). */
  x: number;
  /** Window position along the free vertical travel, 0 (top) … 1 (bottom). */
  y: number;
}

export const CROP_INICIAL: CropView = { zoom: 1, x: 0.5, y: 0.5 };
export const ZOOM_MAX = 4;

export interface CropRect { sx: number; sy: number; sw: number; sh: number }

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Whether a photo is already at the allowed ratio (so it needs no crop). */
export function isAllowedRatio(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return Math.abs(width / height / GALERIA_ASPECT - 1) <= TOLERANCIA_RATIO;
}

function ventanaBase(width: number, height: number): { bw: number; bh: number } {
  return width / height > GALERIA_ASPECT
    ? { bw: height * GALERIA_ASPECT, bh: height }
    : { bw: width, bh: width / GALERIA_ASPECT };
}

/** The source rectangle (in photo pixels) the view selects. Always 3:2. */
export function cropRect(width: number, height: number, view: CropView): CropRect {
  const { bw, bh } = ventanaBase(width, height);
  const zoom = Math.min(ZOOM_MAX, Math.max(1, view.zoom));
  const sw = bw / zoom;
  const sh = bh / zoom;
  return { sx: (width - sw) * clamp01(view.x), sy: (height - sh) * clamp01(view.y), sw, sh };
}

/**
 * Drag the photo by a fraction of the frame (dx, dy: 1 = the frame's full
 * width/height). The photo follows the pointer, so the window moves the other
 * way; an axis with no slack stays where it is.
 */
export function moverRecorte(width: number, height: number, view: CropView, dx: number, dy: number): CropView {
  const { sx, sy, sw, sh } = cropRect(width, height, view);
  const libreX = width - sw;
  const libreY = height - sh;
  return {
    zoom: view.zoom,
    x: libreX > 0 ? clamp01((sx - dx * sw) / libreX) : view.x,
    y: libreY > 0 ? clamp01((sy - dy * sh) / libreY) : view.y,
  };
}

/** Exported size for a window `sw` pixels wide: never upscaled, capped, 3:2. */
export function tamanoSalida(sw: number): { width: number; height: number } {
  const width = Math.round(Math.min(sw, MAX_ANCHO_SALIDA));
  return { width, height: Math.round(width / GALERIA_ASPECT) };
}

function cargarImagen(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la foto.")); };
    img.src = url;
  });
}

/**
 * The file to upload: the original when it is already 3:2 and unzoomed,
 * otherwise the framed crop as a new file of the same type.
 */
export async function recortarImagen(file: File, view: CropView): Promise<File> {
  const img = await cargarImagen(file);
  const { naturalWidth: width, naturalHeight: height } = img;
  if (isAllowedRatio(width, height) && view.zoom <= 1) return file;
  const { sx, sy, sw, sh } = cropRect(width, height, view);
  const salida = tamanoSalida(sw);
  const canvas = document.createElement("canvas");
  canvas.width = salida.width;
  canvas.height = salida.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo recortar la foto.");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, salida.width, salida.height);
  const tipo = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, tipo, 0.9));
  if (!blob) throw new Error("No se pudo recortar la foto.");
  return new File([blob], file.name, { type: tipo });
}
