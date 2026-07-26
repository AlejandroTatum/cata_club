/**
 * Trainer Attendance — "Pasar lista"
 * (`docs/ux/prototipos/20-tomar-lista.html`).
 *
 * Three steps, backed by real data end to end:
 *   - Horario selection from `GET /api/attendance/schedules`, with the roster
 *     loaded from that Horario's assigned alumnos
 *     (`GET /api/groups/horarios/:id/alumnos`).
 *   - Marking, on 48px single-line fiches.
 *   - Confirmation + persistence via `POST /api/attendance/records`.
 *
 * Domain rules: a Horario is not owned by one trainer, any trainer may file a
 * session, and the system records who did.
 *
 * ## Data-integrity guarantees this screen must never lose
 *
 * The roster starts on `DEFAULT_ATTENDANCE` ("present"), because a session is
 * overwhelmingly "everyone showed up" and starting from nothing turned 40
 * students into 40 obligatory taps.
 *
 * That default does NOT remove the risk it replaced, it turns it around: the
 * old `absent` default let a trainer file a whole session as a no-show by
 * tapping straight through, and a `present` default lets them file students as
 * having attended without ever looking at them — including students on roster
 * page 2 they never scrolled to. So the roll call separates the VALUE from the
 * DECISION and never conflates the two:
 *   - `SessionStudent.reviewed` says whether a human touched the row. Every
 *     path that sets a state sets it: the fiche tap, the four controls,
 *     "Marcar restantes presentes", a record already saved for this session,
 *     and a restored draft entry.
 *   - `countUnreviewed` spans the FULL roster, never the visible page or the
 *     name filter, and both the roll call and the confirmation step show it.
 *   - An unreviewed fiche is visibly provisional (dashed outline, dashed state
 *     chip, "sin revisar" in its accessible name), and "Ver solo sin revisar"
 *     turns the count into a way to actually go clear it.
 *   - The confirmation step says "N de M siguen en Presente porque nadie los
 *     revisó" instead of reporting "45 presentes" identically either way, and
 *     offers to go back. It informs; it does not block — the trainer asked for
 *     a default, and a default that blocks is not one.
 *   - Tapping a fiche cycles the state, but `cycleWizardAttendance` can never
 *     return to `UNMARKED`, and the four explicit 44px controls stay present
 *     and stay a `radiogroup` — the tap is an accelerator, not a replacement.
 *   - The draft in `sessionStorage` only ever persists REVIEWED rows in one of
 *     the four REAL states, keyed by horario + date, so a refresh can never
 *     launder "nobody looked" into "confirmed"; see the rules block in
 *     `attendance-utils.ts`. Every way back INTO the flow — the browser's Back
 *     button, a reload, the resume offer on step 1 — goes through that same
 *     draft, so none of them can restore a row nobody decided.
 *   - The `UNMARKED` sentinel still never reaches the API: `toAttendanceMarks`
 *     strips it and the submit refuses while `countUnmarked` is non-zero.
 *
 * ## What the audit found, and where it is answered
 *
 *   - 40 simultaneous targets on one screen → the fiche is one target for the
 *     common case; the four controls are the deliberate path.
 *   - No sticky commit → the totals + Continuar bar is `sticky bottom-0`, so
 *     the trainer never scrolls the card to reach it.
 *   - No draft persistence → a phone call no longer costs the session.
 *   - "N registro(s) no se pudieron guardar" without naming anyone → the
 *     failures are listed by name.
 *   - Back threw the trainer out of the wizard (user control and freedom, the
 *     principle that never moved off the prototype's 6/10) → the step lives in
 *     the URL, so each one is a real history entry: Back walks step 3 → step 2
 *     → step 1 → out, a reload lands back on the roll call, and leaving with
 *     marks on screen asks first instead of discarding in silence.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";

import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  Calendar,
  Clock,
  Users,
  UserCheck,
  UserX,
  Timer,
  FileText,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATES,
  UNMARKED,
  WIZARD_STEP_ORDER as STEP_ORDER,
  applyAttendanceDraft,
  attendanceDraftKey,
  buildWizardQuery,
  clearAttendanceDraft,
  countByState,
  countUnmarked,
  countUnreviewed,
  isReviewed,
  listAttendanceDrafts,
  loadAttendanceDraft,
  markRemainingPresent,
  parseWizardQuery,
  resolveFailedStudentNames,
  tapWizardAttendance,
  saveAttendanceDraft,
  toAttendanceMarks,
  buildAttendanceSummary,
  buildRosterFromAlumnoHorarios,
  resolveEntrenadorId,
  resolveDisplayTrainerName,
  type SessionStudent,
  type StoredAttendanceDraft,
  type WizardLocation,
  type WizardStep,
} from "./attendance-utils";
import {
  getAttendanceBadgeTokens,
  getAttendanceBadgeTone,
  formatDay,
  groupSchedulesByDay,
  selectVisibleSchedules,
  paginateRecords,
  getTotalPages,
} from "@/app/attendance/attendance-utils";
import BackLink from "@/components/BackLink";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Badge, Button, EmptyState, ErrorState, LoadingState, Pagination, Stepper, buttonClasses } from "@/components/ui";
import { getUserInitials } from "@/lib/auth-utils";
import { clubIsoDate, todayDiaSemana } from "@/lib/club-date";
import type { TrainingSchedule } from "@/app/attendance/attendance-utils";
import type { DiaSemana } from "@/types/domain";
import {
  fetchTrainingSchedules,
  fetchAlumnosPorHorario,
  fetchAttendanceRecords,
  registerAttendance,
  type RegisterAttendanceResult,
} from "@/services/api";
import type { EstadoAsistencia } from "@/types/domain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * What the trainer is being asked to give up when they walk out of a roll call
 * they have already started, or throw away a draft from the picker.
 */
type PendingConfirmation =
  | { kind: "leave"; href: string }
  | { kind: "discard-draft"; draftKey: string; label: string; markCount: number };

/** The card heading per step. */
const STEP_LABELS: Record<WizardStep, string> = {
  "select-session": "Elija el horario",
  "mark-attendance": "Pasar lista",
  confirm: "Confirmar y finalizar",
};

// ---------------------------------------------------------------------------
// UI constants
// ---------------------------------------------------------------------------

/** Page size for the student list in the attendance registration wizard. */
const WIZARD_PAGE_SIZE = 10;

const ATTENDANCE_ICONS: Record<EstadoAsistencia, React.ReactNode> = {
  present: <UserCheck size={16} strokeWidth={2} aria-hidden="true" />,
  absent: <UserX size={16} strokeWidth={2} aria-hidden="true" />,
  late: <Timer size={16} strokeWidth={2} aria-hidden="true" />,
  justified: <FileText size={16} strokeWidth={2} aria-hidden="true" />,
};

