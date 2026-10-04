import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import { GALERIA_ASPECT, cropRect, moverRecorte, type CropView } from "./crop";

/**
 * Live preview of the photo being composed, drawn like the landing gallery
 * slide (landing.css `.landing-slide`): the frame takes the photo's own aspect
 * ratio (3:2 until it is known, the landing's `DEFAULT_SLIDE_ASPECT`), the
 * photo covers it, and the title and description sit over a dark gradient
 * rising from the bottom edge, title in uppercase extra-bold. Deliberately
 * local: the landing's styles are not imported. Unlike the landing, the
 * caption is always visible — there is no hover to reveal it.
 *
 * With `crop` the frame is the crop window (ADMB-37): fixed at the gallery's
 * 3:2, the photo is positioned by the view and can be dragged (or moved with
 * the arrow keys) to choose the framing.
 */
export interface GaleriaPreviewProps {
  imageUrl: string | null;
  title: string;
  description: string;
  crop?: { view: CropView; onChange: (view: CropView) => void };
}

/** Arrow-key step, as a fraction of the frame. */
const PASO_TECLADO = 0.05;

const DEFAULT_ASPECT = 3 / 2;

export default function GaleriaPreview({ imageUrl, title, description, crop }: GaleriaPreviewProps): ReactElement {
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const arrastre = useRef<{ x: number; y: number } | null>(null);

  // A new photo is framed at the default until its own ratio is measured.
  useEffect(() => { setAspect(DEFAULT_ASPECT); setNatural(null); }, [imageUrl]);

  const ventana = crop && natural ? cropRect(natural.w, natural.h, crop.view) : null;

  function mover(dx: number, dy: number): void {
    if (crop && natural) crop.onChange(moverRecorte(natural.w, natural.h, crop.view, dx, dy));
  }
  function alPresionar(e: PointerEvent<HTMLElement>): void {
    arrastre.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function alArrastrar(e: PointerEvent<HTMLElement>): void {
    const previo = arrastre.current;
    const { width, height } = e.currentTarget.getBoundingClientRect();
    if (!previo || width === 0 || height === 0) return;
    mover((e.clientX - previo.x) / width, (e.clientY - previo.y) / height);
    arrastre.current = { x: e.clientX, y: e.clientY };
  }
  function alTeclear(e: KeyboardEvent<HTMLElement>): void {
    const paso = { ArrowLeft: [PASO_TECLADO, 0], ArrowRight: [-PASO_TECLADO, 0], ArrowUp: [0, PASO_TECLADO], ArrowDown: [0, -PASO_TECLADO] }[e.key];
    if (!paso) return;
    e.preventDefault();
    mover(paso[0], paso[1]);
  }

  // Nothing chosen or typed yet: the same light placeholder the sponsors composer uses.
  const empty = !imageUrl && !title && !description;

  return (
    <figure
      style={{ aspectRatio: (crop ? GALERIA_ASPECT : aspect).toFixed(4) }}
      className={`relative m-0 w-full overflow-hidden rounded-card ${empty ? "border border-line bg-sunken" : "bg-coal"} ${crop ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
      {...(crop ? {
        tabIndex: 0,
        "aria-label": "Encuadre de la foto: arrastra o usa las flechas",
        onPointerDown: alPresionar,
        onPointerMove: alArrastrar,
        onPointerUp: () => { arrastre.current = null; },
        onPointerCancel: () => { arrastre.current = null; },
        onKeyDown: alTeclear,
      } : {})}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob: preview URL, not optimizable by next/image
        <img
          src={imageUrl}
          alt=""
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) {
              setAspect(naturalWidth / naturalHeight);
              setNatural({ w: naturalWidth, h: naturalHeight });
            }
          }}
          draggable={false}
          style={ventana && natural ? {
            position: "absolute",
            maxWidth: "none",
            width: `${(natural.w / ventana.sw) * 100}%`,
            height: `${(natural.h / ventana.sh) * 100}%`,
            left: `${(-ventana.sx / ventana.sw) * 100}%`,
            top: `${(-ventana.sy / ventana.sh) * 100}%`,
          } : undefined}
          className={ventana ? "block select-none" : "block size-full object-cover"}
        />
      ) : (
        <span className={`absolute inset-0 flex items-center justify-center px-4 text-center text-xs ${empty ? "text-ink-2" : "text-white/70"}`}>La foto aparecerá aquí al elegirla.</span>
      )}
      {imageUrl || title || description ? (
        <figcaption className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-coal/80 to-transparent px-4 pb-4 pt-10">
          <span className="line-clamp-2 text-base font-extrabold uppercase tracking-wide text-white">{title || "Título de la foto"}</span>
          <span className="line-clamp-3 text-sm text-white/80">{description || "La descripción aparecerá aquí."}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
