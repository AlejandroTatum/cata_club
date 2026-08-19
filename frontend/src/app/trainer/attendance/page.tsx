/**
 * Trainer Attendance — "Pasar lista"
 * (`docs/archive/prototypes/prototipos/20-tomar-lista.html`).
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
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  Undo2,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_STATES,
  UNMARKED,
  arrowAttendanceState,
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
  buildAttendanceReceipt,
  buildRosterFromAlumnoHorarios,
  hasUnsavedAttendanceEdits,
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
} from "@/app/attendance/attendance-utils";
import ConfirmDialog from "@/components/ConfirmDialog";
import ContextualHelp from "@/components/ContextualHelp";
import AttendanceCorrectionRow, { type CorrectionPatch } from "./CorrectionRow";
import {
  SessionCompositionBar,
  SessionCompositionCounts,
} from "@/app/trainer/SessionComposition";
import { formatStateCount } from "@/app/trainer/trainer-day-utils";
import { ATTENDANCE_STATUS_CHART_COLORS } from "@/app/dashboard/dashboard-utils";
import {
  Badge,
  BackLink,
  Button,
  buttonClasses,
  EmptyState,
  ErrorState,
  LoadingState,
  StatCard,
  Stepper,
} from "@/components/ui";
import { getUserInitials } from "@/lib/auth-utils";
import { clubIsoDate, lastOccurrenceOfDiaSemana, todayDiaSemana } from "@/lib/club-date";
import { formatDateTime } from "@/lib/format-utils";
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

/** One reversible marking action: the roster before it, and what it was. */
interface RosterUndoEntry {
  students: SessionStudent[];
  label: string;
}

/**
 * How many marking actions stay reversible. Deep enough to cover "I tapped the
 * wrong row three times in a row", shallow enough that a 40-student roster
 * never pins forty copies of itself in memory.
 */
const UNDO_DEPTH = 20;

/** The card heading per step. */
const STEP_LABELS: Record<WizardStep, string> = {
  "select-session": "Elija el horario",
  "mark-attendance": "Pasar lista",
  confirm: "Confirmar y finalizar",
};

// ---------------------------------------------------------------------------
// UI constants
// ---------------------------------------------------------------------------

const ATTENDANCE_ICONS: Record<EstadoAsistencia, React.ReactNode> = {
  present: <UserCheck size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  absent: <UserX size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  late: <Timer size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
  justified: <FileText size={ICON.sm} strokeWidth={2} aria-hidden="true" />,
};

/*
 * `TOTAL_LABELS` used to live here — a third singular/plural table for the
 * four states, spent on the save bar's running totals and on the receipt
 * bar's accessible name. Both read `formatStateCount` now, which is the one
 * the panel already had.
 */

/** Best news first — the same order every attendance surface reads in. */
const TOTAL_ORDER: EstadoAsistencia[] = ["present", "late", "justified", "absent"];

/**
 * One line per estado, for the "Cómo funciona pasar lista" help panel.
 *
 * #315 hallazgo #20: the four estados were named all over the app (badges,
 * radios, filters) but defined nowhere — a novice trainer choosing between
 * four equal-weight buttons had no screen that said what any of them meant.
 * `justified` is worded from `buildMonthAttendanceRate`'s own note (Justificado
 * y ausente no son "entrenó", pero se cuentan aparte): it is its own bucket,
 * not a synonym for ausente.
 */
const ATTENDANCE_DEFINITIONS: Record<EstadoAsistencia, string> = {
  present: "asistió a la clase.",
  late: "asistió, pero llegó después de que empezó.",
  justified: "no asistió, pero avisó un motivo que el club aceptó — se registra aparte de una ausencia.",
  absent: "no asistió y no hay motivo aceptado.",
};

