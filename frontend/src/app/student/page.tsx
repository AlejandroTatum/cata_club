"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchStudentPortal,
  fetchPagosDePersona,
  fetchHorariosPorAlumno,
  independizarPersona,
  subirFotoPersona,
} from "@/services/api";
import type {
  AlumnoHorario,
  StudentPortalSummary,
  StudentProfileSummary,
  PagoPersona,
} from "@/services/api";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PAGE_RAIL,
  STAT_GRID,
  StatCard,
  StatTrack,
  WeekStrip,
  buttonClasses,
  cn,
} from "@/components/ui";
// The one translation between the backend's weekday keys and the shared
// strip's, already owned by `/groups` — see `toStripDia`'s own comment for why
// the two tables are joined by the WORD they both print and not by position.
import { toStripDias } from "@/app/groups/groups-page-utils";
import AgeUpConfirmation from "@/components/AgeUpConfirmation";
import ManagedStudentPicker, {
  useManagedProfiles,
  withSelectedStudent,
} from "./ManagedStudentPicker";
import CuotaCard from "./CuotaCard";
import {
  derivePortalMode,
  isRepresentative,
  isMinor,
  buildWeeklyTrainingSchedule,
  describeAssignedWindows,
  describePaymentSituation,
  findNextTrainingSessions,
  firstNameOf,
  resolveCoverageEnd,
  summarizeRecentAttendance,
  contarEntrenamientosSemanales,
  daysUntil,
  type UpcomingTraining,
} from "./student-utils";
import { CalendarDays, ShieldCheck, User, UserPlus, UserMinus, ArrowRight } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";
import { MIN_TARGET_CLASS } from "@/lib/target-size";

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
// The club membership card — "Funda"
//
// ## The insight this arrangement came out of
//
// Every earlier pass made the carnet A COAL SLAB IN A PAGE OF WHITE CARDS. On
// a dashboard whose every other block is `paper` with a hairline and a header
// row, a full-bleed dark card is a foreign body — and each decorative layer
// added to it to make it feel more like a credential (a corner arc, a security
// net, a guilloche, a pantograph, a halftone) made that worse rather than
// better, because it made the object MORE unlike its neighbours while leaving
// the mismatch that caused the problem exactly where it was.
//
// "Funda" resolves the tension instead of picking a side: THE FRAME BELONGS TO
// THE APP, THE OBJECT BELONGS TO THE CLUB. The carnet becomes an ordinary
// system panel — same `.card` surface, same header grammar as `CuotaCard` and
// "Esta semana" beside it, same text-link action — and that panel HOLDS a coal
// credential on a sunken ground. The dark object stops being a card that fails
// to look like the others and becomes, unmistakably, the thing that gets
// printed. The panel is the citizen of the dashboard; the credential is what
// it is a panel about.
//
// Two consequences follow from that split and are worth stating, because both
// look like omissions:
//
//   - NOTHING ON THE CREDENTIAL OPTS OUT OF PRINT. The object IS the print
//     area (`#carnet-print-area`), so a `print:hidden` inside it would be a
//     fact the screen shows and the sheet hides — precisely the drift that
//     made the two media read as two different cards through three passes.
//     Everything that must not print (the actions, the size note, the panel
//     itself) lives OUTSIDE the object now, where the print sheet already
//     hides it without anything having to opt out.
//   - THE CREDENTIAL CARRIES NO DECORATION. No glow, no texture, no gradient.
//     See the paragraph above for why: the decoration was an answer to the
//     wrong diagnosis. What identifies the club here is the mark, the wordmark
//     and the red rule — three things that are the club rather than three
//     things that look expensive.
//
// ## Typography — one hero, real jumps
//
// The scale is the project's own (`tailwind.config.ts`) and nothing falls
// outside it:
//
//   · the NAME is the hero — `text-xl` (26px), `font-extrabold`, balanced. It
//     is an identity object about a person, so the person is the largest thing
//     on it. It stays in BARLOW: Graduate has almost no vertical range and no
//     lowercase design intent, so a name set in it reads as texture rather
//     than as words.
//   · the CÉDULA is second — `text-lg` (20px), `tabular-nums`, and tracked
//     WIDE (`tracking-caps`, the project's own +0.12em step). The tracking is
//     the whole difference between a document number and a score.
//   · the WORDMARK takes Graduate at `text-base` (15px), the face's floor, on
//     both media. It heads the object; it does not lead it.
//   · register values are `text-sm`, except the two NUMERIC ones, which take
//     Graduate — the club counting — and therefore sit at `text-base`, because
//     15px is a property of the FACE and not a screen convention. That is the
//     one place the register's own size step yields, and it yields to the
//     floor rather than the other way round.
//   · labels, "Socio" and the panel's size note are `text-2xs` uppercase 800.
//
// ## Spacing
//
// Three steps, declared as CSS variables on `.carnet-credential`
// (`globals.css`) and re-declared once for print — `page` 21px, `section`
// 14px, `field` 7px, on the project's own 7px grid. Nothing inside the
// credential may write any other length, and `StudentPage.test.tsx` fails by
// name on one that does. See the CSS for why twenty-four hand-tuned `print:`
// twins were not a workable alternative.
//
// ## What is on it, and what is not
//
// This is the one thing a parent screenshots and the one thing they carry, so
// every field on it is real. The prototype's "Miembro nº", "Desde" and
// "Renueva" are NOT rendered — see the block comment above `resolveCoverageEnd`
// in student-utils.ts for where each one dies. Three more decisions:
//
//   - NO PAYMENT STATE, in either medium. The owner moved the verdict off this
//     card in as many words («esa info muévala a la sección de pagos, no al
//     carnet») and `CuotaCard` beside it owns the whole payment reading. A
//     carnet is an identity document: belonging is an identity fact, this
//     month's coverage is not.
//   - NO PRICE either, and that is new. It used to ride the fact grid as
//     "Valor mensual" and hide itself under `print:` — which was the shape of
//     an unresolved argument, not a decision. A price identifies nobody, ages
//     the day the club changes it, and `CuotaCard` already states it under the
//     label the payments screen uses.
//   - "Modalidad" (Mensual/Personalizada) stays dropped. Nothing in the chosen
//     arrangement draws it, and an unlisted field gets left out rather than
//     kept "just in case".
// ---------------------------------------------------------------------------

