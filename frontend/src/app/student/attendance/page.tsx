/**
 * /student/attendance — the family-facing attendance history.
 *
 * One of the two things a student actually opens this portal to do ("hay que
 * hacer pago y ver asistencias"). Until now the only place a session appeared
 * was a five-row list at the bottom of `/student`, below the carnet and two
 * other panels, with no state totals and no way to see the record as a whole.
 *
 * ## Every number here is counted, none is projected
 *
 * The screen reports exactly what `StudentProfileSummary.recentSessions`
 * carries and says so in as many words:
 *
 * - The rate is printed WITH its denominator ("60 %" over "3 de 5 sesiones"),
 *   so it stays true at N = 1 and at N = 30. It is a rate over the recorded
 *   window and says so; the owner approved showing it (EXTRA redesign), with a
 *   75% goal under which the tile turns amber (`lib/attendance-tone`). The tone
 *   is never alone: the tile always carries its status word.
 * - `late` counts as attended (the student came); sick/competition do not (an
 *   excused absence is still an absence). The breakdown below the
 *   ratio is what keeps that distinction visible instead of hidden in the
 *   arithmetic.
 * - There is no "próxima sesión" on this page. This screen reports what was
 *   RECORDED; the student's assigned weekly schedule is a different fact from
 *   a different endpoint, and it is answered on `/student` (see the
 *   "Próximos entrenamientos" block comment there). Mixing the two on one
 *   screen is what made the old portal print a past session under a heading a
 *   family reads as the next one.
 *
 * ## The window, and the pages behind it
 *
 * `buildRecentSessions` (src/lib/server/student-adapter.ts) slices the backend
 * history to `RECENT_SESSIONS_LIMIT` records — 30 — which is the number
 * `PORTAL_SESSION_WINDOW` below and the footnote at the foot of this screen
 * both state. The summary tiles count that window and say so.
 *
 * The record itself is NOT capped: the portal also carries `historialTotal`
 * (the whole history) and, when it is longer than the window, the list gets a
 * pager. Page 1 is the window already in hand; later pages come from `GET
 * /api/student/attendance` (the paginated `GET /asistencias/persona/{id}`), so
 * no session is ever hidden behind "ask the club".
 *
 * Three numbers, one fact: the adapter's slice, the page's constant and the
 * sentence the student reads. `__tests__/attendance-window.test.ts` fails if
 * those three ever stop agreeing.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { fetchStudentAttendancePage, fetchStudentPortal } from "@/services/api";
import type { StudentPortalSummary, StudentProfileSummary, StudentSessionSummary } from "@/services/api";
import { getAttendanceBadgeTone, getAttendanceLabel } from "@/app/attendance/attendance-utils";
import { formatDate } from "@/lib/format-utils";
import type { EstadoAsistencia } from "@/types/domain";
import {
  BackLink,
  Badge,
  EmptyState,
  LoadingState,
  Pagination,
  STAT_GRID,
  StatCard,
  StatTrack,
  buttonClasses,
  cn,
} from "@/components/ui";
import { attendanceTone } from "@/lib/attendance-tone";
import { breakdownAttendance, firstNameOf, hasOwnMembership, summarizeRecentAttendance } from "../student-utils";
import { useManagedProfiles } from "../ManagedStudentPicker";
import FamilyStrip from "../FamilyStrip";
import { CalendarCheck, CheckCircle2, Clock, UserX, User } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import StudentErrorState from "../StudentErrorState";
import { toUserMessage } from "@/lib/error-message";

/**
 * Mirrors `RECENT_SESSIONS_LIMIT` in src/lib/server/student-adapter.ts (30).
 *
 * Duplicated rather than imported because that module is server-only. It is
 * used for copy, never for slicing — the list renders whatever arrives, so
 * this page never hides a record it was handed.
 *
 * The number is printed to the student in the footnote below, so a drift
 * between the two modules would put a false number on screen. They are
 * compared by `__tests__/attendance-window.test.ts`.
 */
const PORTAL_SESSION_WINDOW = 30;

/** Sessions per older page: the window itself, so page 1 is the data already loaded. */
const HISTORY_PAGE_SIZE = PORTAL_SESSION_WINDOW;

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

// ---------------------------------------------------------------------------
// The summary — four tiles with the traffic light
// ---------------------------------------------------------------------------

