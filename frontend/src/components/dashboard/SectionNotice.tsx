/**
 * SectionNotice — the soft failure of one block.
 *
 * A dashboard that refuses to load because a secondary list timed out is worse
 * than one missing a card, but a card that silently reads "no activity" when
 * the request failed is a lie. This is the middle: the block stays, says in one
 * line that its data did not arrive, and offers to try again.
 */

import type { ReactElement } from "react";
import { Button } from "@/components/ui";

export interface SectionNoticeProps {
  message: string;
  onRetry?: () => void;
}

export default function SectionNotice({ message, onRetry }: SectionNoticeProps): ReactElement {
  return (
    <div
      role="status"
      data-testid="section-notice"
      className="flex flex-wrap items-center gap-3 px-[18px] py-4 text-sm text-ink-2"
    >
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Reintentar
        </Button>
      ) : null}
    </div>
  );
}