/**
 * THE CLUB'S MARK, DRAWN RATHER THAN PHOTOGRAPHED.
 *
 * It used to be `/brand/cata-club-logo.jpeg` on a white disc. The observation
 * behind #286 was right — a photographic JPEG halftones into a smudge at
 * credential size — and the conclusion it reached (drop the mark on print) left
 * a blank white disc as the most conspicuous thing on the sheet.
 *
 * Three boxes cost nothing, print as flat colour at any size, and need no
 * second asset: a `ball` disc for the blade, a white dot on its upper right —
 * that dot IS the ball, which is why no second loose ball appears anywhere else
 * on this card — and a rounded bar rotated 45° for the handle.
 *
 * `aria-hidden`, because the object states the club's name in text immediately
 * beside it and the whole credential is labelled "Carnet de socio de …".
 * Naming this image would make a screen reader say the club's name twice
 * (WCAG 1.1.1: a redundant image is decorative).
 */
function ClubPaddleMark(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      data-testid="carnet-paddle"
      viewBox="0 0 26 24"
      className="h-[24px] w-[26px] flex-none print:h-[18px] print:w-[19px]"
    >
      {/* Tilted the way a hand holds it. The blade and the handle rotate
          together; the ball does not, because a ball in flight is not attached
          to the racket. */}
      <g transform="rotate(-24 11 10)">
        {/* The handle leaves the BOTTOM of the blade, short and thick. Its top
            sits inside the ellipse so the two shapes merge into one silhouette
            rather than reading as a disc with a stick beside it. */}
        <path
          d="M8.9 15.2h4.2l.55 5.1a1.85 1.85 0 0 1-1.84 2.05h-1.62a1.85 1.85 0 0 1-1.84-2.05z"
          className="fill-ball"
        />
        {/* Red, because a paddle's rubber is red or black — never yellow. */}
        <ellipse cx="11" cy="9.1" rx="7.4" ry="7.7" className="fill-cata-red" />
      </g>
      {/* UPPER-RIGHT, and the position was measured at the 30px this mark
          actually renders at. Beside the handle at lower-right the ball and the
          handle are two yellow shapes a pixel apart and they merge into one
          blob with a notch; across the blade they read as two objects. */}
      <circle cx="22.6" cy="4.6" r="3.1" className="fill-ball" />
    </svg>
  );
}

