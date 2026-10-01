/**
 * The guardian's family strip — every dependent as an equal-width card with the
 * one fact a family checks first (is this child covered), and the click that
 * switches the screen to that child.
 *
 * It replaces the dropdown on `/student` when the account manages two or more
 * profiles: a select hides everyone but one, so a guardian could not see that a
 * different child's cuota had lapsed without opening it. The status comes from
 * `MembershipSummary.cubiertoHasta`, already in the portal summary — this adds
 * no request. The selection contract is the picker's own (`?alumno=`, see
 * `ManagedStudentPicker`), which this only drives through `onChange`.
 *
 * The cards share the row equally (one column per dependent, four at most, one
 * column on a phone) so the strip fills its line instead of leaving two chips
 * huddled at the left of an empty one.
 */

"use client";

import { Badge, cn } from "@/components/ui";
import type { StudentProfileSummary } from "@/services/api";
import { describeFamilyCoverage, personInitials } from "./student-utils";

export interface FamilyStripProps {
  profiles: StudentProfileSummary[];
  value: string;
  onChange: (personaId: string) => void;
  /** Injected for tests; the strip reads the clock otherwise. */
  today?: Date;
}

/** Static class names, so Tailwind can see every one of them. */
const LG_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
};

export default function FamilyStrip({
  profiles,
  value,
  onChange,
  today,
}: FamilyStripProps): React.ReactElement | null {
  if (profiles.length < 2) return null;

  return (
    <div
      role="group"
      aria-label="Estudiante"
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2",
        LG_COLUMNS[Math.min(profiles.length, 4)],
      )}
    >
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
              "flex min-h-[64px] min-w-0 items-center gap-3 rounded-ctl border bg-paper px-4 py-3 text-left transition-colors",
              selected
                ? "border-ink ring-1 ring-ink"
                : "border-line-2 hover:border-ink-3",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-bold",
                selected ? "bg-coal text-white" : "bg-canvas text-ink-2",
              )}
            >
              {personInitials(profile.nombres, profile.apellidos)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">
                {profile.nombres} {profile.apellidos}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                {profile.membership?.categoria ? (
                  <span className="truncate text-xs text-ink-3-strong">
                    {profile.membership.categoria}
                  </span>
                ) : null}
                <Badge tone={status.tone}>{status.label}</Badge>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
