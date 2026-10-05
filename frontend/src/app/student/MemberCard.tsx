"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { CalendarDays, Clock, ShieldCheck, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { DIA_SEMANA_LABELS } from "@/app/attendance/attendance-utils";
import { toStripDias } from "@/app/groups/groups-page-utils";
import { buttonClasses, cn } from "@/components/ui";
import { formatDate, joinWithY } from "@/lib/format-utils";
import { ICON } from "@/lib/icon-size";
import { subirFotoDeArchivo } from "@/lib/photo-upload";
import { MIN_TARGET_CLASS } from "@/lib/target-size";
import { subirFotoPersona } from "@/services/api";
import type { AlumnoHorario, StudentProfileSummary } from "@/services/api";
import type { DiaSemana } from "@/types/domain";
import { buildWeeklyTrainingSchedule, describeAssignedWindows } from "./student-utils";

// ---------------------------------------------------------------------------
// The club membership card ("carnet")
//
// A dark credential held by an ordinary dashboard panel: the panel is the
// app's, the credential is the club's. Header (real club logo, wordmark, role
// label), a brand accent bar, the photo with a ball-coloured edge, the name and
// cédula, an icon register (Plan / Franja / Jugador desde / Válido hasta), the
// seven training-day chips and the club's signature line.
//
// What is on it is only what the frontend already holds. There is no role on
// `StudentProfileSummary`, so the role label is the card's own purpose
// ("Jugador"). The credential is also the print area (`#carnet-print-area`,
// geometry and ink in `globals.css`), so nothing inside it opts out of print;
// the controls and the size note live outside it, in the panel.
//
// Spacing is three declared steps (`--carnet-page|section|field`, re-declared
// for print in `globals.css`); nothing inside writes any other length.
// ---------------------------------------------------------------------------

/** The assignments lookup, as `/student` tracks it. */
export type MemberCardHorariosState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; asignaciones: AlumnoHorario[] };

/** The week, in the order the club reads it. */
const WEEK = Object.keys(DIA_SEMANA_LABELS) as DiaSemana[];

/** Shown when the card has no coverage date on record. */
const NO_DATE = "—";

/** One line of the credential's register. */
type RegisterSpec = {
  label: string;
  value: string;
  icon: LucideIcon;
  /**
   * Whether `value` is a figure the club asserts (Graduate) or a word or the
   * state of a lookup (Barlow). An explicit boolean, never a test on the string.
   */
  isFigure: boolean;
};

/** "Lunes, miércoles y viernes" — the sentence a screen reader gets for the chips. */
function trainingDaysSentence(days: readonly DiaSemana[]): string {
  const named = WEEK.filter((day) => days.includes(day)).map((day, index) =>
    index === 0 ? DIA_SEMANA_LABELS[day] : DIA_SEMANA_LABELS[day].toLocaleLowerCase("es"),
  );
  return joinWithY(named) || "Sin horario";
}

/**
 * The seven chips, L M M J V S D. One `role="img"` carrying the sentence;
 * the chips are hidden from the accessibility tree and expose their state as
 * `data-state` for tests and styling.
 */
function TrainingDayChips({ days }: { days: readonly DiaSemana[] }): React.ReactElement {
  return (
    <span
      role="img"
      data-testid="carnet-training-days"
      aria-label={`Días de entrenamiento: ${trainingDaysSentence(days)}`}
      className="flex w-full items-center gap-1"
    >
      {WEEK.map((day) => {
        const active = days.includes(day);
        return (
          <span
            key={day}
            data-day={day}
            data-state={active ? "activo" : "inactivo"}
            title={DIA_SEMANA_LABELS[day]}
            aria-hidden="true"
            className={cn(
              "flex h-7 min-w-0 flex-1 items-center justify-center rounded-[5px] text-2xs font-extrabold print:h-5",
              active ? "bg-cata-red text-white" : "bg-white/5 text-white/70",
            )}
          >
            {DIA_SEMANA_LABELS[day].charAt(0)}
          </span>
        );
      })}
    </span>
  );
}

