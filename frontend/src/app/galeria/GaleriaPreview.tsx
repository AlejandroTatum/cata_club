import { useEffect, useState } from "react";
import type { ReactElement } from "react";

/**
 * Live preview of the photo being composed, drawn like the landing gallery
 * slide (landing.css `.landing-slide`): the frame takes the photo's own aspect
 * ratio (3:2 until it is known, the landing's `DEFAULT_SLIDE_ASPECT`), the
 * photo covers it, and the title and description sit over a dark gradient
 * rising from the bottom edge, title in uppercase extra-bold. Deliberately
 * local: the landing's styles are not imported. Unlike the landing, the
 * caption is always visible — there is no hover to reveal it.
 */
export interface GaleriaPreviewProps {
  imageUrl: string | null;
  title: string;
  description: string;
}

const DEFAULT_ASPECT = 3 / 2;

export default function GaleriaPreview({ imageUrl, title, description }: GaleriaPreviewProps): ReactElement {
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);

  // A new photo is framed at the default until its own ratio is measured.
  useEffect(() => { setAspect(DEFAULT_ASPECT); }, [imageUrl]);

  return (
    <figure
      style={{ aspectRatio: aspect.toFixed(4) }}
      className="relative m-0 w-full overflow-hidden rounded-card bg-coal"
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob: preview URL, not optimizable by next/image
        <img
          src={imageUrl}
          alt=""
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) setAspect(naturalWidth / naturalHeight);
          }}
          className="block size-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/70">La foto aparecerá aquí al elegirla.</span>
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