/*
 * `RECEIPT_TONE_CLASS` used to live here: the state ramp (ok / warn / neutral
 * / bad), painting the receipt's proportional bar and its per-row dots.
 *
 * It was the wrong ramp for a bar, and the reason is written down one folder
 * over. `dashboard-utils.ts` says in as many words that the badge/state tokens
 * "fail the dataviz adjacent-pair CVD/normal-vision checks when placed side by
 * side in a chart", which is why the donut has its own validated palette —
 * and a proportional bar is precisely four fills placed side by side. Worse,
 * the two ramps disagreed on the same session within two clicks: "justificado"
 * was grey on the receipt and blue in "Últimas listas" and the history, for
 * the list the trainer had just filed.
 *
 * The bar and its dots now come from `SessionComposition` /
 * `ATTENDANCE_STATUS_CHART_COLORS`, like every other adjacent-segment figure
 * in the panel. Badges keep the state ramp: a badge is a pill on its own, not
 * a segment against three neighbours.
 */

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TrainerAttendancePage(): React.ReactElement {
  const { session } = useAuth();
  const { showError, showSuccess } = useToast();
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
  /**
   * The roster exactly as `openRoster` last got it from the server — BEFORE
   * the draft overlay, let alone any tap. `hasUnsavedMarks` diffs `students`
   * against this to tell a row the server already filled in apart from one
   * the trainer just edited (issue #335). A ref, not state: it only ever
   * changes alongside `students` itself (inside `openRoster`/`handleReset`),
   * so it needs no render of its own.
   */
  const serverRosterRef = useRef<SessionStudent[]>([]);
  const [undoStack, setUndoStack] = useState<RosterUndoEntry[]>([]);
  const [sessionDate, setSessionDate] = useState<string | null>(null);
  const [restoredFromDraft, setRestoredFromDraft] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  /** Narrows the roll call to the rows nobody has touched yet. */
  const [onlyUnreviewed, setOnlyUnreviewed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<RegisterAttendanceResult | null>(null);
  /**
   * The moment the batch was actually filed — captured once, at the same time
   * `confirmed` flips, rather than re-read at render time. The receipt's
   * identity band reads it as "when this got archived", and a value computed
   * on every render would keep ticking forward after the fact.
   */
  const [confirmedAt, setConfirmedAt] = useState<Date | null>(null);
  /**
   * Where focus goes when the receipt appears (issue #213 accessibility
   * requirement): the screen's own heading, not the first button — a filed
   * session is a state change the trainer needs read out, not a decision
   * waiting on them.
   */
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  /** A position read off the URL that still needs its roster loaded. */
  const [pendingRestore, setPendingRestore] = useState<WizardLocation | null>(null);
  /**
   * The session date the URL explicitly asked for, `null` for today.
   *
   * Deliberately NOT the same value as `sessionDate`, which is always a real
   * date: this one is what gets written BACK to the URL, so the ordinary
   * "pasar lista hoy" flow keeps its short address and only a correction
   * carries `?fecha=`.
   */
  const [requestedDate, setRequestedDate] = useState<string | null>(null);
  /** Unfinished roll calls for today, offered on step 1 — never auto-applied. */
  const [resumableDrafts, setResumableDrafts] = useState<StoredAttendanceDraft[]>([]);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  /**
   * True once `openRoster` finds at least one existing record for the
   * session it just opened — the backend upsert rule (`registrar_asistencia`)
   * treats every one of those as a CORRECTION, and only ADMINISTRADOR may
   * make one. Without this the trainer discovered the rejection on the last
   * click of "Confirmar asistencia" instead of on open (issue #310 / #3).
   */
  const [sessionAlreadyRegistered, setSessionAlreadyRegistered] = useState(false);
  /**
   * Per-horario count of TODAY's attendance records, fetched once the
   * schedules land. Powers step 1's "lista tomada hoy" indicator (issue #310
   * / #22) — without it, a horario that was just registered looked identical
   * to one nobody has touched yet.
   */
  const [todaysRecordCounts, setTodaysRecordCounts] = useState<Map<number, number>>(new Map());

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
   * Feeds step 1's "lista tomada hoy" indicator (issue #310 / #22): without
   * it, a horario registered minutes ago read identical to the 25 still
   * pending, and the only way to tell them apart was opening each one.
   * Scoped to TODAY only — step 1 offers no way to address a different date
   * before a horario is chosen, so a count for any other day would not
   * describe what the trainer is looking at.
   */
  useEffect(() => {
    if (schedules.length === 0) return;
    let cancelled = false;
    fetchAttendanceRecords({ fechaInicio: clubIsoDate(), fechaFin: clubIsoDate() })
      .then((records) => {
        if (cancelled) return;
        const counts = new Map<number, number>();
        for (const record of records) {
          counts.set(record.horarioId, (counts.get(record.horarioId) ?? 0) + 1);
        }
        setTodaysRecordCounts(counts);
      })
      .catch((err: unknown) => {
        console.error("[trainer/attendance] fetchAttendanceRecords today-counts failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [schedules]);

  /**
   * Issue #352: a toast alone left this outcome to a 4500ms window
   * (`TOAST_DURATION_MS`, `ToastContext.tsx`) that closes long before the
   * trainer notices — the client's own timeout budget is 10000ms
   * (`DEFAULT_TIMEOUT_MS`, `services/api.ts`), so the toast can dismiss
   * itself before the failure it announces even lands. The toast still
   * fires, for whoever IS looking right when it fails; `renderConfirmation`
   * also renders `submitError` inline, directly above "Confirmar
   * asistencia" — the button that stays on screen, re-enabled, ready to
   * retry — so the notice survives past the toast's own clock.
   */
  useEffect(() => {
    if (submitError) showError(submitError);
  }, [submitError, showError]);

  const currentIndex = STEP_ORDER.indexOf(step);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === STEP_ORDER.length - 1;

  const isAdmin = session?.user?.role === "admin";
  /**
   * A session that already has a row is permanently closed for EVERYONE now —
   * admin included (issue #389: the backend's `registrar_asistencia` rejects
   * a second row for the same persona/session with no exception, and the only
   * way to fix a mistake is the separate correction endpoint, which this
   * wizard does not expose). Gates step 2 and step 3 into read-only — see
   * `renderMarkAttendance` — instead of letting the user rebuild every state
   * only to have the backend reject all of them on the last click (issue
   * #310 / #3).
   */
  const readOnly = sessionAlreadyRegistered;

  const selectedSchedule = schedules.find((s) => s.id === selectedScheduleId) ?? null;

  /**
   * Issue #368: lo mismo que `readOnly`, pero SABIDO desde el paso 1 y sin
   * haber abierto nada. `readOnly` depende de `openRoster`, o sea de haberse
   * decidido ya; esto se deriva del conteo que la tarjeta muestra, así que el
   * motivo puede decirse junto al control que ofrece continuar en vez de en la
   * pantalla siguiente.
   *
   * Acotado a HOY igual que la tarjeta: `todaysRecordCounts` solo trae la
   * fecha de hoy, y un horario de otro día no tiene conteo que reportar (#308).
   */
  const selectedListTakenToday =
    selectedSchedule !== null &&
    selectedSchedule.diaSemana === today &&
    (todaysRecordCounts.get(selectedSchedule.id) ?? 0) > 0;

  /** The draft's key — null until a session is actually chosen. */
  const draftKey = useMemo(
    () =>
      selectedScheduleId !== null && sessionDate
        ? attendanceDraftKey(selectedScheduleId, sessionDate)
        : null,
    [selectedScheduleId, sessionDate],
  );

  // Sin relación entrenador–horario (issue #13): la asistencia no registra
  // quién dictó la sesión, así que no hay entrenador que resolver.

  // /trainer is gated to the "trainer" role only — an admin using this page
  // must bounce back to their own attendance overview, not the trainer panel.
  const backHref = session?.user?.role === "admin" ? "/attendance" : "/trainer";
  /**
   * The receipt's "salida hacia el historial" (issue #213). `/attendance` —
   * `backHref`'s own admin destination — already IS the admin's history view
   * (filterable records, same screen `backHref` sends them to); a trainer has
   * no such overlap, so this points at the trainer's own history route
   * instead of doubling up on `backHref`.
   */
  const attendanceHistoryHref =
    session?.user?.role === "admin" ? "/attendance" : "/trainer/attendance/history";

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
    (
      horarioId: number | null,
      fecha: string | null,
      target: WizardStep,
      mode: "push" | "replace",
    ): void => {
      if (typeof window === "undefined") return;
      const url = `${window.location.pathname}${buildWizardQuery(horarioId, fecha, target)}`;
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
   * offer on step 1, a reload on `?paso=lista`, a "Corregir" deep link from
   * the history, and a Back that outlived the roster in memory — so all of
   * them get the same roster, the same draft overlay and the same "only
   * reviewed rows come back" guarantee.
   *
   * `requestedDate` is the session's own day, and `null` means today. It is
   * the ONE value that decides which session this whole screen is about: the
   * prefill of already-filed marks, the draft key and the date the batch is
   * filed on all derive from it. Hard-wiring today here is what stopped the
   * history's "Corregir" from being able to correct anything — it would open
   * today's list for that group and file a second session instead.
   *
   * Resolves `true` only when the roster actually landed on `target`. The
   * failure path sets `rosterError` and leaves `step` where it was, which is
   * invisible to a caller that cannot tell the two apart — see
   * `handleRetryFailed`, which must not tear the receipt down over a load
   * that never happened.
   */
  const openRoster = useCallback(
    async (
      horarioId: number,
      requestedDate: string | null,
      target: Exclude<WizardStep, "select-session">,
      mode: "push" | "replace",
    ): Promise<boolean> => {
      setRosterLoading(true);
      setRosterError(null);
      try {
        // Re-opening the wizard for a session that already has attendance
        // recorded must show those existing marks, not silently default
        // everyone back to unmarked.
        const fecha = requestedDate ?? clubIsoDate();
        // The prefill fetch is a convenience, not a requirement: if it fails,
        // fall back to an empty list rather than failing the whole roster load.
        const [alumnoHorarios, existingRecords] = await Promise.all([
          fetchAlumnosPorHorario(horarioId),
          fetchAttendanceRecords({ fechaInicio: fecha, fechaFin: fecha, horarioId }).catch(
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
        // Snapshot BEFORE the draft overlay below — see `hasUnsavedAttendanceEdits`.
        serverRosterRef.current = roster;
        const draft = loadAttendanceDraft(attendanceDraftKey(horarioId, fecha));
        const withDraft = applyAttendanceDraft(roster, draft);

        // At least one record already exists for this (horario, fecha): the
        // whole session is closed under the backend's upsert rule, for
        // everyone, admin included (issue #389) — only the separate
        // correction endpoint can touch it, and this wizard does not expose
        // that. Read BEFORE the draft is applied — the draft can mark a
        // student reviewed too, and that must never be mistaken for "the club
        // already has this on file" (issue #310 / #3).
        setSessionAlreadyRegistered(existingRecords.length > 0);
        setSessionDate(fecha);
        setRequestedDate(requestedDate);
        setRestoredFromDraft(
          withDraft !== roster && countUnreviewed(withDraft) < countUnreviewed(roster),
        );
        setStudents(withDraft);
        // A roster that just loaded has no marking actions behind it — an undo
        // here would restore a roster from a different session.
        setUndoStack([]);
        setOnlyUnreviewed(false);
        setStep(target);
        writeWizardUrl(horarioId, requestedDate, target, mode);
        return true;
      } catch (err) {
        console.error("[trainer/attendance] fetchAlumnosPorHorario failed", err);
        setRosterError(
          "No se pudo cargar el listado de estudiantes de este horario. Revise su conexión e intente nuevamente.",
        );
        return false;
      } finally {
        setRosterLoading(false);
      }
    },
    [writeWizardUrl],
  );

  /**
   * A row's correction just landed (issue #389, slice 4b) — patch `students`
   * AND `serverRosterRef.current` in the SAME operation. Both derive from the
   * exact same `apply` closure so they can never disagree: if only `students`
   * moved, `hasUnsavedAttendanceEdits` would diff a row that WAS saved
   * against a stale server snapshot and spuriously flag it as unsaved,
   * tripping the `beforeunload` warning on a session the admin just closed
   * again on purpose.
   *
   * Correcting stays available on the same row afterward (unlimited
   * sequential corrections within the window) — this only ever patches the
   * one row, it never disables anything.
   */
  const handleRowCorrected = useCallback((personaId: string, patch: CorrectionPatch): void => {
    const apply = (list: SessionStudent[]): SessionStudent[] =>
      list.map((s) =>
        s.id === personaId
          ? { ...s, attendance: patch.attendance, justificativo: patch.justificativo, estadoJustificativo: patch.estadoJustificativo }
          : s,
      );
    setStudents((prev) => apply(prev));
    serverRosterRef.current = apply(serverRosterRef.current);
  }, []);

  async function handleContinueToRoster(): Promise<void> {
    if (selectedScheduleId === null) return;
    // A schedule on TODAY's own day needs no explicit date — `openRoster`
    // already gives "today" via `clubIsoDate()` when `requestedDate` is
    // `null`. A schedule from a DIFFERENT day must carry its own date
    // explicitly: the empty state's own "puede pasar la lista de otro día"
    // invites exactly this path, and letting it fall through to `null` here
    // was issue #308 — every such session filed under TODAY's date instead
    // of the day it actually happened on, corrupting the history.
    //
    // Not a reuse of the previous `requestedDate`: that would let a
    // correction the trainer walked back out of date the NEXT session they
    // choose. This is always freshly derived from the SELECTED schedule.
    const requestedDate =
      selectedSchedule && selectedSchedule.diaSemana !== today
        ? lastOccurrenceOfDiaSemana(selectedSchedule.diaSemana)
        : null;
    await openRoster(selectedScheduleId, requestedDate, "mark-attendance", "push");
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
    writeWizardUrl(selectedScheduleId, requestedDate, previous, "replace");
    setStep(previous);
  }

  function handleNext(): void {
    const next = STEP_ORDER[currentIndex + 1];
    if (!next) return;
    setStep(next);
    writeWizardUrl(selectedScheduleId, requestedDate, next, "push");
  }

  /**
   * Restore the position the URL is asking for, once the schedules it refers
   * to are actually loaded. A horario that no longer exists (or a hand-typed
   * one that never did) falls back to the picker rather than to a roll call
   * for nobody.
   */
  useEffect(() => {
    if (!pendingRestore || loading || loadError) return;
    const { horarioId, fecha, step: target } = pendingRestore;
    setPendingRestore(null);
    if (horarioId === null || target === "select-session") return;
    if (!schedules.some((s) => s.id === horarioId)) {
      writeWizardUrl(null, null, "select-session", "replace");
      return;
    }
    setSelectedScheduleId(horarioId);
    void openRoster(horarioId, fecha, target, "replace");
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
      //
      // The DATE is part of "which roster": the same horario on two days is
      // two different sessions, and reusing the one in memory would show the
      // marks of one while the URL — and the batch — say the other.
      if (
        entry.horarioId === selectedScheduleId &&
        entry.fecha === requestedDate &&
        students.length > 0
      ) {
        setStep(entry.step);
        return;
      }
      setPendingRestore(entry);
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [confirmed, selectedScheduleId, requestedDate, students.length]);

  // Receipt a11y requirement (issue #213): focus lands on the screen's own
  // heading when it appears, not on the first button — a filed session is a
  // state change to announce, not a decision waiting on input.
  useEffect(() => {
    if (confirmed) confirmationHeadingRef.current?.focus();
  }, [confirmed]);

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

  /**
   * Every path that changes a mark funnels through here, so does the draft —
   * and so does the undo stack.
   *
   * The stack holds the roster AS IT WAS, not a description of the edit, which
   * is what lets one entry undo the bulk action's forty simultaneous changes
   * exactly as easily as it undoes one tap. It also restores `reviewed`, and
   * that is the part that matters: putting a row back to "Presente" while
   * leaving it counted as reviewed would launder "nobody looked" into
   * "confirmed", which is precisely what the unreviewed counter exists to stop.
   */
  const commitStudents = useCallback(
    (next: SessionStudent[], undoLabel: string): void => {
      setUndoStack((stack) => {
        const grown = [...stack, { students, label: undoLabel }];
        return grown.length > UNDO_DEPTH ? grown.slice(grown.length - UNDO_DEPTH) : grown;
      });
      setStudents(next);
      setRestoredFromDraft(false);
      if (draftKey) saveAttendanceDraft(draftKey, next);
    },
    [draftKey, students],
  );

  const lastUndoable = undoStack[undoStack.length - 1] ?? null;

  /**
   * Reads the top of the stack directly rather than from inside a `setUndoStack`
   * updater: an updater has to be pure, and React invokes it twice under
   * StrictMode. Restoring the roster and rewriting the draft are side effects,
   * so they belong out here where they happen exactly once.
   */
  const handleUndo = useCallback((): void => {
    if (!lastUndoable) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setStudents(lastUndoable.students);
    setRestoredFromDraft(false);
    if (draftKey) saveAttendanceDraft(draftKey, lastUndoable.students);
  }, [draftKey, lastUndoable]);

  /**
   * Every mark the trainer makes is also a REVIEW of that student — including
   * setting a row to the state it already had. Tapping "Presente" on a student
   * who was already present by default is the trainer saying "yes, that one is
   * here", and the roll call has to stop asking about them.
   */
  function handleDirectAttendanceSet(studentIndex: number, state: EstadoAsistencia): void {
    commitStudents(
      students.map((s, i) => (i === studentIndex ? { ...s, attendance: state, reviewed: true } : s)),
      `marcar a ${students[studentIndex]?.name ?? "un alumno"}`,
    );
  }

  /**
   * Arrow-key navigation for the four-state radiogroup (issue #312 /
   * hallazgo #26): the ARIA radiogroup pattern moves both focus and the
   * checked state together, like a native `<input type="radio">` group.
   * Extracted out of the JSX (rather than inlined in the `onKeyDown` prop)
   * so the touch-target-floor marker on that button stays close enough to
   * its `min-h-[44px]` class for `touch-target-usage.test.ts`'s static scan.
   */
  function handleAttendanceRadioKeyDown(
    e: React.KeyboardEvent<HTMLButtonElement>,
    studentIndex: number,
    state: EstadoAsistencia,
  ): void {
    if (
      e.key !== "ArrowRight" &&
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowDown" &&
      e.key !== "ArrowUp"
    ) {
      return;
    }
    e.preventDefault();
    const nextState = arrowAttendanceState(state, e.key);
    handleDirectAttendanceSet(studentIndex, nextState);
    // Move focus WITH the checked state — the roving tabindex below only
    // works if focus actually lands on the newly-checked radio.
    const group = e.currentTarget.closest('[role="radiogroup"]');
    const next = group?.querySelector<HTMLButtonElement>(`[role="radio"][data-state="${nextState}"]`);
    next?.focus();
  }

  /** The whole fiche is tappable — one target for the common case. */
  function handleCycleAttendance(studentIndex: number): void {
    commitStudents(
      students.map((s, i) =>
        i === studentIndex ? { ...s, attendance: tapWizardAttendance(s), reviewed: true } : s,
      ),
      `marcar a ${students[studentIndex]?.name ?? "un alumno"}`,
    );
  }

  /**
   * Bulk action for the common case (near-full attendance): the trainer states
   * in one tap that everyone they have not touched is present. Marks the
   * trainer already made are preserved. Applies to the whole roster, not just
   * the visible page or the current filter.
   *
   * It also carries its own undo in the confirmation toast. The commit bar's
   * "Deshacer" would reverse it just as well, but this action rewrites rows on
   * roster pages the trainer never scrolled to — the confirmation is the only
   * place those changes are ever mentioned, so it is where the way back
   * belongs.
   */
  function handleMarkRemainingPresent(): void {
    const affected = countUnreviewed(students);
    if (affected === 0) return;
    const previous = students;
    // Where the stack stood before this action. Restoring `previous` means
    // everything stacked after the bulk is gone too, so the stack is truncated
    // to here rather than popped: popping would drop whatever happens to be on
    // top, which need not be this action at all.
    const depthBefore = undoStack.length;
    commitStudents(markRemainingPresent(students), "marcar restantes presentes");
    showSuccess(
      affected === 1 ? "1 alumno marcado presente" : `${affected} alumnos marcados presentes`,
      {
        description: "Quedaban sin revisar. Puede deshacerlo desde aquí.",
        action: {
          label: "Deshacer",
          onAction: () => {
            setUndoStack((stack) => stack.slice(0, depthBefore));
            setStudents(previous);
            setRestoredFromDraft(false);
            if (draftKey) saveAttendanceDraft(draftKey, previous);
          },
        },
      },
    );
  }

  async function handleConfirm(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (!selectedScheduleId) return;
    // Only the confirmation step files a session. Without this, a submit that
    // reached the form from anywhere else would file one straight from the
    // roll call — see the `key` on the advance/submit buttons for the way that
    // actually happened.
    if (step !== "confirm") return;
    // Defense in depth: `renderMarkAttendance`/the commit bar already keep a
    // read-only session from reaching this step, but a direct `?paso=confirmar`
    // deep link or a role that changed mid-visit must not get a second way in
    // (issue #310 / #3).
    if (readOnly) return;
    // Never file a session carrying the sentinel — `toAttendanceMarks` strips
    // it, and this refuses the batch rather than filing a short roster.
    if (countUnmarked(students) > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const registration = await registerAttendance({
        horarioId: selectedScheduleId,
        // Sent explicitly rather than left to the route's "today" default:
        // this is the day the roster was READ for, and on a correction it is
        // deliberately not today. Filing on the default would leave the wrong
        // records untouched and add a second session dated now.
        fechaEntrenamiento: sessionDate ?? undefined,
        // `toAttendanceMarks` strips the frontend-only `unmarked` sentinel,
        // which the backend contract does not accept.
        students: toAttendanceMarks(students),
      });
      setResult(registration);
      setConfirmedAt(new Date());
      setConfirmed(true);
      // The draft's job ends the moment a submission attempt actually reaches
      // the server, whether or not it saved everything (issue #310 / #5): a
      // draft kept alive past a rejection is what let a reopened roster show
      // the trainer's UNSAVED intent as if the club had it on file. Discarding
      // it always — never only on full success — is the fix: a retry that
      // needs those marks re-derives them from the freshly re-fetched roster
      // (`handleRetryFailed` → `openRoster`), not from a stale draft.
      if (draftKey) clearAttendanceDraft(draftKey);
      // Drop the step from the URL: a filed session must not be reachable as
      // an editable roll call by reloading the page that filed it.
      writeWizardUrl(null, null, "select-session", "replace");
    } catch (err) {
      console.error("[trainer/attendance] registerAttendance failed", err);
      // Same reasoning as the success-with-failures branch above: nothing
      // this attempt tried to write was actually saved, so nothing of it may
      // survive as a phantom "the club has this" draft (issue #310 / #5).
      if (draftKey) clearAttendanceDraft(draftKey);
      setSubmitError("No se pudo registrar la asistencia. Intente nuevamente.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset(): void {
    if (draftKey) clearAttendanceDraft(draftKey);
    writeWizardUrl(null, null, "select-session", "replace");
    ownedHistoryEntries.current = 0;
    setStep("select-session");
    setSelectedScheduleId(null);
    setSessionDate(null);
    setRequestedDate(null);
    setRestoredFromDraft(false);
    setStudents([]);
    serverRosterRef.current = [];
    setUndoStack([]);
    setSearchFilter("");
    setOnlyUnreviewed(false);
    setConfirmed(false);
    setSubmitting(false);
    setSubmitError(null);
    setResult(null);
    setConfirmedAt(null);
    setSessionAlreadyRegistered(false);
  }

  /**
   * The receipt's primary action when some records failed (decision 2,
   * issue #213): re-open the SAME session's roster, freshly re-fetched, so
   * the students who saved show as already reviewed and only the failed
   * ones are left to correct — never the picker, which would make the
   * trainer re-find this exact horario and date by hand.
   *
   * The receipt comes down only once the roster is actually back. Clearing
   * `confirmed` first would drop the trainer onto the pre-submission review
   * of a roster that is still fully marked — where confirming again refiles
   * every student, including the ones already saved, and `result.failed`
   * would already be gone.
   *
   * A failed re-fetch leaves `step` at "confirm" (see `openRoster`), so
   * `renderConfirmation` renders `rosterError` itself (issue #241) — the
   * error used to only exist on step 1, invisible from this screen.
   */
  async function handleRetryFailed(): Promise<void> {
    if (selectedScheduleId === null) return;
    const opened = await openRoster(
      selectedScheduleId,
      requestedDate,
      "mark-attendance",
      "replace",
    );
    if (!opened) return;
    setConfirmed(false);
    setResult(null);
    setConfirmedAt(null);
  }

  // ---- Student list (attendance wizard) ----
  //
  // Issue #318 / hallazgo #58 (K9): this used to paginate at 10 (`Pagination`
  // + `WIZARD_PAGE_SIZE`), which forced a page change mid-session for any
  // roster over 10 alumnos and was the single largest contributor to the
  // 22-click walkthrough the audit measured on a 15-alumno session. The whole
  // roster now renders in one pass — the trainer scrolls, never paginates —
  // and "Marcar restantes presentes" (below) is the actual answer to a long
  // roster, not a page-2 button.

  const filteredStudents = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q && !onlyUnreviewed) return students;
    return students.filter(
      (s) =>
        (!q || s.name.toLowerCase().includes(q)) && (!onlyUnreviewed || !isReviewed(s)),
    );
  }, [students, searchFilter, onlyUnreviewed]);

  // Deliberately computed over `students` (the FULL roster) rather than
  // `filteredStudents`: the search box filters, so a filter-scoped count
  // would report "0 sin revisar" while students the name filter hid were
  // about to be filed present sight unseen — the exact silent-data-loss path
  // this counter exists to close.
  /**
   * The four states as one record, so the confirmation step can preview the
   * session with the same figure the receipt archives it with. The whole
   * roster is the denominator, not the sum of the four: a row still carrying
   * the `UNMARKED` sentinel belongs to none of them, and the bar showing rail
   * where that row is, is the honest drawing of that.
   */
  const confirmCounts = useMemo(
    () =>
      TOTAL_ORDER.reduce(
        (counts, state) => ({ ...counts, [state]: countByState(students, state) }),
        {} as Record<EstadoAsistencia, number>,
      ),
    [students],
  );
  const unreviewedCount = useMemo(() => countUnreviewed(students), [students]);
  const unmarkedCount = useMemo(() => countUnmarked(students), [students]);
  const unmarkedReasonId = "attendance-unmarked-reason";

  /**
   * Decisions the trainer has made and not yet filed. `reviewed` is what makes
   * this answerable at all: the roster defaults everyone to "present", so
   * counting marked rows would call an untouched roster "unsaved work" and ask
   * about discarding something nobody wrote.
   */
  const reviewedCount = students.length - unreviewedCount;
  /**
   * NOT `reviewedCount > 0` (issue #335): `reviewed` also comes back `true`
   * for a row the SERVER already sent an `estado` for — every row, on an
   * already-registered session opened in read-only mode — which made
   * `reviewedCount` count decisions nobody made in this visit. This diffs
   * `students` against the server snapshot instead, so only an actual edit
   * (a live tap or a restored draft) counts as "unsaved".
   */
  const hasUnsavedMarks = !confirmed && hasUnsavedAttendanceEdits(students, serverRosterRef.current);

  // ---- The confirmation receipt (issue #213) ----

  /**
   * Counts what got SAVED, not what the trainer marked (decision 2): a failed
   * record is excluded from every one of the four states, not just tallied
   * separately, because the receipt describes the archive, not the intent.
   */
  const receiptCounts = useMemo(
    () => buildAttendanceReceipt(students, result?.failed.map((f) => f.personaId) ?? []),
    [students, result],
  );
  const receiptTotal = TOTAL_ORDER.reduce((sum, state) => sum + receiptCounts[state], 0);
  const hasFailedRecords = (result?.failed.length ?? 0) > 0;
  const retryButtonLabel = (() => {
    if (rosterLoading) return "Reintentando…";
    const failedCount = result?.failed.length ?? 0;
    if (failedCount === 1) return "Reintentar con ese alumno";
    return `Reintentar con esos ${failedCount} alumnos`;
  })();
  /*
   * The receipt bar's accessible name (issue #213's a11y requirement) is built
   * by `SessionCompositionBar` now — the bar is decorative on its own, so it
   * still says out loud the four values a sighted reader gets from its
   * proportions, in the same sentence every other copy of that bar uses, and
   * with the total this one used to leave out.
   */

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
    // `null`, not `draft.fecha`: the offer only ever lists TODAY's drafts
    // (`listAttendanceDrafts(clubIsoDate())`), so the two are the same date
    // and `null` keeps the resumed URL as short as the one it resumes.
    void openRoster(draft.horarioId, null, "mark-attendance", "push");
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
                    <ChevronRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="tertiary"
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
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-field">
            <p className="text-sm text-ink-3">
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
                className="text-xs font-semibold text-ink-2 underline underline-offset-2 transition-colors hover:text-ink"
              >
                {showAllDays ? "Ver solo hoy" : "Ver todos los días"}
              </button>
            )}
          </div>
          {visible.emptyToday && (
            <p className="mb-3 text-xs text-ink-3">
              No hay entrenamientos hoy ({formatDay(today).toLowerCase()}). Mostrando la semana
              completa.
            </p>
          )}
          {schedules.length === 0 ? (
            <EmptyState
              icon={<Calendar size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
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
                        size={ICON.sm}
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
                          // Only meaningful for TODAY's group: `todaysRecordCounts`
                          // is fetched for today's date alone (see the effect that
                          // builds it), so a horario from another day group has no
                          // count to report here — asserting one either way would
                          // describe a session nobody has opened yet (issue #310 /
                          // #22).
                          const recordedToday =
                            group.day === today ? todaysRecordCounts.get(sched.id) ?? 0 : 0;
                          // Issue #368: ese conteo no es un dato más, es un
                          // IMPEDIMENTO — la sesión ya registrada solo se abre
                          // en modo consulta. Issue #389: la ventana de 30
                          // días del administrador (#262) ya no existe —
                          // cerrar una lista es permanente para todos, así que
                          // la tarjeta se deshabilita también para él, por el
                          // mismo motivo que para cualquier otro usuario.
                          const takenForThisUser = recordedToday > 0;
                          return (
                            <button
                              key={sched.id}
                              type="button"
                              onClick={() => {
                                if (takenForThisUser) return;
                                setSelectedScheduleId(sched.id);
                              }}
                              disabled={takenForThisUser}
                              aria-pressed={isActive}
                              // Selection is coal + the yellow ball dot, never
                              // a red fill — red is CTA and destructive only.
                              // Issue #397: a schedule already taken today is
                              // genuinely unreachable — a real `disabled`, not
                              // a "solo consulta" mode dressed up with CSS —
                              // so it needs the shared disabled treatment too.
                              className={`flex min-h-[56px] flex-col justify-center gap-1 rounded-ctl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                isActive
                                  ? "border-coal bg-paper shadow-selected"
                                  : "border-line-2 bg-paper hover:border-ink-3"
                              }`}
                            >
                              <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                                <Clock size={ICON.sm} strokeWidth={2} className="text-ink-3" aria-hidden="true" />
                                {sched.horaInicio} — {sched.horaFin}
                                {isActive && (
                                  <span
                                    aria-hidden="true"
                                    className="ml-auto h-1.5 w-1.5 rounded-full bg-ball ring-2 ring-coal"
                                  />
                                )}
                              </span>
                              {recordedToday > 0 && (
                                <span className="flex items-center gap-1 text-2xs font-bold text-ink-3">
                                  Lista tomada hoy · {recordedToday}{" "}
                                  {recordedToday === 1 ? "registro" : "registros"}
                                </span>
                              )}
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

        {/*
         * El aviso del #368, pegado al mismo control que el error de roster.
         * Issue #397: la tarjeta ya no ofrece esta lectura por click — un
         * horario tomado hoy es `disabled` de entrada. Lo que queda es el
         * caso de vuelta atrás: el entrenador elige un horario disponible,
         * avanza, alguien más lo toma mientras tanto, y al presionar "Atrás"
         * vuelve al paso 1 con la selección todavía viva — ahí es donde este
         * aviso nombra la consecuencia antes de que "Continuar" reabra la
         * lista en modo consulta.
         *
         * `role="status"`, no `alert`: describe el estado del horario elegido,
         * no el resultado de algo que el entrenador acaba de hacer mal.
         */}
        {selectedListTakenToday && (
          <div
            role="status"
            className="rounded-ctl border border-state-warn/30 bg-state-warn-bg p-4 text-sm text-state-warn"
          >
            <p className="font-semibold">Esta lista ya fue tomada hoy.</p>
            <p>
              Puede continuar para consultarla, pero no para volver a tomarla: una vez registrada,
              la lista queda cerrada. Ante un error, consulte con administración.
            </p>
          </div>
        )}

        {/* Still directly above the control it blocks — that control is now
            the commit bar's "Continuar", which is the last thing on the card. */}
        {rosterError && (
          <div className="alert-error" role="alert">
            {rosterError}
          </div>
        )}
      </div>
    );
  }

  /**
   * The permission gate, spelled out — WHAT is blocked and WHO to ask, not
   * just THAT it is blocked (issue #310 / #3). Issue #389: closing a session
   * is now permanent for everyone, admin included — there is no one left who
   * can fix it from this wizard, so the message names the actual door
   * (administración, through the separate correction flow) instead of a role
   * that used to have a shortcut here. `role="status"` rather than `alert`:
   * this is the state of the session the user just opened, not the outcome
   * of something they did.
   */
  function renderReadOnlyReason(): React.ReactElement {
    return (
      <div
        role="status"
        className="rounded-ctl border border-state-warn/30 bg-state-warn-bg p-4 text-sm text-state-warn"
      >
        <p className="font-semibold">Esta lista ya fue registrada.</p>
        <p>
          Quedó cerrada de forma permanente — no se puede editar desde acá. Ante un error, consulte
          con administración.
        </p>
      </div>
    );
  }

  function renderMarkAttendance(): React.ReactElement | null {
    if (!selectedSchedule) return null;

    // A session that already has a row is closed for everyone now (issue
    // #389): the roster renders read-only, with the reason up front, instead
    // of letting the user rebuild every state only to have the backend
    // reject all of them on the last click. No radios, no fiche taps, no
    // bulk action — every control that used to promise an edit the backend
    // was always going to refuse is gone, not merely disabled.
    if (readOnly) {
      return (
        <div className="flex flex-col gap-4">
          {renderReadOnlyReason()}
          <ul className="flex flex-col gap-2" aria-label="Asistencia registrada (solo lectura)">
            {students.map((student) => (
              <AttendanceCorrectionRow
                key={student.id}
                student={student}
                sessionDate={sessionDate ?? clubIsoDate()}
                canCorrect={isAdmin}
                onCorrected={handleRowCorrected}
              />
            ))}
          </ul>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        {/*
         * The coal header: the live marker the trainer glances at, the session
         * it belongs to, and the one-tap shortcut for the common case.
         */}
        <div className="flex flex-wrap items-center gap-5 rounded-card bg-coal px-[22px] py-[18px] text-white">
          {/*
           * Revisados, no presentes (issue #313, K5 hallazgo #23): el roster
           * arranca en PRESENTE por defecto, así que el conteo crudo de
           * "presentes" daba "16/16" antes de que el entrenador mirara a
           * nadie — un novato lo lee como lista ya tomada. El número grande
           * ahora mide lo que de verdad se decidió; `unreviewedCount` (la
           * misma fuente que ya alimentaba el aviso de abajo) es lo que
           * falta para llegar al total.
           */}
          <span
            aria-live="polite"
            className="text-display font-extrabold leading-none tabular-nums"
          >
            {reviewedCount}
            <span className="text-lg text-white/50">/{students.length}</span>
          </span>
          <span className="flex min-w-[170px] flex-1 flex-col gap-1">
            <b className="text-base font-bold">revisados</b>
            <span className="flex flex-wrap items-center gap-1.5 text-sm text-white/60">
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
              <span className="flex items-center gap-1.5 text-xs font-bold text-ball">
                <AlertTriangle size={ICON.sm} strokeWidth={2.5} aria-hidden="true" />
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
              className="inline-flex h-ctl items-center gap-2 rounded-ctl border border-white/25 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              <UserCheck size={ICON.sm} strokeWidth={2} aria-hidden="true" />
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
            icon={<Users size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
            title="Este horario no tiene alumnos asignados."
            description="Pida a administración que asigne alumnos a este horario para poder tomar lista."
          />
        ) : (
          <>
            {/*
              D11c: the subtitle says WHAT this is, and everything that
              explains HOW it works goes behind "Ver ayuda". This strip was a
              legend of five chips plus a sentence, permanently occupying a
              row above the roster to explain a mechanic the trainer learns on
              the first tap — and each fiche already prints its own state as a
              labelled chip, so the legend was mostly repeating what was
              already on screen underneath it.
            */}
            <ContextualHelp title="Cómo funciona pasar lista">
              <p className="mb-2">
                Toque la ficha de un alumno para confirmar o cambiar su estado, o use los cuatro
                botones de la derecha para elegirlo directamente. Los cuatro estados son:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {TOTAL_ORDER.map((state) => (
                  <Badge key={state} tone={getAttendanceBadgeTone(state)}>
                    {ATTENDANCE_LABELS[state]}
                  </Badge>
                ))}
              </div>
              <ul className="mt-2 flex flex-col gap-1">
                {TOTAL_ORDER.map((state) => (
                  <li key={state}>{`${ATTENDANCE_LABELS[state]}: ${ATTENDANCE_DEFINITIONS[state]}`}</li>
                ))}
              </ul>
              <p className="mt-2">
                Una ficha con borde punteado y el estado{" "}
                <span className="h-badge inline-flex items-center rounded-full border border-dashed border-line-2 px-[11px] text-2xs tracking-flat font-bold text-ink-3">
                  Sin revisar
                </span>{" "}
                sigue en el valor por defecto porque todavía nadie la miró.
              </p>
            </ContextualHelp>

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
                className="h-ctl min-w-[180px] flex-1 rounded-ctl border border-line-2 bg-paper px-[13px] text-sm text-ink placeholder:text-ink-3 focus:border-cata-red focus:outline-none"
              />
              {/* Turns the count into something the trainer can act on: the
                  point of knowing 12 are unreviewed is being able to go
                  through those 12. Selection is coal, never a red fill. */}
              {(unreviewedCount > 0 || onlyUnreviewed) && (
                <button
                  type="button"
                  onClick={() => setOnlyUnreviewed((prev) => !prev)}
                  aria-pressed={onlyUnreviewed}
                  className={`inline-flex h-ctl shrink-0 items-center gap-2 rounded-ctl border px-4 text-sm font-semibold transition-colors ${
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
                icon={<Users size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
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
                /* Both filters hand back their own way out. The name filter
                   used to end at "revise el filtro o bórrelo", which is D11's
                   third part written as a sentence instead of as something to
                   press — on the one screen where the trainer is standing up
                   with a phone in one hand. */
                action={
                  onlyUnreviewed ? (
                    <Button type="button" onClick={() => setOnlyUnreviewed(false)}>
                      Ver la lista completa
                    </Button>
                  ) : (
                    <Button type="button" onClick={() => setSearchFilter("")}>
                      Borrar el filtro
                    </Button>
                  )
                }
              />
            ) : (
              <>
                {/*
                 * Issue #318 / hallazgo #25 (K9), desktop only (audit
                 * measured 1440×900; below `sm` these are card stacks, same
                 * scope `list-page-size.test.ts` already carves out).
                 *
                 * The commit bar is `sticky bottom-0` over the WHOLE PAGE
                 * scroll. A padding reserve below the last row does nothing
                 * for a row in the MIDDLE of a long roster: at the page's
                 * very first paint (scrollY 0, before the trainer has
                 * touched anything) the bar already pins itself to the
                 * viewport's bottom 74px whenever the page is taller than
                 * the viewport — which #58 made routine, since the roster no
                 * longer paginates — and whichever row's static position
                 * happens to land in that band loses its tap to the bar
                 * underneath it. Measured: `document.elementFromPoint` on
                 * that row returned the bar's own button.
                 *
                 * Padding cannot fix a defect that depends on which row is
                 * ABOVE the reserved space, only on what is below it. The
                 * roster instead gets its OWN bounded, internally-scrolling
                 * box, so the page itself never needs to scroll past the bar:
                 * every row's tap target lives inside this fixed box, the bar
                 * sits in its own space right below it, and the two can no
                 * longer occupy the same pixels at any scroll position.
                 *
                 * `calc(100vh-660px)` reserves the measured height of
                 * everything ELSE the mark-attendance step can render above
                 * and below the roster (coal header, contextual help,
                 * filter row, the bar itself) so the WHOLE page fits one
                 * viewport at 1440×900 and never needs outer scroll. It is a
                 * measured constant, not a derived one — the honest
                 * limitation is that a step that grows new chrome above the
                 * roster has to re-measure it, the same way `WIZARD_PAGE_SIZE`
                 * needed watching (`list-page-size.test.ts`). `min-h-[120px]`
                 * keeps the box from collapsing to nothing on shorter desktop
                 * windows; sub-1440 heights may still need outer scroll, which
                 * is the pre-existing behaviour, not a regression.
                 */}
                <ul
                  data-testid="attendance-roster-scroll"
                  className="flex flex-col gap-2 sm:max-h-[calc(100vh-660px)] sm:min-h-[120px] sm:overflow-y-auto sm:overscroll-contain sm:pr-1"
                >
                  {filteredStudents.map((student) => {
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
                        // `shrink-0`: once the roster (#318/#25) got its own
                        // bounded `overflow-y-auto` box, this `<li>` — a flex
                        // item of the now height-constrained `<ul>` — started
                        // shrinking to FIT the box instead of the box
                        // scrolling past it, because `flex-shrink` defaults to
                        // 1. Every fiche rendered squashed to ~28px with its
                        // own 48px button overflowing it. `shrink-0` keeps
                        // rows at their real size and makes the box the thing
                        // that scrolls.
                        className={`flex shrink-0 flex-col overflow-hidden rounded-ctl border bg-paper sm:h-12 sm:flex-row sm:items-center ${
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
                            className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-state-neutral-bg text-2xs tracking-flat font-bold text-state-neutral"
                          >
                            {getUserInitials(student.name)}
                          </span>
                          <span
                            id={nameId}
                            className="min-w-0 flex-1 truncate text-sm font-semibold text-ink"
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
                            <span className="h-badge inline-flex flex-none items-center rounded-full border border-dashed border-line-2 px-[11px] text-2xs tracking-flat font-bold text-ink-3">
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
                            // Roving tabindex (issue #312 / hallazgo #26): the
                            // ARIA radiogroup pattern is ONE tab stop per
                            // group. Before this, all four buttons sat in tab
                            // order — 5 Tab presses per student.
                            return (
                              <button
                                key={state}
                                type="button"
                                role="radio"
                                onClick={() => handleDirectAttendanceSet(idx, state)}
                                tabIndex={isActive ? 0 : -1}
                                onKeyDown={(e) => handleAttendanceRadioKeyDown(e, idx, state)}
                                aria-checked={isActive}
                                title={ATTENDANCE_LABELS[state]}
                                data-state={state}
                                /* @touch-target Marked standing up, phone in hand — 44px at
                                   every width, not only below `lg`. */
                                className={`inline-flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1 text-2xs tracking-flat font-semibold leading-tight transition-colors ${
                                  isActive
                                    ? `border-transparent ${getAttendanceBadgeTokens(state).badgeClass}`
                                    : "border-transparent text-ink-3 hover:bg-canvas hover:text-ink"
                                }`}
                              >
                                {ATTENDANCE_ICONS[state]}
                                {/* hallazgo #24: escondido desde 640px
                                    (`sm:sr-only`), una laptop nunca lo veía.
                                    Visible desde `lg` (1024px), donde la
                                    ficha ya no es una columna angosta. */}
                                <span className="sr-only lg:not-sr-only">{ATTENDANCE_LABELS[state]}</span>
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}

      </div>
    );
  }

  function renderConfirmation(): React.ReactElement | null {
    if (!selectedSchedule) return null;

    return (
      <div className="flex flex-col gap-4">
        {/*
         * Defense in depth (issue #310 / #3): the commit bar already disables
         * "Revisar y confirmar" for a read-only session, so this step should not be
         * reachable — except through a direct `?paso=confirmar` deep link.
         * The reason still has to be visible from here, not only from step 2.
         */}
        {readOnly && renderReadOnlyReason()}
        {/* The lead-in line that used to open this step said "Revise el
            resumen antes de confirmar el registro de asistencia" — which is
            what the step is CALLED, one line above, plus the verb the button
            at the foot already carries. D11c: if the help repeats the title,
            one of the two is spare. */}
        <dl className="overflow-hidden rounded-ctl border border-line">
          <div className="flex h-drow items-center gap-4 border-b border-line px-5">
            <dt className="w-[160px] flex-none text-2xs font-bold uppercase text-ink-3">
              Horario
            </dt>
            <dd className="flex-1 text-sm font-semibold text-ink">
              {formatDay(selectedSchedule.diaSemana)} {selectedSchedule.horaInicio} —{" "}
              {selectedSchedule.horaFin}
            </dd>
          </div>
          <div className="flex min-h-drow items-center gap-4 px-5 py-3">
            <dt className="w-[160px] flex-none text-2xs font-bold uppercase text-ink-3">
              Resultado
            </dt>
            <dd className="flex flex-1 flex-col gap-2">
              {/*
                The same figure the receipt will archive this session as, and
                the same one "Últimas listas" and the history draw it with
                afterwards — see `SessionComposition`. It used to be four loose
                colored badges here, a fifth drawing of one measurement, and
                each of them read as a count welded to a singular label ("25
                presente").
              */}
              <SessionCompositionBar
                counts={confirmCounts}
                total={students.length}
                className="max-w-md"
              />
              <SessionCompositionCounts counts={confirmCounts} total={students.length} />
              {/* Without this, "45 presentes" reads the same whether the
                  trainer went through the roster or never looked at it. This
                  one stays a badge: it is not part of the composition, it is
                  the warning that the composition may not have been decided. */}
              {unreviewedCount > 0 && (
                <Badge tone="warn" className="self-start">
                  {unreviewedCount} sin revisar
                </Badge>
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
            <p className="flex items-start gap-2 text-sm font-semibold text-state-warn">
              <AlertTriangle
                size={ICON.sm}
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
                  setStep("mark-attendance");
                }}
              >
                {unreviewedCount === 1 ? "Revisar a ese alumno" : `Revisar a esos ${unreviewedCount}`}
              </Button>
              <Button type="button" variant="tertiary" onClick={handleMarkRemainingPresent}>
                <UserCheck size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                Confirmar que están presentes
              </Button>
            </div>
          </div>
        )}

        <p className="text-xs text-ink-3">
          Se registrará la asistencia de {students.length}{" "}
          {students.length === 1 ? "estudiante" : "estudiantes"}.
        </p>

        {/* Directly above "Confirmar asistencia", the control this error
            blocks — same inline pattern as `rosterError` above. */}
        {submitError && (
          <div className="alert-error" role="alert">
            {submitError}
          </div>
        )}
      </div>
    );
  }

  /**
   * Running totals for the save bar — the same numbers, one glance.
   *
   * `whitespace-nowrap` per item because the strip used to break INSIDE a
   * phrase: at this width it printed "16 sin / revisar" across two lines,
   * which is the "cosas desalineadas" reproach in miniature. The strip still
   * wraps — between items, which is where a wrap says something.
   */
  function renderTotals(): React.ReactElement {
    return (
      <span className="flex min-w-[250px] flex-1 flex-wrap gap-x-3 gap-y-field text-xs text-ink-3">
        {TOTAL_ORDER.map((state) => (
          <span key={state} className="whitespace-nowrap">
            {formatStateCount(state, countByState(students, state))}
          </span>
        ))}
        {unreviewedCount > 0 && (
          <span className="whitespace-nowrap font-bold text-state-warn">
            {`${unreviewedCount} sin revisar`}
          </span>
        )}
      </span>
    );
  }

  // ---- Render ----

  return (
    <ProtectedRoute allowedRoles={["trainer", "admin"]}>
      <AppShell title="Pasar lista">
      {/*
        Issue #213: this used to hide behind `!confirmed`, which took the
        page's own frame down with it exactly when the receipt needed it —
        `handleLeaveWizard` already no-ops once `confirmed` is true (it only
        asks while `hasUnsavedMarks`, and a filed session has none), so
        rendering it unconditionally costs nothing and restores the frame
        every other screen in the panel keeps.
      */}
      <BackLink
        href={backHref}
        // Walking out of a started roll call is the one navigation on this
        // screen that costs something, so it is the one that asks.
        onClick={handleLeaveWizard}
        className="mb-6"
      />
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
        // The receipt (issue #213): a record of what got archived, in the
        // page's own left-aligned frame — not a centered announcement of a
        // fact the trainer already knows from having just tapped the button.
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-2xs font-bold uppercase tracking-wide text-ink-3">
              {hasFailedRecords ? "Asistencia registrada parcialmente" : "Asistencia registrada"}
            </p>
            {/* `tabIndex={-1}`: reachable only by the focus effect above, never
                a Tab stop of its own. The system focus ring excludes
                `[tabindex="-1"]` (see `globals.css`), so the ring is redrawn
                by hand here — the same pattern `payments/page.tsx` uses for
                its own programmatically-focused detail heading. */}
            {/* The card-title step in the display face, not a second 26px
                headline: the page already has one, drawn by `PageHeader` in
                the same face, and two headlines on one screen is a hierarchy
                that names nothing. */}
            <h2
              ref={confirmationHeadingRef}
              tabIndex={-1}
              className="font-display text-lg uppercase leading-tight tracking-flat text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ball focus-visible:shadow-focus-band"
            >
              {selectedSchedule
                ? `${formatDay(selectedSchedule.diaSemana)} ${selectedSchedule.horaInicio} — ${selectedSchedule.horaFin}`
                : "Horario seleccionado"}
            </h2>
          </div>

          {/* The identity band: what quedó archivado, sobre cuántos, cuándo y
              quién. */}
          <StatCard
            variant="hot"
            label={
              hasFailedRecords
                ? `Falta${result && result.failed.length === 1 ? "" : "n"} ${result?.failed.length ?? 0} ${result?.failed.length === 1 ? "alumno" : "alumnos"} por guardar`
                : "Guardada en el historial del club"
            }
            value={result?.createdCount ?? 0}
            unit={`/${students.length} ${students.length === 1 ? "alumno" : "alumnos"}`}
            hint={
              confirmedAt
                ? `${formatDateTime(confirmedAt.toISOString())} · ${result?.registradoPorNombre ?? "No registrado"}`
                : undefined
            }
          />

          {result && result.failed.length > 0 && (
            /*
             * NAME the students. This used to say "N registro(s) no se
             * pudieron guardar" and then ask the trainer to retry for
             * students it refused to identify — leaving them to re-mark the
             * whole roster to find out who was missing. Kept as-is (issue
             * #213 decision 3): only its position moved, above the
             * breakdown instead of below it.
             */
            <div
              role="alert"
              className="rounded-ctl border border-state-warn/25 bg-state-warn-bg p-3.5 text-xs text-state-warn"
            >
              <p className="flex items-center gap-1.5 font-bold">
                <AlertTriangle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
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

          {/* The desglose: the one number the old screen buried. Four states,
              always all four (issue #213 decision 1 — a zero is atenuado,
              never omitted), plus a proportional bar for the at-a-glance
              read. */}
          <div className="card flex flex-col gap-4 p-5 sm:p-6">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-3">
              {hasFailedRecords
                ? `Cómo quedó la sesión · ${receiptTotal} guardados`
                : "Cómo quedó la sesión"}
            </p>

            <SessionCompositionBar counts={receiptCounts} total={receiptTotal} className="w-full" />

            <ul className="flex flex-col">
              {TOTAL_ORDER.map((state) => {
                const count = receiptCounts[state];
                const isZero = count === 0;
                const percent = receiptTotal > 0 ? Math.round((count / receiptTotal) * 100) : 0;
                return (
                  <li
                    key={state}
                    className="grid grid-cols-[10px_1fr_auto_auto] items-center gap-x-3 border-t border-line py-2.5 first:border-t-0"
                  >
                    {/* The dot repeats the bar's own segment, so it has to be
                        the bar's own colour — see `RECEIPT_TONE_CLASS`'s
                        removal note above the imports. A zero has no segment
                        up there, so it wears the hairline instead. */}
                    <span
                      aria-hidden="true"
                      className={`h-2.5 w-2.5 rounded-[3px] ${isZero ? "bg-line-2" : ""}`}
                      style={
                        isZero
                          ? undefined
                          : { backgroundColor: ATTENDANCE_STATUS_CHART_COLORS[state] }
                      }
                    />
                    {/* The state name is real text, not just the dot's
                        color — no row here is distinguishable by color
                        alone (issue #213 a11y requirement). */}
                    <span className={`text-sm ${isZero ? "font-normal text-ink-3" : "font-semibold text-ink"}`}>
                      {ATTENDANCE_LABELS[state]}
                    </span>
                    <span
                      className={`min-w-[3ch] text-right text-lg font-extrabold tabular-nums tracking-tight ${isZero ? "text-ink-3" : "text-ink"}`}
                    >
                      {count}
                    </span>
                    <span className="min-w-[5ch] text-right text-xs tabular-nums text-ink-3">
                      {isZero ? "—" : `${percent} %`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* Issue #241: the retry's own load failure must land here, next to
              the button that triggered it — not only on step 1, which this
              screen never shows. Same inline pattern step 1 uses for the
              same `rosterError`. */}
          {rosterError && hasFailedRecords && (
            <div className="alert-error" role="alert">
              {rosterError}
            </div>
          )}

          {/*
            One way back, not two. This row used to end in a second `BackLink`
            to `backHref` — the same destination the frame's own control at the
            top of the screen already points at. It was masked while the two
            controls wrote their own labels ("Volver al Panel del Entrenador"
            and "Volver al Panel", two names for one place); once the
            destination registry made both of them say "Volver a Mi día", the
            duplication was in plain sight, and a test asserted it as
            tolerated. The frame's is the one that stays: it is where every
            other screen in the panel keeps its way back, it survives the
            receipt appearing and disappearing, and DESIGN.md is explicit that
            going back is the least important control on a screen — so it does
            not belong in the row that carries what to do NEXT.
          */}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {hasFailedRecords ? (
              <>
                {/* Decision 2: the primary action displaces to the retry —
                    it is the only action that actually corrects the
                    state. */}
                {/*
                 * The retry button's disabled phase is expressed with
                 * `aria-disabled`, not the native `disabled` attribute — the
                 * browser blurs a natively-disabled element the instant it
                 * applies, stranding keyboard focus on `<body>` with no way
                 * back. `aria-disabled` keeps it in the tab order the whole
                 * time.
                 */}
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => {
                    if (!rosterLoading) void handleRetryFailed();
                  }}
                  aria-disabled={rosterLoading}
                  aria-busy={rosterLoading}
                  className={`w-full justify-center sm:w-auto ${
                    rosterLoading ? "cursor-not-allowed opacity-45" : ""
                  }`}
                >
                  {retryButtonLabel}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleReset}
                  className="w-full justify-center sm:w-auto"
                >
                  Registrar otra asistencia
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleReset}
                  className="w-full justify-center sm:w-auto"
                >
                  Registrar otra asistencia
                </Button>
                <Link
                  href={attendanceHistoryHref}
                  className={buttonClasses("secondary", "md", "w-full justify-center sm:w-auto")}
                >
                  Ver historial de asistencias
                </Link>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          {loading && <LoadingState label="Cargando horarios…" />}

          {loadError && !loading && (
            <ErrorState message={loadError} onRetry={() => loadOptions()} />
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

              {/*
                `w-full` is load-bearing, and its absence is why this screen
                measured 364px wide in a 1152px column.
                `<main>` is a flex column, so its children are flex items —
                and an auto margin on the cross axis (`mx-auto`) cancels the
                stretch that would otherwise give this div its full width,
                leaving it shrink-to-fit with `max-w-3xl` capping a width it
                never reached. The picker's five hour buttons were laid out in
                two columns inside 364px while 788px of canvas sat beside
                them. Same family as the `margin-top: auto` trap the socio
                sweep measured: a rule that behaves one way in a block
                container and another inside a flex one.
              */}
              <div className="mx-auto w-full max-w-3xl">
                <div className="card p-5 sm:p-6">
                  {/* The card title step, in the display face — `DESIGN.md`'s
                      "regla de Graduate". */}
                  <h2 className="mb-4 font-display text-lg uppercase leading-tight tracking-flat text-ink">
                    {STEP_LABELS[step]}
                  </h2>

                  <form onSubmit={handleConfirm}>
                    {step === "select-session" && renderSessionSelection()}
                    {step === "mark-attendance" && renderMarkAttendance()}
                    {step === "confirm" && renderConfirmation()}

                    {/*
                     * The commit bar. `sticky bottom-0` so the trainer never
                     * scrolls the whole card to reach Siguiente — the audit
                     * found exactly that, on the screen where the commit
                     * matters most.
                     *
                     * All THREE steps now commit from it. Step 1 used to keep
                     * its "Continuar" inside the step's own content, as a
                     * full-width red bar — a second place for the same kind of
                     * decision, and a shape the system does not have (a
                     * primary is 40px tall with 16px of side padding, not a
                     * 100%-wide slab). One bar, one position, one size, from
                     * the first question to the last.
                     */}
                    {(
                      <div
                        data-testid="attendance-commit-bar"
                        className="sticky bottom-0 -mx-5 mt-5 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-5 py-3.5 backdrop-blur sm:-mx-6 sm:px-6"
                      >
                        {!isFirst && (
                          <Button type="button" variant="tertiary" onClick={handleBack} disabled={submitting}>
                            <ChevronLeft size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                            Atrás
                          </Button>
                        )}

                        {/*
                         * Undo lives in the commit bar, beside the step
                         * navigation, because that bar is `sticky bottom-0`:
                         * on a forty-row roster it is the only control that is
                         * always within reach of the row you just mistyped.
                         * Disabled rather than hidden — a control that appears
                         * and disappears under the thumb is a control you
                         * cannot aim at.
                         */}
                        {step === "mark-attendance" && (
                          <Button
                            type="button"
                            variant="tertiary"
                            onClick={handleUndo}
                            disabled={lastUndoable === null || submitting}
                            aria-label={
                              lastUndoable
                                ? `Deshacer: ${lastUndoable.label}`
                                : "Deshacer — no hay nada que deshacer"
                            }
                          >
                            <Undo2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                            Deshacer
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
                          {isFirst ? (
                            /* Step 1 commits by LOADING the roster, not by
                               advancing a step, so it keeps its own handler
                               and its own key — see the note above for why
                               two branches must never share a node. */
                            <Button
                              key="open-roster"
                              type="button"
                              variant="primary"
                              onClick={handleContinueToRoster}
                              disabled={!selectedScheduleId || rosterLoading}
                            >
                              {rosterLoading ? "Cargando estudiantes…" : "Continuar"}
                              <ChevronRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                            </Button>
                          ) : !isLast ? (
                            /*
                             * Issue #318 / hallazgo #59 (K9): this used to say
                             * "Siguiente", the same visible text the roster's
                             * own pagination "Siguiente" carried — two
                             * controls, one label, opposite consequences (one
                             * paged, this one closed the list and jumped to
                             * "Confirmar y finalizar"). #58 removed the
                             * roster's pagination in the same cluster, but
                             * this button's own name still described nothing:
                             * it says what happens next, not a generic "keep
                             * going".
                             */
                            <Button
                              key="advance"
                              type="button"
                              variant="primary"
                              onClick={handleNext}
                              disabled={students.length === 0 || unmarkedCount > 0 || readOnly}
                              aria-describedby={unmarkedCount > 0 ? unmarkedReasonId : undefined}
                            >
                              Revisar y confirmar
                              <ChevronRight size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                            </Button>
                          ) : (
                            <Button
                              key="file-session"
                              type="submit"
                              variant="primary"
                              disabled={
                                submitting ||
                                students.length === 0 ||
                                unmarkedCount > 0 ||
                                readOnly
                              }
                              aria-describedby={unmarkedCount > 0 ? unmarkedReasonId : undefined}
                            >
                              {submitting ? (
                                "Registrando…"
                              ) : (
                                <>
                                  <CheckCircle size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                                  Confirmar asistencia
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
        </>
      )}
      </AppShell>
    </ProtectedRoute>
  );
}