/**
 * LABEL LEFT, VALUE RIGHT. The label is the row's first element child (icon +
 * text) and the value its last, read off the right edge.
 *
 * A "Franja" value with several windows is wrapped window by window in
 * `whitespace-nowrap` spans so a line can only break at the " · " between them.
 */
function RegisterRow({
  label,
  value,
  icon: Icon,
  isFigure,
  ruled,
}: RegisterSpec & { ruled: boolean }): React.ReactElement {
  const windows = value.split(" · ");
  const content =
    windows.length > 1
      ? windows.flatMap((window, index) => {
          const nodes: React.ReactNode[] = [
            <span key={window} className="whitespace-nowrap">
              {window}
            </span>,
          ];
          if (index < windows.length - 1) nodes.push(" · ");
          return nodes;
        })
      : value;

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-[var(--carnet-field)] py-[var(--carnet-field)]",
        // A hairline BETWEEN rows, none after the last. The bracket form is the
        // same 12%: Tailwind's opacity scale steps by 5, so a bare `/12`
        // compiles to nothing.
        ruled && "border-t border-white/[0.12]",
      )}
    >
      <span className="flex flex-none items-center gap-[var(--carnet-field)] text-2xs font-extrabold uppercase leading-none text-white/60">
        <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-white/10 text-white/80 print:h-5 print:w-5">
          <Icon size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
        </span>
        {label}
      </span>
      {/* Two elements rather than a ternary inside `className`:
          `display-face-usage.test.ts` reads whole opening tags. */}
      {isFigure ? (
        <b className="min-w-0 text-right font-display text-base leading-none tracking-flat tabular-nums">
          {content}
        </b>
      ) : (
        <b className="min-w-0 text-right font-sans text-sm font-bold leading-tight">{content}</b>
      )}
    </div>
  );
}

