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
 * history to its five most recent records before it reaches this client. The
 * backend itself does NOT impose that limit — `GET /asistencias/persona/{id}`
 * returns the full, unpaginated history to any authenticated caller (see
 * `AsistenciaRepositorio.listar_por_persona`) — so the cap is a frontend
 * decision, and several real students already have 13 records the portal never
 * shows. Raising `RECENT_SESSIONS_LIMIT` is all this screen needs to grow.
 *
 * Until it is raised, the page states its own scope in the footnote rather
 * than presenting five rows as if they were the whole record.
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
import { Badge, EmptyState, ErrorState, LoadingState, buttonClasses, cn } from "@/components/ui";
import { breakdownAttendance, firstNameOf, summarizeRecentAttendance } from "../student-utils";
import type { AttendanceBreakdown } from "../student-utils";
import ManagedStudentPicker, { useManagedProfiles } from "../ManagedStudentPicker";
import { CalendarCheck, User } from "lucide-react";

/**
 * Mirrors `RECENT_SESSIONS_LIMIT` in src/lib/server/student-adapter.ts.
 *
 * Duplicated rather than imported because that module is server-only. It is
 * used for copy, never for slicing — the list renders whatever arrives, so if
 * the server cap changes and this constant is forgotten the page still shows
 * every record it was given.
 */
/** Must match `RECENT_SESSIONS_LIMIT` in lib/server/student-adapter.ts — the
 *  footnote below states this number to the student, so a drift would lie. */
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
        <p className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.13em] text-ink-3">
          {studentName ? `Asistencia de ${studentName}` : "Su asistencia"}
        </p>
        <h2 id="attendance-recap-title" className="text-[17px] font-bold tracking-tight text-ink">
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
        <p className="mt-1.5 text-[13px] text-ink-3">
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
            <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3-strong">
              <span aria-hidden="true" className={cn("h-1.5 w-1.5 flex-none rounded-full", DOT_CLASS[estado])} />
              {getAttendanceLabel(estado)}
            </p>
            {/* Ink, always. `_sistema.css` allows colour in badges and dots,
                never in a figure — a green "4" beside a red "1" turns a tally
                into a verdict. */}
            <p className="mt-1 text-[26px] font-extrabold tabular-nums leading-none tracking-[-0.03em] text-ink">
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
}: {
  profile: StudentProfileSummary;
  studentName: string | null;
}): React.ReactElement {
  const sessions = profile.recentSessions;

  return (
    <section className="card overflow-hidden" aria-labelledby="sessions-title">
      <div className="flex items-center gap-3 border-b border-line px-5 py-4">
        {/* The record is the main column, and it names its subject: a guardian
            reading two children's histories one click apart must never have to
            infer which one is on screen from the dates. */}
        <h2 id="sessions-title" className="flex-1 text-[13px] font-bold text-ink">
          {studentName ? `Sesiones registradas de ${studentName}` : "Sesiones registradas"}
        </h2>
        {sessions.length > 0 && (
          <span className="text-[12.5px] font-semibold tabular-nums text-ink-3">
            {sessions.length}
          </span>
        )}
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={<CalendarCheck size={21} strokeWidth={1.5} aria-hidden="true" />}
          title={
            studentName
              ? `Aún no hay asistencias registradas de ${studentName}`
              : "Aún no hay asistencias registradas"
          }
          description="Cada vez que el entrenador tome lista, la sesión aparecerá en esta pantalla con el estado que le haya asignado."
        />
      ) : (
        <ul className="flex flex-col">
          {sessions.map((session) => (
            <li
              key={`${session.fecha}-${session.horario}`}
              className="flex min-h-drow flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-2 last:border-b-0"
            >
              <span className="w-[92px] flex-none text-[10.5px] font-bold uppercase tracking-[0.1em] tabular-nums text-ink-3">
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
    </section>
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
            error instanceof Error ? error.message : "No se pudo cargar su historial de asistencia.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  return (
    <AppShell
      eyebrow="Área de estudiantes"
      // "Asistencias" — the sidebar row's own label, and true for a guardian
      // reading a dependent's record. See the same change on `/student/payments`.
      title="Asistencias"
      subtitle="Cada sesión que el entrenador registró, con el estado que le asignó."
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
    <div className="w-full space-y-5">
      <ManagedStudentPicker
        id="student-select-attendance"
        profiles={managedProfiles}
        value={selectedId}
        onChange={setSelectedId}
      />

      {selectedProfile === null ? (
        <div className="card">
          <EmptyState
            icon={<User size={21} strokeWidth={1.5} aria-hidden="true" />}
            title="No se encontraron estudiantes asociados a esta cuenta"
            description="Inscríbase como jugador o agregue un hijo o dependiente para empezar a ver asistencias."
            action={
              <Link href="/student" className={buttonClasses("secondary", "sm")}>
                Ir a mi cuenta
              </Link>
            }
          />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-3">
            <SessionList profile={selectedProfile} studentName={studentName} />

            {/* The scope, stated. Rows presented without this line read as
                "this is the whole record". */}
            <p className="max-w-[68ch] text-[12.5px] leading-relaxed text-ink-3-strong">
              Su portal recibe las {PORTAL_SESSION_WINDOW} sesiones más recientes que el club
              registró. Si necesita un período anterior, pídalo al club.
            </p>
          </div>

          <AttendanceRecap profile={selectedProfile} studentName={studentName} />
        </div>
      )}

      {/* No back link and no "Ver mis pagos" button. The sidebar carries both
          destinations and highlights the current one; the admin screens
          dropped their own "← Volver al Panel" for exactly this reason. */}
    </div>
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