/** Plural labels for the save bar's running totals. */
const TOTAL_LABELS: Record<EstadoAsistencia, [singular: string, plural: string]> = {
  present: ["Presente", "Presentes"],
  late: ["Tardanza", "Tardanzas"],
  justified: ["Justificado", "Justificados"],
  absent: ["Ausente", "Ausentes"],
};

/** Best news first — the same order every attendance surface reads in. */
const TOTAL_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TrainerAttendancePage(): React.ReactElement {
  const { session } = useAuth();
  const { showError } = useToast();
  const router = useRouter();

  const [step, setStep] = useState<WizardStep>("select-session");

  const [schedules, setSchedules] = useState<TrainingSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<DiaSemana>>(new Set());
  /**
   * The picker opens on today and stays there until the trainer says
   * otherwise — a default, never a lock. Filing a session missed yesterday
   * has to stay one tap away.
   */
  const [showAllDays, setShowAllDays] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterError, setRosterError] = useState<string | null>(null);

  const [students, setStudents] = useState<SessionStudent[]>([]);
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  /** Narrows the roll call to the rows nobody has touched yet. */
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [studentPage, setStudentPage] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<RegisterAttendanceResult | null>(null);
  /** A position read off the URL that still needs its roster loaded. */
  const [pendingRestore, setPendingRestore] = useState<WizardLocation | null>(null);
  /** Unfinished roll calls for today, offered on step 1 — never auto-applied. */
  const [resumableDrafts, setResumableDrafts] = useState<StoredAttendanceDraft[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);

  const loadOptions = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setLoadError(null);
      const scheduleData = await fetchTrainingSchedules();
      setSchedules(scheduleData);
    } catch (err) {
      console.error("[trainer/attendance] loadOptions failed", err);
      setLoadError("Error al cargar horarios");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  /**
   * Resolved every render rather than memoized: a tablet left open at
   * courtside crosses midnight, and a "today" frozen at mount would keep
   * offering yesterday's sessions. The formatter behind it is cached, so the
   * cost is a lookup.
   */
  const today = todayDiaSemana();
  const visible = useMemo(
    () => selectVisibleSchedules(schedules, today, showAllDays),
    [schedules, today, showAllDays],
  );

  /**
   * Open today's panel as soon as the schedules land. With a single day on
   * screen, making the trainer tap the accordion to reveal its times is the
   * friction this whole default exists to remove.
   */
  useEffect(() => {
    if (schedules.length === 0) return;
    const currentDay = todayDiaSemana();
    if (!schedules.some((s) => s.diaSemana === currentDay)) return;
    setExpandedDays((prev) => (prev.has(currentDay) ? prev : new Set(prev).add(currentDay)));
  }, [schedules]);

  /**
   * One feedback rule, product-wide (see `payments/page.tsx` for the other
   * half of it): the TOAST carries the outcome of an action the user just
   * took; an INLINE block carries a blocker attached to a specific control.
   *
   * `submitError` is an outcome — the registration failed — with no control
   * left to attach it to, so it toasts. `rosterError` blocks the "Continuar"
   * button it renders directly above, so it stays inline and does NOT also
   * toast.
   */
  useEffect(() => {
    if (submitError) showError(submitError);
  }, [submitError, showError]);

  // Reset student page when either filter changes.
  useEffect(() => {
    setStudentPage(1);
  }, [searchFilter, onlyUnreviewed]);

  const currentIndex = STEP_ORDER.indexOf(step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === STEP_ORDER.length - 1;

  const selectedSchedule = schedules.find((s) => s.id === selectedScheduleId) ?? null;

  /** The draft's key — null until a session is actually chosen. */
  const draftKey = useMemo(
    () =>
      selectedScheduleId !== null && sessionDate
        ? attendanceDraftKey(selectedScheduleId, sessionDate)
        : null,
    [selectedScheduleId, sessionDate],
  );

  // Admins may register attendance on a trainer's behalf (backend requires
  // entrenadorId to belong to an actual ENTRENADOR — see attendance-utils.ts).
  const trainerName = resolveDisplayTrainerName(
    session?.user?.role ?? null,
    session?.user?.name,
    selectedSchedule,
  );
  const entrenadorPersonaId = resolveEntrenadorId(
    session?.user?.role ?? null,
    session?.user?.id,
    selectedSchedule,
  );

  // /trainer is gated to the "trainer" role only — an admin using this page
  // must bounce back to their own attendance overview, not the trainer panel.
  const backHref = session?.user?.role === "admin" ? "/attendance" : "/trainer";

  // ---- The wizard's address ----
  //
  // The step is written into the query string with the History API directly
  // (the shape Next documents for search-param-only updates): each forward
  // move is a real history entry, so the browser's Back button walks the
  // wizard instead of walking out of it. React state stays the source of
  // truth for the render; the URL is what makes that state addressable,
  // reloadable and reachable by Back.

  /** History entries THIS wizard pushed — see `handleBack`. */
  const ownedHistoryEntries = useRef(0);

  const writeWizardUrl = useCallback(
    (horarioId: number | null, target: WizardStep, mode: "push" | "replace"): void => {
      if (typeof window === "undefined") return;
      const url = `${window.location.pathname}${buildWizardQuery(horarioId, target)}`;
      if (mode === "push") {
        window.history.pushState(null, "", url);
        ownedHistoryEntries.current += 1;
        return;
      }
      window.history.replaceState(null, "", url);
    },
    [],
  );

  // ---- Navigation ----

  /**
   * Load a horario's roster and land on `target`.
   *
   * Every entrance to the roll call goes through here — Continuar, the resume
   * offer on step 1, a reload on `?paso=lista`, and a Back that outlived the
   * roster in memory — so all of them get the same roster, the same draft
   * overlay and the same "only reviewed rows come back" guarantee.
   */
  const openRoster = useCallback(
    async (
      horarioId: number,
      target: Exclude<WizardStep, "select-session">,
      mode: "push" | "replace",
    ): Promise<void> => {
      setRosterLoading(true);
      setRosterError(null);
      try {
        // The wizard always registers attendance for "today" (the backend
        // defaults fechaEntrenamiento to today's server date when omitted).
        // Re-opening the wizard for a session that already has today's
        // attendance recorded must show those existing marks, not silently
        // default everyone back to unmarked.
        const today = clubIsoDate();
        // The prefill fetch is a convenience, not a requirement: if it fails,
        // fall back to an empty list rather than failing the whole roster load.
        const [alumnoHorarios, existingRecords] = await Promise.all([
          fetchAlumnosPorHorario(horarioId),
          fetchAttendanceRecords({ fechaInicio: today, fechaFin: today, horarioId }).catch(
            (err: unknown) => {
              console.error("[trainer/attendance] fetchAttendanceRecords prefill failed", err);
              return [];
            },
          ),
        ]);

        // Order matters: server records first, then the trainer's own in-progress
        // draft on top — the draft is the newer intent. Neither can produce
        // `UNMARKED`, so a student nobody has decided on stays undecided.
        const roster = buildRosterFromAlumnoHorarios(alumnoHorarios, existingRecords);
        const draft = loadAttendanceDraft(attendanceDraftKey(horarioId, today));
        const withDraft = applyAttendanceDraft(roster, draft);

        setSessionDate(today);
        setRestoredFromDraft(
          withDraft !== roster && countUnreviewed(withDraft) < countUnreviewed(roster),
        );
        setStudents(withDraft);
        setStudentPage(1);
        setOnlyUnreviewed(false);
        setStep(target);
        writeWizardUrl(horarioId, target, mode);
      } catch (err) {
        console.error("[trainer/attendance] fetchAlumnosPorHorario failed", err);
        setRosterError("No se pudo cargar el listado de estudiantes de este horario.");
      } finally {
        setRosterLoading(false);
      }
    },
    [writeWizardUrl],
  );

  async function handleContinueToRoster(): Promise<void> {
    if (selectedScheduleId === null) return;
    await openRoster(selectedScheduleId, "mark-attendance", "push");
  }

  function handleBack(): void {
    const previous = STEP_ORDER[currentIndex - 1];
    if (!previous) return;
    // Walk the real history whenever the entry behind us is ours, so the
    // in-page "Atrás" and the browser's own Back button leave the same stack
    // behind. Without an entry of ours back there — a trainer who opened
    // `?paso=confirmar` directly — `history.back()` would leave the app, so
    // that case rewrites the current entry instead.
    if (ownedHistoryEntries.current > 0) {
      window.history.back();
      return;
    }
    writeWizardUrl(selectedScheduleId, previous, "replace");
    setStep(previous);
  }

  function handleNext(): void {
    const next = STEP_ORDER[currentIndex + 1];
    if (!next) return;
    setStep(next);
    writeWizardUrl(selectedScheduleId, next, "push");
  }

  /**
   * Restore the position the URL is asking for, once the schedules it refers
   * to are actually loaded. A horario that no longer exists (or a hand-typed
   * one that never did) falls back to the picker rather than to a roll call
   * for nobody.
   */
  useEffect(() => {
    if (!pendingRestore || loading || loadError) return;
    const { horarioId, step: target } = pendingRestore;
    setPendingRestore(null);
    if (horarioId === null || target === "select-session") return;
    if (!schedules.some((s) => s.id === horarioId)) {
      writeWizardUrl(null, "select-session", "replace");
      return;
    }
    setSelectedScheduleId(horarioId);
    void openRoster(horarioId, target, "replace");
  }, [pendingRestore, loading, loadError, schedules, openRoster, writeWizardUrl]);

  /**
   * The Back button, on arrival and on every press.
   *
   * Read after mount rather than during render: the first client render has
   * to match the server's, and the URL is a client-only fact.
   */
  useEffect(() => {
    const entry = parseWizardQuery(window.location.search);
    if (entry.step !== "select-session") setPendingRestore(entry);
  }, []);

  useEffect(() => {
    function handlePopState(): void {
      // A filed session is not a step anyone can walk back into.
      if (confirmed) return;
      ownedHistoryEntries.current = Math.max(0, ownedHistoryEntries.current - 1);
      const entry = parseWizardQuery(window.location.search);
      if (entry.step === "select-session" || entry.horarioId === null) {
        setStep("select-session");
        return;
      }
      // The roster this step belongs to is still in memory: show it, marks and
      // all. Otherwise rebuild it — which also re-applies the draft, so the
      // trainer's decisions come back and nobody else's row does.
      if (entry.horarioId === selectedScheduleId && students.length > 0) {
        setStep(entry.step);
        return;
      }
      setPendingRestore(entry);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [confirmed, selectedScheduleId, students.length]);

  function toggleDay(day: DiaSemana): void {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }

  /** Every path that changes a mark funnels through here, so does the draft. */
  const commitStudents = useCallback(
    (next: SessionStudent[]): void => {
      setStudents(next);
      setRestoredFromDraft(false);
      if (draftKey) saveAttendanceDraft(draftKey, next);
    },
    [draftKey],
  );

  /**
   * Every mark the trainer makes is also a REVIEW of that student — including
   * setting a row to the state it already had. Tapping "Presente" on a student
   * who was already present by default is the trainer saying "yes, that one is
   * here", and the roll call has to stop asking about them.
   */
  function handleDirectAttendanceSet(studentIndex: number, state: EstadoAsistencia): void {
    commitStudents(
      students.map((s, i) => (i === studentIndex ? { ...s, attendance: state, reviewed: true } : s)),
    );
  }

  /** The whole fiche is tappable — one target for the common case. */
  function handleCycleAttendance(studentIndex: number): void {
    commitStudents(
      students.map((s, i) =>
        i === studentIndex ? { ...s, attendance: tapWizardAttendance(s), reviewed: true } : s,
      ),
    );
  }

  /**
   * Bulk action for the common case (near-full attendance): the trainer states
   * in one tap that everyone they have not touched is present. Marks the
   * trainer already made are preserved. Applies to the whole roster, not just
   * the visible page or the current filter.
   */
  function handleMarkRemainingPresent(): void {
    commitStudents(markRemainingPresent(students));
  }

  async function handleConfirm(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!selectedScheduleId || entrenadorPersonaId === null) return;
    // Only the confirmation step files a session. Without this, a submit that
    // reached the form from anywhere else would file one straight from the
    // roll call — see the `key` on the advance/submit buttons for the way that
    // actually happened.
    if (step !== "confirm") return;
    // Never file a session carrying the sentinel — `toAttendanceMarks` strips
    // it, and this refuses the batch rather than filing a short roster.
    if (countUnmarked(students) > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const registration = await registerAttendance({
        horarioId: selectedScheduleId,
        entrenadorId: entrenadorPersonaId,
        // `toAttendanceMarks` strips the frontend-only `unmarked` sentinel,
        // which the backend contract does not accept.
        students: toAttendanceMarks(students),
      });
      setResult(registration);
      setConfirmed(true);
      // The session is filed; the draft has nothing left to protect. Kept when
      // some records failed, so a retry still starts from the trainer's marks.
      if (draftKey && registration.failed.length === 0) clearAttendanceDraft(draftKey);
      // Drop the step from the URL: a filed session must not be reachable as
      // an editable roll call by reloading the page that filed it.
      writeWizardUrl(null, "select-session", "replace");
    } catch (err) {
      console.error("[trainer/attendance] registerAttendance failed", err);
      setSubmitError("No se pudo registrar la asistencia. Intente nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset(): void {
    if (draftKey) clearAttendanceDraft(draftKey);
    writeWizardUrl(null, "select-session", "replace");
    ownedHistoryEntries.current = 0;
    setStep("select-session");
    setSelectedScheduleId(null);
    setSessionDate(null);
    setRestoredFromDraft(false);
    setStudents([]);
    setSearchFilter("");
    setOnlyUnreviewed(false);
    setConfirmed(false);
    setSubmitting(false);
    setSubmitError(null);
    setResult(null);
  }

  // ---- Student list pagination (attendance wizard) ----

  const filteredStudents = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q && !onlyUnreviewed) return students;
    return students.filter(
      (s) =>
        (!q || s.name.toLowerCase().includes(q)) && (!onlyUnreviewed || !isReviewed(s)),
    );
  }, [students, searchFilter, onlyUnreviewed]);

  const totalStudentPages = useMemo(
    () => getTotalPages(filteredStudents.length, WIZARD_PAGE_SIZE),
    [filteredStudents.length],
  );
  const paginatedStudents = useMemo(
    () => paginateRecords(filteredStudents, studentPage, WIZARD_PAGE_SIZE),
    [filteredStudents, studentPage],
  );

  // Deliberately computed over `students` (the FULL roster) rather than
  // `filteredStudents`/`paginatedStudents`: the wizard paginates at 10 and
  // the search box filters, so a page- or filter-scoped count would report
  // "0 sin revisar" while a whole second page of students was about to be
  // filed present sight unseen — the exact silent-data-loss path this counter
  // exists to close.
  const unreviewedCount = useMemo(() => countUnreviewed(students), [students]);
  const unmarkedCount = useMemo(() => countUnmarked(students), [students]);
  const presentCount = useMemo(() => countByState(students, "present"), [students]);
  const unmarkedReasonId = "attendance-unmarked-reason";

  /**
   * Decisions the trainer has made and not yet filed. `reviewed` is what makes
   * this answerable at all: the roster defaults everyone to "present", so
   * counting marked rows would call an untouched roster "unsaved work" and ask
   * about discarding something nobody wrote.
   */
  const reviewedCount = students.length - unreviewedCount;
  const hasUnsavedMarks = !confirmed && reviewedCount > 0;

  /**
   * The one exit the app cannot re-enter: `sessionStorage` dies with the tab,
   * so closing it is the single way to actually lose the roll call. The browser
   * writes the copy for this one; all we can say is that there is something to
   * lose.
   */
  useEffect(() => {
    if (!hasUnsavedMarks) return;
    function warnBeforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedMarks]);

  /**
   * Unfinished roll calls, read back from the drafts themselves and OFFERED on
   * the picker rather than restored behind the trainer's back: coming to this
   * screen to file a different session and landing inside yesterday's half-done
   * one would be the same loss of control, pointing the other way.
   */
  const refreshResumableDrafts = useCallback((): void => {
    setResumableDrafts(listAttendanceDrafts(clubIsoDate()));
  }, []);

  useEffect(() => {
    if (confirmed || step !== "select-session") {
      setResumableDrafts([]);
      return;
    }
    refreshResumableDrafts();
  }, [confirmed, step, refreshResumableDrafts]);

  function describeSchedule(horarioId: number): string {
    const found = schedules.find((s) => s.id === horarioId);
    return found
      ? `${formatDay(found.diaSemana)} ${found.horaInicio} — ${found.horaFin}`
      : `Horario #${horarioId}`;
  }

  function handleResumeDraft(draft: StoredAttendanceDraft): void {
    setSelectedScheduleId(draft.horarioId);
    void openRoster(draft.horarioId, "mark-attendance", "push");
  }

  /** The in-app way out — guarded only while there is something to discard. */
  function handleLeaveWizard(event: React.MouseEvent<HTMLAnchorElement>): void {
    if (!hasUnsavedMarks) return;
    event.preventDefault();
    setPendingConfirmation({ kind: "leave", href: backHref });
  }

  function handleConfirmPending(): void {
    const pending = pendingConfirmation;
    setPendingConfirmation(null);
    if (!pending) return;
    if (pending.kind === "leave") {
      router.push(pending.href);
      return;
    }
    clearAttendanceDraft(pending.draftKey);
    refreshResumableDrafts();
  }

  /** The named steps — step 1 carries the decision already made. */
  const stepNames = useMemo(
    () => [
      selectedSchedule
        ? `Horario · ${formatDay(selectedSchedule.diaSemana)} ${selectedSchedule.horaInicio}`
        : "Horario",
      "Pasar lista",
      "Confirmar",
    ],
    [selectedSchedule],
  );

  // ---- Step renderers ----

  function renderSessionSelection(): React.ReactElement {
    const dayGroups = groupSchedulesByDay(visible.schedules);
    return (
      <div className="flex flex-col gap-5">
        {/*
         * The way back into an interrupted roll call. It says what is in the
         * draft (which session, how many alumnos the trainer decided on)
         * before asking them to act on it, and it offers both directions —
         * resume it, or throw it away — because an offer you cannot decline
         * is just a slower version of restoring it automatically.
         */}
        {resumableDrafts.length > 0 && (
          <div className="flex flex-col gap-3 rounded-ctl border border-line bg-canvas p-4">
            <p className="text-[13px] font-bold text-ink">
              {resumableDrafts.length === 1
                ? "Tiene una lista sin terminar"
                : `Tiene ${resumableDrafts.length} listas sin terminar`}
            </p>
            <ul className="flex flex-col gap-3">
              {resumableDrafts.map((draft) => (
                <li key={draft.key} className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="min-w-[180px] flex-1 text-[13px] text-ink-2">
                    <b className="font-semibold text-ink">{describeSchedule(draft.horarioId)}</b>
                    <span aria-hidden="true"> · </span>
                    {draft.markCount === 1
                      ? "1 alumno marcado"
                      : `${draft.markCount} alumnos marcados`}
                  </span>
                  <Button
                    type="button"
                    variant="dark"
                    onClick={() => handleResumeDraft(draft)}
                    disabled={rosterLoading}
                  >
                    Retomar la lista
                    <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setPendingConfirmation({
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
        )}
        <div>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-[13px] text-ink-3">
              {visible.narrowedToToday
                ? `Horarios de hoy · ${formatDay(today)}`
                : "Seleccione el horario de entrenamiento:"}
            </p>
            {/* The escape hatch. Hidden when today is empty: the list is
                already the full week and the hint below says why. */}
            {schedules.length > 0 && !visible.emptyToday && (
              <button
                type="button"
                onClick={() => setShowAllDays((prev) => !prev)}
                className="text-[12.5px] font-semibold text-ink-2 underline underline-offset-2 transition-colors hover:text-ink"
              >
                {showAllDays ? "Ver solo hoy" : "Ver todos los días"}
              </button>
            )}
          </div>
          {visible.emptyToday && (
            <p className="mb-3 text-[12.5px] text-ink-3">
              No hay entrenamientos hoy ({formatDay(today).toLowerCase()}). Mostrando la semana
              completa.
            </p>
          )}
          {schedules.length === 0 ? (
            <EmptyState
              icon={<Calendar size={21} strokeWidth={1.5} aria-hidden="true" />}
              title="No hay horarios registrados"
              description="Sin un horario no se puede tomar lista. Pida a administración que registre uno."
            />
          ) : (
            <div className="flex flex-col gap-2">
              {dayGroups.map((group) => {
                const isExpanded = expandedDays.has(group.day);
                const panelId = `schedule-day-${group.day}`;
                return (
                  <div key={group.day} className="overflow-hidden rounded-ctl border border-line bg-paper">
                    <button
                      type="button"
                      onClick={() => toggleDay(group.day)}
                      aria-expanded={isExpanded}
                      aria-controls={panelId}
                      className="flex min-h-[52px] w-full items-center justify-between gap-2.5 px-4 py-3 text-left transition-colors hover:bg-canvas"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="text-sm font-bold text-ink">{group.label}</span>
                        <span className="text-xs text-ink-3">
                          ({group.schedules.length}{" "}
                          {group.schedules.length === 1 ? "horario" : "horarios"})
                        </span>
                      </span>
                      <ChevronDown
                        size={16}
                        strokeWidth={2}
                        className={`shrink-0 text-ink-3 transition-transform duration-150 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                    {isExpanded && (
                      <div id={panelId} className="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
                        {group.schedules.map((sched) => {
                          const isActive = sched.id === selectedScheduleId;
                          return (
                            <button
                              key={sched.id}
                              type="button"
                              onClick={() => setSelectedScheduleId(sched.id)}
                              aria-pressed={isActive}
                              // Selection is coal + the yellow ball dot, never
                              // a red fill — red is CTA and destructive only.
                              className={`flex min-h-[56px] flex-col justify-center gap-1 rounded-ctl border px-4 py-3 text-left transition-colors ${
                                isActive
                                  ? "border-coal bg-paper shadow-[0_0_0_1px_theme(colors.coal.DEFAULT)]"
                                  : "border-line-2 bg-paper hover:border-ink-3"
                              }`}
                            >
                              <span className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                                <Clock size={14} strokeWidth={2} className="text-ink-3" aria-hidden="true" />
                                {sched.horaInicio} — {sched.horaFin}
                                {isActive && (
                                  <span
                                    aria-hidden="true"
                                    className="ml-auto h-1.5 w-1.5 rounded-full bg-ball ring-2 ring-coal"
                                  />
                                )}
                              </span>
                              <span className="text-[11.5px] text-ink-3">{sched.entrenadorNombre}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {rosterError && (
          <div className="alert-error" role="alert">
            {rosterError}
          </div>
        )}

        <Button
          type="button"
          variant="primary"
          onClick={handleContinueToRoster}
          disabled={!selectedScheduleId || rosterLoading}
          className="w-full"
        >
          {rosterLoading ? "Cargando estudiantes…" : "Continuar"}
          <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
        </Button>
      </div>
    );
  }

  function renderMarkAttendance(): React.ReactElement | null {
    if (!selectedSchedule) return null;

    return (
      <div className="flex flex-col gap-4">
        {/*
         * The coal header: the live marker the trainer glances at, the session
         * it belongs to, and the one-tap shortcut for the common case.
         */}
        <div className="flex flex-wrap items-center gap-5 rounded-card bg-coal px-[22px] py-[18px] text-white">
          <span
            aria-live="polite"
            className="text-[40px] font-extrabold leading-none tracking-[-0.05em] tabular-nums"
          >
            {presentCount}
            <span className="text-[20px] text-white/50">/{students.length}</span>
          </span>
          <span className="flex min-w-[170px] flex-1 flex-col gap-1">
            <b className="text-[15px] font-bold">presentes</b>
            <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-white/60">
              {/* Kept as its own node: "Lunes" is the day, the range is the
                  time, and they are two different facts. */}
              <span>{formatDay(selectedSchedule.diaSemana)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {selectedSchedule.horaInicio} — {selectedSchedule.horaFin}
              </span>
            </span>
            {/* The counter that keeps the default honest: the big number reads
                45/45 from the first second, and this says how much of it
                anybody has actually looked at. */}
            {unreviewedCount > 0 && (
              <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-ball">
                <AlertTriangle size={12} strokeWidth={2.5} aria-hidden="true" />
                {unreviewedCount === 1
                  ? "1 alumno sin revisar"
                  : `${unreviewedCount} alumnos sin revisar`}
              </span>
            )}
          </span>
          {unreviewedCount > 0 && (
            <button
              type="button"
              onClick={handleMarkRemainingPresent}
              className="inline-flex h-ctl items-center gap-2 rounded-ctl border border-white/25 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              <UserCheck size={14} strokeWidth={2} aria-hidden="true" />
              Marcar restantes presentes
            </button>
          )}
        </div>

        {restoredFromDraft && (
          <p className="rounded-ctl border border-line bg-canvas px-3.5 py-2.5 text-xs text-ink-2">
            Recuperamos las marcas que ya había hecho en esta sesión. Revíselas antes de continuar.
          </p>
        )}

        {students.length === 0 ? (
          <EmptyState
            icon={<Users size={21} strokeWidth={1.5} aria-hidden="true" />}
            title="Este horario no tiene alumnos asignados."
            description="Pida a administración que asigne alumnos a este horario para poder tomar lista."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {TOTAL_ORDER.map((state) => (
                <Badge key={state} tone={getAttendanceBadgeTone(state)}>
                  {ATTENDANCE_LABELS[state]}
                </Badge>
              ))}
              <span className="h-badge inline-flex items-center rounded-full border border-dashed border-line-2 px-[11px] text-[11.5px] font-bold text-ink-3">
                Sin revisar
              </span>
              <span className="text-xs text-ink-3">Toque la ficha para confirmar o cambiar</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                placeholder="Filtrar alumnos por nombre…"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                aria-label="Filtrar alumnos"
                /* No ring here: the system indicator in `globals.css` wins on
                   specificity (0,3,0 vs Tailwind's 0,2,0), so the
                   `focus:ring-[3px] focus:ring-cata-red/10` this field used to
                   declare never rendered. The border still darkens on focus. */
                className="h-ctl min-w-[180px] flex-1 rounded-ctl border border-line-2 bg-paper px-[13px] text-[13.5px] text-ink placeholder:text-ink-3 focus:border-cata-red focus:outline-none"
              />
              {/* Turns the count into something the trainer can act on: the
                  point of knowing 12 are unreviewed is being able to go
                  through those 12. Selection is coal, never a red fill. */}
              {(unreviewedCount > 0 || onlyUnreviewed) && (
                <button
                  type="button"
                  onClick={() => setOnlyUnreviewed((prev) => !prev)}
                  aria-pressed={onlyUnreviewed}
                  className={`inline-flex h-ctl shrink-0 items-center gap-2 rounded-ctl border px-4 text-[13px] font-semibold transition-colors ${
                    onlyUnreviewed
                      ? "border-coal bg-coal text-white"
                      : "border-line-2 bg-paper text-ink-2 hover:border-ink-3 hover:text-ink"
                  }`}
                >
                  Ver solo sin revisar
                  <span className="tabular-nums">({unreviewedCount})</span>
                </button>
              )}
            </div>

            {filteredStudents.length === 0 ? (
              <EmptyState
                icon={<Users size={21} strokeWidth={1.5} aria-hidden="true" />}
                title={
                  onlyUnreviewed && unreviewedCount === 0
                    ? "Ya revisó a todos los alumnos de este horario."
                    : "No se encontraron alumnos con ese nombre."
                }
                description={
                  onlyUnreviewed && unreviewedCount === 0
                    ? "Quite el filtro para volver a ver la lista completa antes de continuar."
                    : "Revise el filtro o bórrelo para volver a ver la lista completa."
                }
                action={
                  onlyUnreviewed ? (
                    <Button type="button" onClick={() => setOnlyUnreviewed(false)}>
                      Ver la lista completa
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {paginatedStudents.map((student) => {
                    const idx = students.findIndex((s) => s.id === student.id);
                    const isUnmarked = student.attendance === UNMARKED;
                    const reviewed = isReviewed(student);
                    const nameId = `student-name-${student.id}`;
                    const groupLabelId = `attendance-label-${student.id}`;
                    const stateLabel = isUnmarked
                      ? "Sin marcar"
                      : ATTENDANCE_LABELS[student.attendance as EstadoAsistencia];
                    return (
                      <li
                        key={student.id}
                        data-attendance={student.attendance}
                        data-reviewed={reviewed}
                        className={`flex flex-col overflow-hidden rounded-ctl border bg-paper sm:h-12 sm:flex-row sm:items-center ${
                          reviewed ? "border-line-2" : "border-dashed border-ink-3/50"
                        }`}
                      >
                        {/*
                         * `.fiche` — 48px, avatar + name + state, and the WHOLE
                         * surface is the target. Sibling of the radiogroup, not
                         * its parent: nesting controls inside a button is
                         * invalid and unreachable by keyboard.
                         */}
                        <button
                          type="button"
                          onClick={() => handleCycleAttendance(idx)}
                          // The name says which of the two things a tap does
                          // here: an unreviewed row is a proposal, and the
                          // first tap accepts it.
                          aria-label={
                            reviewed
                              ? `${student.name}: ${stateLabel}. Cambiar estado`
                              : `${student.name}: ${stateLabel}, sin revisar. Confirmar o cambiar estado`
                          }
                          // `shrink-0` + `w-full`, and `flex-1` only from `sm`:
                          // on a phone the row is a COLUMN, where a bare
                          // `flex-1` (flex-basis 0) collapsed the 48px fiche to
                          // its 28px content height — the one dimension the
                          // prototype is explicit about.
                          className="flex h-12 w-full min-w-0 shrink-0 items-center gap-[11px] px-[13px] text-left transition-colors hover:bg-canvas sm:w-auto sm:flex-1"
                        >
                          <span
                            aria-hidden="true"
                            className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-state-neutral-bg text-[10px] font-bold text-state-neutral"
                          >
                            {getUserInitials(student.name)}
                          </span>
                          <span
                            id={nameId}
                            className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink"
                          >
                            {student.name}
                          </span>
                          {/* Same chip, two weights. A reviewed row wears the
                              state's own colour; an unreviewed one wears the
                              state in a dashed outline — the value is there
                              and readable, and it reads as provisional
                              because it is. */}
                          {reviewed && !isUnmarked ? (
                            <Badge
                              tone={getAttendanceBadgeTone(student.attendance)}
                              className="flex-none"
                            >
                              {stateLabel}
                            </Badge>
                          ) : (
                            <span className="h-badge inline-flex flex-none items-center rounded-full border border-dashed border-line-2 px-[11px] text-[11.5px] font-bold text-ink-3">
                              {stateLabel}
                            </span>
                          )}
                        </button>

                        {/*
                         * A radiogroup, not a fieldset of `aria-pressed`
                         * toggles: the four states are mutually exclusive, and
                         * toggle buttons announce as four independent switches
                         * that never convey that exclusivity. The group is
                         * labelled by the RENDERED student name, so the
                         * accessible name can never drift from what is on
                         * screen. This is the deliberate path; the tap above is
                         * the accelerator.
                         */}
                        <div
                          role="radiogroup"
                          aria-labelledby={`${groupLabelId} ${nameId}`}
                          className="grid w-full grid-cols-4 gap-0.5 border-t border-line p-1 sm:h-full sm:w-auto sm:border-l sm:border-t-0 sm:p-0.5"
                        >
                          <span id={groupLabelId} className="sr-only">
                            Estado de asistencia de
                          </span>
                          {ATTENDANCE_STATES.map((state) => {
                            const isActive = student.attendance === state;
                            return (
                              <button
                                key={state}
                                type="button"
                                role="radio"
                                onClick={() => handleDirectAttendanceSet(idx, state)}
                                aria-checked={isActive}
                                title={ATTENDANCE_LABELS[state]}
                                className={`inline-flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 text-[10px] font-semibold leading-tight transition-colors ${
                                  isActive
                                    ? `border-transparent ${getAttendanceBadgeTokens(state).badgeClass}`
                                    : "border-transparent text-ink-3 hover:bg-canvas hover:text-ink"
                                }`}
                              >
                                {ATTENDANCE_ICONS[state]}
                                <span className="sm:sr-only">{ATTENDANCE_LABELS[state]}</span>
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {filteredStudents.length > WIZARD_PAGE_SIZE && (
                  <Pagination
                    className="mt-0 rounded-ctl border border-line bg-canvas px-4 py-3"
                    page={studentPage}
                    totalPages={totalStudentPages}
                    onPageChange={setStudentPage}
                    totalItems={filteredStudents.length}
                    pageSize={WIZARD_PAGE_SIZE}
                    itemNoun="alumno"
                  />
                )}
              </>
            )}
          </>
        )}

        <p className="text-xs text-ink-3">Registrando como: {trainerName}</p>
      </div>
    );
  }

  function renderConfirmation(): React.ReactElement | null {
    if (!selectedSchedule) return null;

    return (
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-ink-3">
          Revise el resumen antes de confirmar el registro de asistencia:
        </p>

        <dl className="overflow-hidden rounded-ctl border border-line">
          <div className="flex h-drow items-center gap-4 border-b border-line px-5">
            <dt className="w-[160px] flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
              Horario
            </dt>
            <dd className="flex-1 text-sm font-semibold text-ink">
              {formatDay(selectedSchedule.diaSemana)} {selectedSchedule.horaInicio} —{" "}
              {selectedSchedule.horaFin}
            </dd>
          </div>
          <div className="flex h-drow items-center gap-4 border-b border-line px-5">
            <dt className="w-[160px] flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
              Registra
            </dt>
            <dd className="flex-1 text-sm font-semibold text-ink">{trainerName}</dd>
          </div>
          <div className="flex min-h-drow items-center gap-4 px-5 py-3">
            <dt className="w-[160px] flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3">
              Resultado
            </dt>
            <dd className="flex flex-1 flex-wrap gap-2">
              {TOTAL_ORDER.map((state) => (
                <Badge key={state} tone={getAttendanceBadgeTone(state)}>
                  {countByState(students, state)} {ATTENDANCE_LABELS[state].toLowerCase()}
                </Badge>
              ))}
              {/* Without this, "45 presentes" reads the same whether the
                  trainer went through the roster or never looked at it. */}
              {unreviewedCount > 0 && (
                <Badge tone="warn">{unreviewedCount} sin revisar</Badge>
              )}
            </dd>
          </div>
        </dl>

        {unreviewedCount > 0 && (
          /*
           * Names the risk in the trainer's own terms and hands back the way
           * to fix it. It does NOT block: the trainer asked for a default, and
           * a default you cannot submit is not a default. What it must never
           * do is let the summary above read as a reviewed roster.
           */
          <div
            role="status"
            className="flex flex-col gap-3 rounded-ctl border border-state-warn/25 bg-state-warn-bg p-3.5"
          >
            <p className="flex items-start gap-2 text-[13px] font-semibold text-state-warn">
              <AlertTriangle
                size={14}
                strokeWidth={2}
                className="mt-0.5 flex-none"
                aria-hidden="true"
              />
              <span>
                {unreviewedCount === 1
                  ? `1 de ${students.length} alumnos sigue en "Presente" porque nadie lo revisó.`
                  : `${unreviewedCount} de ${students.length} alumnos siguen en "Presente" porque nadie los revisó.`}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  setOnlyUnreviewed(true);
                  setSearchFilter("");
                  setStudentPage(1);
                  setStep("mark-attendance");
                }}
              >
                {unreviewedCount === 1 ? "Revisar a ese alumno" : `Revisar a esos ${unreviewedCount}`}
              </Button>
              <Button type="button" variant="ghost" onClick={handleMarkRemainingPresent}>
                <UserCheck size={14} strokeWidth={2} aria-hidden="true" />
                Confirmar que están presentes
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-ink-3">
          Se registrará la asistencia de {students.length}{" "}
          {students.length === 1 ? "estudiante" : "estudiantes"}.
        </p>
      </div>
    );
  }

  /** Running totals for the save bar — the same numbers, one glance. */
  function renderTotals(): React.ReactElement {
    return (
      <span className="min-w-[250px] flex-1 text-xs text-ink-3">
        {TOTAL_ORDER.map((state, index) => {
          const count = countByState(students, state);
          const [singular, plural] = TOTAL_LABELS[state];
          return (
            <span key={state}>
              {index > 0 ? " · " : ""}
              <span>{`${count} ${count === 1 ? singular : plural}`}</span>
            </span>
          );
        })}
        {unreviewedCount > 0 && (
          <>
            {" · "}
            <span className="font-bold text-state-warn">{`${unreviewedCount} sin revisar`}</span>
          </>
        )}
      </span>
    );
  }

  // ---- Render ----

  return (
    <ProtectedRoute allowedRoles={["trainer", "admin"]}>
      <AppShell eyebrow="Tomar asistencia" title="Pasar lista">
      {!confirmed && (
        <BackLink
          href={backHref}
          label={session?.user?.role === "admin" ? "Volver a Asistencias" : "Volver al Panel del Entrenador"}
          // Walking out of a started roll call is the one navigation on this
          // screen that costs something, so it is the one that asks.
          onClick={handleLeaveWizard}
        />
      )}
      <ConfirmDialog
        open={pendingConfirmation !== null}
        variant="danger"
        title={
          pendingConfirmation?.kind === "discard-draft"
            ? "¿Descartar la lista sin terminar?"
            : "¿Salir sin registrar la asistencia?"
        }
        message={
          pendingConfirmation?.kind === "discard-draft"
            ? `Se perderán las ${pendingConfirmation.markCount} marcas de ${pendingConfirmation.label}. Los alumnos volverán a quedar sin revisar.`
            : `Marcó ${reviewedCount} de ${students.length} ${students.length === 1 ? "alumno" : "alumnos"} y todavía no registró la asistencia. Guardamos el borrador en esta pestaña para que pueda retomarlo, pero si la cierra se pierde.`
        }
        confirmLabel={
          pendingConfirmation?.kind === "discard-draft" ? "Descartar" : "Salir sin registrar"
        }
        cancelLabel={
          pendingConfirmation?.kind === "discard-draft" ? "Conservar" : "Seguir con la lista"
        }
        onConfirm={handleConfirmPending}
        onCancel={() => setPendingConfirmation(null)}
      />
      {confirmed ? (
        <div className="flex min-h-[50vh] items-center justify-center py-8">
          <div className="w-full max-w-lg text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-state-ok-bg">
              <CheckCircle size={32} className="text-state-ok" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight text-ink">
              Asistencia Registrada
            </h2>
            <p className="mb-2 text-sm leading-relaxed text-ink-2">
              La asistencia para{" "}
              <strong className="text-ink">
                {selectedSchedule
                  ? `${formatDay(selectedSchedule.diaSemana)} ${selectedSchedule.horaInicio} — ${selectedSchedule.horaFin}`
                  : "el horario seleccionado"}
              </strong>{" "}
              ha sido registrada exitosamente.
            </p>
            <p className="mb-2 text-sm leading-relaxed text-ink-2">
              <strong className="text-ink">{trainerName}</strong> figura como
              el entrenador que tomó la asistencia de{" "}
              <strong className="text-ink">{result?.createdCount ?? 0} estudiantes</strong>.
            </p>
            {students.length > 0 && (
              <p className="mb-4 text-xs text-ink-3">{buildAttendanceSummary(students)}</p>
            )}
            {result && result.failed.length > 0 && (
              /*
               * NAME the students. This used to say "N registro(s) no se
               * pudieron guardar" and then ask the trainer to retry for
               * students it refused to identify — leaving them to re-mark the
               * whole roster to find out who was missing.
               */
              <div
                role="alert"
                className="mb-8 rounded-ctl border border-state-warn/25 bg-state-warn-bg p-3.5 text-left text-xs text-state-warn"
              >
                <p className="flex items-center gap-1.5 font-bold">
                  <AlertTriangle size={13} strokeWidth={2} aria-hidden="true" />
                  {result.failed.length === 1
                    ? "No se pudo guardar 1 registro"
                    : `No se pudieron guardar ${result.failed.length} registros`}
                </p>
                <ul className="mt-1.5 list-inside list-disc font-semibold">
                  {resolveFailedStudentNames(result.failed, students).map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-state-warn/80">
                  Vuelva a tomar lista de este horario para reintentar con estos alumnos — el resto
                  ya quedó guardado.
                </p>
              </div>
            )}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button type="button" variant="primary" onClick={handleReset}>
                Registrar Otra Asistencia
              </Button>
              <Link href={backHref} className={buttonClasses("secondary")}>
                Volver al Panel
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div>
          {loading && <LoadingState label="Cargando horarios…" />}

          {loadError && !loading && (
            <ErrorState className="mb-8" message={loadError} onRetry={() => loadOptions()} />
          )}

          {!loading && !loadError && (
            <>
              {/* The stepper is NAMED: "Horario · Lunes 15:00" tells you what
                  you already decided; "Paso 2 de 3" does not. */}
              <Stepper
                className="mb-5"
                steps={stepNames}
                current={currentIndex + 1}
                label="Pasos para tomar asistencia"
              />

              <div className="mx-auto max-w-3xl">
                <div className="rounded-card border border-line bg-paper p-5 sm:p-6">
                  <h2 className="mb-4 text-[13px] font-bold text-ink">{STEP_LABELS[step]}</h2>

                  <form onSubmit={handleConfirm}>
                    {step === "select-session" && renderSessionSelection()}
                    {step === "mark-attendance" && renderMarkAttendance()}
                    {step === "confirm" && renderConfirmation()}

                    {/*
                     * The commit bar. `sticky bottom-0` so the trainer never
                     * scrolls the whole card to reach Siguiente — the audit
                     * found exactly that, on the screen where the commit
                     * matters most.
                     */}
                    {step !== "select-session" && (
                      <div className="sticky bottom-0 -mx-5 mt-5 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-5 py-3.5 backdrop-blur sm:-mx-6 sm:px-6">
                        {!isFirst && (
                          <Button type="button" variant="ghost" onClick={handleBack} disabled={submitting}>
                            <ChevronLeft size={14} strokeWidth={2} aria-hidden="true" />
                            Atrás
                          </Button>
                        )}

                        {step === "mark-attendance" && renderTotals()}

                        <div className="ml-auto flex flex-col items-end gap-1.5">
                          {/* The `UNMARKED` invariant, and its explanation.
                              No path the wizard can take produces the sentinel
                              any more, so in practice neither renders — but a
                              button disabled by an invariant still has to say
                              why, or it reads as a broken wizard. Being
                              unreviewed does NOT gate the advance: it is a
                              warning, not a blocker. */}
                          {unmarkedCount > 0 && (
                            <p
                              id={unmarkedReasonId}
                              role="status"
                              className="text-xs font-semibold text-ink-2"
                            >
                              {unmarkedCount === 1
                                ? "Falta 1 alumno por marcar"
                                : `Faltan ${unmarkedCount} alumnos por marcar`}
                            </p>
                          )}
                          {/*
                           * The `key`s are load-bearing, not decoration.
                           *
                           * Both branches render a `Button` in the same slot,
                           * so React reconciled them into ONE `<button>` node
                           * and merely swapped its `type` from "button" to
                           * "submit". React flushes the state update inside the
                           * click handler, so by the time the browser ran that
                           * click's DEFAULT ACTION the node under the finger
                           * was already a submit button: one tap on "Siguiente"
                           * advanced the wizard AND filed the session, skipping
                           * the confirmation step entirely. Distinct keys make
                           * React replace the node instead of mutating it.
                           */}
                          {!isLast ? (
                            <Button
                              key="advance"
                              type="button"
                              variant="primary"
                              onClick={handleNext}
                              disabled={students.length === 0 || unmarkedCount > 0}
                              aria-describedby={unmarkedCount > 0 ? unmarkedReasonId : undefined}
                            >
                              Siguiente
                              <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />
                            </Button>
                          ) : (
                            <Button
                              key="file-session"
                              type="submit"
                              variant="primary"
                              disabled={
                                submitting ||
                                entrenadorPersonaId === null ||
                                students.length === 0 ||
                                unmarkedCount > 0
                              }
                              aria-describedby={unmarkedCount > 0 ? unmarkedReasonId : undefined}
                            >
                              {submitting ? (
                                "Registrando…"
                              ) : (
                                <>
                                  <CheckCircle size={14} strokeWidth={2} aria-hidden="true" />
                                  Confirmar Asistencia
                                </>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </form>
                </div>
              </div>
            </>
          )}
        </div>
      )}
      </AppShell>
    </ProtectedRoute>
  );
}
