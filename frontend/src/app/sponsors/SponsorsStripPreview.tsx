import type { ReactElement } from "react";
import type { Sponsor } from "@/services/api";

interface SponsorsStripPreviewProps {
  sponsors: Sponsor[];
  /** A short roster gets three big tiles per row; a long one packs smaller tiles. */
  few?: boolean;
}

/** Same ~5:2 tile the landing strip draws (landing.css `.landing-sponsor`). */
const TILE_STYLE = { aspectRatio: "5 / 2" } as const;
const TILE = "w-full overflow-hidden rounded-card border bg-sunken";
/** Ghost tiles shown while the roster is empty: enough to show the strip's rhythm. */
const GHOST_TILES = 4;

/**
 * Static mirror of the landing's sponsors strip: the same roster in the same
 * order, each logo `object-contain` on a neutral tile with the name as alt
 * text. The landing scrolls it as a marquee; here it is a plain row so the
 * admin sees every logo at once.
 */
export default function SponsorsStripPreview({
  sponsors,
  few = false,
}: SponsorsStripPreviewProps): ReactElement {
  return (
    <section
      aria-labelledby="sponsors-strip-title"
      className="card flex min-w-0 flex-col gap-4 p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 id="sponsors-strip-title" className="text-sm font-semibold">
          Así se ve en el sitio
        </h2>
        <p className="text-xs text-ink-2">
          {sponsors.length === 0
            ? "Cuando suba el primer logo, aparecerá aquí tal como lo verá el público."
            : "La franja de patrocinadores de la landing: los mismos logos, en este mismo orden."}
        </p>
      </div>
      <div
        data-testid="sponsors-strip"
        className={`grid grid-cols-2 gap-3 ${sponsors.length === 0 ? "sm:grid-cols-4" : few ? "sm:grid-cols-3" : "sm:grid-cols-4 2xl:grid-cols-6"}`}
      >
        {sponsors.length === 0
          ? Array.from({ length: GHOST_TILES }, (_, tile) => (
              <div
                key={tile}
                aria-hidden="true"
                data-testid="sponsors-strip-ghost"
                style={TILE_STYLE}
                className={`${TILE} border-dashed border-line opacity-60`}
              />
            ))
          : sponsors.map((sponsor) => (
              <div
                key={sponsor.id}
                style={TILE_STYLE}
                className={`${TILE} flex items-center justify-center border-line`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- external Cloudinary URL, not a local/static asset */}
                <img
                  src={sponsor.logoUrl}
                  alt={sponsor.nombre}
                  loading="lazy"
                  width={312}
                  height={120}
                  className="size-full object-contain p-2"
                />
              </div>
            ))}
      </div>
    </section>
  );
}
