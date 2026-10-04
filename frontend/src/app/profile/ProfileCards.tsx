"use client";

/**
 * The three blocks of /profile v2, as pure presentation: the identity card,
 * the per-role block (membership ticket, «A tu cargo», or the coal board) and
 * the «Seguridad» card shell. Every value arrives as a prop; the page owns the
 * state and the requests.
 */

import { useState } from "react";
import Link from "next/link";
import { Camera, Eye, Loader2, Pencil } from "lucide-react";
import AvatarPhoto from "@/components/AvatarPhoto";
import PhotoViewerDialog from "@/components/PhotoViewerDialog";
import { Badge, buttonClasses, cn, RowActionsMenu } from "@/components/ui";
import type { BadgeTone } from "@/components/ui/Badge";
import { ICON } from "@/lib/icon-size";
import type { StudentProfileSummary } from "@/services/api";
import { personInitials } from "@/app/student/student-utils";
import type { TicketToneKey } from "./ProfileParts";
import LinkifiedText from "@/components/LinkifiedText";

// ---------------------------------------------------------------------------
// Identity card
// ---------------------------------------------------------------------------

export interface IdentityChip {
  label: string;
  tone: BadgeTone;
  /** Extra classes for a chip with no `BadgeTone` of its own (the representante's count). */
  className?: string;
  /** Screen-reader-only suffix, appended inside the chip. */
  srOnly?: string;
}

export interface IdentityFact {
  label: string;
  value: string;
}

