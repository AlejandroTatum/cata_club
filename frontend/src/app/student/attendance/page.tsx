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
 * - The ratio is "asistió a X de N sesiones registradas", never a percentage.
 *   A percentage over a handful of records reads as a rate — "43% de
 *   asistencia" — which is a claim about the student's habits that this data
 *   cannot support. The ratio carries its own denominator, so it stays true at
 *   N = 1 and at N = 13.
 * - `late` counts as attended (the student came); `justified` does not (an
 *   excused absence is still an absence). The four-way breakdown below the
 *   ratio is what keeps that distinction visible instead of hidden in the
 *   arithmetic.
 * - There is no "próxima sesión" on this page. This screen reports what was
 *   RECORDED; the student's assigned weekly schedule is a different fact from
 *   a different endpoint, and it is answered on `/student` (see the
 *   "Próximos entrenamientos" block comment there). Mixing the two on one
 *   screen is what made the old portal print a past session under a heading a
 *   family reads as the next one.
 *
 * ## The window, and why it is stated on screen
 *
 * `buildRecentSessions` (src/lib/server/student-adapter.ts) slices the backend
 * history to `RECENT_SESSIONS_LIMIT` records — 30, since that module's cap was
 * raised from 5 — which is the number `PORTAL_SESSION_WINDOW` below and the
 * footnote at the foot of this screen both state. `GET
 * /asistencias/persona/{id}` is itself paginated (TRA-6), but the BFF route
 * already requests a page well above this window (`HISTORIAL_PAGE_LIMIT`, 200
 * in src/app/api/student/route.ts), so page 1 always contains it and the cap
 * remains a frontend decision.
 *
 * Three numbers, one fact: the adapter's slice, the page's constant and the
 * sentence the student reads. The footnote exists so a capped list is not
 * read as the whole record, and `__tests__/attendance-window.test.ts` fails if
 * those three ever stop agreeing.
 */

"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { fetchStudentPortal } from "@/services/api";
import type { StudentPortalSummary, StudentProfileSummary } from "@/services/api";
import { getAttendanceBadgeTone, getAttendanceLabel } from "@/app/attendance/attendance-utils";
import { formatDate } from "@/lib/format-utils";
import type { EstadoAsistencia } from "@/types/domain";
import {
  BackLink,
  Badge,
  EmptyState,
  ErrorState,
  InfoPanel,
  LoadingState,
  PAGE_RAIL,
  buttonClasses,
  cn,
} from "@/components/ui";
import { breakdownAttendance, firstNameOf, summarizeRecentAttendance } from "../student-utils";
import type { AttendanceBreakdown } from "../student-utils";
import ManagedStudentPicker, { useManagedProfiles } from "../ManagedStudentPicker";
import { CalendarCheck, User } from "lucide-react";
import { ICON } from "@/lib/icon-size";
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

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

// ---------------------------------------------------------------------------
// The recap — one counted sentence, then the four states behind it
// ---------------------------------------------------------------------------

/** The four states, in the order a family reads them: best outcome first. */
const BREAKDOWN_ROWS: { key: keyof Omit<AttendanceBreakdown, "total">; estado: string }[] = [
  { key: "present", estado: "present" },
  { key: "late", estado: "late" },
  { key: "justified", estado: "justified" },
  { key: "absent", estado: "absent" },
];

/** The state dot, in that state's own badge colour — the number itself stays ink. */
const DOT_CLASS: Record<string, string> = {
  present: "bg-state-ok",
  late: "bg-state-warn",
  justified: "bg-state-neutral",
  absent: "bg-state-bad",
};

/** What each state a session can carry means, for a reader with no rows yet. */
const ATTENDANCE_LEGEND: { estado: EstadoAsistencia; meaning: string }[] = [
  { estado: "present", meaning: "Estuvo en la sesión" },
  { estado: "late", meaning: "Llegó después de la hora" },
  { estado: "absent", meaning: "No asistió" },
  { estado: "justified", meaning: "Avisó que no podía ir" },
  { estado: "sick", meaning: "Faltó por enfermedad" },
  { estado: "competition", meaning: "Estuvo en una competencia" },
];

