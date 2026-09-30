import type { ReactElement, ReactNode } from "react";
import { EmptyState } from "@/components/ui";

interface EmptyGridProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** Aspect ratio of the real cards, so the ghost tiles show where they will go. */
  tileRatio: string;
}

/**
 * Empty state for a card grid that sits beside a tall composer rail: one card
 * that fills the column down to the rail's height, with faint placeholder
 * tiles at the real card proportions above the guiding message.
 */
export default function EmptyGrid({
  icon,
  title,
  description,
  tileRatio,
}: EmptyGridProps): ReactElement {
  return (
    <div className="card flex flex-1 flex-col gap-4 p-4">
      <div
        aria-hidden="true"
        data-testid="empty-grid-tiles"
        className="grid grid-cols-2 gap-3 opacity-60 lg:grid-cols-3 lg:gap-4"
      >
        {[0, 1, 2].map((tile) => (
          <div
            key={tile}
            style={{ aspectRatio: tileRatio }}
            className={`rounded-card border border-dashed border-line bg-sunken ${tile === 2 ? "hidden lg:block" : ""}`}
          />
        ))}
      </div>
      <EmptyState
        surface="inset"
        icon={icon}
        title={title}
        description={description}
      />
    </div>
  );
}