interface IdentityCardProps {
  name: string;
  initials: string;
  fotoUrl?: string | null;
  roleLabel: string;
  chips: readonly IdentityChip[];
  correo: string;
  /** The teléfono row — owned by the page, which holds the edit state. */
  telefonoRow: React.ReactNode;
  /** Read-only extras (nacimiento, representante); a datum the page does not hold is never passed. */
  facts: readonly IdentityFact[];
  /** Pre-formatted creation date, or `null` when the account carries none. */
  createdOn: string | null;
  uploadingFoto: boolean;
  fotoError: string | null;
  fotoInputRef: React.RefObject<HTMLInputElement>;
  onFotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * The round badge on the avatar's lower-right edge, WhatsApp's pencil. 32px to
 * sit on an 84px avatar; `touch-target-reach` gives a thumb its 44px anyway.
 */
const PENCIL_BADGE =
  "touch-target-reach absolute -bottom-0.5 -right-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-paper bg-coal text-white shadow-card hover:bg-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cata-red disabled:opacity-80";

/**
 * The avatar with its pencil. With a photo, the pencil offers «Ver foto» and
 * «Cambiar foto», and the photo itself opens full size; without one there is
 * nothing to view, so the pencil goes straight to the file picker.
 */
function AvatarWithPencil({
  fotoUrl,
  initials,
  uploadingFoto,
  onPick,
}: {
  fotoUrl?: string | null;
  initials: string;
  uploadingFoto: boolean;
  onPick: () => void;
}): React.ReactElement {
  const [viewing, setViewing] = useState(false);
  const circle =
    "flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-full border-4 border-paper bg-coal font-display text-xl tracking-flat text-ball shadow-card";
  const photo = (
    <AvatarPhoto fotoUrl={fotoUrl} initials={initials} className="h-full w-full rounded-full object-cover" />
  );

  return (
    <div data-testid="profile-avatar" className="relative flex-none">
      {fotoUrl ? (
        <button
          type="button"
          aria-label="Ver foto de perfil"
          onClick={() => setViewing(true)}
          className={cn(circle, "cursor-zoom-in")}
        >
          {photo}
        </button>
      ) : (
        <div className={circle}>{photo}</div>
      )}

      {uploadingFoto ? (
        <button type="button" disabled aria-label="Subiendo foto de perfil…" className={PENCIL_BADGE}>
          <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
        </button>
      ) : fotoUrl ? (
        <RowActionsMenu
          label="Editar foto de perfil"
          align="start"
          triggerClassName={PENCIL_BADGE}
          triggerIcon={<Pencil size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />}
          items={[
            {
              label: "Ver foto",
              icon: <Eye size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
              onSelect: () => setViewing(true),
            },
            {
              label: "Cambiar foto",
              icon: <Camera size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />,
              onSelect: onPick,
            },
          ]}
        />
      ) : (
        <button type="button" aria-label="Cambiar foto de perfil" title="Cambiar foto de perfil" onClick={onPick} className={PENCIL_BADGE}>
          <Pencil size={ICON.sm} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      {fotoUrl && (
        <PhotoViewerDialog
          open={viewing}
          fotoUrl={fotoUrl}
          onClose={() => setViewing(false)}
          onChange={() => {
            setViewing(false);
            onPick();
          }}
        />
      )}
    </div>
  );
}

/** One bounce when the card first draws; nothing at all under reduced motion. */
const BALL_MOTION = `@media (prefers-reduced-motion: no-preference){.profile-ball{animation:profile-ball-bounce 2.8s ease-in-out 1}}@keyframes profile-ball-bounce{0%,100%{transform:translateY(0)}30%{transform:translateY(-.28em)}55%{transform:translateY(0)}70%{transform:translateY(-.1em)}}`;

export function IdentityCard({
  name,
  initials,
  fotoUrl,
  roleLabel,
  chips,
  correo,
  telefonoRow,
  facts,
  createdOn,
  uploadingFoto,
  fotoError,
  fotoInputRef,
  onFotoChange,
}: IdentityCardProps): React.ReactElement {
  return (
    <section
      data-testid="profile-hero"
      aria-label={`Identidad de la cuenta de ${name}`}
      className="relative min-w-0 overflow-hidden rounded-2xl border border-line-2 bg-paper px-5 shadow-elevated"
    >
      {/* The asymmetric institutional-red field: the card's one colour gesture. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[132px] bg-cata-red"
        style={{ clipPath: "polygon(0 0, 100% 0, 100% 58%, 68% 100%, 0 84%)" }}
      />
      <div className="relative flex h-[100px] items-start pt-4 text-white">
        <span className="text-2xs font-bold uppercase tracking-caps-wide">Cata Club</span>
        {/* The role is the first thing read; the ball is its full stop. */}
        <div
          data-testid="profile-shoulder"
          className="absolute bottom-2 left-0 whitespace-nowrap font-display text-xl uppercase leading-none tracking-flat"
        >
          {roleLabel}
          <span
            aria-hidden="true"
            className="ml-[0.12em] inline-block h-[0.34em] w-[0.34em] rounded-full bg-ball ring-2 ring-coal/20 profile-ball"
          />
        </div>
      </div>

      <style>{BALL_MOTION}</style>

      <div className="relative -mt-1.5 flex items-end gap-3.5">
        <AvatarWithPencil
          fotoUrl={fotoUrl}
          initials={initials}
          uploadingFoto={uploadingFoto}
          onPick={() => fotoInputRef.current?.click()}
        />
        <h2 className="min-w-0 break-words pb-1.5 font-display text-lg uppercase leading-tight tracking-flat text-ink">
          {name}
        </h2>
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <Badge key={chip.label} tone={chip.tone} className={chip.className}>
              {chip.label}
              {chip.srOnly && <span className="sr-only"> {chip.srOnly}</span>}
            </Badge>
          ))}
        </div>
      )}

      <dl className="mt-3 grid gap-x-5 sm:grid-cols-2 split:grid-cols-1">
        <div className="min-w-0 border-t border-line py-2.5 sm:col-span-2 split:col-span-1">
          <dt className="text-2xs font-bold uppercase tracking-wide text-ink-3-strong">Correo</dt>
          <dd
            data-testid="profile-correo"
            className="mt-0.5 text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]"
          >
            {correo}
            <span className="block text-xs font-semibold text-ink-3-strong">Lo gestiona el club.</span>
          </dd>
        </div>
        {telefonoRow}
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0 border-t border-line py-2.5">
            <dt className="text-2xs font-bold uppercase tracking-wide text-ink-3-strong">{fact.label}</dt>
            <dd className="mt-0.5 text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="pb-3">
        <input
          ref={fotoInputRef}
          type="file"
          accept="image/jpeg,image/png"
          onChange={onFotoChange}
          className="hidden"
          data-testid="foto-perfil-input"
        />
        {fotoError && (
          <p role="alert" className="mt-1 text-xs font-semibold text-state-bad">
            <LinkifiedText text={fotoError} />
          </p>
        )}
      </div>

      {createdOn && (
        <p className="-mx-5 flex justify-between gap-3 border-t border-line bg-sunken px-5 py-2.5 text-xs text-ink-3-strong">
          <span>Cuenta creada</span>
          <b className="font-bold tabular-nums text-ink-2">{createdOn}</b>
        </p>
      )}
    </section>
  );
}

/** The teléfono row's read mode: the value and the edit trigger on one line. */
export function TelefonoRead({
  value,
  onEdit,
}: {
  value: string;
  /** `null` while there is no profile to seed the edit from. */
  onEdit: (() => void) | null;
}): React.ReactElement {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-t border-line py-2.5">
      <div className="min-w-0">
        <dt className="text-2xs font-bold uppercase tracking-wide text-ink-3-strong">Teléfono</dt>
        <dd className="mt-0.5 text-base font-semibold leading-snug text-ink [overflow-wrap:anywhere]">
          {value || "—"}
        </dd>
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit} className={buttonClasses("secondary", "sm")}>
          <Pencil size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Editar datos
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Membership ticket (jugador)
// ---------------------------------------------------------------------------

