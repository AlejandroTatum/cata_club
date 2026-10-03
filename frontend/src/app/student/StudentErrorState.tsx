/**
 * The student portal's load-failure card.
 *
 * Same card as `ErrorState` (components/ui), but the detail runs through
 * `LinkifiedText` (FAM-21): the user-facing error copy offers the club's
 * WhatsApp as a bare URL, and `ErrorState` only accepts a plain string, so the
 * address showed up as text nobody could tap.
 */

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import LinkifiedText from "@/components/LinkifiedText";
import { ICON } from "@/lib/icon-size";

export default function StudentErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2.5 rounded-card border border-state-bad/25 bg-state-bad-bg px-6 py-9 text-center"
    >
      <span
        aria-hidden="true"
        className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-paper text-state-bad"
      >
        <AlertTriangle size={ICON.lg} strokeWidth={1.5} />
      </span>
      <b className="text-base font-bold text-ink">No se pudo cargar la información</b>
      <p className="max-w-[44ch] text-sm text-ink-2">
        <LinkifiedText text={message} />
      </p>
      <div className="mt-1">
        <Button size="sm" onClick={onRetry}>
          <RefreshCw size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Reintentar
        </Button>
      </div>
    </div>
  );
}
