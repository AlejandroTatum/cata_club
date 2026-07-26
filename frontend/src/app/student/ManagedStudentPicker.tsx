/**
 * The guardian → dependent switcher, and the selection state behind it.
 *
 * Three family screens ask the same question — "whose account am I looking
 * at?" — and each used to answer it with its own copy of the select, its own
 * `useState`, and its own effect to re-anchor the selection when the profile
 * list changes. `/student` and `/student/payments` had already drifted apart
 * (different label, different control height, different focus ring), which is
 * the drift a third screen would have tripled.
 *
 * ## The selection is route state, not screen state
 *
 * It used to be a plain `useState` per screen, so it died on every navigation:
 * a guardian who picked her 16-year-old on `/student` and clicked "Pagos" in
 * the sidebar landed on the 10-year-old's plan, amount and payment history
 * with nothing on screen saying the subject had changed — one click away from
 * registering money against the wrong child.
 *
 * So the selection now lives in the URL, as `?alumno=<personaId>`. That makes
 * it visible ("this page is about persona 4"), shareable and back/forward
 * correct. But the sidebar's "Pagos" and "Asistencias" rows are plain
 * `/student/...` links and cannot carry it, so the URL alone would still lose
 * the selection on exactly the path that broke. `sessionStorage`, keyed by the
 * account, closes that gap: it is the fallback the page reads when it arrives
 * without a param, and the page immediately writes the resolved id back into
 * the address bar. Precedence is param → stored → first profile, so a shared
 * link always wins over whatever the recipient last looked at.
 *
 * The hook is the load-bearing half: `managedProfiles` is derived on every
 * render, so anchoring the selection to it needs the id-list comparison below
 * rather than a reference check.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import type { StudentPortalSummary, StudentProfileSummary } from "@/services/api";

/** The query parameter that names the profile a family screen is about. */
export const SELECTED_STUDENT_PARAM = "alumno";

/**
 * Per-account, per-tab. `sessionStorage` rather than `localStorage` because a
 * dependent selection is a working context, not a preference: a family member
 * opening the portal in a new tab tomorrow should land on the account's first
 * profile, not on whoever was on screen last week.
 */
function storageKeyFor(accountPersonaId: string): string {
  return `cata:student-portal:alumno:${accountPersonaId}`;
}

function readStoredSelection(accountPersonaId: string): string | null {
  if (!accountPersonaId || typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(storageKeyFor(accountPersonaId));
  } catch {
    // Private-mode / storage-disabled browsers throw on access. The URL param
    // still carries the selection within a screen; losing the fallback is not
    // worth taking the portal down.
    return null;
  }
}

function writeStoredSelection(accountPersonaId: string, personaId: string): void {
  if (!accountPersonaId || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKeyFor(accountPersonaId), personaId);
  } catch {
    /* see readStoredSelection */
  }
}

export interface ManagedProfilesState {
  /** The account's own profile first (when it has one), then every dependent. */
  managedProfiles: StudentProfileSummary[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  /** The profile the screen is currently about, or `null` when the account manages nobody. */
  selectedProfile: StudentProfileSummary | null;
}

/**
 * Resolve which profiles this account manages and which one is selected.
 *
 * A representante with no ALUMNO role of their own is not in the list: they
 * have no student profile to show, and putting their name at the top of a
 * switcher that then renders an empty carnet is worse than leaving them out.
 *
 * @param accountPersonaId the persona behind the SESSION — the storage scope,
 *   so two accounts sharing a browser never inherit each other's selection.
 */
export function useManagedProfiles(
  data: StudentPortalSummary,
  hasAlumnoRole: boolean,
  accountPersonaId: string,
): ManagedProfilesState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramId = searchParams.get(SELECTED_STUDENT_PARAM);

  const managedProfiles: StudentProfileSummary[] =
    hasAlumnoRole && data.self ? [data.self, ...data.representados] : data.representados;

  const profileIds = managedProfiles.map((profile) => profile.personaId).join(",");
  const manages = useCallback(
    (id: string | null): id is string =>
      id !== null && id !== "" && profileIds.split(",").includes(id),
    [profileIds],
  );