export default function MemberCard({
  profile,
  coverageEnd,
  horariosState,
  className,
  canManagePhoto,
  onPhotoUploaded,
}: {
  profile: StudentProfileSummary;
  /**
   * `MembershipSummary.cubiertoHasta`, `null` when the backend has no coverage
   * on record (issue #1328). The same date `CuotaCard` prints.
   */
  coverageEnd: string | null;
  /** The same assignments the training panel reads. */
  horariosState: MemberCardHorariosState;
  className?: string;
  /** Whether the authenticated account may manage this profile's photo. */
  canManagePhoto: boolean;
  onPhotoUploaded: () => void;
}): React.ReactElement {
  const fullName = `${profile.nombres} ${profile.apellidos}`.trim();
  const initial = fullName.trim().charAt(0).toUpperCase() || "?";
  const fotoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFoto, setUploadingFoto] = useState(false);
  const [fotoError, setFotoError] = useState<string | null>(null);
  const [fotoFallback, setFotoFallback] = useState(false);

  async function handleFotoChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const archivo = e.target.files?.[0];
    e.target.value = ""; // reset so re-selecting the same file re-triggers onChange
    if (!archivo) return;

    setFotoError(null);
    setUploadingFoto(true);
    try {
      // Upload and failure handling are shared with `/profile`
      // (`lib/photo-upload.ts`); this surface sends the file without that
      // module's optional pre-check, as it always has.
      const resultado = await subirFotoDeArchivo(
        archivo,
        (foto) => subirFotoPersona(profile.personaId, foto),
        "No se pudo actualizar la foto.",
      );
      if (resultado.status === "failed") {
        setFotoError(resultado.message);
        return;
      }
      setFotoFallback(false);
      onPhotoUploaded();
    } finally {
      setUploadingFoto(false);
    }
  }

  // Derived from the assignments, never from the plan. `null` means "the club
  // assigned nothing" and the row is omitted — but only for `ready`: a pending
  // or failed lookup is not "nothing assigned", and says so in the same words
  // the "Esta semana" panel uses.
  const franja =
    horariosState.status === "ready"
      ? describeAssignedWindows(horariosState.asignaciones)
      : horariosState.status === "loading"
        ? "Consultando…"
        : "No se pudo consultar";

  // "Plan" and not "Categoría": `membership.categoria` holds the PLAN's name (a
  // price); a training categoría is a group, and a student can be in several.
  // "Válido hasta" is vigencia (the same `coverageEnd` `CuotaCard` prints), not
  // the payment verdict; with no date on record it reads "—".
  const register: RegisterSpec[] = [];
  if (profile.membership?.categoria) {
    register.push({ label: "Plan", value: profile.membership.categoria, icon: User, isFigure: false });
  }
  if (franja) {
    register.push({
      label: "Franja",
      value: franja,
      icon: Clock,
      isFigure: horariosState.status === "ready",
    });
  }
  if (profile.membership?.fechaActivacion) {
    register.push({
      label: "Jugador desde",
      value: formatDate(profile.membership.fechaActivacion),
      icon: CalendarDays,
      isFigure: true,
    });
  }
  register.push({
    label: "Válido hasta",
    value: coverageEnd ? formatDate(coverageEnd) : NO_DATE,
    icon: ShieldCheck,
    isFigure: Boolean(coverageEnd),
  });

  // The same weekly schedule "Esta semana" reads, so the readings cannot
  // disagree. Shown only once the lookup answered: seven unlit chips would
  // claim "trains no day", which a pending or failed lookup has not earned.
  const trainingDays =
    horariosState.status === "ready"
      ? toStripDias(buildWeeklyTrainingSchedule(horariosState.asignaciones).map((slot) => slot.dia))
      : null;

  return (
    // THE PANEL — `.card` grammar, `CuotaCard`'s header row, and a footer with
    // the panel's own controls. Nothing here prints: the print sheet keeps only
    // `#carnet-print-area`.
    <section
      data-testid="student-carnet-panel"
      aria-label="Su carnet"
      className={cn("card overflow-hidden", className)}
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="flex-1 font-display text-lg uppercase leading-tight tracking-flat text-ink">Carnet de jugador</h2>
        {/* A text link, not a button: printing is a destination, not a second
            CTA. `MIN_TARGET_CLASS` is the WCAG 2.5.8 24px hit area (#818). */}
        <button
          type="button"
          onClick={() => window.print()}
          className={`inline-flex items-center text-xs font-semibold text-ink-2 underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink ${MIN_TARGET_CLASS}`}
        >
          Imprimir carnet
        </button>
      </div>

      <div className="flex justify-center px-5 py-4">
        {/* THE CREDENTIAL — the only thing that prints. `role="group"` rather
            than a second landmark; the label says whose card this is. */}
        <div
          id="carnet-print-area"
          data-testid="student-carnet"
          role="group"
          aria-label={`Carnet de jugador de ${fullName}`}
          className={cn(
            "carnet-credential my-section w-full max-w-[284px] rounded-ctl bg-coal p-[var(--carnet-page)] text-white shadow-elevated",
            "flex flex-col",
            // No `min-h` / aspect-ratio: the sheet's `#carnet-print-area` rule
            // owns the printed geometry. The shadow is dropped on paper.
            "print:rounded-none print:shadow-none",
          )}
        >
          {/* 1 · THE HEADER — the real club mark (the sidebar's asset), the
              wordmark, and the role label at the far edge. */}
          <div className="flex items-center gap-[var(--carnet-field)]">
            <span
              data-testid="carnet-logo"
              className="relative block h-9 w-9 flex-none overflow-hidden rounded-full bg-white print:h-7 print:w-7"
            >
              <Image
                src="/brand/cata-club-logo.jpeg"
                alt="Logo de Cata Club"
                fill
                className="object-cover"
                sizes="36px"
              />
            </span>
            <b className="font-display text-base uppercase leading-none tracking-flat">Cata Club</b>
            <span
              data-testid="carnet-role"
              className="ml-auto border-l border-white/[0.12] pl-[var(--carnet-field)] text-2xs font-extrabold uppercase leading-none text-ball"
            >
              Jugador
            </span>
          </div>

          {/* 2 · THE ACCENT BAR — the club's red, with a ball-coloured tail.
              Decorative, so it is a bare element and not announced. */}
          <div
            aria-hidden="true"
            data-testid="carnet-accent-bar"
            className="mt-[var(--carnet-field)] flex h-1 w-full overflow-hidden rounded-full"
          >
            <span className="h-full flex-[5] bg-cata-red" />
            <span className="h-full flex-1 bg-ball" />
          </div>

          {/* 3 · THE IDENTITY — photo, then name and cédula beside it. */}
          <div className="mt-[var(--carnet-section)] flex items-start gap-[var(--carnet-field)]">
            {/* A document photo: a portrait rectangle behind a real 2px
                `border` (a ring is a box-shadow, and Chrome drops those when
                "Background graphics" is off). */}
            <span
              data-testid="carnet-photo"
              className="flex h-[78px] w-[62px] flex-none items-center justify-center overflow-hidden rounded-[3px] border-2 border-ball bg-white/10 print:h-[62px] print:w-[49px]"
            >
              {profile.fotoUrl && !fotoFallback ? (
                /* eslint-disable-next-line @next/next/no-img-element -- remote Cloudinary URL, not a local/static asset (AppShell/Profile/Sponsors convention) */
                <img
                  src={profile.fotoUrl}
                  alt={`Foto de ${fullName}`}
                  width={62}
                  height={78}
                  className="h-full w-full object-cover"
                  onError={() => setFotoFallback(true)}
                />
              ) : (
                <span aria-hidden="true" className="text-2xl font-bold text-white/70">
                  {initial}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              {/* The hero: Barlow (Graduate has no lowercase design), balanced. */}
              <p className="text-balance text-xl font-extrabold leading-crisp tracking-dense print:text-lg">
                {fullName}
              </p>
              {/* Absent cédula means the row is not drawn, never a blank. */}
              {profile.cedula && (
                <div className="mt-[var(--carnet-field)]">
                  <span className="block text-2xs font-extrabold uppercase leading-none text-white/60">
                    Cédula
                  </span>
                  {/* Barlow, tracked WIDE: a document number, not a score. */}
                  <b className="mt-[var(--carnet-field)] block text-lg font-bold leading-none tracking-caps tabular-nums print:text-base">
                    {profile.cedula}
                  </b>
                </div>
              )}
            </div>
          </div>

          {/* 4 · THE REGISTER — label/value lines, ruled between. */}
          <div data-testid="carnet-facts" className="mt-[var(--carnet-section)]">
            {register.map((row, index) => (
              <RegisterRow key={row.label} {...row} ruled={index > 0} />
            ))}
          </div>

          {/* 5 · THE WEEK AND THE SIGNATURE. */}
          {trainingDays && (
            <div className="pt-[var(--carnet-section)]">
              <TrainingDayChips days={trainingDays} />
            </div>
          )}
          <p
            data-testid="carnet-signature"
            className="pt-[var(--carnet-section)] text-right text-sm font-semibold italic leading-none text-white/80 print:text-xs"
          >
            ¡Nos vemos en la mesa!
            <span aria-hidden="true" className="ml-auto mt-[var(--carnet-field)] block h-0.5 w-2/3 rounded-full bg-ball" />
          </p>
        </div>
      </div>

      {/* THE FOOTER — the size note and the photo control are panel chrome:
          neither is on the credential, so neither reaches the sheet. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <span className="text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">
          Se imprime a 54 × 85,6 mm
        </span>
        {canManagePhoto && (
          <>
            <button
              type="button"
              onClick={() => fotoInputRef.current?.click()}
              disabled={uploadingFoto}
              className={buttonClasses("secondary", "sm")}
            >
              {uploadingFoto ? "Subiendo…" : "Cambiar foto"}
            </button>
            <input
              ref={fotoInputRef}
              type="file"
              accept="image/*"
              onChange={handleFotoChange}
              className="hidden"
              data-testid="carnet-photo-input"
            />
          </>
        )}
        {fotoError && (
          <p role="alert" className="w-full text-2xs text-state-bad">
            {fotoError}
          </p>
        )}
      </div>
    </section>
  );
}