/** One line of the credential's register. See `CarnetRegisterRow`. */
type CarnetRegisterSpec = {
  label: string;
  value: string;
  /**
   * Whether `value` is a FIGURE OF THE CLUB — something the club counts and
   * asserts — or the state of a query about one.
   *
   * It drives the face. A figure is set in Graduate, which is what the club
   * says about itself; "Consultando…" and "No se pudo consultar" are the state
   * of a network call and take Barlow, because setting them in the club's
   * display face would dress a failed lookup as a fact the club stated. A plan
   * NAME is not a figure either — it is a word, and words are Barlow.
   *
   * It is an explicit per-row boolean and never a test on the string. The
   * wording of those two states belongs to `TrainingPanel`'s vocabulary and is
   * free to change; sniffing for it here would make a copy edit silently
   * repaint a value in the wrong face.
   */
  isFigure: boolean;
};

/**
 * LABEL LEFT, VALUE RIGHT — the register of a credential, not a scoreboard.
 *
 * The arrangement this replaces inverted the pair (value first, label under
 * it) to make the block read as something being MEASURED. That was right for a
 * coal slab standing alone in a column, where a stack of figures is what the
 * object mostly is. Held inside a system panel, the same block is one of four
 * label/value pairs on the screen, and reading it in the opposite order from
 * the three beside it buys nothing and costs the reader the comparison.
 *
 * A "Franja" value with two or more windows ("15:00 — 16:00 · 20:00 — 21:15")
 * used to be one plain string, so the browser wrapped wherever it found a
 * space — including inside a single window, splitting "20:00 —" from "21:15"
 * (fix 12b, docs/archive/fixes/12-mi-cuenta-carnet.md). Each window is wrapped
 * in its own `whitespace-nowrap` span so the ONLY point where a line can break
 * is the " · " between them, which stays a normal (breakable) text node.
 */
function CarnetRegisterRow({
  label,
  value,
  isFigure,
  ruled,
}: CarnetRegisterSpec & { ruled: boolean }): React.ReactElement {
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
        "flex items-baseline justify-between gap-[var(--carnet-field)] py-[var(--carnet-field)]",
        // A hairline BETWEEN rows and none after the last: a rule under the
        // final row reads as the top of a fourth row that is not there.
        //
        // `border-white/[0.12]`, not `border-white/12`: Tailwind's opacity
        // scale steps by 5, so a bare `/12` compiles to NOTHING and the rule
        // would vanish with neither lint nor tsc saying a word. The bracket
        // form is the same 12%, written the way an off-scale opacity has to be.
        ruled && "border-t border-white/[0.12]",
      )}
    >
      <span className="flex-none text-2xs font-extrabold uppercase leading-none text-white/60">
        {label}
      </span>
      {/* Two elements rather than one with a ternary inside its `className`:
          `display-face-usage.test.ts` reads whole JSX opening tags, so a single
          tag carrying both branches puts `font-display` and the other branch's
          `text-sm` in the same string and the floor guard reads it as Graduate
          at 13.5px. Split, each tag states one face and the guard can check the
          one that is actually Graduate. The content is built once above. */}
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

