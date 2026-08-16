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
import { EmptyState, ErrorState, LoadingState, PAGE_RAIL, buttonClasses, cn } from "@/components/ui";
import AgeUpConfirmation from "@/components/AgeUpConfirmation";
import ManagedStudentPicker, {
  useManagedProfiles,
  withSelectedStudent,
} from "./ManagedStudentPicker";
import CuotaCard from "./CuotaCard";
import {
  compactPaymentLabel,
  derivePortalMode,
  isRepresentative,
  isMinor,
  buildWeeklyTrainingSchedule,
  describeAssignedWindows,
  describePaymentSituation,
  findNextTrainingSessions,
  firstNameOf,
  paymentBandTone,
  resolveCoverageEnd,
  summarizeRecentAttendance,
  type PaymentSituation,
  type UpcomingTraining,
} from "./student-utils";
import { AlertTriangle, CalendarDays, ShieldCheck, User, UserPlus, UserMinus, ArrowRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";

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
// above `resolveCoverageEnd` in student-utils.ts for where each one dies.
//
// ## "El carnet manda" (docs/archive/fixes/12-mi-cuenta-carnet.md)
//
// The redesign folds the payment situation into the carnet as a status band,
// in the position the chosen maquette draws it — over the card, not beside
// it — and trims the fact grid to the four the maquette asks for: Socio
// desde, Plan, Franja, Valor mensual. Two facts the OLD grid carried move or
// drop:
//
//   - "Cobertura hasta" moves to the "Cuota" card (`CuotaCard`) beside the
//     carnet — it is payment information, and the band above now states the
//     payment verdict already; repeating the date on the carnet too would be
//     the same fact stated twice two inches apart.
//   - "Modalidad" (Mensual/Personalizada) is dropped. Nothing in the chosen
//     maquette draws it, and the brief is explicit that an unlisted field
//     gets left out rather than kept "just in case" — the whole point of this
//     pass is that the carnet stops carrying everything it can.
//
// The band ALSO replaces the old `describeMembershipState` badge
// ("Membresía activa/pendiente/vencida"). That badge and the payment
// situation used to be able to disagree — an admin-set `estado` is not
// derived from coverage — and the maquette draws exactly one band, worded
// for "can this family act on it", which `describePaymentSituation` already
// is. The one case this trades away: an admin who marks a membership
// `INACTIVA` with no payment consequence no longer gets a distinct carnet
// reading for that — `never-paid`'s "no tiene ningún pago aprobado" covers
// it, and it is the more actionable of the two.
// ---------------------------------------------------------------------------

/**
 * A "Franja" value with two or more windows ("15:00 — 16:00 · 20:00 —
 * 21:15") used to be one plain string in a 172px-wide grid cell, so the
 * browser wrapped wherever it found a space — including inside a single
 * window, splitting "20:00 —" from "21:15" (fix 12b,
 * docs/archive/fixes/12-mi-cuenta-carnet.md). Each window is wrapped in its own
 * `whitespace-nowrap` span so the ONLY point where a line can break is the
 * " · " between them, which stays a normal (breakable) text node — never
 * inside a window, always between two.
 */
function CarnetFact({ label, value }: { label: string; value: string }): React.ReactElement {
  const windows = value.split(" · ");
  return (
    <div className="min-w-0">
      <span className="mb-[3px] block text-2xs font-semibold uppercase leading-tight text-white/60">
        {label}
      </span>
      <b className="block text-sm font-bold leading-tight tabular-nums">
        {windows.length > 1
          ? windows.flatMap((window, index) => {
              const nodes: React.ReactNode[] = [
                <span key={window} className="whitespace-nowrap">
                  {window}
                </span>,
              ];
              if (index < windows.length - 1) nodes.push(" · ");
              return nodes;
            })
          : value}
      </b>
    </div>
  );
}

/**
 * The carnet's own reading of the payment situation.
 *
 * Two shapes, not one-per-tone: `kind === "covered"` — a family that is up to
 * date, the majority of visits in a club where most people pay on time — is
 * the ONLY state that renders as the small pill the membership badge this
 * replaces already used. This is the direct answer to the maquette's own
 * recorded cost, "pesa mucho cuando no hay nada que resolver": that sentence
 * is about the up-to-date case specifically, not about every non-urgent one.
 *
 * Every other state — urgent (`bad`) or not (`awaiting-validation`,
 * `minor-blocked`, `no-membership`) — still has something to explain (why
 * there is nothing to act on yet, or who acts instead), so it keeps the
 * full-weight strip with `situation.headline` stated in full. Only the color
 * tells those two groups apart: red for urgent, the same neutral white the
 * old badge's inactive state used otherwise.
 *
 * Colors are literal hex, not the `state-*` tokens `Badge` uses: those are
 * tuned for text on the light `paper`/`canvas` surfaces, and this band sits
 * on the carnet's own coal gradient. The pattern (a translucent `state-*`
 * wash plus a light, hand-picked foreground) is the one the membership badge
 * this replaces already established for `ok` (`bg-state-ok/20
 * text-[#7BE8A4]`); `bad` follows the same recipe.
 */
function CarnetStatusBand({ situation }: { situation: PaymentSituation }): React.ReactElement {
  const tone = paymentBandTone(situation);
  const compact = situation.kind === "covered";

  if (!compact) {
    return (
      <div
        data-testid="carnet-status-band"
        data-urgent={String(situation.urgent)}
        data-tone={tone}
        className={cn(
          "relative z-10 mt-3 flex items-start gap-2.5 rounded-ctl px-3.5 py-2.5",
          tone === "bad" ? "bg-state-bad/20" : "bg-white/[0.11]",
        )}
      >
        {tone === "bad" && (
          <AlertTriangle
            size={ICON.sm}
            strokeWidth={2}
            className="mt-0.5 flex-none text-[#FF8A93]"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0">
          <p
            className={cn(
              "text-sm font-bold leading-tight",
              tone === "bad" ? "text-[#FF8A93]" : "text-white",
            )}
          >
            {situation.headline}
          </p>
          {situation.figure && (
            <p className="mt-0.5 text-2xs font-semibold uppercase tracking-flat text-white/60">
              {situation.figure.value} {situation.figure.unit}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <span
      data-testid="carnet-status-band"
      data-urgent="false"
      data-tone={tone}
      className="relative z-10 mt-3 inline-flex h-badge w-fit items-center gap-1.5 rounded-full bg-state-ok/20 px-[11px] text-2xs tracking-flat font-bold text-[#7BE8A4]"
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-current" />
      {compactPaymentLabel(situation)}
    </span>
  );
}

function Carnet({
  profile,
  situation,
  horariosState,
  className,
}: {
  profile: StudentProfileSummary;
  situation: PaymentSituation;
  /** The same assignments the training panel reads — see `franja` below. */
  horariosState: HorariosState;
  className?: string;
}): React.ReactElement {
  const fullName = `${profile.nombres} ${profile.apellidos}`.trim();
  const facts: { label: string; value: string }[] = [];
  // "Socio desde" rather than the prototype's "MIEMBRO Nº · DESDE": the backend
  // has no member-number concept, and printing the surrogate persona id as one
  // would invent an identity-document field. The activation date IS real.
  if (profile.membership?.fechaActivacion) {
    facts.push({ label: "Socio desde", value: formatDate(profile.membership.fechaActivacion) });
  }
  if (profile.membership?.categoria) facts.push({ label: "Plan", value: profile.membership.categoria });
  // Derived from the assignments, never from the plan: the membership type is
  // a price, and the `franja_horaria` column it used to be read from was a
  // hand-typed String(80) that drifted from the club's real hours — an Adultos
  // student read "20:00-21:00" here and "20:00 — 21:15" on the panel beside it.
  //
  // `null` from `describeAssignedWindows` means "the club assigned nothing",
  // and the carnet is honest about that by omitting the row entirely — but
  // that silence is only true for `status: "ready"`. A `loading` or `error`
  // lookup is not "nothing assigned", it is "not answered yet" or "could not
  // be answered", and printing the same omission for all three used to let a
  // network failure read as a fact the club never asserted. The wording below
  // matches the "Esta semana" panel's vocabulary for the same `horariosState`
  // (see `TrainingPanel`) so the screen speaks with one voice.
  const franja =
    horariosState.status === "ready"
      ? describeAssignedWindows(horariosState.asignaciones)
      : horariosState.status === "loading"
        ? "Consultando…"
        : "No se pudo consultar";
  if (franja) facts.push({ label: "Franja", value: franja });
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

  return (
    <section
      data-testid="student-carnet"
      aria-label={`Carnet de socio de ${fullName}`}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-card bg-gradient-to-br from-coal to-[#2A2A33] px-6 py-[22px] text-white",
        className,
      )}
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
          <b className="block text-xs font-bold leading-tight">Cata Club</b>
          <span className="block text-2xs uppercase leading-tight text-white/60">Tenis de mesa</span>
        </div>
      </div>

      {/* Name and status band are one group — the person and what the club
          currently needs from them about it — so they sit close together,
          while the header above and the fact grid below are separated by
          18px. */}
      <p className="relative z-10 mt-[18px] text-balance text-xl font-extrabold">
        {fullName}
      </p>

      <CarnetStatusBand situation={situation} />

      {/* A fixed two-column grid, not `auto-fit`: the carnet used to sit in a
          340px rail, where `auto-fit` and "two columns" were the same thing.
          `auto-fit` at the carnet's current width would spread four facts
          across four or five columns — the chosen maquette (Propuesta 2)
          draws exactly two, `.carnet .grid` at its own card's full width.
          The grid used to carry `sm:max-w-[360px]` from when the carnet was
          fix 12's ~1000px "wide" column — with the carnet and the rail now
          split evenly (fix 12c, see `ActivePortalView`), that cap would leave
          an empty strip inside the card instead of filling it, which is the
          same "vacío que no se llena" fix 12b already closed once. Dropped,
          so the grid fills the carnet the way the maquette's own does. */}
      {facts.length > 0 && (
        <div
          data-testid="carnet-facts"
          className="relative z-10 mt-[18px] grid grid-cols-2 gap-x-4 gap-y-section border-t border-white/10 pt-[15px]"
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
      className="inline-flex min-h-[24px] items-center gap-1.5 rounded text-sm font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 transition-colors hover:decoration-ink"
    >
      {children}
      <ArrowRight size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );
}

/** One upcoming session, on the product's 56px detail row. */
function TrainingRow({ session, first }: { session: UpcomingTraining; first: boolean }): React.ReactElement {
  return (
    /*
     * `flex-1` between `min-h-drow` and a ceiling: the card is stretched to
     * the height the page now claims, and with at most three sessions all the
     * slack used to pool into one dead band between the last row and the
     * footer. The rows share it instead. `items-center` already had the
     * content centred, so a taller row just breathes more.
     *
     * The ceiling is the correction that came out of measuring this pass. With
     * the page's leftover finally reaching the panel (see the grid in
     * `ActivePortalView`), three rows dividing it grew to 168px each at
     * 1440x900 — a 56px row rendered nearly triple, its `bg-sunken` marker a
     * grey slab, and the label floating in the middle of it. That is the
     * client's own "espacios vacíos" reappearing inside the row that was
     * supposed to absorb them. 112px is the largest a row reads as a row here:
     * it holds the day, the date and the badge with real air and still stacks
     * three of them into a panel. Whatever is left over past that stops at the
     * footer, which `mt-auto` now genuinely pins to the bottom.
     *
     * `first && "bg-sunken"` (fix 12c): the chosen maquette (Propuesta 2,
     * `.row.next`) marks the closest upcoming session with a distinct row
     * background, not with a badge — the "Hoy" pill below only fires when
     * that session happens to land on today's date, so on its own it left the
     * nearest-of-the-week row looking like any other one.
     */
    <li
      className={cn(
        "flex min-h-drow max-h-[112px] flex-1 flex-wrap items-center gap-x-4 gap-y-field border-b border-line px-5 py-3 last:border-b-0",
        first && "bg-sunken",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-base font-bold tracking-tight text-ink">
          {session.diaLabel}
          {session.isToday && (
            <span className="h-badge inline-flex items-center gap-1.5 rounded-full bg-coal px-[11px] text-2xs tracking-flat font-bold text-white">
              <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-ball" />
              Hoy
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs tabular-nums text-ink-3-strong">
          {formatDate(session.fecha)}
        </p>
      </div>
      <span
        className={
          first
            ? "flex-none text-base font-extrabold tabular-nums tracking-dense text-ink"
            : "flex-none text-base font-bold tabular-nums text-ink-2"
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
      aria-label="Esta semana"
      // `flex-1 min-h-0`, not the old `h-full`: this card used to stand alone
      // in its own grid column (its row's only occupant), where "fill the
      // row" and "fill 100% of my parent" were the same thing. It now shares
      // a flex column with `CuotaCard` above it — `h-full` there meant "take
      // the WHOLE stretched column", squeezing `CuotaCard` below its own
      // content height and letting its `overflow-hidden` silently clip the
      // payment button. `flex-1` takes only what `CuotaCard` doesn't need.
      className="card flex flex-1 min-h-0 flex-col overflow-hidden"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-field px-5 pb-3.5 pt-[18px]">
        <h2 className="text-base font-bold tracking-tight text-ink">Esta semana</h2>
        <p className="text-xs text-ink-3-strong">
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
          <p className="text-sm leading-relaxed text-ink-3">
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
          <div className="flex flex-1 flex-col border-t border-line">
            {/* D11 — an empty state has three parts, and this one had two:
                what is missing, and why. The third, "qué hacer", was a
                sentence telling the reader to "consulte en administración"
                with nothing to click. `/ayuda` is where the club answers that
                question, and the label is the destination's registered name
                (D12b), not a phrase invented here.

                `fill` because the panel around it is stretched now: without
                it the statement would sit at the top of a tall card with
                canvas below it, which is the defect this pass exists to
                close, moved inside the card. */}
            <EmptyState
              surface="inset"
              fill
              icon={<CalendarDays size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
              title={
                viewingOwnProfile
                  ? "Todavía no tiene un horario asignado"
                  : `${studentName} todavía no tiene un horario asignado`
              }
              description="El club asigna los días y las horas de entrenamiento. Escriba a administración para que le asignen uno."
              action={
                <Link href="/ayuda" className={buttonClasses("secondary", "sm")}>
                  Preguntas frecuentes
                  <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                </Link>
              }
            />
          </div>
        ))}

      {/* One line, not a second panel: it is the same subject — training —
          and it is the fact a family checks right after "when is the next
          one". The record itself lives on `/student/attendance`. */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-5 gap-y-field border-t border-line bg-sunken px-5 py-3.5">
        <p className="text-xs leading-relaxed text-ink-3-strong">
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
      <EmptyState
        icon={<ShieldCheck size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No hay planes de membresía disponibles"
        description="El catálogo de planes está vacío en este momento. Consulte con administración."
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.membershipPlans.map((plan) => (
        <div key={plan.id} className="card flex flex-col p-5">
          <h3 className="text-base font-bold text-ink">{plan.nombre}</h3>
          {/* Name and price only. The plan used to print a franja too, but a
              membership type is what the family pays, not when they train —
              the hours come from the horarios the club assigns afterwards. */}
          <span className="mt-2 text-xl font-extrabold tabular-nums text-ink">
            {formatCurrency(plan.precio)}
          </span>
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
    <>
      <section className="card p-6">
        <h2 className="text-base font-bold tracking-tight text-ink">Bienvenido a Cata Club</h2>
        {/* Capped at a readable measure inside a full-width card, rather than
            capping the card: a 110-character line is not a paragraph. */}
        <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-ink-3">
          Su cuenta está creada pero todavía no tiene una matrícula activa. Complete su inscripción para
          empezar a entrenar.
        </p>
      </section>

      <MembershipPlansGrid data={data} />

      <div className="flex flex-wrap gap-3">
        <Link href="/student/enroll?type=self" className={buttonClasses("primary")}>
          <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Inscribirme como jugador
          <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        </Link>
        <Link href="/student/enroll?type=child" className={buttonClasses("secondary")}>
          <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Inscribir a un hijo o dependiente
          <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        </Link>
      </div>
    </>
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
          message: toUserMessage(error, "No se pudo cargar el historial de pagos."),
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
   * The one thing this screen exists to answer, resolved once and rendered
   * twice — as the carnet's own status band and as the "Cuota" card's detail
   * (see `CarnetStatusBand` and `CuotaCard`). `describePaymentSituation` owns
   * every word of it, so the carnet, the rail card and `/student/payments`
   * can never word the same `estado` differently again.
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
    // Full content width, like `/dashboard`, `/members` and `/payments` — the
    // 760px cap the prototype started from left the right HALF of the content
    // column empty on every family screen. "El carnet manda" (Propuesta 2)
    // spends that width on the carnet itself: see the `PAGE_RAIL` block below
    // for how the identity card and the two rail cards split it.
    <>
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
        <EmptyState
          icon={<User size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
          title="No se encontraron estudiantes asociados a esta cuenta"
          description="Inscríbase como jugador o agregue un hijo o dependiente para empezar."
        />
      ) : (
        // "El carnet manda" (docs/archive/fixes/12-mi-cuenta-carnet.md, Propuesta 2):
        // the identity card carries its own payment band; the rail stacks the
        // "Cuota" detail card over "Esta semana". `PAGE_RAIL` is the
        // product's one two-column split (see layout.ts) — kept for its
        // `lg:items-start` (no stretch override, see fix 12b below), but its
        // own 340px rail is overridden here.
        //
        // Fix 12c: the chosen maquette draws this split as
        // `grid-template-columns: 1fr 1fr` — even columns. Reusing
        // `PAGE_RAIL`'s 340px rail unmodified left the carnet at roughly
        // three-quarters of the row width, well past what its four-fact grid
        // needs to fill — the actual root of the "empty carnet" defect fix 12
        // and 12b kept re-finding downstream (inside the card, then as page
        // canvas below it) without ever touching the ratio that caused it.
        // `!` beats `PAGE_RAIL`'s own `lg:grid-cols-[…_340px]` regardless of
        // class order, the same mechanism fix 12b used for `lg:!items-stretch`
        // before finding stretching itself was the wrong fix — the technique
        // is fine, that one application of it was not.
        //
        // Fix 12b tried stretching the carnet's height first —
        // `lg:!items-stretch` plus `flex-1` on the carnet, so it filled the
        // row's full height — and it traded one emptiness for another:
        // whenever the rail (Cuota + Esta semana) was taller than the
        // carnet's own content, the stretched carnet grew to match it and the
        // slack landed INSIDE the card, below its fact grid. A carnet has a
        // carnet's proportions, not a column's, so it still sits at its
        // natural height, top-aligned with the rail (`lg:items-start`).
        //
        // D11b, and the root cause the three socio screens share: `AppShell`'s
        // `<main>` is `flex flex-1 flex-col` inside a `min-h-screen` chain, so
        // it is ALREADY the height of the window. Nothing on this screen
        // claimed that height, so every pixel the content did not use piled up
        // under the last block — 38% of the viewport for a self-managed adult.
        //
        // `flex-1` here is what claims it. It is not a cosmetic addition: it
        // is the missing first link of a chain this file already wrote and
        // then could not switch on. `TrainingPanel` carries `flex-1`,
        // `TrainingRow` carries `flex-1`, and the panel's footer carries
        // `mt-auto` — all three were inert, because `PAGE_RAIL`'s
        // `lg:items-start` sizes each column to its own content and no
        // container in the chain had any free space for them to divide.
        //
        // `mt-auto` could never have fixed this on its own. An auto margin
        // absorbs free space its container ALREADY has; with nothing stretched
        // it has nothing to absorb, which is exactly how the same attempt died
        // on the profile screen.
        <div className={cn(PAGE_RAIL, "lg:!grid-cols-[minmax(0,1fr)_minmax(0,1fr)]", "flex-1")}>
          <div className="flex flex-col gap-5">
            <Carnet
              profile={selectedProfile}
              situation={paymentSituation}
              horariosState={horariosState}
            />

            {/* Only on the minor's OWN account. Shown to a guardian looking
                at their dependent it read "Su representante: Laura Vera" to
                Laura Vera — the card names the person the reader should turn
                to, and the reader was that person. */}
            {selectedIsMinor && viewingOwnProfile && selectedProfile.representante && (
              <section className="card flex items-center gap-3 p-5" aria-label="Su representante">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-canvas">
                  <User size={ICON.base} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-2xs font-bold uppercase text-ink-3">
                    Su representante
                  </span>
                  <span className="block text-sm font-semibold text-ink">
                    {selectedProfile.representante.nombres}{" "}
                    {selectedProfile.representante.apellidos}
                  </span>
                </span>
              </section>
            )}
          </div>

          {/* Below `lg` this is the SECOND stacked block (see `PAGE_RAIL`'s
              doc comment: no explicit columns below `lg` means DOM order is
              reading order), so a phone gets exactly the brief's order —
              carnet, then the payment action, then "Esta semana".

              `lg:self-stretch` is the second link of the chain described on
              the grid above: it opts THIS column, and only this column, out of
              `PAGE_RAIL`'s `lg:items-start`, so the row's full height reaches
              `TrainingPanel`. The carnet column deliberately stays opted in —
              fix 12b stretched it once and the slack landed inside the card,
              under its fact grid, which is the same emptiness moved rather
              than closed. A carnet has a carnet's proportions; a panel of
              rows does not. */}
          <div className="flex flex-col gap-5 lg:self-stretch">
            <CuotaCard
              situation={paymentSituation}
              coverageEnd={coverageEnd}
              monthlyPrice={selectedProfile.membership?.montoAplicado ?? null}
              viewPagosHref={withSelectedStudent("/student/payments", selectedPersonaId)}
              action={
                paymentSituation.canRegister
                  ? // Straight into the open form. The route to paying used to
                    // be three clicks — link, page, "Registrar un pago" — and
                    // the last two were on a screen that never said whose
                    // payment it was about.
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

            <TrainingPanel
              profile={selectedProfile}
              horariosState={horariosState}
              viewingOwnProfile={viewingOwnProfile}
              studentName={firstNameOf(selectedProfile.nombres)}
            />
          </div>
        </div>
      )}

      {/* A minor manages nothing on their own account: no dependents, no
          payments, no independentization. Everything below is gated on that.

          A self-managed student with no dependents sees no "agregar
          dependiente" either: that CTA used to point at the PUBLIC enrolment
          wizard, which creates a whole second account and user — and
          `/student/add-dependent` is gated to `representante`, so they could
          not use the honest route either. Offering it was worse than nothing.

          `hasAccountActions` exists because the row is now genuinely optional:
          the payments CTA lives in `CuotaCard` in the rail above (on the fact
          it acts on), so a self-managed adult with no dependents and no
          representative has nothing left to put here, and an empty flex row
          still costs a 20px gap under the panel. */}
      {!selfIsMinor && hasAccountActions && (
        <div className="flex flex-wrap gap-3 pt-1">
          {representative && (
            <Link href="/student/add-dependent" className={buttonClasses("secondary")}>
              <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Agregar hijo o dependiente
              <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          )}
          {!hasAlumnoRole && (
            <Link href="/student/enroll?type=self" className={buttonClasses("secondary")}>
              <UserPlus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Unirme como jugador
              <ArrowRight size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            </Link>
          )}
          {data.self?.representanteId != null && (
            <button type="button" onClick={onIndependizar} className={buttonClasses("secondary")}>
              <UserMinus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Independizarse del representante
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function StudentPortalContent(): React.ReactElement {
  const { session, refreshSession } = useAuth();
  const personaId = session?.user.id ?? "";
  const hasAlumnoRole = session?.roles.includes("ALUMNO") ?? false;

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
          message: toUserMessage(error, "No se pudo cargar su cuenta."),
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
    <AppShell title="Mi cuenta" subtitle={subtitle}>
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
