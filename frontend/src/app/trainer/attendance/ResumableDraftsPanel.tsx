import { ChevronRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Button } from "@/components/ui";
import type { PendingConfirmation } from "./useLeaveGuard";
import type { StoredAttendanceDraft } from "./attendance-utils";

interface ResumableDraftsPanelProps {
  resumableDrafts: StoredAttendanceDraft[];
  describeSchedule: (horarioId: number) => string;
  onResumeDraft: (draft: StoredAttendanceDraft) => void;
  onDiscardDraft: (confirmation: PendingConfirmation) => void;
  rosterLoading: boolean;
}

/**
 * The way back into an interrupted roll call. It says what is in the draft
 * before asking the trainer to act on it, and offers both directions — resume
 * it, or throw it away — because an offer you cannot decline is just a slower
 * version of restoring it automatically.
 */
export default function ResumableDraftsPanel({
  resumableDrafts,
  describeSchedule,
  onResumeDraft,
  onDiscardDraft,
  rosterLoading,
}: ResumableDraftsPanelProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-ctl border border-line bg-canvas p-4">
      <p className="text-sm font-bold text-ink">
        {resumableDrafts.length === 1
          ? "Tiene una lista sin terminar"
          : `Tiene ${resumableDrafts.length} listas sin terminar`}
      </p>
      <ul className="flex flex-col gap-3">
        {resumableDrafts.map((draft) => (
          <li key={draft.key} className="flex flex-wrap items-center gap-x-3 gap-y-field">
            <span className="min-w-[180px] flex-1 text-sm text-ink-2">
              <b className="font-semibold text-ink">{describeSchedule(draft.horarioId)}</b>
              <span aria-hidden="true"> · </span>
              {draft.markCount === 1 ? "1 alumno marcado" : `${draft.markCount} alumnos marcados`}
            </span>
            <Button
              type="button"
              variant="dark"
              onClick={() => onResumeDraft(draft)}
              disabled={rosterLoading}
            >
              Retomar la lista
              <ChevronRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="tertiary"
              onClick={() =>
                onDiscardDraft({
                  kind: "discard-draft",
                  draftKey: draft.key,
                  label: describeSchedule(draft.horarioId),
                  markCount: draft.markCount,
                })
              }
            >
              Descartar
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