function Carnet({
  profile,
  horariosState,
  className,
  canManagePhoto,
  onPhotoUploaded,
}: {
  profile: StudentProfileSummary;
  /** The same assignments the training panel reads — see `franja` below. */
  horariosState: HorariosState;
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
      await subirFotoPersona(profile.personaId, archivo);
      setFotoFallback(false);
      onPhotoUploaded();
    } catch (error: unknown) {
      setFotoError(toUserMessage(error, "No se pudo actualizar la foto."));
    } finally {
      setUploadingFoto(false);
    }
  }

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

  /**
   * The register, in reading order: what the club sells this family, when they
   * train, and since when they have belonged.
   *
   * "Plan" and not "Categoría", and the difference is not a wording
   * preference. `membership.categoria` holds the PLAN's name — "Mensual
   * Adultos" — which is a price; a training categoría is a group a student
   * meets with, and a student can belong to three of them at once (four of the
   * club's seven do). Labelling a price "Categoría" here would re-make, on the
   * one object a family carries, exactly the confusion #160 already retired
   * once when it deleted `franja_horaria`.
   *
   * "Socio desde" rather than the prototype's "MIEMBRO Nº · DESDE": the backend
   * has no member-number concept, and printing the surrogate persona id as one
   * would invent an identity-document field. The activation date IS real.
   */
  const register: CarnetRegisterSpec[] = [];
  if (profile.membership?.categoria) {
    register.push({ label: "Plan", value: profile.membership.categoria, isFigure: false });
  }
  if (franja) {
    register.push({
      label: "Franja",
      value: franja,
      isFigure: horariosState.status === "ready",
    });
  }
  if (profile.membership?.fechaActivacion) {
    register.push({
      label: "Socio desde",
      value: formatDate(profile.membership.fechaActivacion),
      isFigure: true,
    });
  }

  // The week the club assigned, as the shared seven-box strip rather than as a
  // fourth line of prose. It is fed from the SAME `buildWeeklyTrainingSchedule`
  // the "Esta semana" panel and the "Entrenamientos" tile read, so the three
  // readings on this screen cannot disagree; `toStripDias` is the translation
  // `/groups` already owns between the backend's weekday keys and the strip's.
  const stripDias =
    horariosState.status === "ready"
      ? toStripDias(buildWeeklyTrainingSchedule(horariosState.asignaciones).map((slot) => slot.dia))
      : [];

  return (
    // THE PANEL — an ordinary citizen of the dashboard.
    //
    // `.card` grammar, `CuotaCard`'s header row (title left, action as a text
    // link right), and a footer that states what the object inside becomes on
    // paper. Nothing here prints: the print sheet keeps only
    // `#carnet-print-area` visible, and that id is on the credential below.
    <section
      data-testid="student-carnet-panel"
      aria-label="Su carnet"
      className={cn("card overflow-hidden", className)}
    >
      <div className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="flex-1 text-sm font-bold text-ink">Carnet de socio</h2>
        {/* A TEXT LINK, not a button — the same skin `CuotaCard` gives "Ver
            pagos" one panel down. Printing is a destination, not a second CTA
            competing with the page's own; it was a filled control only while
            it had to hold its own against a whole coal card around it. */}
        <button
          type="button"
          onClick={() => window.print()}
          // `MIN_TARGET_CLASS` (issue #818, WCAG 2.5.8 AA): the button used
          // to be exactly its text, 87 × 18.8px.
          className={`inline-flex items-center text-xs font-semibold text-ink-2 underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink ${MIN_TARGET_CLASS}`}
        >
          Imprimir carnet
        </button>
      </div>

      {/* THE SUNKEN GROUND. `sunken` is the product's "inset area INSIDE
          paper", and it is what makes the coal object read as HELD by the
          panel rather than as the panel's own surface. On white the same card
          reads as a hole cut in the page. */}
      <div className="flex justify-center bg-sunken px-5 py-5">
        {/* THE CREDENTIAL — the object, and the only thing that prints.
            `role="group"` rather than a second `<section>`: the panel around it
            is already a landmark, and two nested regions announce twice for one
            block. The label still names whose card this is, which is what lets
            the mark inside stay `aria-hidden`. */}
        <div
          id="carnet-print-area"
          data-testid="student-carnet"
          role="group"
          aria-label={`Carnet de socio de ${fullName}`}
          className={cn(
            "carnet-credential my-section w-full max-w-[284px] rounded-ctl bg-coal p-[var(--carnet-page)] text-white shadow-elevated",
            // THE CREDENTIAL IS SQUARE ON PURPOSE, AND THE FUNDA IS THE
            // VERTICAL OBJECT. This reverses what stood here before.
            //
            // It used to carry `min-h-[476px]` — ID-1's 54:85.6 taken at its own
            // 300px — so the card would look like a card. Measured in the
            // running app, that opened THREE holes: after the red rule, after
            // the cédula and before the week strip, about 170px of empty coal
            // that `justify-between` spread around instead of removing.
            //
            // The cause is arithmetic, not spacing. The name's wrapping was
            // measured at 252 / 268 / 284 / 300px, and at EVERY width where
            // "Pedro Salgado" stays on one line the card lands at 0.92–0.97 —
            // square. Six data points do not fill a portrait at this width.
            //
            // So the object is dense (284×310 measured) and the panel around it
            // is the portrait one: 336×483, a ratio of 0.70. That is NOT ID-1's
            // 0.63 and it is not pinned to be — the funda's height is whatever
            // the credential plus the panel's own chrome comes to. Pinning it
            // would re-open the hole this pass just closed, one level up.
            // A card holder is card-shaped; the card inside it need not be. The
            // `my-section` above is what makes it read as HELD by the sunken
            // band rather than as a fill of it.
            //
            // No `min-h` and no `aspect-ratio` at all now, which also retires a
            // print bug this file paid for once: `min-height` beats `height`, so
            // the old pin overrode the sheet's own `height: 85.6mm` and printed
            // the credential at 54×126mm until `print:min-h-0` was added.
            "flex flex-col",
            // ITS OWN SHADOW, so it rests ON the sunken ground instead of being
            // painted into it. The print sheet drops it (`box-shadow: none`),
            // where an ink shadow would be a smudge along the cut line.
            //
            // PRINT: the sheet's `#carnet-print-area` rule owns the geometry
            // (54×85.6mm, centred, a real border for the cut) and beats these
            // utilities on specificity, so no `print:w-*`/`print:h-*` twin is
            // written here, and `justify-between` above already governs both
            // media — ONE composition, which is the whole point.
            "print:rounded-none print:shadow-none",
          )}
        >
          {/* 1 · THE HEADER — the club signs the object, and says what it is.
              A row, on both media: the mark, the wordmark, and "Socio" pushed
              to the far edge. The 2px red rule is the row's own bottom border
              rather than a separate element — a stray flex child in a
              `justify-between` row is how the old banner grew a floating rule.

              THE CARD'S ONE FLAT RED. DESIGN.md rations the colour and this
              spends its single decorative appearance on the line dividing the
              club from the person. The week strip at the foot is red too, and
              that is not a second spend: there the colour is the DATUM — which
              days run — measured at 3:1 against the unlit fill for that job. */}
          <div className="flex items-center gap-[var(--carnet-field)] border-b-2 border-cata-red pb-[var(--carnet-field)]">
            <ClubPaddleMark />
            {/* Graduate at its 15px floor, on screen and on paper alike — the
                floor is a property of the face (no vertical range, no lowercase
                design intent), not a screen convention print may relax. The
                hero is the NAME below; the club heads the object, it does not
                lead it. */}
            <b className="font-display text-base uppercase leading-none tracking-flat">Cata Club</b>
            <span className="ml-auto text-2xs font-extrabold uppercase leading-none text-ball">
              Socio
            </span>
          </div>

          {/* 2 · THE IDENTITY — who this is, under the club that says so.
              A row on both media: the document photo, then the name and the
              number beside it. */}
          <div className="mt-[var(--carnet-section)] flex items-start gap-[var(--carnet-field)]">
            {/* A RECTANGLE, not a disc. A round avatar is what a table row
                carries; every credential this object is a picture of carries a
                portrait rectangle behind a ruled edge, and the shape is most of
                what makes a photo read as a document photo.

                The edge is a real 2px `border`, not a Tailwind `ring`: a ring
                is a `box-shadow`, and a box-shadow is the first thing Chrome
                drops when "Background graphics" is off — which is its default,
                and which is why the cut line in `globals.css` is a border too.
                `border-box` sizing means the 2px comes out of the box rather
                than growing it, so the ring is inset by construction. */}
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
              {/* THE HERO. Barlow, at the top of the scale this card may spend:
                  it is an identity object about a person, so the person is the
                  largest thing on it. `text-balance` splits a long name into
                  even lines instead of leaving one word on the last. */}
              <p className="text-balance text-xl font-extrabold leading-crisp tracking-dense print:text-lg">
                {fullName}
              </p>
              {/* THE CÉDULA — the one field this pass had to plumb through
                  three layers to get here, and the reason it is on this card
                  and on no other screen: it is personal data on an object a
                  family CARRIES. It belongs on the credential and on the
                  person's own ficha; it does not belong in a table or a list,
                  where it would be published to every reader of a roster.

                  Absent means the row is not drawn. A blank beside "Cédula" on
                  an identity document reads as a document with a missing field
                  rather than as a card that never claimed one. */}
              {profile.cedula && (
                <div className="mt-[var(--carnet-field)]">
                  <span className="block text-2xs font-extrabold uppercase leading-none text-white/60">
                    Cédula
                  </span>
                  {/* Barlow, and tracked WIDE. `tracking-caps` (+0.12em) is the
                      project's own step for exactly this and is what separates
                      a document number from a score: at the default negative
                      tracking `text-lg` carries, ten digits close up into one
                      run and read as a quantity. */}
                  <b className="mt-[var(--carnet-field)] block text-lg font-bold leading-none tracking-caps tabular-nums print:text-base">
                    {profile.cedula}
                  </b>
                </div>
              )}
            </div>
          </div>

          {/* 3 · THE REGISTER — three label/value lines, ruled between. */}
          {register.length > 0 && (
            <div data-testid="carnet-facts" className="mt-[var(--carnet-section)]">
              {register.map((row, index) => (
                <CarnetRegisterRow key={row.label} {...row} ruled={index > 0} />
              ))}
            </div>
          )}

          {/* 4 · THE WEEK, at the foot.
              It takes no `mt-auto`: the card's `justify-between` already spreads
              the four blocks over the field, and an auto margin here would
              swallow the whole surplus into one band above the strip instead —
              measured, and it is fix 12b's hole with a different address.

              Seven fixed boxes rather than a fourth line of prose, and they are
              fed from the same weekly schedule as the panel and the tile beside
              them. The strip only appears when the lookup ANSWERED: seven unlit
              boxes are a claim — "this student trains no day of the week" — and
              a failed or pending lookup has not earned it.

              And when it has not answered, the foot stays EMPTY rather than
              saying so a second time: the "Franja" row above already carries
              "Consultando…" or "No se pudo consultar" in `TrainingPanel`'s own
              words, and repeating one sentence twice on a 300px card reads as
              two failures rather than as one. */}
          {horariosState.status === "ready" && (
            <div className="pt-[var(--carnet-section)]">
              <WeekStrip dias={stripDias} variant="onCoal" />
            </div>
          )}
        </div>
      </div>

      {/* THE FOOTER — what the object becomes, and the one control that
          changes it. Both are panel chrome: neither is on the credential, so
          neither reaches the sheet. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        {/* The size note is why the credential needs no on-screen proportion
            lock: the object on screen is a preview, and this line states, in
            words, the physical thing it prints as. */}
        <span className="text-2xs font-extrabold uppercase tracking-caps text-ink-3-strong">
          Se imprime a 54 × 85,6 mm
        </span>
        {canManagePhoto && (
          <>
            <button
              type="button"
              onClick={() => fotoInputRef.current?.click()}
              disabled={uploadingFoto}
              // `secondary`, not `onCoal`: the control sits on the panel's
              // `paper` now. `onCoal` is white-on-translucent and would be a
              // ghost here — a variant is a measured pair with its ground, not
              // a style that travels with the button.
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
  // Issue #313 (K5 hallazgo #52): el tile "Entrenamientos" cuenta
  // `buildWeeklyTrainingSchedule(...).length` — la MISMA lista de ventanas
  // semanales — y esta tarjeta se llama a sí misma "Esta semana" / "el
  // horario semanal". Un tope fijo de 3 (`findNextTrainingSessions(..., 3)`)
  // hacía que el tile dijera 5 mientras la tarjeta solo listaba 3 días. El
  // límite ahora es el largo real de esa misma lista: nunca corta lo que el
  // tile ya prometió mostrar completo.
  const weeklySlots = useMemo(
    () =>
      horariosState.status === "ready"
        ? buildWeeklyTrainingSchedule(horariosState.asignaciones)
        : [],
    [horariosState],
  );
  const sessions = useMemo(
    () => findNextTrainingSessions(weeklySlots, weeklySlots.length),
    [weeklySlots],
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
            // La CIFRA se fue a la tile "Asistencia" de la fila de pulso: acá
            // queda el alcance, que es lo que la tile no puede decir ("sus
            // últimas 10 sesiones registradas"). Repetir "8 de 10" en los dos
            // lugares habría sido el recap duplicado que este proyecto ya
            // borró una vez en el panel del entrenador.
            <>Sobre {scope}.</>
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
  onPhotoUploaded,
  onOwnPhotoUploaded,
}: {
  data: StudentPortalSummary;
  hasAlumnoRole: boolean;
  /** The persona behind the SESSION — not the profile currently selected. */
  accountPersonaId: string;
  onIndependizar: () => void;
  onPhotoUploaded: () => void;
  /** Extra refresh for the SESSION avatar, fired only when the OWN profile uploaded. */
  onOwnPhotoUploaded?: () => void;
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
  /**
   * Las tres cifras derivadas de la fila de pulso. Ninguna dispara una
   * llamada: salen del estado que esta pantalla ya tenía.
   *
   * `null` significa "todavía no se sabe", nunca 0. Un alumno sin pago
   * aprobado y uno cuya cobertura vence hoy son situaciones distintas, y un
   * horario que no cargó no es un alumno sin entrenamientos.
   */
  const diasDeCobertura = useMemo(() => daysUntil(coverageEnd), [coverageEnd]);
  const entrenamientosSemanales = useMemo(
    () =>
      horariosState.status === "ready"
        ? contarEntrenamientosSemanales(horariosState.asignaciones)
        : null,
    [horariosState],
  );
  const asistencia = useMemo(() => {
    const recap = selectedProfile
      ? summarizeRecentAttendance(selectedProfile.recentSessions)
      : null;
    if (!recap) return null;
    return {
      ...recap,
      porcentaje: Math.round((recap.attended / recap.total) * 100),
    };
  }, [selectedProfile]);

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
   * Whether the authenticated account may manage the selected profile's
   * photo: the profile is the account's own, or the account is its
   * representante. The backend re-checks the real permission regardless.
   */
  const canManagePhoto =
    selectedProfile !== null &&
    (viewingOwnProfile || selectedProfile.representanteId === Number(accountPersonaId));
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
   * in ONE place — the "Cuota" card (`CuotaCard`), which leads with the
   * verdict and states the evidence under it. It used to be rendered twice,
   * as the carnet's own status band as well; the owner moved the verdict off
   * the identity card entirely, so there is one host again.
   * `describePaymentSituation` still owns every word, so the rail card and
   * `/student/payments` can never word the same `estado` differently.
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
        esGratuidadFamiliar: selectedProfile.membership?.esGratuidadFamiliar ?? false,
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
        // AND THEN IT MOVED BACK, on purpose. The column is `380px 1fr` now,
        // not `1fr 1fr`. This is not fix 12c reverted by accident: 12c widened
        // the carnet because its FOUR-cell, two-column grid could not fill the
        // 340px rail's complement, and widening the column was the honest fix
        // for that shape. The card no longer has that shape. It is a PORTRAIT
        // credential — one centred column of three stacked figures, the same
        // composition it prints at — and the condition 12c reasoned from is
        // gone: a 566px column is now the thing stopping the card from being
        // a card, not the thing filling it. 380px is the card's own width, and
        // the width it stops needing goes to the rail rather than back into
        // the carnet as the emptiness 12, 12b and 12c each chased downstream.
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
        <>
        {/*
          LA FILA DE PULSO, en la gramática de `/dashboard` (STAT_GRID).

          Es lo que faltaba para que esta pantalla y el panel de admin dejaran
          de leerse como dos productos: el vocabulario ya estaba -- el carnet
          es coal con su cifra en `font-display` -- pero la forma no, porque
          acá no había ninguna fila de tiles.

          Lo que NO se portó, y por qué: el carnet no se convierte en banda a
          lo ancho. Tiene proporciones de carnet, no de columna -- el #297
          acaba de volverlo una credencial imprimible de 54x85.6mm-- y el fix
          12b ya probó estirarlo: el sobrante terminó DENTRO de la tarjeta,
          bajo su grilla de datos. El split SÍ se movió después de esto: ya no
          es el `1fr 1fr` del fix 12c sino `380px 1fr`, porque la tarjeta pasó
          a ser vertical y una columna de 566px es justo lo que le impedía
          serlo. El razonamiento completo está sobre el `<div>` del riel.

          Cada cifra sale de datos que la pantalla ya tenía, y ninguna repite
          una cifra que ya esté abajo. La de asistencia se MUDÓ: el pie de
          "Esta semana" cedió su "8 de 10" y se quedó con el alcance, que es lo
          que una tile no puede decir.
        */}
        <div data-testid="student-pulse" className={STAT_GRID}>
          <StatCard
            label="Cobertura"
            value={diasDeCobertura === null ? "—" : Math.abs(diasDeCobertura)}
            unit={diasDeCobertura === null ? undefined : diasDeCobertura === 1 || diasDeCobertura === -1 ? "día" : "días"}
            hint={
              diasDeCobertura === null
                ? "sin pago aprobado todavía"
                : diasDeCobertura < 0
                  ? "vencida"
                  : "de membresía paga"
            }
          />
          <StatCard
            label="Asistencia"
            value={asistencia === null ? "—" : asistencia.porcentaje}
            unit={asistencia === null ? undefined : "%"}
            hint={
              asistencia === null ? (
                "sin listas tomadas todavía"
              ) : (
                <span className="flex flex-col gap-y-field">
                  <StatTrack value={asistencia.attended} total={asistencia.total} />
                  <span>{`${asistencia.attended} de ${asistencia.total} sesiones`}</span>
                </span>
              )
            }
          />
          <StatCard
            label="Entrenamientos"
            value={entrenamientosSemanales ?? "—"}
            hint={entrenamientosSemanales === null ? "horario no disponible" : "por semana"}
          />
          <StatCard
            label="Pagos en revisión"
            value={pendingPagos}
            hint={pendingPagos === 0 ? "nada esperando validación" : "esperan validación del club"}
          />
        </div>

        <div className={cn(PAGE_RAIL, "lg:!grid-cols-[minmax(0,336px)_minmax(0,1fr)]", "flex-1")}>
          <div className="flex flex-col gap-5">
            <Carnet
              profile={selectedProfile}
              horariosState={horariosState}
              canManagePhoto={canManagePhoto}
              onPhotoUploaded={() => {
                onPhotoUploaded();
                // Only the session-owner's photo is the AppShell avatar: an
                // upload on a represented dependent must never refresh/replace
                // the representative's avatar.
                if (selectedProfile?.personaId === accountPersonaId) onOwnPhotoUploaded?.();
              }}
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
            onPhotoUploaded={() => setReloadToken((n) => n + 1)}
            onOwnPhotoUploaded={() => void refreshSession()}
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
