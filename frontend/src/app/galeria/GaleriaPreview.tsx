import type { ReactElement } from "react";

/**
 * Live preview of the photo being composed. It copies the visual treatment of
 * the landing gallery slide (photo at its native aspect ratio with the title
 * and description laid over a dark gradient) so the admin sees what visitors
 * will see. Deliberately local: the landing's styles are not imported. Unlike
 * the landing, the caption is always visible — there is no hover to reveal it.
 */
export interface GaleriaPreviewProps {
  imageUrl: string | null;
  title: string;
  description: string;
}

export default function GaleriaPreview({ imageUrl, title, description }: GaleriaPreviewProps): ReactElement {
  return (
    <figure className="relative m-0 flex min-h-48 items-center justify-center overflow-hidden rounded-card bg-coal">
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- local blob: preview URL, not optimizable by next/image
        <img src={imageUrl} alt="" className="block h-auto max-h-96 w-full object-contain" />
      ) : (
        <span className="px-6 py-16 text-center text-sm text-white/70">La vista previa aparecerá al elegir una foto.</span>
      )}
      {imageUrl || title || description ? (
        <figcaption className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-coal/80 to-transparent px-5 pb-5 pt-10">
          <span className="text-base font-extrabold uppercase tracking-wide text-white">{title || "Título de la foto"}</span>
          <span className="text-sm text-white/80">{description || "La descripción aparecerá aquí."}</span>
        </figcaption>
      ) : null}
    </figure>
  );
}