/** What each state a session can carry means, for a reader with no rows yet. */
const ATTENDANCE_LEGEND: { estado: EstadoAsistencia; meaning: string }[] = [
  { estado: "present", meaning: "Estuvo en la sesión" },
  { estado: "late", meaning: "Llegó después de la hora" },
  { estado: "absent", meaning: "No asistió" },
  { estado: "sick", meaning: "Faltó por enfermedad" },
  { estado: "competition", meaning: "Estuvo en una competencia" },
];

/**
 * Rate, present, late, absent — the colour of each tile is the meaning of its
 * datum (green fine, amber to watch, red a problem) and each says it in a
 * word. `sick` and `competition` are not tiles, but they are tallied right
 * under them (FAM-22): the counters must add up to the sessions listed.
 */
function AttendanceSummary({
  profile,
  /** The dependent's given name, or `null` when the reader IS the student. */
  studentName,
}: {
  profile: StudentProfileSummary;
  studentName: string | null;
}): React.ReactElement | null {
  const recap = summarizeRecentAttendance(profile.recentSessions);
  if (recap === null) return null;
  const breakdown = breakdownAttendance(profile.recentSessions);
  const percent = Math.round((recap.attended / recap.total) * 100);

  return (
    <section aria-label="Resumen de asistencia" data-testid="attendance-breakdown" className="flex flex-col gap-section">
      {/* A guardian with one dependent never sees the switcher (it hides below
          two profiles), so this kicker is the only place that names whose
          record this is. */}
      <p className="text-2xs font-bold uppercase text-ink-3-strong">
        {studentName ? `Asistencia de ${studentName}` : "Tu asistencia"}
      </p>
      <div className={STAT_GRID}>
        <StatCard
          label="Asistencia"
          {...attendanceTone(percent)}
          icon={<CalendarCheck size={ICON.sm} strokeWidth={1.75} />}
          value={percent}
          unit="%"
          hint={
            <span className="flex flex-col gap-y-field">
              <StatTrack value={recap.attended} total={recap.total} />
              <span>{`${recap.attended} de ${recap.total} sesiones`}</span>
            </span>
          }
        />
        <div data-testid="breakdown-presente" className="contents">
          <StatCard
            label="Presentes"
            {...(breakdown.present > 0
              ? { tone: "ok" as const, status: "Estuvo en la sesión" }
              : { tone: "neutral" as const, status: "Sin presentes" })}
            icon={<CheckCircle2 size={ICON.sm} strokeWidth={1.75} />}
            value={breakdown.present}
            unit={`de ${breakdown.total}`}
          />
        </div>
        <div data-testid="breakdown-tardanza" className="contents">
          <StatCard
            label="Tardanzas"
            {...(breakdown.late > 0
              ? { tone: "warn" as const, status: "Llegó tarde" }
              : { tone: "neutral" as const, status: "Sin tardanzas" })}
            icon={<Clock size={ICON.sm} strokeWidth={1.75} />}
            value={breakdown.late}
            hint="cuentan como asistencia"
          />
        </div>
        <div data-testid="breakdown-ausente" className="contents">
          <StatCard
            label="Ausencias"
            {...(breakdown.absent > 0
              ? { tone: "bad" as const, status: "No asistió" }
              : { tone: "ok" as const, status: "Sin ausencias" })}
            icon={<UserX size={ICON.sm} strokeWidth={1.75} />}
            value={breakdown.absent}
            hint="no cuentan como asistencia"
          />
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-field text-xs text-ink-3-strong">
        {[
          { key: "sick", label: "Enfermo", count: breakdown.sick },
          { key: "competition", label: "Competencia", count: breakdown.competition },
        ].map(({ key, label, count }) => (
          <span key={key} data-testid={`breakdown-${label.toLowerCase()}`} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-state-neutral" />
            <span>{label}</span>
            <span className="font-bold tabular-nums text-ink">{count}</span>
          </span>
        ))}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// The record itself
// ---------------------------------------------------------------------------

function SessionList({
  profile,
  /** The dependent's given name, or `null` when the reader IS the student. */
  studentName,
}: {
  profile: StudentProfileSummary;
  studentName: string | null;
}): React.ReactElement {
  const [page, setPage] = useState(1);
  const [older, setOlder] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; items: StudentSessionSummary[] }>(
    { status: "loading" },
  );
  const total = Math.max(profile.historialTotal ?? 0, profile.recentSessions.length);
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

  // Page 1 is the window the portal already carries; every later page is its
  // own round trip, so the record is never capped at the window.
  useEffect(() => {
    if (page === 1) return;
    let cancelled = false;
    setOlder({ status: "loading" });
    fetchStudentAttendancePage(profile.personaId, { skip: (page - 1) * HISTORY_PAGE_SIZE, limit: HISTORY_PAGE_SIZE })
      .then((data) => {
        if (!cancelled) setOlder({ status: "ready", items: data.items });
      })
      .catch(() => {
        if (!cancelled) setOlder({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [page, profile.personaId]);

  const showingOlder = page > 1;
  const sessions = showingOlder ? (older.status === "ready" ? older.items : []) : profile.recentSessions;
  const empty = !showingOlder && sessions.length === 0;

  return (
    <section
      data-testid="sessions-card"
      className="card flex flex-col overflow-hidden"
      aria-labelledby="sessions-title"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        {/* The record names its subject: a guardian reading two children's
            histories one click apart must never have to infer which one is on
            screen from the dates. */}
        <h2 id="sessions-title" className="flex-1 text-sm font-bold text-ink">
          {studentName ? `Sesiones registradas de ${studentName}` : "Sesiones registradas"}
        </h2>
        {total > 0 && (
          <span className="text-xs font-semibold tabular-nums text-ink-3-strong">{total}</span>
        )}
      </div>

      {empty ? (
        // Dotted ground (the system's halftone gesture) instead of a bare
        // block: the empty state takes its place on screen with meaning and
        // does not read as "still loading".
        <div data-testid="sessions-empty" className="p-4">
          <div className="flex flex-col items-center gap-2 rounded-ctl bg-[radial-gradient(circle,rgb(19_19_22/0.09)_1px,transparent_1px)] bg-[length:8px_8px] px-5 py-8 text-center">
            <CalendarCheck
              size={ICON.lg}
              strokeWidth={1.5}
              aria-hidden="true"
              className="flex-none text-ink-3-strong"
            />
            <p className="text-sm font-bold text-ink">
              {studentName
                ? `Aún no hay asistencias registradas de ${studentName}`
                : "Aún no hay asistencias registradas"}
            </p>
            <p className="max-w-[44ch] text-sm text-ink-3-strong">
              Cada vez que el entrenador tome lista, la sesión aparecerá aquí con el estado que
              le haya asignado.
            </p>
          </div>
        </div>
      ) : showingOlder && older.status === "loading" ? (
        <LoadingState label="Cargando sesiones…" />
      ) : showingOlder && older.status === "error" ? (
        <p role="alert" className="px-5 py-6 text-sm text-ink-3-strong">
          No se pudo cargar esta página del historial.
        </p>
      ) : (
        <ul className="flex flex-col">
          {sessions.map((session) => (
            <li
              key={`${session.fecha}-${session.horario}`}
              className="flex min-h-drow flex-wrap items-center gap-x-4 gap-y-field border-b border-line px-5 py-2 last:border-b-0"
            >
              <span className="w-[92px] flex-none text-2xs font-bold uppercase tabular-nums text-ink-3-strong">
                {formatDate(session.fecha)}
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-ink">{session.horario}</span>
              <Badge tone={getAttendanceBadgeTone(session.estado)}>
                {getAttendanceLabel(session.estado)}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      {total > HISTORY_PAGE_SIZE && (
        <Pagination
          variant="footer"
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          totalItems={total}
          pageSize={HISTORY_PAGE_SIZE}
          itemNoun="sesión"
          itemNounPlural="sesiones"
        />
      )}

      <AttendanceLegend />
    </section>
  );
}

/**
 * The states and how they get recorded, in one strip glued under the list —
 * not a tall rail beside it. Always shown, with or without rows: a reader
 * with no sessions yet still learns what each state will mean.
 */
function AttendanceLegend(): React.ReactElement {
  return (
    <div data-testid="attendance-legend" className="flex flex-col gap-2 border-t border-line bg-sunken px-5 py-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-field">
        {ATTENDANCE_LEGEND.map(({ estado, meaning }) => (
          <li key={estado} className="flex items-center gap-2">
            <Badge tone={getAttendanceBadgeTone(estado)}>{getAttendanceLabel(estado)}</Badge>
            <span className="text-xs text-ink-3-strong">{meaning}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-3-strong">
        El entrenador toma lista en cada sesión. Si un registro no es correcto, pide la corrección al club.
      </p>
    </div>
  );
}

/**
 * The scope, stated. Rows presented without this line read as "this is the
 * whole record".
 *
 * Extracted because both layouts render it and the two used to be two copies
 * of the same sentence — the drift that put four different spellings of the
 * same fact into this product before.
 */
function PortalWindowNote({ hasOlder }: { hasOlder: boolean }): React.ReactElement {
  return (
    <p className="max-w-[68ch] text-xs leading-relaxed text-ink-3-strong">
      El resumen cuenta las {PORTAL_SESSION_WINDOW} sesiones más recientes que el club registró.
      {hasOlder ? " Las anteriores están en el listado, por páginas." : ""}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function StudentAttendanceContent(): React.ReactElement {
  const { session } = useAuth();
  const personaId = session?.user.id ?? "";
  const hasAlumnoRole = session?.user.role === "estudiante";

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!personaId) return;
    let cancelled = false;
    setState({ status: "loading" });
    fetchStudentPortal(personaId)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            toUserMessage(error, "No se pudo cargar tu historial de asistencia."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  return (
    <AppShell
      // "Asistencias" — the sidebar row's own label, and true for a guardian
      // reading a dependent's record. See the same change on `/student/payments`.
      title="Asistencias"
      subtitle="Cada sesión que el entrenador registró, con el estado que le asignó."
      // Issue #1396: through the shell's `back` slot, so the control precedes
      // the title in document order — `PageHeader` is drawn above `<main>`,
      // so a back control among the children lands after the title by
      // construction. The finding that put a named way back on this screen
      // (issue #316 hallazgo #70) stands; only its placement moves.
      back={<BackLink href="/student" />}
    >

      {state.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando tu asistencia…" />
        </div>
      )}
      {state.status === "error" && (
        <StudentErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {state.status === "ready" && (
        <AttendanceView
          data={state.data}
          hasAlumnoRole={hasAlumnoRole}
          accountPersonaId={personaId}
        />
      )}
    </AppShell>
  );
}

function AttendanceView({
  data,
  hasAlumnoRole,
  accountPersonaId,
}: {
  data: StudentPortalSummary;
  hasAlumnoRole: boolean;
  /** The persona behind the SESSION — not the profile being viewed. */
  accountPersonaId: string;
}): React.ReactElement {
  const { managedProfiles, selectedId, setSelectedId, selectedProfile } = useManagedProfiles(
    data,
    hasAlumnoRole || hasOwnMembership(data),
    accountPersonaId,
  );

  const viewingOwnProfile =
    selectedProfile !== null && selectedProfile.personaId === accountPersonaId;
  const studentName = viewingOwnProfile ? null : firstNameOf(selectedProfile?.nombres ?? "");

  return (
    // Full content width, like every other screen in the product. The 760px
    // cap came from the prototype's `.canvas` and left the right half of the
    // column empty at 1440 — the record is the subject and takes the main
    // column; the counted recap rides in the rail beside it.
    <>
      <FamilyStrip
        profiles={managedProfiles}
        value={selectedId}
        onChange={setSelectedId}
      />

      {selectedProfile === null ? (
        <EmptyState
          icon={<User size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
          title="No se encontraron jugadores asociados a esta cuenta"
          description="Inscríbete como jugador o agrega un hijo o dependiente para empezar a ver asistencias."
          action={
            <Link href="/student" className={buttonClasses("secondary", "sm")}>
              Ir a mi cuenta
            </Link>
          }
        />
      ) : (
        // One column at the content's full width: summary tiles, the record
        // with its legend glued below, then the scope note. No rail — the
        // legend moved under the list and the counted tiles on top, so no
        // column is left with dead air under it.
        <div className="flex min-w-0 flex-col gap-page">
          <AttendanceSummary profile={selectedProfile} studentName={studentName} />
          <div className="flex min-w-0 flex-col gap-section">
            {/* Keyed by persona: switching dependent restarts at page 1. */}
            <SessionList key={selectedProfile.personaId} profile={selectedProfile} studentName={studentName} />
            <PortalWindowNote hasOlder={(selectedProfile.historialTotal ?? 0) > PORTAL_SESSION_WINDOW} />
          </div>
        </div>
      )}

      {/* Still no "Ver mis pagos" button here — that cross-link would be a
          second, competing way out of a screen that already has one
          (`BackLink`, on `AppShell`) plus the sidebar's own "Pagos" row. */}
    </>
  );
}

export default function StudentAttendancePage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["representante", "estudiante", "unsupported"]} allowStaffPlayer>
      {/* `useManagedProfiles` reads `?alumno=` through `useSearchParams` — see
          the same boundary on `/student` and `/student/payments`. */}
      <Suspense>
        <StudentAttendanceContent />
      </Suspense>
    </ProtectedRoute>
  );
}