function AttendanceRecap({
  profile,
  /** The dependent's given name, or `null` when the reader IS the student. */
  studentName,
}: {
  profile: StudentProfileSummary;
  studentName: string | null;
}): React.ReactElement {
  const recap = summarizeRecentAttendance(profile.recentSessions);
  const breakdown = breakdownAttendance(profile.recentSessions);

  return (
    <section className="card overflow-hidden" aria-labelledby="attendance-recap-title">
      <div className="px-5 py-[18px]">
        {/* A guardian with one dependent never sees the switcher (it hides
            below two profiles), so this kicker was the only place that could
            name whose record this is — and it said "Su asistencia" to a reader
            who does not train here. */}
        <p className="mb-1 text-2xs font-bold uppercase text-ink-3">
          {studentName ? `Asistencia de ${studentName}` : "Su asistencia"}
        </p>
        <h2 id="attendance-recap-title" className="text-base font-bold tracking-tight text-ink">
          {recap ? (
            <>
              Asistió a{" "}
              <span className="tabular-nums">
                {recap.attended} de {recap.total}
              </span>{" "}
              {recap.total === 1 ? "sesión registrada" : "sesiones registradas"}
            </>
          ) : (
            "Todavía no hay sesiones registradas"
          )}
        </h2>
        <p className="mt-1.5 text-sm text-ink-3">
          {recap
            ? "Una tardanza cuenta como asistencia; una falta justificada, no."
            : studentName
              ? `La asistencia de ${studentName} aparecerá aquí en cuanto el entrenador tome lista.`
              : "Su asistencia aparecerá aquí en cuanto el entrenador tome lista."}
        </p>
      </div>

      {/* The four states behind the ratio. `sunken` because this strip is an
          inset area inside the card, not a second card.

          A fixed 2×2, at every width: the card now lives in a 340px rail on
          large screens, where a 4-up row gives "Justificada" 45px of content
          box and breaks it across three lines. The hairlines are computed per
          index rather than written as `divide-x` — a 2×2 needs a right border
          on the even cells and a bottom border on the first row, and no single
          utility says both. */}
      <div
        data-testid="attendance-breakdown"
        className="grid grid-cols-2 border-t border-line bg-sunken"
      >
        {BREAKDOWN_ROWS.map(({ key, estado }, index) => (
          <div
            key={key}
            data-testid={`breakdown-${getAttendanceLabel(estado).toLowerCase()}`}
            className={cn(
              "px-5 py-3.5",
              index < 2 ? "border-b border-line" : null,
              index % 2 === 0 ? "border-r border-line" : null,
            )}
          >
            <p className="flex items-center gap-1.5 text-2xs font-bold uppercase text-ink-3-strong">
              <span aria-hidden="true" className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT_CLASS[estado])} />
              {getAttendanceLabel(estado)}
            </p>
            {/* Ink, always. `_sistema.css` allows colour in badges and dots,
                never in a figure — a green "4" beside a red "1" turns a tally
                into a verdict. */}
            <p className="mt-1 text-xl font-extrabold tabular-nums leading-none text-ink">
              {breakdown[key]}
            </p>
          </div>
        ))}
      </div>
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
  fill = false,
}: {
  profile: StudentProfileSummary;
  studentName: string | null;
  /** Stretch to the rail's height, closing the gap with ghost rows. */
  fill?: boolean;
}): React.ReactElement {
  const sessions = profile.recentSessions;
  const empty = sessions.length === 0;

  return (
    // Empty: one guiding line, card height = content (ghost rows would read
    // as "still loading"); the legend of states lives in the rail's guide.
    <section
      data-testid="sessions-card"
      className={cn("card flex flex-col overflow-hidden", fill && !empty && "lg:flex-1")}
      aria-labelledby="sessions-title"
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        {/* The record is the main column, and it names its subject: a guardian
            reading two children's histories one click apart must never have to
            infer which one is on screen from the dates. */}
        <h2 id="sessions-title" className="flex-1 text-sm font-bold text-ink">
          {studentName ? `Sesiones registradas de ${studentName}` : "Sesiones registradas"}
        </h2>
        {sessions.length > 0 && (
          <span className="text-xs font-semibold tabular-nums text-ink-3">
            {sessions.length}
          </span>
        )}
      </div>

      {empty ? (
        <div data-testid="sessions-empty">
          <div className="flex items-start gap-3 px-5 py-4">
            <CalendarCheck
              size={ICON.lg}
              strokeWidth={1.5}
              aria-hidden="true"
              className="mt-0.5 flex-none text-ink-3"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">
                {studentName
                  ? `Aún no hay asistencias registradas de ${studentName}`
                  : "Aún no hay asistencias registradas"}
              </p>
              <p className="mt-0.5 text-sm text-ink-3">
                Cada vez que el entrenador tome lista, la sesión aparecerá aquí con el estado que
                le haya asignado.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col">
          {sessions.map((session) => (
            <li
              key={`${session.fecha}-${session.horario}`}
              className="flex min-h-drow flex-wrap items-center gap-x-4 gap-y-field border-b border-line px-5 py-2 last:border-b-0"
            >
              <span className="w-[92px] flex-none text-2xs font-bold uppercase tabular-nums text-ink-3">
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
      {fill && !empty && <GhostSessionRows />}
    </section>
  );
}

/**
 * Placeholder rows under a short record: they show the shape a session row
 * takes (date, time slot, state chip) so a few sessions read as "more will
 * appear here". The block takes the height the rail leaves over and clips.
 * Decorative only — hidden from assistive tech.
 */
function GhostSessionRows(): React.ReactElement {
  return (
    <div className="relative hidden min-h-0 flex-1 lg:block">
      <ul
        aria-hidden="true"
        data-testid="session-ghost-rows"
        className="absolute inset-0 flex flex-col divide-y divide-line overflow-hidden border-t border-line"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <li
            key={i}
            className="flex min-h-drow flex-none items-center gap-4 px-5 py-2"
            style={{ opacity: Math.max(0.1, 0.6 - i * 0.08) }}
          >
            <span className="h-2 w-[92px] flex-none rounded-full bg-line" />
            <span className="h-2.5 w-40 max-w-full flex-1 rounded-full bg-line/70" />
            <span className="h-5 w-20 flex-none rounded-full bg-line/50" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the rail's guide says: who records, what each state means. */
function AttendanceGuide(): React.ReactElement {
  return (
    <InfoPanel title="Cómo se registra la asistencia" as="div" className="min-w-0">
      <p>El entrenador toma lista en cada sesión. Si un registro no es correcto, pida la corrección al club.</p>
      <ul className="flex flex-col gap-2">
        {ATTENDANCE_LEGEND.map(({ estado, meaning }) => (
          <li key={estado} className="flex items-center gap-2.5">
            <Badge tone={getAttendanceBadgeTone(estado)}>{getAttendanceLabel(estado)}</Badge>
            <span className="text-xs text-ink-3">{meaning}</span>
          </li>
        ))}
      </ul>
    </InfoPanel>
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
function PortalWindowNote(): React.ReactElement {
  return (
    <p className="max-w-[68ch] text-xs leading-relaxed text-ink-3-strong">
      Su portal recibe las {PORTAL_SESSION_WINDOW} sesiones más recientes que el club registró. Si
      necesita un período anterior, pídalo al club.
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
            toUserMessage(error, "No se pudo cargar su historial de asistencia."),
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
          <LoadingState label="Cargando su asistencia…" />
        </div>
      )}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
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
    hasAlumnoRole,
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
      <ManagedStudentPicker
        id="student-select-attendance"
        profiles={managedProfiles}
        value={selectedId}
        onChange={setSelectedId}
      />

      {selectedProfile === null ? (
        <EmptyState
          icon={<User size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
          title="No se encontraron estudiantes asociados a esta cuenta"
          description="Inscríbete como jugador o agregue un hijo o dependiente para empezar a ver asistencias."
          action={
            <Link href="/student" className={buttonClasses("secondary", "sm")}>
              Ir a mi cuenta
            </Link>
          }
        />
      ) : selectedProfile.recentSessions.length === 0 ? (
        /*
         * The socio nuevo: the same two columns as a record with sessions, but
         * the rail holds only the guide, which fills the width beside the
         * record. The counted recap stays out — at zero it would repeat the
         * record's sentence over four zeros. The record keeps its content
         * height: ghost rows under "Aún no hay asistencias" read as loading.
         */
        <div className={cn(PAGE_RAIL, "lg:items-stretch")}>
          <div className="flex min-w-0 flex-col gap-section">
            <SessionList profile={selectedProfile} studentName={studentName} fill />
            <PortalWindowNote />
          </div>
          <div className="flex min-w-0 flex-col gap-page lg:self-start">
            <AttendanceGuide />
          </div>
        </div>
      ) : (
        <div className={cn(PAGE_RAIL, "lg:items-stretch")}>
          {/* `gap-section` — the declared step between the parts of one block,
              not the 12px this wrote by hand. */}
          <div className="flex min-w-0 flex-col gap-section">
            <SessionList profile={selectedProfile} studentName={studentName} fill />
            <PortalWindowNote />
          </div>

          <div className="flex min-w-0 flex-col gap-page lg:self-start">
            <AttendanceRecap profile={selectedProfile} studentName={studentName} />
            <AttendanceGuide />
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
    <ProtectedRoute allowedRoles={["representante", "estudiante", "unsupported"]}>
      {/* `useManagedProfiles` reads `?alumno=` through `useSearchParams` — see
          the same boundary on `/student` and `/student/payments`. */}
      <Suspense>
        <StudentAttendanceContent />
      </Suspense>
    </ProtectedRoute>
  );
}
