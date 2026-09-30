import type { ReactElement, ReactNode } from "react";
import { EmptyState } from "@/components/ui";

interface EmptyGridProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** Aspect ratio of the real cards, so the ghost tiles show where they will go. */
  tileRatio: string;
  /** Ghost tiles drawn on desktop; enough rows to outgrow the tallest rail. */
  tiles: number;
  /** Adds a fourth column from 2xl up, for grids whose real tiles are small. */
  wide?: boolean;
  /** Sizes the card to two rows of ghost tiles instead of filling a rail's height. */
  compact?: boolean;
}

/** Ghost tiles kept on mobile: two rows of the two-column grid. */
const MOBILE_TILES = 4;

/**
 * Empty state for a card grid that sits beside a tall composer rail: one card
 * that fills the column down to the rail's height. Faint placeholder tiles lay
 * out like the real grid (overflow clipped, fading out at the bottom) and the
 * guide sits centered on top of them.
 */
export default function EmptyGrid({
  icon,
  title,
  description,
  tileRatio,
  tiles,
  wide = false,
  compact = false,
}: EmptyGridProps): ReactElement {
  if (compact)
    return (
      <CompactEmptyGrid
        icon={icon}
        title={title}
        description={description}
        tileRatio={tileRatio}
      />
    );
  return (
    <div className="card relative flex flex-1 flex-col overflow-hidden">
      <div
        aria-hidden="true"
        data-testid="empty-grid-tiles"
        className={`grid grid-cols-2 content-start gap-3 p-4 opacity-60 lg:absolute lg:inset-0 lg:grid-cols-3 lg:gap-4${wide ? " 2xl:grid-cols-4" : ""}`}
      >
        {Array.from({ length: tiles }, (_, tile) => (
          <div
            key={tile}
            style={{ aspectRatio: tileRatio }}
            className={`rounded-card border border-dashed border-line bg-sunken ${tile >= MOBILE_TILES ? "hidden lg:block" : ""}`}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-paper to-transparent"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4 lg:relative lg:flex-1">
        <div className="rounded-card border border-line bg-paper/75 backdrop-blur-sm">
          <EmptyState
            surface="inset"
            icon={icon}
            title={title}
            description={description}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Compact empty card. On mobile: a short block of ghost tiles with the guide
 * below. From lg it fills whatever height its column gives it (the ghost tiles
 * are clipped and fade out at the bottom, the guide sits centered on top), so
 * the column can line up with a taller rail beside it.
 */
function CompactEmptyGrid({
  icon,
  title,
  description,
  tileRatio,
}: Omit<EmptyGridProps, "tiles" | "wide" | "compact">): ReactElement {
  return (
    <div className="card relative flex flex-col overflow-hidden lg:min-h-64 lg:flex-1">
      <div
        aria-hidden="true"
        data-testid="empty-grid-tiles"
        className="grid grid-cols-2 content-start gap-3 p-4 opacity-60 lg:absolute lg:inset-0 lg:grid-cols-3 lg:gap-4 2xl:grid-cols-4"
      >
        {Array.from({ length: 12 }, (_, tile) => (
          <div
            key={tile}
            style={{ aspectRatio: tileRatio }}
            className={`rounded-card border border-dashed border-line bg-sunken ${
              tile < MOBILE_TILES ? "" : "hidden lg:block"
            }`}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-1/4 bg-gradient-to-t from-paper to-transparent lg:block"
      />
      <div className="flex justify-center p-4 lg:absolute lg:inset-0 lg:items-center">
        <div className="rounded-card border border-line bg-paper/75 backdrop-blur-sm">
          <EmptyState
            surface="inset"
            icon={icon}
            title={title}
            description={description}
          />
        </div>
      </div>
    </div>
  );
}