const TICKET_TONE: Record<
  TicketToneKey,
  { card: string; word: string; on: string; off: string }
> = {
  ok: {
    card: "border-t-state-ok bg-state-ok-bg/55",
    word: "text-state-ok",
    on: "bg-state-ok",
    off: "bg-state-ok/25",
  },
  warn: {
    card: "border-t-state-warn bg-state-warn-bg/55",
    word: "text-state-warn",
    on: "bg-state-warn",
    off: "bg-state-warn/25",
  },
  bad: {
    card: "border-t-state-bad bg-state-bad-bg/55",
    word: "text-state-bad",
    on: "bg-state-bad",
    off: "bg-state-bad/25",
  },
};

/** Days one strip represents: a monthly payment. */
export const TICKET_DAYS = 30;

export function MembershipTicket({
  tone,
  daysLeft,
  statusWord,
  until,
  plan,
  modalidad,
  since,
}: {
  tone: TicketToneKey;
  /** Whole days of coverage left (negative once lapsed), or `null` when no payment date is known. */
  daysLeft: number | null;
  statusWord: string;
  /** Pre-formatted coverage end, or `null`. */
  until: string | null;
  plan: string;
  modalidad: string;
  /** Pre-formatted activation date, or `null`. */
  since: string | null;
}): React.ReactElement {
  const skin = TICKET_TONE[tone];
  const expired = daysLeft !== null && daysLeft < 0;
  const left = daysLeft === null ? 0 : Math.max(0, daysLeft);
  const filled = Math.min(TICKET_DAYS, left);
  const caption = expired
    ? `Venció hace ${-(daysLeft ?? 0)} ${-(daysLeft ?? 0) === 1 ? "día" : "días"}`
    : left === 1
      ? "día restante"
      : "días restantes";

  return (
    <section
      data-testid="profile-membership"
      aria-label="Tu membresía"
      className={cn(
        "grid items-center gap-x-5 gap-y-3 rounded-card border border-line border-t-[3px] px-5 py-4 sm:grid-cols-[auto_minmax(0,1fr)]",
        skin.card,
      )}
    >
      {daysLeft !== null && (
        <div
          data-testid="profile-coverage"
          className="font-display text-display leading-none tracking-flat text-ink tabular-nums"
        >
          {left}
          <small className={cn("mt-1.5 block font-sans text-2xs font-bold uppercase tracking-caps-wide", skin.word)}>
            {caption}
          </small>
        </div>
      )}
      <div className="min-w-0">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Tu membresía</h2>
        <p className={cn("mt-0.5 text-sm font-bold", skin.word)}>
          {statusWord}
          {until ? ` · hasta ${until}` : ""}
        </p>
        {daysLeft !== null && (
          <div
            role="progressbar"
            aria-label="Cobertura restante"
            aria-valuemin={0}
            aria-valuemax={TICKET_DAYS}
            aria-valuenow={filled}
            aria-valuetext={expired ? caption : `${left} ${caption}`}
            className="mt-2.5 grid grid-cols-[repeat(30,1fr)] gap-0.5"
          >
            {Array.from({ length: TICKET_DAYS }, (_, i) => (
              <i
                key={i}
                aria-hidden="true"
                className={cn(
                  "h-2 rounded-[2px]",
                  i >= TICKET_DAYS - filled ? skin.on : skin.off,
                )}
              />
            ))}
          </div>
        )}
      </div>
      {(plan || since || modalidad) && (
        <p className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-line-2/60 pt-2.5 text-xs text-ink-2 sm:col-span-2">
          {plan && (
            <span>
              Plan <b className="text-ink">{plan}</b>
            </span>
          )}
          {modalidad && (
            <span>
              Modalidad <b className="text-ink">{modalidad}</b>
            </span>
          )}
          {since && (
            <span>
              Jugador desde <b className="text-ink">{since}</b>
            </span>
          )}
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// «A tu cargo» (representante)
// ---------------------------------------------------------------------------

export function DependantsCard({
  dependants,
  statusFor,
}: {
  dependants: readonly StudentProfileSummary[];
  statusFor: (dependant: StudentProfileSummary) => { label: string; tone: BadgeTone } | null;
}): React.ReactElement {
  return (
    <section data-testid="profile-dependants" aria-label="Jugadores a tu cargo" className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">A tu cargo</h2>
        {dependants.length > 0 && (
          <Badge tone="neutral" className="!bg-cuenta-representante-bg !text-cuenta-representante">
            {dependants.length} {dependants.length === 1 ? "jugador" : "jugadores"}
          </Badge>
        )}
      </header>
      {dependants.length > 0 ? (
        <ul className="m-0 list-none p-0">
          {dependants.map((dependant) => {
            const status = statusFor(dependant);
            const full = `${dependant.nombres} ${dependant.apellidos}`.trim();
            return (
              <li
                key={dependant.personaId}
                data-testid="profile-dependant"
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-5 py-3 last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full bg-coal text-xs font-extrabold text-ball"
                >
                  {personInitials(dependant.nombres, dependant.apellidos)}
                </span>
                <span className="min-w-[8rem] flex-1 break-words text-sm font-bold text-ink">{full}</span>
                {status ? (
                  <Badge tone={status.tone}>{status.label}</Badge>
                ) : (
                  <Badge tone="neutral">Sin membresía visible</Badge>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-ink-2">
          Todavía no hay jugadores representados vinculados a esta cuenta.
        </p>
      )}
      <Link
        href="/student/add-dependent"
        className="flex min-h-11 items-center gap-3 border-t border-dashed border-line-2 bg-sunken px-5 py-2.5 text-sm font-bold text-ink hover:bg-line"
      >
        <span
          aria-hidden="true"
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full border-2 border-dashed border-line-2 text-lg text-ink-2"
        >
          +
        </span>
        Agregar jugador (menor de edad)
      </Link>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Coal board (entrenador, administrador, unrecognised role)
// ---------------------------------------------------------------------------

export type BoardMotif = "table" | "arc";

/**
 * Top-down table-tennis table: border, centre line, net band. The ball is the
 * brand yellow; the table itself is white at low alpha so the copy stays
 * legible wherever the two meet.
 */
function TableMotif(): React.ReactElement {
  return (
    <svg viewBox="0 0 200 120" fill="none" aria-hidden="true" className="h-full w-auto">
      <rect x="6" y="14" width="188" height="92" rx="3" stroke="#fff" strokeOpacity="0.5" strokeWidth="2" />
      <path d="M6 60h188" stroke="#fff" strokeOpacity="0.35" strokeWidth="1.5" />
      <rect x="97" y="6" width="6" height="108" rx="1" fill="#fff" fillOpacity="0.55" />
      <circle cx="148" cy="36" r="6" fill="#FFD600" />
    </svg>
  );
}

/** A dotted ball trajectory ending, top right, on the yellow ball. */
function ArcMotif(): React.ReactElement {
  return (
    <svg viewBox="0 0 200 120" fill="none" aria-hidden="true" className="h-full w-auto">
      <path
        d="M6 108Q24 92 42 108Q70 70 98 108Q142 30 184 24"
        stroke="#fff"
        strokeOpacity="0.5"
        strokeWidth="2"
        strokeDasharray="3 5"
        strokeLinecap="round"
      />
      <path d="M2 110h110" stroke="#fff" strokeOpacity="0.3" strokeWidth="1.5" />
      <g fill="#fff" fillOpacity="0.6">
        <circle cx="42" cy="108" r="3.5" />
        <circle cx="98" cy="108" r="3.5" />
      </g>
      <circle cx="184" cy="24" r="8" fill="#FFD600" />
    </svg>
  );
}

export function CoalBoard({
  motif,
  eyebrow,
  title,
  text,
}: {
  motif: BoardMotif;
  eyebrow: string;
  title: string;
  text: string;
}): React.ReactElement {
  return (
    <section
      data-testid="profile-role-board"
      aria-label={eyebrow}
      className="relative overflow-hidden rounded-card bg-coal px-5 pb-5 pt-[88px] text-white sm:min-h-[140px] sm:px-6 sm:py-6 sm:pr-[min(46%,15rem)]"
    >
      {/* Top right on every width, so it never sits under the copy. */}
      <div className="pointer-events-none absolute right-4 top-4 h-16 sm:right-6 sm:top-1/2 sm:h-24 sm:-translate-y-1/2">
        {motif === "table" ? <TableMotif /> : <ArcMotif />}
      </div>
      <p className="text-2xs font-bold uppercase tracking-caps-wide text-ball">{eyebrow}</p>
      <h2 className="mt-1 font-display text-lg uppercase leading-tight tracking-flat">{title}</h2>
      <p className="mt-1.5 max-w-[44ch] text-sm text-white/80">{text}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// «Seguridad»
// ---------------------------------------------------------------------------

export function SecurityCard({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section data-testid="profile-column-status" aria-label="Seguridad" className="card overflow-hidden">
      <header className="border-b border-line px-5 py-3">
        <h2 className="font-display text-lg uppercase leading-tight tracking-flat text-ink">Seguridad</h2>
      </header>
      {children}
    </section>
  );
}

/** One «title / hint / action» row inside Seguridad. */
export function SecurityRow({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-3.5 last:border-b-0">
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="text-xs text-ink-3-strong">{hint}</p>
      </div>
      {action}
    </div>
  );
}
