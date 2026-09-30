import { toCanvas } from "html-to-image";

/** Backend limit for a report screenshot (MAX_CAPTURA). */
export const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
export const CAPTURE_TYPES = ["image/png", "image/jpeg", "image/webp"];

const MAX_WIDTH = 1600;
// Keep a margin under the hard limit: multipart framing adds a few bytes.
const TARGET_BYTES = MAX_CAPTURE_BYTES - 64 * 1024;
const QUALITIES = [0.85, 0.72, 0.58, 0.45];
const SCALES = [1, 0.75, 0.5];

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Elements marked `data-report-ignore` never appear in the capture. */
function keepNode(node: Node): boolean {
  return !(node instanceof HTMLElement && node.hasAttribute("data-report-ignore"));
}

/**
 * Captures the visible viewport of the current page (not the full scroll
 * height) as a JPEG that fits the backend's 2 MB limit. Rejects when the
 * browser cannot render or encode it: callers must fail soft.
 */
export async function captureViewport(): Promise<File> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const source = await toCanvas(document.body, {
    width, height, pixelRatio: 1, filter: keepNode,
    backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
    style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`, transformOrigin: "top left", margin: "0" },
  });
  const base = Math.min(1, MAX_WIDTH / source.width);
  for (const scale of SCALES) {
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(source.width * base * scale));
    out.height = Math.max(1, Math.round(source.height * base * scale));
    const context = out.getContext("2d");
    if (!context) throw new Error("canvas unavailable");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, out.width, out.height);
    context.drawImage(source, 0, 0, out.width, out.height);
    for (const quality of QUALITIES) {
      const blob = await toBlob(out, quality);
      if (blob && blob.size <= TARGET_BYTES) return new File([blob], "captura-pantalla.jpg", { type: "image/jpeg" });
    }
  }
  throw new Error("capture too large");
}
