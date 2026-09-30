/**
 * The guardian's family strip — every dependent on one row with the one fact a
 * family checks first (is this child covered), and the click that switches the
 * screen to that child.
 *
 * It replaces the dropdown on `/student` when the account manages two or more
 * profiles: a select hides everyone but one, so a guardian could not see that a
 * different child's cuota had lapsed without opening it. The status comes from
 * `MembershipSummary.cubiertoHasta`, already in the portal summary — this adds
 * no request. The selection contract is the picker's own (`?alumno=`, see
 * `ManagedStudentPicker`), which this only drives through `onChange`.
 */

"use client";

import { cn } from "@/components/ui";
import type { StudentProfileSummary } from "@/services/api";
import { describeFamilyCoverage } from "./student-utils";

export interface FamilyStripProps {
  profiles: StudentProfileSummary[];
  value: string;
  onChange: (personaId: string) => void;
  /** Injected for tests; the strip reads the clock otherwise. */
  today?: Date;
}

const DOT: Record<"ok" | "warn" | "bad" | "neutral", string> = {
  ok: "bg-state-ok",
  warn: "bg-state-warn",
  bad: "bg-state-bad",
  neutral: "bg-ink-3",
};

export default function FamilyStrip({
  profiles,
  value,
  onChange,
  today,
}: FamilyStripProps): React.ReactElement | null {
  if (profiles.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="group" aria-label="Estudiante" className="flex flex-wrap gap-2">
        {profiles.map((profile) => {
          const status = describeFamilyCoverage(profile.membership, today);
          const selected = profile.personaId === value;
          return (
            <button
              key={profile.personaId}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(profile.personaId)}
              className={cn(
                "flex min-h-[44px] flex-col items-start justify-center rounded-ctl border px-3.5 py-1.5 text-left",
                selected ? "border-ink bg-paper" : "border-line-2 bg-paper hover:border-ink-3",
              )}
            >
              <span className="text-sm font-semibold text-ink">
                {profile.nombres} {profile.apellidos}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-ink-2">
                <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", DOT[status.tone])} />
                {status.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
