"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchStudentPortal,
  fetchPagosDePersona,
  fetchHorariosPorAlumno,
  independizarPersona,
} from "@/services/api";
import type {
  AlumnoHorario,
  StudentPortalSummary,
  StudentProfileSummary,
  PagoPersona,
} from "@/services/api";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { EmptyState, ErrorState, LoadingState, buttonClasses } from "@/components/ui";
import AgeUpConfirmation from "@/components/AgeUpConfirmation";
import ManagedStudentPicker, {
  useManagedProfiles,
  withSelectedStudent,
} from "./ManagedStudentPicker";
import PaymentBand from "./PaymentBand";
import {
  derivePortalMode,
  isRepresentative,
  isMinor,
  buildWeeklyTrainingSchedule,
  describeMembershipState,
  describePaymentSituation,
  findNextTrainingSessions,
  firstNameOf,
  formatLevelName,
  resolveCoverageEnd,
  summarizeRecentAttendance,
  type UpcomingTraining,
} from "./student-utils";
import { CalendarDays, ShieldCheck, User, UserPlus, UserMinus, ArrowRight } from "lucide-react";

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

type PagosState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; pagos: PagoPersona[] };

type HorariosState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; asignaciones: AlumnoHorario[] };

// ---------------------------------------------------------------------------
// The club membership card (`.carnet`, _sistema.css:291-304)
//
// This is the one thing a parent screenshots, so it is an identity document
// and is held to that standard: every field on it is real. The prototype's
// "Miembro nº", "Desde" and "Renueva" are NOT rendered — see the block comment
// above `parseLevelNumber` in student-utils.ts for where each one dies.
// ---------------------------------------------------------------------------

function levelTagLabel(profile: StudentProfileSummary): string | null {
  const { ranking } = profile;
  if (ranking.status !== "available" || !ranking.estaEnRanking) return null;
  return formatLevelName(ranking.nivelNombre);
}

function CarnetFact({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="min-w-0">
      <span className="mb-[3px] block text-[10px] font-semibold uppercase leading-[1.2] tracking-[0.1em] text-white/60">
        {label}
      </span>
      <b className="block text-[13px] font-bold leading-[1.25] tabular-nums">{value}</b>
    </div>
  );
}