  // Every consumer of this hook mounts only after its portal fetch has
  // resolved, i.e. on the client, so reading storage in the initializer cannot
  // desynchronise a server render — and it avoids a frame of the wrong child.
  const [selectedId, setSelectedId] = useState<string>(() => {
    if (paramId !== null && managedProfiles.some((p) => p.personaId === paramId)) return paramId;
    const stored = readStoredSelection(accountPersonaId);
    if (stored !== null && managedProfiles.some((p) => p.personaId === stored)) return stored;
    return managedProfiles[0]?.personaId ?? "";
  });

  /**
   * The last param value this hook either adopted or wrote itself. It is what
   * separates "the URL changed under us" (a shared link, Back, Forward — adopt
   * it) from "we just changed the URL" (ignore the echo), which is the loop
   * every URL-backed state has to break.
   */
  const syncedParamRef = useRef<string | null>(paramId);

  useEffect(() => {
    if (paramId === syncedParamRef.current) return;
    syncedParamRef.current = paramId;
    if (manages(paramId)) setSelectedId(paramId);
  }, [paramId, manages]);

  // Push the resolved selection into the address bar, preserving whatever else
  // is there — `/student/payments?registrar=1` is the home band's "this reader
  // came here to pay", and dropping it would close the form it just opened.
  useEffect(() => {
    if (!selectedId || selectedId === paramId) return;
    syncedParamRef.current = selectedId;
    const next = new URLSearchParams(searchParams.toString());
    next.set(SELECTED_STUDENT_PARAM, selectedId);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [selectedId, paramId, pathname, router, searchParams]);

  useEffect(() => {
    if (selectedId) writeStoredSelection(accountPersonaId, selectedId);
  }, [selectedId, accountPersonaId]);

  useEffect(() => {
    if (!managedProfiles.some((profile) => profile.personaId === selectedId)) {
      setSelectedId(managedProfiles[0]?.personaId ?? "");
    }
    // Re-anchor only when the SET of managed ids changes — `managedProfiles`
    // is a fresh array on every render, so it cannot be the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileIds]);

  const selectedProfile =
    managedProfiles.find((profile) => profile.personaId === selectedId) ??
    managedProfiles[0] ??
    null;

  return { managedProfiles, selectedId, setSelectedId, selectedProfile };
}

/**
 * Append the selected profile to a family-portal link, so a CTA that leaves the
 * screen keeps talking about the same child.
 */
export function withSelectedStudent(href: string, personaId: string): string {
  if (!personaId) return href;
  const [path, query = ""] = href.split("?");
  const params = new URLSearchParams(query);
  params.set(SELECTED_STUDENT_PARAM, personaId);
  return `${path}?${params.toString()}`;
}

export interface ManagedStudentPickerProps {
  id: string;
  profiles: StudentProfileSummary[];
  value: string;
  onChange: (personaId: string) => void;
}

/**
 * The switcher itself. Renders nothing for a single profile — a select with
 * one option is a control that cannot do anything.
 *
 * 40px (`h-ctl`) and a 10px radius (`rounded-ctl`) like every other control in
 * the system, with the `ball` focus ring `_sistema.css:80` specifies.
 *
 * The note beside it is the fix stated out loud. A guardian who once watched
 * this choice evaporate between two screens has no way to tell from the screen
 * that it no longer does, and the whole point of the control is that she can
 * trust whose money she is about to move.
 */
export default function ManagedStudentPicker({
  id,
  profiles,
  value,
  onChange,
}: ManagedStudentPickerProps): React.ReactElement | null {
  if (profiles.length < 2) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <label
        htmlFor={id}
        className="text-[10.5px] font-bold uppercase tracking-[0.13em] text-ink-3-strong"
      >
        Estudiante
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-ctl appearance-none rounded-ctl border border-line-2 bg-paper pl-3.5 pr-10 text-[13px] font-semibold text-ink"
        >
          {profiles.map((profile) => (
            <option key={profile.personaId} value={profile.personaId}>
              {profile.nombres} {profile.apellidos}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
      </div>
      <p className="text-[12.5px] text-ink-3-strong">
        Se mantiene en Mi cuenta, Pagos y Asistencias hasta que usted lo cambie.
      </p>
    </div>
  );
}