function Carnet({
  profile,
  coverageEnd,
}: {
  profile: StudentProfileSummary;
  coverageEnd: string | null;
}): React.ReactElement {
  const fullName = `${profile.nombres} ${profile.apellidos}`.trim();
  const level = levelTagLabel(profile);
  // The same reading `/student/payments` shows, from the same function — the
  // two screens used to word this differently for the same `estado`.
  const membership = describeMembershipState(profile.membership?.estado);
  const facts: { label: string; value: string }[] = [];
  // "Socio desde" rather than the prototype's "MIEMBRO Nº · DESDE": the backend
  // has no member-number concept, and printing the surrogate persona id as one
  // would invent an identity-document field. The activation date IS real.
  if (profile.membership?.fechaActivacion) {
    facts.push({ label: "Socio desde", value: formatDate(profile.membership.fechaActivacion) });
  }
  if (profile.membership?.categoria) facts.push({ label: "Plan", value: profile.membership.categoria });
  if (profile.membership?.franjaHoraria) facts.push({ label: "Franja", value: profile.membership.franjaHoraria });
  if (profile.membership?.modalidad) {
    facts.push({
      label: "Modalidad",
      value: profile.membership.modalidad === "PERSONALIZADA" ? "Personalizada" : "Mensual",
    });
  }
  if (profile.membership?.montoAplicado) {
    // "Valor mensual", the same label `/student/payments` puts on the same
    // field. The carnet used to call it "Monto", which reads as an amount
    // paid rather than the plan's price, and gave one number two names two
    // clicks apart.
    facts.push({
      label: "Valor mensual",
      value: formatCurrency(Number(profile.membership.montoAplicado)),
    });
  }
  if (coverageEnd) facts.push({ label: "Cobertura hasta", value: formatDate(coverageEnd) });

  return (
    <section
      data-testid="student-carnet"
      aria-label={`Carnet de socio de ${fullName}`}
      className="relative flex flex-col overflow-hidden rounded-card bg-gradient-to-br from-coal to-[#2A2A33] px-6 py-[22px] text-white"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-[46px] -top-[46px] h-[150px] w-[150px] rounded-full bg-ball/[0.08]"
      />

      <div className="relative z-10 flex items-center gap-[11px]">
        {/* `alt=""` on purpose: the mark carries no information the card does
            not already state in text — "Cata Club / Tenis de mesa" is right
            beside it, and the section is labelled "Carnet de socio de …".
            Naming the image would make a screen reader say the club's name
            twice in a row (WCAG 1.1.1: a redundant image is decorative). */}
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center overflow-hidden rounded-full bg-white">
          <Image src="/brand/cata-club-logo.jpeg" alt="" width={30} height={30} className="h-[30px] w-[30px] object-cover" />
        </span>
        <div>
          <b className="block text-[12.5px] font-bold leading-[1.25]">Cata Club</b>
          <span className="block text-[10px] uppercase leading-[1.3] tracking-[0.12em] text-white/60">Tenis de mesa</span>
        </div>
      </div>

      {/* Name and badges are one group — the person and what the club grants
          them — so they sit 10px apart, while the club header above and the
          fact grid below are separated by 18px. The card used to space all
          four blocks by an identical 14px, which read as four unrelated rows
          rather than as header / identity / record. */}
      <p className="relative z-10 mt-[18px] text-balance text-2xl font-extrabold leading-[1.15] tracking-[-0.03em]">
        {fullName}
      </p>

      <div className="relative z-10 mt-2.5 flex flex-wrap gap-2">
        {level !== null ? (
          <span className="h-badge inline-flex items-center rounded-full bg-l9 px-[11px] text-[11.5px] font-bold text-ink">
            {level}
          </span>
        ) : (
          <span className="h-badge inline-flex items-center rounded-full bg-white/[0.11] px-[11px] text-[11.5px] font-bold text-white">
            Sin nivel asignado
          </span>
        )}
        <span
          className={
            membership.active
              ? "h-badge inline-flex items-center gap-1.5 rounded-full bg-state-ok/20 px-[11px] text-[11.5px] font-bold text-[#7BE8A4]"
              : "h-badge inline-flex items-center gap-1.5 rounded-full bg-white/[0.11] px-[11px] text-[11.5px] font-bold text-white"
          }
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
          {membership.label}
        </span>
      </div>

      {/* Equal columns, not shrink-to-fit ones. As a wrapping flex row every
          fact was as wide as its own value, so the labels landed at arbitrary
          x positions and no two rows lined up (in the 340px rail: 1098/1198.4
          on the first row against 1098/1203.5/1293 on the second, with 93px of
          dead space at the end of the first). `auto-fit` tracks give one
          rhythm at every width — two columns in the rail and on a phone, and
          all five or six side by side when the card runs full width below
          `lg`. */}
      {facts.length > 0 && (
        <div
          data-testid="carnet-facts"
          className="relative z-10 mt-[18px] grid grid-cols-[repeat(auto-fit,minmax(116px,1fr))] gap-x-4 gap-y-[13px] border-t border-white/10 pt-[15px]"
        >
          {facts.map((fact) => (
            <CarnetFact key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// "Próximos entrenamientos" — the second of the two things this screen is for
//
// The screen used to answer this with the most recent RECORDED session under
// the heading "Entrenamientos": a past fact where a family reads a future one.
// It could not do better, because `Horario` carries no link to the persona it
// serves.
//
// `AlumnoHorario` does. The rows behind this panel are the assignment an admin
// made in `/groups` — `buildWeeklyTrainingSchedule` merges the club's
// consecutive one-hour blocks back into the window the student actually
// attends, and `findNextTrainingSessions` walks the calendar forward from
// today. Nothing here is projected: the schedule is the club's, and the dates
// are its next occurrences.
//
// The panel says so in as many words, because the club records no
// cancellations, holidays or one-off changes anywhere — a date printed with no
// source would read as a confirmed appointment, which is not what it is.
// ---------------------------------------------------------------------------

/**
 * A text action that reads as a destination, not as a button competing with the page's CTA.
 *
 * `min-h-[24px]` is the WCAG 2.2 AA target size (SC 2.5.8): the 13px label's
 * own line box measures 20px tall, which is under the 24x24 floor. The extra
 * height is hit area only — the box centres its content, so the type size and
 * the underline's position are unchanged.
 */
function SituationLink({ href, children }: { href: string; children: React.ReactNode }): React.ReactElement {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[24px] items-center gap-1.5 rounded text-[13px] font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 transition-colors hover:decoration-ink"
    >
      {children}
      <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );
}

/** One upcoming session, on the product's 56px detail row. */
function TrainingRow({ session, first }: { session: UpcomingTraining; first: boolean }): React.ReactElement {
  return (
    <li className="flex min-h-drow flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-5 py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold tracking-tight text-ink">
          {session.diaLabel}
          {session.isToday && (
            <span className="h-badge inline-flex items-center gap-1.5 rounded-full bg-coal px-[11px] text-[11.5px] font-bold text-white">
              <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
              Hoy
            </span>
          )}
        </p>
        <p className="mt-0.5 text-[12.5px] tabular-nums text-ink-3-strong">
          {formatDate(session.fecha)}
        </p>
      </div>
      <span
        className={
          first
            ? "flex-none text-[17px] font-extrabold tabular-nums tracking-[-0.02em] text-ink"
            : "flex-none text-[15px] font-bold tabular-nums text-ink-2"
        }
      >
        {session.horaInicio} — {session.horaFin}
      </span>
    </li>
  );
}

function TrainingPanel({
  profile,
  horariosState,
  /** Whose record this is — "sus asistencias" only when the reader is the student. */
  viewingOwnProfile,
  studentName,
}: {
  profile: StudentProfileSummary;
  horariosState: HorariosState;
  viewingOwnProfile: boolean;
  studentName: string;
}): React.ReactElement {
  const sessions = useMemo(
    () =>
      horariosState.status === "ready"
        ? findNextTrainingSessions(buildWeeklyTrainingSchedule(horariosState.asignaciones), 3)
        : [],
    [horariosState],
  );

  const recap = summarizeRecentAttendance(profile.recentSessions);
  // A guardian reading "De sus últimas 2 sesiones asistió a 1" about their
  // child was being told about themselves. The subject is named instead.
  const scope = recap
    ? viewingOwnProfile
      ? recap.total === 1
        ? "su última sesión registrada"
        : `sus últimas ${recap.total} sesiones registradas`
      : recap.total === 1
        ? `la última sesión registrada de ${studentName}`
        : `las últimas ${recap.total} sesiones registradas de ${studentName}`
    : "";

  return (
    <section
      data-testid="student-situation"
      aria-label="Próximos entrenamientos"
      className="card flex h-full flex-col overflow-hidden"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 pb-3.5 pt-[18px]">
        <h2 className="text-[17px] font-bold tracking-tight text-ink">Próximos entrenamientos</h2>
        <p className="text-[12.5px] text-ink-3-strong">
          {viewingOwnProfile
            ? "El horario semanal que el club le asignó."
            : `El horario semanal que el club le asignó a ${studentName}.`}
        </p>
      </div>

      {horariosState.status === "loading" && (
        <div className="border-t border-line">
          <LoadingState label="Consultando su horario…" />
        </div>
      )}

      {horariosState.status === "error" && (
        <div className="border-t border-line px-5 py-4">
          <p className="text-[13px] leading-relaxed text-ink-3">
            No se pudo consultar el horario en este momento. Vuelva a cargar la página o consulte
            en administración del club.
          </p>
        </div>
      )}

      {horariosState.status === "ready" &&
        (sessions.length > 0 ? (
          <ul className="flex flex-1 flex-col border-t border-line">
            {sessions.map((session, index) => (
              <TrainingRow
                key={`${session.fecha}-${session.horaInicio}`}
                session={session}
                first={index === 0}
              />
            ))}
          </ul>
        ) : (
          <div className="flex-1 border-t border-line">
            <EmptyState
              icon={<CalendarDays size={21} strokeWidth={1.5} aria-hidden="true" />}
              title={
                viewingOwnProfile
                  ? "Todavía no tiene un horario asignado"
                  : `${studentName} todavía no tiene un horario asignado`
              }
              description="El club asigna los días y las horas de entrenamiento. Consulte en administración para que le asignen uno."
            />
          </div>
        ))}

      {/* One line, not a second panel: it is the same subject — training —
          and it is the fact a family checks right after "when is the next
          one". The record itself lives on `/student/attendance`. */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-t border-line bg-sunken px-5 py-3.5">
        <p className="text-[12.5px] leading-relaxed text-ink-3-strong">
          {recap ? (
            <>
              De {scope} asistió a{" "}
              <b className="font-semibold text-ink">
                {recap.attended} de {recap.total}
              </b>
              .
            </>
          ) : viewingOwnProfile ? (
            "Su asistencia aparecerá aquí en cuanto el entrenador tome lista."
          ) : (
            `La asistencia de ${studentName} aparecerá aquí en cuanto el entrenador tome lista.`
          )}
        </p>
        {/* The link carries the profile it is talking about, so the record it
            opens is the one the sentence beside it just described. */}
        <SituationLink href={withSelectedStudent("/student/attendance", profile.personaId)}>
          {viewingOwnProfile ? "Ver mis asistencias" : `Ver las asistencias de ${studentName}`}
        </SituationLink>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Membership plan catalog — pending-enrollment view only
// ---------------------------------------------------------------------------

function MembershipPlansGrid({ data }: { data: StudentPortalSummary }): React.ReactElement {
  if (data.membershipPlans.length === 0) {
    return (
      <div className="card">
        <EmptyState
          icon={<ShieldCheck size={21} strokeWidth={1.5} aria-hidden="true" />}
          title="No hay planes de membresía disponibles"
          description="El catálogo de planes está vacío en este momento. Consulte con administración."
        />
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.membershipPlans.map((plan) => (
        <div key={plan.id} className="card flex flex-col p-5">
          <h3 className="text-base font-bold text-ink">{plan.nombre}</h3>
          <span className="mt-2 text-2xl font-extrabold tabular-nums text-ink">
            {formatCurrency(plan.precio)}
          </span>
          <p className="mt-1 text-xs text-ink-3">{plan.franjaHoraria}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pending-enrollment view — honest intermediate state for an authenticated
// persona with no ALUMNO role and no representados (see student-utils.ts's
// `derivePortalMode` doc comment for why this is not /unauthorized).
// ---------------------------------------------------------------------------

function PendingEnrollmentView({ data }: { data: StudentPortalSummary }): React.ReactElement {
  return (
    <div className="w-full space-y-5">
      <section className="card p-6">
        <h2 className="text-[17px] font-bold tracking-tight text-ink">Bienvenido a Cata Club</h2>
        {/* Capped at a readable measure inside a full-width card, rather than
            capping the card: a 110-character line is not a paragraph. */}
        <p className="mt-2 max-w-[68ch] text-[13px] leading-relaxed text-ink-3">
          Su cuenta está creada pero todavía no tiene una matrícula activa. Complete su inscripción para
          empezar a entrenar.
        </p>
      </section>

      <MembershipPlansGrid data={data} />

      <div className="flex flex-wrap gap-3">
        <Link href="/student/enroll?type=self" className={buttonClasses("primary")}>
          <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />
          Inscribirme como jugador
          <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <Link href="/student/enroll?type=child" className={buttonClasses("secondary")}>
          <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />
          Inscribir a un hijo o dependiente
          <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active portal view — self-managed student and/or representante
// ---------------------------------------------------------------------------

function ActivePortalView({
  data,
  hasAlumnoRole,
  accountPersonaId,
  onIndependizar,
}: {
  data: StudentPortalSummary;
  hasAlumnoRole: boolean;
  /** The persona behind the SESSION — not the profile currently selected. */
  accountPersonaId: string;
  onIndependizar: () => void;
}): React.ReactElement {
  const { managedProfiles, selectedId, setSelectedId, selectedProfile } = useManagedProfiles(
    data,
    hasAlumnoRole,
    accountPersonaId,
  );

  const representative = isRepresentative(data.representados.length);
  const selfIsMinor = isMinor(data.self?.fechaNacimiento);
  const selectedPersonaId = selectedProfile?.personaId ?? "";

  // Payments are fetched here rather than inside `PagosSection` because the
  // carnet also needs them: the only real "coverage until" date in the system
  // is the furthest `fechaFin` among approved payments.
  const [pagosState, setPagosState] = useState<PagosState>({ status: "loading" });
  const [pagosReloadToken, setPagosReloadToken] = useState(0);

  useEffect(() => {
    if (!selectedPersonaId) return;
    let cancelled = false;
    setPagosState({ status: "loading" });
    fetchPagosDePersona(selectedPersonaId)
      .then((pagos) => {
        if (!cancelled) setPagosState({ status: "ready", pagos });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPagosState({
          status: "error",
          message: error instanceof Error ? error.message : "No se pudo cargar el historial de pagos.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId, pagosReloadToken]);

  // The student's REAL schedule assignments — the only source from which an
  // upcoming session can be stated truthfully (see `TrainingPanel`).
  const [horariosState, setHorariosState] = useState<HorariosState>({ status: "loading" });

  useEffect(() => {
    if (!selectedPersonaId) return;
    let cancelled = false;
    setHorariosState({ status: "loading" });
    fetchHorariosPorAlumno(Number(selectedPersonaId))
      .then((asignaciones) => {
        if (!cancelled) setHorariosState({ status: "ready", asignaciones });
      })
      .catch(() => {
        // No message to carry: the panel states the recovery itself, and a
        // schedule lookup failing must never take the payment band with it.
        if (!cancelled) setHorariosState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId]);

  const coverageEnd = useMemo(
    () => (pagosState.status === "ready" ? resolveCoverageEnd(pagosState.pagos) : null),
    [pagosState],
  );
  const pendingPagos = useMemo(
    () =>
      pagosState.status === "ready"
        ? pagosState.pagos.filter((pago) => pago.estadoPago === "PENDIENTE_VALIDACION").length
        : 0,
    [pagosState],
  );
  const selectedIsMinor = isMinor(selectedProfile?.fechaNacimiento);
  /**
   * Whether the profile on screen is the account holder's own, rather than a
   * dependent they manage. Several things below turn on it, and every one of
   * them used to turn on the age of the SELECTED profile instead — which is
   * the same question only for a self-managed student.
   */
  const viewingOwnProfile =
    selectedProfile !== null && selectedProfile.personaId === accountPersonaId;
  /**
   * Only a minor looking at their OWN account is read-only on payments. A
   * representante looking at their minor child is the person the backend
   * expects to pay (`registrarPago` authorizes the owner, their representative
   * or an ADMINISTRADOR), so they get the real CTA.
   */
  const paymentsAreReadOnly = selectedIsMinor && viewingOwnProfile;
  const hasAccountActions =
    representative || !hasAlumnoRole || data.self?.representanteId != null;

  /**
   * The one thing this screen exists to answer, resolved once and rendered in
   * the band above everything else — see `PaymentBand`. `describePaymentSituation`
   * owns every word of it, so the home screen and `/student/payments` can never
   * word the same `estado` differently again.
   */
  const paymentSituation = selectedProfile
    ? describePaymentSituation({
        studentName: firstNameOf(selectedProfile.nombres),
        viewingOwnProfile,
        blockedAsMinor: paymentsAreReadOnly,
        representanteName: selectedProfile.representante
          ? `${selectedProfile.representante.nombres} ${selectedProfile.representante.apellidos}`.trim()
          : null,
        hasMembership: selectedProfile.membership != null,
        planName: selectedProfile.membership?.categoria ?? null,
        monthlyPrice: selectedProfile.membership?.montoAplicado ?? null,
        coverageEnd,
        pendingCount: pendingPagos,
      })
    : null;

  return (
    // Full content width, like `/dashboard`, `/members` and `/payments`. The
    // 760px cap came from the prototype's `.canvas`, and at 1440×900 it left
    // the right HALF of the content column empty on every family screen while
    // every admin screen filled it — the loudest remaining reason the portal
    // did not read as the same product. What was one 760px stack is now a
    // band across the top, the training panel in the main column and the
    // carnet in a rail beside it.
    <div className="w-full space-y-5">
      {/* The greeting is NOT a heading here. It used to be a 26px h2 directly
          under `PageHeader`'s own 26px h1, which stacked "ÁREA DE ESTUDIANTES
          / Mi cuenta / Hola, Ana" — three title-weight lines before a single
          fact — and then repeated the same name in the carnet immediately
          below. It now rides in `AppShell`'s subtitle slot, on the header row
          where it belongs. */}

      {/* Guardian → dependent switcher. The audit named this genuinely
          club-specific: a representante lands on one child and swaps to the
          next without leaving the page. */}
      <ManagedStudentPicker
        id="student-select"
        profiles={managedProfiles}
        value={selectedId}
        onChange={setSelectedId}
      />

      {selectedProfile === null || paymentSituation === null ? (
        <div className="card">
          <EmptyState
            icon={<User size={21} strokeWidth={1.5} aria-hidden="true" />}
            title="No se encontraron estudiantes asociados a esta cuenta"
            description="Inscríbase como jugador o agregue un hijo o dependiente para empezar."
          />
        </div>
      ) : (
        <>
          {/* First, across the whole width: the reader came to find out whether
              they owe the club anything and to do something about it. */}
          <PaymentBand
            situation={paymentSituation}
            action={
              paymentSituation.canRegister
                ? // Straight into the open form. The route to paying used to be
                  // three clicks — link, page, "Registrar un pago" — and the
                  // last two were on a screen that never said whose payment it
                  // was about.
                  {
                    href: withSelectedStudent("/student/payments?registrar=1", selectedPersonaId),
                    label: "Registrar un pago",
                  }
                : {
                    href: withSelectedStudent("/student/payments", selectedPersonaId),
                    label: "Ver los pagos",
                  }
            }
          />

          {/* The main column answers "when do I train next"; the rail carries
              the identity the family screenshots. The carnet was NOT deleted —
              it is the one thing on this screen a parent has reacted well to —
              but it no longer sits between the band and the training panel at
              full width, where it read as the screen's subject. At 340px it is
              a card the size of a card. */}
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <TrainingPanel
              profile={selectedProfile}
              horariosState={horariosState}
              viewingOwnProfile={viewingOwnProfile}
              studentName={firstNameOf(selectedProfile.nombres)}
            />

            <div className="flex flex-col gap-5">
              <Carnet profile={selectedProfile} coverageEnd={coverageEnd} />

              {/* Only on the minor's OWN account. Shown to a guardian looking
                  at their dependent it read "Su representante: Laura Vera" to
                  Laura Vera — the card names the person the reader should turn
                  to, and the reader was that person. */}
              {selectedIsMinor && viewingOwnProfile && selectedProfile.representante && (
                <section className="card flex items-center gap-3 p-5" aria-label="Su representante">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-canvas">
                    <User size={18} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[10.5px] font-bold uppercase tracking-[0.13em] text-ink-3">
                      Su representante
                    </span>
                    <span className="block text-[13.5px] font-semibold text-ink">
                      {selectedProfile.representante.nombres}{" "}
                      {selectedProfile.representante.apellidos}
                    </span>
                  </span>
                </section>
              )}
            </div>
          </div>
        </>
      )}

      {/* A minor manages nothing on their own account: no dependents, no
          payments, no independentization. Everything below is gated on that.

          A self-managed student with no dependents sees no "agregar
          dependiente" either: that CTA used to point at the PUBLIC enrolment
          wizard, which creates a whole second account and user — and
          `/student/add-dependent` is gated to `representante`, so they could
          not use the honest route either. Offering it was worse than nothing.

          `hasAccountActions` exists because the row is now genuinely optional:
          the payments CTA lives in `PaymentBand` at the top of the screen (on
          the fact it acts on), so a self-managed adult with no dependents and
          no representative has nothing left to put here, and an empty flex row
          still costs a 20px gap under the panel. */}
      {!selfIsMinor && hasAccountActions && (
        <div className="flex flex-wrap gap-3 pt-1">
          {representative && (
            <Link href="/student/add-dependent" className={buttonClasses("secondary")}>
              <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />
              Agregar hijo o dependiente
              <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          )}
          {!hasAlumnoRole && (
            <Link href="/student/enroll?type=self" className={buttonClasses("secondary")}>
              <UserPlus size={16} strokeWidth={1.5} aria-hidden="true" />
              Unirme como jugador
              <ArrowRight size={14} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          )}
          {data.self?.representanteId != null && (
            <button type="button" onClick={onIndependizar} className={buttonClasses("secondary")}>
              <UserMinus size={16} strokeWidth={1.5} aria-hidden="true" />
              Independizarse del representante
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function StudentPortalContent(): React.ReactElement {
  const { session, refreshSession } = useAuth();
  const personaId = session?.user.id ?? "";
  const hasAlumnoRole = session?.user.role === "estudiante";

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  const [showAgeUpModal, setShowAgeUpModal] = useState(false);
  const [ageUpLoading, setAgeUpLoading] = useState(false);

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
          message: error instanceof Error ? error.message : "No se pudo cargar su cuenta.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  const greetingName =
    state.status === "ready" && state.data.self
      ? firstNameOf(state.data.self.nombres)
      : firstNameOf(session?.user.name ?? "");

  async function handleAgeUpConfirm(contrasenia: string): Promise<void> {
    if (!personaId) return;
    setAgeUpLoading(true);
    try {
      await independizarPersona(Number(personaId), contrasenia);
      await refreshSession();
      setReloadToken((n) => n + 1);
      setShowAgeUpModal(false);
    } finally {
      setAgeUpLoading(false);
    }
  }

  // The greeting rides on the header row rather than in a heading of its own
  // (see `ActivePortalView`). While the portal is still loading there is no
  // name to greet, so the slot stays empty instead of flashing a placeholder.
  const portalMode =
    state.status === "ready"
      ? derivePortalMode(hasAlumnoRole, state.data.representados.length)
      : null;
  const subtitle =
    portalMode === "active" && greetingName
      ? `Hola, ${greetingName}. Esto es lo que el club tiene registrado.`
      : undefined;

  return (
    <AppShell eyebrow="Área de estudiantes" title="Mi cuenta" subtitle={subtitle}>
      {state.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando su cuenta…" />
        </div>
      )}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {state.status === "ready" &&
        (portalMode === "pending" ? (
          <PendingEnrollmentView data={state.data} />
        ) : (
          <ActivePortalView
            data={state.data}
            hasAlumnoRole={hasAlumnoRole}
            accountPersonaId={personaId}
            onIndependizar={() => setShowAgeUpModal(true)}
          />
        ))}
      <AgeUpConfirmation
        open={showAgeUpModal}
        onConfirm={handleAgeUpConfirm}
        onCancel={() => setShowAgeUpModal(false)}
      />
    </AppShell>
  );
}

export default function StudentPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["representante", "estudiante", "unsupported"]}>
      {/* `useManagedProfiles` reads `?alumno=` through `useSearchParams`, which
          needs a boundary to fall back to during prerender — the same wrapper
          `/student/payments` and `/reset-password` use for the same reason. */}
      <Suspense>
        <StudentPortalContent />
      </Suspense>
    </ProtectedRoute>
  );
}
