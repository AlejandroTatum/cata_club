/**
 * /student/payments — the family-facing payment screen.
 *
 * One of the two things a student or a parent actually opens this portal to do
 * ("hay que hacer pago y ver asistencias"). It arrived from upstream visually
 * unmigrated — raw `cata-*` classes, ISO dates printed straight from the API,
 * `$35.00` amounts, a red "selected" filter chip and Argentine voseo in its
 * copy ("Adjuntá", "tenés", "Consultá") — and this pass puts it on the same
 * system as the rest of the product:
 *
 * - `Badge`, `FilterPill`, `Button`, `EmptyState`, `ErrorState`,
 *   `LoadingState`, and the `card` / `h-ctl` / `h-drow` / `rounded-card`
 *   tokens, instead of eight bespoke pill and card shapes.
 * - `formatCurrency` / `formatDate` / `formatDateRange` from
 *   `src/lib/format-utils.ts` — this screen was the second currency grammar
 *   and the third date grammar in the product.
 * - Neutral Ecuadorian Spanish, usted. The student portal is not tuteo and it
 *   is certainly not voseo.
 * - Selection is coal plus the yellow ball dot (`FilterPill`), never red. Red
 *   is the primary CTA and destructive intent only, so a red "Aprobados" chip
 *   read as an alarm about approved payments.
 *
 * ## Two facts this screen deliberately does NOT show
 *
 * - **"Vigente hasta" from the membership.** `MembershipSummary.fechaFin` is
 *   declared on the client type but `MembershipView` in
 *   src/lib/server/student-adapter.ts never populates it — the field is
 *   `undefined` for every real payload, and the old status bar's "Vigente
 *   hasta: {fechaFin}" therefore rendered nothing at all while its `isExpired`
 *   branch silently never fired. The real, computable coverage date is the
 *   furthest `fechaFin` among APPROVED payments (`resolveCoverageEnd`), which
 *   is what the card shows and what the renewal form starts from.
 * - **An amount due.** There is no debt concept in the backend: a Membresia
 *   carries a `montoAplicado` (the plan's price), not a balance. The card
 *   reports the monthly price it can prove and lets the reader enter what they
 *   are paying.
 */

"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistentPreference } from "@/lib/persistent-preference";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppShell from "@/components/shell/AppShell";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import {
  fetchStudentPortal,
  fetchPagosDePersona,
  fetchBeneficio,
  subirVoucherPago,
  registrarPago,
  aplicarBeneficio,
} from "@/services/api";
import type {
  StudentPortalSummary,
  StudentProfileSummary,
  PagoPersona,
  MembershipSummary,
  RegistrarPagoInput,
  BeneficioAsignado,
  CoberturaBonificada,
} from "@/services/api";
import {
  BackLink,
  Badge,
  Button,
  DataBox,
  EmptyState,
  ErrorState,
  FilterPanel,
  FilterPill,
  LoadingState,
  ResponsiveList,
  TableCell,
  TableHeaderCell,
  TableRow,
  buttonClasses,
  cn,
  type BadgeTone,
} from "@/components/ui";
import ContextualHelp from "@/components/ContextualHelp";
import { formatCurrency, formatDate, formatDateRange } from "@/lib/format-utils";
import { calendarIsoDate, clubToday } from "@/lib/club-date";
import {
  describeMembershipState,
  describePaymentSituation,
  firstNameOf,
  isMinor,
  resolveCoverageEnd,
} from "../student-utils";
import ManagedStudentPicker, {
  useManagedProfiles,
  withSelectedStudent,
} from "../ManagedStudentPicker";
import {
  filterPagosByStatus,
  sortPagosByDate,
  formatPagoMonto,
  getEmptyStateMessage,
  describePagoEstado,
  describePagoDescuento,
  pagoFaltaComprobante,
  countPagosByStatus,
  addMonthsIso,
  estimateTotal,
  formatFileSize,
  TIPO_PAGO_LABEL,
  PAGO_FILTER_LABELS,
  voucherFileTypeError,
  type PagoStatusFilter,
} from "./payments-utils";
import {
  ChevronDown,
  CreditCard,
  Download,
  Loader2,
  Minus,
  Paperclip,
  Plus,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";

// ---------------------------------------------------------------------------
// Load state
// ---------------------------------------------------------------------------

type PortalLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: StudentPortalSummary };

type PagosLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; pagos: PagoPersona[] };

const FILTERS: PagoStatusFilter[] = ["TODOS", "PENDIENTE_VALIDACION", "APROBADO", "RECHAZADO"];

function isPagoStatusFilter(value: string): value is PagoStatusFilter {
  return (FILTERS as string[]).includes(value);
}

/** Shared empty list, so "not loaded yet" is a stable reference for the memos below. */
const NO_PAGOS: PagoPersona[] = [];

/** `_sistema.css` `.fld` — the one input shape, 40px like every other control. */
const FIELD_CLASSES =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-3.5 text-sm text-ink " +
  "placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-45";

const FIELD_LABEL_CLASSES = "text-2xs font-bold uppercase text-ink-3";

/** Parse an ISO date at local noon — the same anchoring `format-utils` uses, for the same reason. */
function fromIsoDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

/**
 * The status-footer dot's text color, one per `BadgeTone` — the same
 * tone→color pairing `Badge` uses for its own `currentColor` dot, reused
 * here as plain text color since this dot sits alone, with no pill behind
 * it.
 */
const STATUS_DOT_TEXT: Record<BadgeTone, string> = {
  neutral: "text-state-neutral",
  ok: "text-state-ok",
  warn: "text-state-warn",
  bad: "text-state-bad",
};

// ---------------------------------------------------------------------------
// Membership status — everything the club can actually prove about coverage
// ---------------------------------------------------------------------------

function MembershipCard({
  membership,
  coverageEnd,
  /**
   * Whose membership this is, when the reader is not that person.
   *
   * A guardian with exactly ONE dependent never saw the switcher (it hides
   * below two profiles), so this whole screen — titled "Mis pagos", with a
   * card reading "Su membresía" and a form that debits a specific persona —
   * never once named the student it was about. Laura Vera, who has no
   * membership of her own, was registering a payment for Sofía on a page that
   * said "su".
   */
  studentName,
  children,
}: {
  membership: MembershipSummary | null;
  coverageEnd: string | null;
  studentName: string | null;
  children?: React.ReactNode;
}): React.ReactElement {
  const state = describeMembershipState(membership?.estado);

  const facts: { label: string; value: string }[] = [];
  if (membership?.categoria) facts.push({ label: "Plan", value: membership.categoria });
  // Issue #400 (slice 4c-b): `montoAplicado` stays the real, nonzero tariff
  // even for a gratuitous membership (`esGratuidadFamiliar`) — E04-RF002
  // stopped zeroing it. Printing "Valor mensual: $35,00" here would read as
  // an amount this family owes, when this specific membership charges $0
  // regardless. The gratuity itself is stated by the form area below
  // (`RenewPaymentForm` is replaced by an explanatory paragraph for this
  // case), not by this facts row.
  if (membership?.montoAplicado && !membership.esGratuidadFamiliar) {
    facts.push({ label: "Valor mensual", value: formatCurrency(membership.montoAplicado) });
  }

  return (
    <section
      data-testid="membership-status"
      className="card overflow-hidden"
      aria-labelledby="membership-status-title"
    >
      {/* The badge carries the `estado`; the heading carries the fact the
          reader came for. The badge used to say the same thing as the heading
          in coarser words ("Al día"), which is a second, weaker judgement of
          data that already speaks for itself. */}
      <div className="px-5 py-[18px]">
        <div className="mb-2 flex flex-wrap items-center gap-2.5">
          <p className="text-2xs font-bold uppercase text-ink-3">
            {studentName ? `Membresía de ${studentName}` : "Su membresía"}
          </p>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        <h2 id="membership-status-title" className="text-base font-bold tracking-tight text-ink">
          {coverageEnd ? (
            <>
              Pagado hasta el <span className="tabular-nums">{formatDate(coverageEnd)}</span>
            </>
          ) : (
            "Todavía no hay ningún pago aprobado"
          )}
        </h2>
        <p className="mt-1.5 text-sm text-ink-3">
          {coverageEnd
            ? "Es la fecha del pago aprobado que llega más lejos en su historial."
            : "En cuanto el club apruebe un pago, aquí aparecerá hasta qué fecha queda cubierto."}
        </p>
      </div>

      {facts.length > 0 && (
        <dl className="flex flex-wrap gap-x-8 gap-y-section border-t border-line bg-sunken px-5 py-3.5">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-2xs font-bold uppercase text-ink-3-strong">
                {fact.label}
              </dt>
              <dd className="mt-0.5 text-sm font-bold tabular-nums text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Issue #513 (Propuesta B, idea 1): a compact status-footer dot,
          placed at the very foot of the status block — immediately above
          the CTA below. The `Badge` at the top already carries the state
          for a reader scanning down from the title; this repeats it right
          where the eye lands before acting, so status and action read
          together without a scroll back up. */}
      {children && (
        <div className="flex items-center gap-1.5 border-t border-line bg-sunken px-5 py-2">
          <span aria-hidden="true" className={cn("h-1.5 w-1.5 flex-none rounded-full bg-current", STATUS_DOT_TEXT[state.tone])} />
          <span className={cn("text-2xs font-bold uppercase", STATUS_DOT_TEXT[state.tone])}>{state.label}</span>
        </div>
      )}

      {children && <div className="border-t border-line px-5 py-4">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// "Cómo se registra un pago" — the procedure, behind "Ver ayuda"
//
// The complaint this answers is literal: "hasta ahora ni yo sé cómo probar ese
// flujo porque nunca se muestra". The upload has always existed — it is the
// file input the form reveals for a TRANSFERENCIA — but nothing on the screen
// said the form existed, what it would ask for, or that the comprobante is
// what the club validates. A reader who could pay saw one button; a reader who
// could NOT pay (a minor on their own account) saw a sentence that ended the
// conversation. Every step describes something on THIS screen or something the
// club demonstrably does — an ADMINISTRADOR can register a payment for a
// persona (`membresia_pago_servicio.registrar_pago` authorizes owner,
// representative or admin, and `/members` is where the club does it).
//
// ## Why it stopped being a rail (D11c, and D11b)
//
// It was a permanent card in the second column, and it was wrong on both
// counts the redesign names.
//
// D11c: the page subtitle says WHAT this screen is in one line; everything
// that explains HOW it works goes behind "Ver ayuda". This was three numbered
// steps and a preamble — a procedure, top to bottom, and the longest piece of
// loose help in the family portal.
//
// D11b: it was also the layout defect. Its height is FIXED — the same three
// steps whether the family has forty payments or none — so in the thin state
// it was the tallest item on the screen and its height became the grid row's.
// The comment it used to carry admitted the symptom ("dejaba un hueco de
// 170px") and answered it with `row-span-2`, which spread the same fixed block
// over both rows instead of removing the thing that was setting the height.
// Behind a disclosure it costs one 20px line closed, and the block that grows
// with the family's real record — the history — is free to claim the page.
// ---------------------------------------------------------------------------

function HowToPay({
  /** `null` when the reader is the student — "usted" instead of a name. */
  studentName,
  /** The minor-on-their-own-account case: the rail carries the alternative, not the steps. */
  blocked,
  /**
   * Issue #400 (slice 4c-b): the gratuitous case — `RenewPaymentForm` is
   * replaced by an explanatory paragraph (see the render below), so the
   * month-selector procedure below ("elija cuántos meses… cada mes cuesta
   * $X") describes a form that is not there for this reader.
   */
  gratuitous,
  /** True once the club has a `Membresia` to renew; without one the form cannot be reached at all. */
  hasMembership,
  monthlyPrice,
}: {
  studentName: string | null;
  blocked: boolean;
  gratuitous: boolean;
  hasMembership: boolean;
  monthlyPrice: string | null;
}): React.ReactElement {
  const subject = studentName ? `de ${studentName}` : "suyo";

  if (gratuitous) {
    return (
      <ContextualHelp title="Cómo funciona esta membresía">
        <p>
          El club le otorgó gratuidad familiar: esta membresía no genera ningún cobro y no hay
          ningún monto que registrar acá.
        </p>
        <p className="mt-2.5">
          Para extender la cobertura cuando corresponda, el club se encarga de registrarlo. Si
          necesita algo puntual, acérquese a administración.
        </p>
      </ContextualHelp>
    );
  }

  if (blocked) {
    return (
      <ContextualHelp title="Cómo se paga esta membresía">
        {/* The card above already names WHO registers the payment, from
            `describePaymentSituation`. Repeating that sentence here printed it
            twice on one screen; this answers the next question instead — what
            the reader actually does. */}
        <p>Su cuenta no registra pagos, pero el pago sí se puede hacer. Estos son los pasos:</p>
        <ol className="mt-2.5 flex flex-col gap-2.5">
          <HowToPayStep index={1}>
            Acérquese a administración del club con el valor del plan
            {monthlyPrice ? ` (${formatCurrency(monthlyPrice)} al mes)` : ""}. También puede pagar
            por transferencia y entregar el comprobante allí.
          </HowToPayStep>
          <HowToPayStep index={2}>
            El club registra el pago a su nombre y elige el período que cubre.
          </HowToPayStep>
          <HowToPayStep index={3}>
            El pago aparece en el historial de esta misma pantalla, con el período cubierto y su
            estado.
          </HowToPayStep>
        </ol>
      </ContextualHelp>
    );
  }

  if (!hasMembership) {
    return (
      <ContextualHelp title="Cómo se registra un pago">
        <p>
          El club crea la membresía al registrar el primer pago, así que ese primero se hace en
          administración. Desde el segundo, la renovación se registra aquí: monto, forma de pago y
          —si es transferencia— el comprobante.
        </p>
      </ContextualHelp>
    );
  }

  return (
    <ContextualHelp title="Cómo se registra un pago">
      <p>Son tres pasos y terminan en el club, no en usted: lo último lo hace quien valida.</p>
      <ol className="mt-2.5 flex flex-col gap-2.5">
        <HowToPayStep index={1}>
          Abra <b className="font-semibold text-ink">Registrar un pago</b> y elija cuántos meses{" "}
          {subject === "suyo" ? "" : `${subject} `}va a pagar, más la forma de pago — nunca escribe
          un monto.
          {monthlyPrice ? (
            <>
              {" "}
              Cada mes cuesta {formatCurrency(monthlyPrice)}: el formulario muestra el período y el
              total estimado antes de que confirme.
            </>
          ) : null}
        </HowToPayStep>
        <HowToPayStep index={2}>
          Si paga por <b className="font-semibold text-ink">transferencia</b>, adjunte el
          comprobante — PDF, JPG o PNG, hasta 5 MB. Sin comprobante el club no tiene qué validar, y
          el formulario no deja continuar.
        </HowToPayStep>
        <HowToPayStep index={3}>
          El pago queda <b className="font-semibold text-ink">en revisión</b> en el historial hasta
          que el club lo apruebe o lo rechace. Si lo rechaza, el motivo aparece en la misma fila.
        </HowToPayStep>
      </ol>
    </ContextualHelp>
  );
}

/**
 * One step of the procedure.
 *
 * Numbered because the order is the information — this is the only numbered
 * sequence in the product, and it is one because doing step 2 before step 1 is
 * not possible.
 *
 * The disc keeps its coal fill and its tabular figure; what it lost with the
 * card is the row chrome (the 20px gutter and the hairline between steps),
 * which belonged to a panel and reads as a table inside the help sheet.
 */
function HowToPayStep({
  index,
  children,
}: {
  index: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="mt-px flex h-[20px] w-[20px] flex-none items-center justify-center rounded-full bg-coal text-2xs tracking-flat font-bold tabular-nums text-white"
      >
        {index}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The club's benefit, read BEFORE the reader pays (issue #400, slice 06)
//
// `GET /personas/{id}/beneficio` used to be ADMINISTRADOR-only (issue #398):
// a socio could not know whether they had a discount until the club told
// them, or until a payment came back with it already applied. Relaxing that
// one GET (owner/representative, same ownership criterion `fetchPagosDePersona`
// already uses) lets this screen show it up front, right where the reader is
// about to decide how much to pay.
// ---------------------------------------------------------------------------

function BeneficioNote({ beneficio }: { beneficio: BeneficioAsignado | null }): React.ReactElement | null {
  if (!beneficio) return null;
  const { descuento } = beneficio;
  const porcentaje = descuento.porcentaje != null ? Number(descuento.porcentaje) : null;
  const etiqueta =
    porcentaje != null && Number.isFinite(porcentaje)
      ? `${porcentaje}% OFF`
      : descuento.monto != null
        ? `${formatCurrency(descuento.monto)} OFF`
        : null;
  if (!etiqueta) return null;

  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
      Su beneficio: <DataBox>{etiqueta}</DataBox>
      <span className="text-ink-3">{descuento.nombre}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Cuántos meses — selector discreto, nunca un monto (issue #400)
//
// El usuario elige una cantidad ENTERA de meses; el backend sigue siendo
// quien calcula `monto_base = tarifa_vigente * meses` (`PagoCreateDTO.meses`,
// `gt=0, le=12` — mismo techo que `CoberturaBonificadaCreateDTO.meses`, doce
// es la cobertura más larga que el club vende hoy).
//
// `Stepper` (components/ui) es un indicador de PASOS con nombre ("Horario ·
// Lunes 15:00"), nunca un número pelado, y no calza con "elija una
// cantidad" — este es un control +/- simple sobre los mismos tokens
// (`h-ctl`, `rounded-ctl`, `border-line-2`) que ya usa el resto del
// formulario, no un componente nuevo del sistema de diseño.
// ---------------------------------------------------------------------------

const MESES_MINIMO = 1;
const MESES_MAXIMO = 12;

function MonthCountField({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL_CLASSES}>Meses a pagar</span>
      <div className="inline-flex h-ctl w-fit items-center gap-1 rounded-ctl border border-line-2 bg-paper px-1.5">
        <button
          type="button"
          onClick={() => onChange(Math.max(MESES_MINIMO, value - 1))}
          disabled={disabled || value <= MESES_MINIMO}
          aria-label="Un mes menos"
          className="flex h-7 w-7 flex-none items-center justify-center rounded text-ink-2 hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        </button>
        <span
          aria-live="polite"
          className="w-8 flex-none text-center text-sm font-bold tabular-nums text-ink"
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(Math.min(MESES_MAXIMO, value + 1))}
          disabled={disabled || value >= MESES_MAXIMO}
          aria-label="Un mes más"
          className="flex h-7 w-7 flex-none items-center justify-center rounded text-ink-2 hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Registering a payment
//
// ## Why this commits behind a confirm step and not behind an undo
//
// The usability review asked for a 5-second "Deshacer" after consequential
// actions. Registering a payment is the consequential action in the family
// portal, and it is the one place where a "Deshacer" button could not be
// honest: the backend exposes no way to delete or cancel a `Pago`. The whole
// surface is `POST /membresias/pagos` (create), `POST /pagos/{id}/voucher`
// (attach the proof) and `PATCH /pagos/{id}/validar`, and that last one is
// gated on `GestorPermisos(ROL_ADMIN)` — there is no DELETE anywhere in
// `membresias_pagos_router.py`, `membresia_pago_servicio.py` or
// `pago_repositorio.py`. A toast offering "Deshacer" would have had nothing to
// call, and a button that quietly does nothing is worse than no button.
//
// So the control the reader gets is placed BEFORE the commit rather than
// after it: one checkpoint naming the child, the amount, the method and the
// period that is about to be charged — and, once it is registered, a plain
// statement of the real recovery, which is that the club validates every
// payment and a wrong one is resolved by the club rejecting it.
//
// ## `useConfirmedAction` — the state machine `RenewPaymentForm` and
// `ApplyBenefitForm` share
//
// Both forms are "closed → open → confirm → submit", and until this hook
// existed that whole machine was copy-pasted between them (SonarCloud
// flagged the duplication on PR #438): the same four pieces of state
// (`showForm`/`confirming`/`loading`/`error`), the same auto-open-on-arrival
// effect, the same focus-follows-the-checkpoint effect, and the same
// `handleCancel`/`handleRequestConfirm`/`handleBackToForm` trio.
//
// What stays OUT of the hook, on purpose: `onSubmit` orchestration. The two
// forms diverge there in a way that is not cosmetic —
// `RenewPaymentForm.handleSubmit` has a THIRD outcome (`registrarPago`
// succeeds but `subirVoucherPago` fails) that closes the form without
// clearing `error`, while `ApplyBenefitForm.handleSubmit` only has the usual
// two. Forcing both through one `onSubmit(): Promise<void>` shape here would
// either lose that branch or smuggle it back in as a hook-level special
// case — so `loading`/`error`/`setConfirming` are exposed as setters and
// each component still writes its own `handleSubmit`, using them.
// ---------------------------------------------------------------------------

function useConfirmedAction({
  autoOpen,
  blocked,
  onOpen,
  findProblem,
}: {
  /** Open without a click, once, for a reader who arrived via `?registrar=1`. */
  autoOpen: boolean;
  /** A pending payment blocks auto-open — same gate both forms already state in their own render. */
  blocked: boolean;
  /** The caller's own field seeding (months, fechaInicio, voucherFile…), run every time the form opens. */
  onOpen: () => void;
  /** The first thing wrong with the form as it stands, or `null` — checked before the checkpoint opens. */
  findProblem: () => string | null;
}): {
  showForm: boolean;
  confirming: boolean;
  loading: boolean;
  error: string | null;
  setShowForm: (value: boolean) => void;
  setConfirming: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
  confirmButtonRef: React.RefObject<HTMLButtonElement>;
  submitButtonRef: React.RefObject<HTMLButtonElement>;
  open: () => void;
  handleCancel: () => void;
  handleRequestConfirm: () => void;
  handleBackToForm: () => void;
} {
  const [showForm, setShowForm] = useState(false);
  /** The checkpoint between "I filled this in" and "the club has my money". */
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  const open = useCallback((): void => {
    setShowForm(true);
    setConfirming(false);
    setError(null);
    onOpen();
  }, [onOpen]);

  // Once, on arrival. Guarded by a ref rather than by `showForm` so that a
  // reader who deliberately cancels the form is not handed it straight back
  // when the payment history refetches.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpened.current || blocked) return;
    autoOpened.current = true;
    open();
  }, [autoOpen, blocked, open]);

  // The checkpoint's own primary button takes focus when it appears: the
  // control that was focused a moment ago has just unmounted.
  useEffect(() => {
    if (confirming) confirmButtonRef.current?.focus();
  }, [confirming]);

  function handleCancel(): void {
    setShowForm(false);
    setConfirming(false);
    setError(null);
  }

  /**
   * The button that used to submit no longer submits anything. It validates
   * and opens the checkpoint — the reader still has to say yes to a sentence
   * that names what is about to happen, because nothing after this point can
   * be taken back from the portal.
   */
  function handleRequestConfirm(): void {
    const problem = findProblem();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setConfirming(true);
  }

  function handleBackToForm(): void {
    setConfirming(false);
    // The button that opened the checkpoint is the one that gets focus back —
    // otherwise dismissing it drops the keyboard reader on `document.body`.
    window.requestAnimationFrame(() => submitButtonRef.current?.focus());
  }

  return {
    showForm,
    confirming,
    loading,
    error,
    setShowForm,
    setConfirming,
    setLoading,
    setError,
    confirmButtonRef,
    submitButtonRef,
    open,
    handleCancel,
    handleRequestConfirm,
    handleBackToForm,
  };
}

/**
 * The confirmation checkpoint's own two buttons — primary "Confirmar y X"
 * (spinner while `loading`) plus "Volver a corregir". Byte-identical between
 * `RenewPaymentForm` and `ApplyBenefitForm` except for the label and the
 * `aria-describedby` target, both passed in.
 */
function ConfirmCheckpointActions({
  loading,
  loadingLabel,
  idleLabel,
  describedBy,
  onConfirm,
  onBack,
  confirmButtonRef,
}: {
  loading: boolean;
  loadingLabel: string;
  idleLabel: string;
  describedBy: string;
  onConfirm: () => void;
  onBack: () => void;
  confirmButtonRef: React.RefObject<HTMLButtonElement>;
}): React.ReactElement {
  return (
    <div className="mt-3.5 flex flex-wrap gap-2">
      <Button
        ref={confirmButtonRef}
        variant="primary"
        onClick={onConfirm}
        disabled={loading}
        aria-describedby={describedBy}
      >
        {loading ? (
          <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
        ) : (
          <CreditCard size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        )}
        {loading ? loadingLabel : idleLabel}
      </Button>
      <Button variant="tertiary" onClick={onBack} disabled={loading}>
        Volver a corregir
      </Button>
    </div>
  );
}

/**
 * The pre-checkpoint trigger row — primary "Registrar pago"/"Aplicar
 * beneficio" plus "Cancelar". Byte-identical between the two forms except
 * for the label; both share the same `disabled` condition
 * (`!fechaInicio || !fechaFin`).
 */
function OpenCheckpointTrigger({
  label,
  disabled,
  onRequestConfirm,
  onCancel,
  submitButtonRef,
}: {
  label: string;
  disabled: boolean;
  onRequestConfirm: () => void;
  onCancel: () => void;
  submitButtonRef: React.RefObject<HTMLButtonElement>;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        ref={submitButtonRef}
        variant="primary"
        onClick={onRequestConfirm}
        disabled={disabled}
      >
        <CreditCard size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        {label}
      </Button>
      <Button variant="tertiary" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

function RenewPaymentForm({
  membership,
  personaId,
  coverageEnd,
  hasPendingPago,
  /**
   * Open the form without a click, for a reader who arrived from the home
   * screen's "Registrar un pago" band (`/student/payments?registrar=1`).
   *
   * The caller only flips this to `true` once the payment history has loaded:
   * `handleOpen` seeds `fechaInicio` from `coverageEnd` so a family paying
   * early does not lose the days they already paid for, and `coverageEnd` is
   * `null` until the history arrives.
   */
  autoOpen,
  studentName,
  /**
   * The active benefit's percentage, or `null` — issue #400 slice 06. Only
   * feeds the CLIENT-SIDE preview total (`estimateTotal`); the request this
   * form sends never carries it, same as it never carried `monto`. A 100%
   * benefit never reaches this component: `PaymentsContent` renders
   * `ApplyBenefitForm` instead in that case.
   */
  beneficioPorcentaje,
  onRegistered,
}: {
  membership: MembershipSummary;
  personaId: string;
  coverageEnd: string | null;
  hasPendingPago: boolean;
  autoOpen: boolean;
  studentName: string | null;
  beneficioPorcentaje: number | null;
  onRegistered: () => void;
}): React.ReactElement {
  /** Issue #400: a discrete month count, never a typed monto. */
  const [months, setMonths] = useState<number>(MESES_MINIMO);
  const [tipoPago, setTipoPago] = useState<"EFECTIVO" | "TRANSFERENCIA">("TRANSFERENCIA");
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [voucherFile, setVoucherFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showSuccess, showWarning } = useToast();

  const monthlyPrice = Number(membership.montoAplicado ?? "") || 0;
  /** What the checkpoint shows BEFORE confirming — a preview, not the authoritative total (see `estimateTotal`). */
  const estimatedTotal = estimateTotal(monthlyPrice, months, beneficioPorcentaje);

  /**
   * Coverage resumes where the paid period ends, not today — otherwise a family
   * paying early loses the days they already paid for. `coverageEnd` is the
   * furthest approved `fechaFin`; `membership.fechaFin`, which the old form
   * read, never reaches this client.
   */
  const fechaFin = useMemo(
    () => (fechaInicio ? addMonthsIso(fechaInicio, months) : ""),
    [fechaInicio, months],
  );

  const seedForm = useCallback((): void => {
    setVoucherFile(null);
    setMonths(MESES_MINIMO);
    // Both sides must be CALENDAR dates before they are compared: mixing an
    // instant with a noon-anchored date made the comparison depend on the
    // hour of day.
    const today = clubToday();
    const paidThrough = coverageEnd ? fromIsoDate(coverageEnd) : null;
    setFechaInicio(
      calendarIsoDate(paidThrough && paidThrough.getTime() > today.getTime() ? paidThrough : today),
    );
  }, [coverageEnd]);

  /** The first thing wrong with the form as it stands, or `null`. */
  function findProblem(): string | null {
    if (!fechaInicio || !fechaFin) return "No se pudo calcular el período que cubre este pago.";
    if (tipoPago === "TRANSFERENCIA" && !voucherFile) {
      return "Adjunte el comprobante de la transferencia para que el club pueda validarla.";
    }
    return null;
  }

  const action = useConfirmedAction({
    autoOpen,
    blocked: hasPendingPago,
    onOpen: seedForm,
    findProblem,
  });

  function handleCancel(): void {
    action.handleCancel();
    setVoucherFile(null);
  }

  /**
   * Issue #482: `accept` on the voucher `<input>` only filters the OS
   * picker's own dropdown — a reader who switches it to "All Files" can
   * still pick a `.txt`. Reject it here, the moment it is selected, instead
   * of letting `registrarPago` succeed and only failing the follow-up
   * `subirVoucherPago` call once the backend's own content-type check does.
   */
  function handleVoucherChange(file: File | null): void {
    if (file) {
      const typeError = voucherFileTypeError(file);
      if (typeError) {
        setVoucherFile(null);
        action.setError(typeError);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    }
    setVoucherFile(file);
    action.setError(null);
  }

  async function handleSubmit(): Promise<void> {
    // Re-checked rather than trusted: the fields stay live behind the
    // checkpoint, so the summary always describes what will actually be sent.
    const problem = findProblem();
    if (problem) {
      action.setError(problem);
      action.setConfirming(false);
      return;
    }

    action.setLoading(true);
    action.setError(null);

    let nuevoPago: PagoPersona;
    try {
      // No fechaInicio/fechaFin (fix período de cobertura, PAG-5): el
      // backend las calcula solo, a partir de `meses`. Las variables
      // locales siguen existiendo -- son la vista previa que ve el lector
      // antes de confirmar -- pero ya no viajan en la petición.
      //
      // `meses` reemplaza a `monto` (issue #400): el backend ya no recibe
      // un monto libre, sino la cantidad de meses que el usuario eligió con
      // `MonthCountField` — ya no hay nada que parsear ni validar como
      // "múltiplo del valor mensual", el selector solo permite enteros.
      nuevoPago = await registrarPago({
        meses: months,
        tipoPago,
        personaId: Number(personaId),
        membresiaId: membership.id,
      } satisfies RegistrarPagoInput);
    } catch (err) {
      action.setError(toUserMessage(err, "No se pudo registrar el pago."));
      action.setLoading(false);
      return;
    }

    // The payment exists in the database from this point on, and it is not
    // reverted if the voucher fails to attach (decisiones-de-negocio
    // §7 — the owner's call, not this screen's). Reoffering "Confirmar y
    // registrar" here used to call registrarPago() again and collide with
    // the payment it had just created ("ya tiene un pago pendiente") — the
    // ghost-payment bug this closes (PAG-1). Instead the form gets out of
    // the way and the payment survives in the history, marked as missing
    // its voucher, with its own upload control (`PagoActionSlot`).
    if (voucherFile && nuevoPago?.id) {
      try {
        await subirVoucherPago(nuevoPago.id, voucherFile);
      } catch (err) {
        action.setShowForm(false);
        action.setConfirming(false);
        setVoucherFile(null);
        action.setLoading(false);
        showWarning(
          studentName
            ? `El pago de ${studentName} se registró, pero no pudimos subir el comprobante`
            : "Su pago se registró, pero no pudimos subir el comprobante",
          {
            description: `${toUserMessage(err, "No pudimos subir el comprobante.")} Súbalo desde el historial para que el club pueda validarlo.`,
          },
        );
        onRegistered();
        return;
      }
    }

    action.setShowForm(false);
    action.setConfirming(false);
    setVoucherFile(null);
    // What happened, and what to do if it was wrong. There is no "Deshacer"
    // to offer (see the block comment above this component), so the toast
    // says plainly where the recovery actually lives. `nuevoPago.monto` is
    // the REAL, authoritative amount the backend registered (issue #400
    // slice 06) — `estimatedTotal` above is only the preview shown before
    // confirming, and the two can differ when a partial or fixed-amount
    // benefit applies.
    showSuccess(
      studentName
        ? `Pago de ${studentName} registrado y en revisión`
        : "Pago registrado y en revisión",
      {
        description: `${formatCurrency(nuevoPago.monto)} por el período ${formatDateRange(fechaInicio, fechaFin)}. El club lo valida; si algo está mal lo rechaza indicando el motivo y usted registra el pago correcto.`,
      },
    );
    onRegistered();
    action.setLoading(false);
  }

  if (hasPendingPago) {
    return (
      <p className="text-sm text-ink-2">
        {studentName
          ? `Ya hay un pago de ${studentName} esperando validación. Espere a que el club lo apruebe para registrar otro.`
          : "Ya tiene un pago esperando validación. Espere a que el club lo apruebe para registrar otro."}
      </p>
    );
  }

  if (!action.showForm) {
    return (
      <Button variant="primary" onClick={action.open}>
        <Plus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        {studentName ? `Registrar un pago de ${studentName}` : "Registrar un pago"}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {studentName && (
        <p className="text-sm text-ink-2">
          Este pago se registra a nombre de <b className="font-semibold text-ink">{studentName}</b>.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <MonthCountField value={months} onChange={setMonths} disabled={action.loading} />
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASSES}>Forma de pago</span>
          <select
            value={tipoPago}
            onChange={(e) => {
              const value = e.target.value as "EFECTIVO" | "TRANSFERENCIA";
              setTipoPago(value);
              // findProblem() reported "falta el comprobante" against the
              // FORM STATE AT THAT MOMENT — switching to EFECTIVO removes
              // the field the alert refers to, but nothing was previously
              // re-running findProblem() to also clear the stale message
              // (issue #488), so it hung around until the next submit
              // attempt pointing at a field no longer on screen.
              if (value !== "TRANSFERENCIA") {
                setVoucherFile(null);
                action.setError(null);
              }
            }}
            className={FIELD_CLASSES}
          >
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="EFECTIVO">Efectivo</option>
          </select>
        </label>
      </div>

      {/* The consequence of the months chosen, stated before the reader commits to it. */}
      <div className="rounded-ctl bg-sunken px-3.5 py-3">
        <p className="text-2xs font-bold uppercase text-ink-3-strong">
          Período que cubre
        </p>
        <p className="mt-1 text-sm font-bold tabular-nums text-ink">
          {fechaInicio && fechaFin ? formatDateRange(fechaInicio, fechaFin) : "—"}
        </p>
        <p className="mt-0.5 text-xs text-ink-3-strong">
          {months === 1 ? "1 mes" : `${months} meses`} a {formatCurrency(monthlyPrice)} por mes.
        </p>
        {/* Issue #400 slice 06: labelled "estimado" on purpose — this is a
            client-side preview (`estimateTotal`), never what the backend
            was sent (it only ever receives `meses`). The real total is
            `nuevoPago.monto`, shown in the success toast once registered. */}
        <p className="mt-1.5 text-sm font-bold tabular-nums text-ink">
          Total estimado: {formatCurrency(estimatedTotal)}
        </p>
      </div>

      {tipoPago === "TRANSFERENCIA" && (
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASSES}>Comprobante</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => handleVoucherChange(e.target.files?.[0] ?? null)}
              className="hidden"
              data-testid="renew-voucher-input"
            />
            <Button onClick={() => fileInputRef.current?.click()}>
              <Upload size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              {voucherFile ? "Cambiar archivo" : "Seleccionar archivo"}
            </Button>
            {voucherFile && (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-ink-2">
                <Paperclip size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                <span className="truncate">{voucherFile.name}</span>
                {/* The only way back from attaching the wrong file, and it
                    shipped as a bare 14px glyph in an unpadded button — a
                    14x14 target against the 24x24 of WCAG 2.2 SC 2.5.8.
                    `h-6 w-6` with the glyph centred is hit area only; the ✕
                    itself is still 14px. */}
                <button
                  type="button"
                  onClick={() => setVoucherFile(null)}
                  aria-label="Quitar el comprobante seleccionado"
                  className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-ink-3 hover:text-state-bad"
                >
                  <X size={ICON.sm} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
          <span className="text-xs text-ink-3-strong">PDF, JPG o PNG — máximo 5 MB.</span>
        </div>
      )}

      {/*
       * Issue #400 (slice 06): the PAG-5 live-preview this used to need
       * ("a monto that doesn't close") is gone along with the monto field —
       * `MonthCountField` cannot produce an invalid `months`, so the only
       * remaining `findProblem()` case (a TRANSFERENCIA with no voucher yet)
       * is fine to hold behind an actual submit attempt, same as the API
       * failure branch it shares this alert with.
       */}
      {action.error && (
        <p role="alert" className="text-sm font-semibold text-state-bad">
          {action.error}
        </p>
      )}

      {action.confirming ? (
        /* The checkpoint sits where the submit button was, so it lands under
           the eye that just clicked, with every field it describes still on
           screen and still editable above it. A modal would have dimmed
           exactly the numbers the reader is being asked to check. */
        <div data-testid="renew-confirm" className="rounded-ctl border border-line-2 bg-sunken px-4 py-4">
          <p className="text-2xs font-bold uppercase text-ink-3-strong">
            Confirme antes de registrar
          </p>
          <p id="renew-confirm-summary" className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-ink">
            Va a registrar un total estimado de{" "}
            <b className="font-bold tabular-nums">{formatCurrency(estimatedTotal)}</b>{" "}
            {studentName ? (
              <>
                a nombre de <b className="font-bold">{studentName}</b>
              </>
            ) : (
              "a su nombre"
            )}
            , {tipoPago === "TRANSFERENCIA" ? "por transferencia" : "en efectivo"}, para el período{" "}
            <b className="font-bold tabular-nums">{formatDateRange(fechaInicio, fechaFin)}</b>.
          </p>
          <p className="mt-2 max-w-[68ch] text-xs leading-relaxed text-ink-3-strong">
            Una vez registrado no puede eliminarlo desde el portal. El club revisa cada pago: si
            algo está mal lo rechaza indicando el motivo y usted registra el correcto.
          </p>
          <ConfirmCheckpointActions
            loading={action.loading}
            loadingLabel="Registrando…"
            idleLabel="Confirmar y registrar"
            describedBy="renew-confirm-summary"
            onConfirm={() => void handleSubmit()}
            onBack={action.handleBackToForm}
            confirmButtonRef={action.confirmButtonRef}
          />
        </div>
      ) : (
        <OpenCheckpointTrigger
          label="Registrar pago"
          disabled={!fechaInicio || !fechaFin}
          onRequestConfirm={action.handleRequestConfirm}
          onCancel={handleCancel}
          submitButtonRef={action.submitButtonRef}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Applying a 100% benefit — no Pago, no monto, no voucher (issue #400, slice 06)
//
// `PaymentsContent` renders this INSTEAD of `RenewPaymentForm` when the
// benefit read from `GET /personas/{id}/beneficio` is a 100% percentage
// discount. `POST /membresias/{id}/aplicar-beneficio` grants coverage
// directly with no `Pago` created — the same invariant `HowToPay`'s
// gratuitous branch already states for family gratuity ("no hay ningún
// monto que registrar acá"), here for a personal 100% benefit instead. Same
// two-step checkpoint pattern as `RenewPaymentForm` — `useConfirmedAction`,
// declared right before `RenewPaymentForm` above, is what the two share.
// ---------------------------------------------------------------------------

function ApplyBenefitForm({
  membership,
  personaId,
  coverageEnd,
  hasPendingPago,
  autoOpen,
  studentName,
  onRegistered,
}: {
  membership: MembershipSummary;
  personaId: string;
  coverageEnd: string | null;
  hasPendingPago: boolean;
  autoOpen: boolean;
  studentName: string | null;
  onRegistered: () => void;
}): React.ReactElement {
  const [months, setMonths] = useState<number>(MESES_MINIMO);
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const { showSuccess } = useToast();

  const fechaFin = useMemo(
    () => (fechaInicio ? addMonthsIso(fechaInicio, months) : ""),
    [fechaInicio, months],
  );

  const seedForm = useCallback((): void => {
    setMonths(MESES_MINIMO);
    const today = clubToday();
    const paidThrough = coverageEnd ? fromIsoDate(coverageEnd) : null;
    setFechaInicio(
      calendarIsoDate(paidThrough && paidThrough.getTime() > today.getTime() ? paidThrough : today),
    );
  }, [coverageEnd]);

  function findProblem(): string | null {
    if (!fechaInicio || !fechaFin) return "No se pudo calcular el período que cubre este beneficio.";
    return null;
  }

  const action = useConfirmedAction({
    autoOpen,
    blocked: hasPendingPago,
    onOpen: seedForm,
    findProblem,
  });

  async function handleSubmit(): Promise<void> {
    action.setLoading(true);
    action.setError(null);

    let cobertura: CoberturaBonificada;
    try {
      cobertura = await aplicarBeneficio(membership.id, months);
    } catch (err) {
      action.setError(toUserMessage(err, "No se pudo aplicar el beneficio."));
      action.setConfirming(false);
      action.setLoading(false);
      return;
    }

    action.setShowForm(false);
    action.setConfirming(false);
    action.setLoading(false);
    // `cobertura.fechaInicio`/`fechaFin` are the REAL, authoritative period —
    // same reasoning `RenewPaymentForm` uses `nuevoPago.monto` for the
    // success toast rather than a client-side preview.
    showSuccess(
      studentName
        ? `Beneficio de ${studentName} aplicado — cobertura activa`
        : "Beneficio aplicado — cobertura activa",
      {
        description: `Cubre el período ${formatDateRange(cobertura.fechaInicio, cobertura.fechaFin)}. No se generó ningún pago: el beneficio cubrió el 100%.`,
      },
    );
    onRegistered();
  }

  if (hasPendingPago) {
    return (
      <p className="text-sm text-ink-2">
        {studentName
          ? `Ya hay un pago de ${studentName} esperando validación. Espere a que el club lo resuelva antes de aplicar el beneficio.`
          : "Ya tiene un pago esperando validación. Espere a que el club lo resuelva antes de aplicar el beneficio."}
      </p>
    );
  }

  if (!action.showForm) {
    return (
      <Button variant="primary" onClick={action.open}>
        <CreditCard size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        {studentName ? `Aplicar el beneficio de ${studentName}` : "Aplicar mi beneficio"}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {studentName && (
        <p className="text-sm text-ink-2">
          Este beneficio se aplica a nombre de <b className="font-semibold text-ink">{studentName}</b>.
        </p>
      )}

      <MonthCountField value={months} onChange={setMonths} disabled={action.loading} />

      <div className="rounded-ctl bg-sunken px-3.5 py-3">
        <p className="text-2xs font-bold uppercase text-ink-3-strong">Período que cubre</p>
        <p className="mt-1 text-sm font-bold tabular-nums text-ink">
          {fechaInicio && fechaFin ? formatDateRange(fechaInicio, fechaFin) : "—"}
        </p>
        <p className="mt-0.5 text-xs text-ink-3-strong">
          {months === 1 ? "1 mes" : `${months} meses`}, sin costo — el beneficio cubre el 100%.
        </p>
      </div>

      {action.error && (
        <p role="alert" className="text-sm font-semibold text-state-bad">
          {action.error}
        </p>
      )}

      {action.confirming ? (
        <div data-testid="benefit-confirm" className="rounded-ctl border border-line-2 bg-sunken px-4 py-4">
          <p className="text-2xs font-bold uppercase text-ink-3-strong">Confirme antes de aplicar</p>
          <p id="benefit-confirm-summary" className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-ink">
            Va a aplicar su beneficio del 100%{" "}
            {studentName ? (
              <>
                a nombre de <b className="font-bold">{studentName}</b>
              </>
            ) : (
              "a su nombre"
            )}
            , para el período{" "}
            <b className="font-bold tabular-nums">{formatDateRange(fechaInicio, fechaFin)}</b>. No se
            genera ningún pago ni comprobante.
          </p>
          <p className="mt-2 max-w-[68ch] text-xs leading-relaxed text-ink-3-strong">
            La cobertura queda activa de inmediato. Una vez aplicado no puede deshacerlo desde el
            portal.
          </p>
          <ConfirmCheckpointActions
            loading={action.loading}
            loadingLabel="Aplicando…"
            idleLabel="Confirmar y aplicar"
            describedBy="benefit-confirm-summary"
            onConfirm={() => void handleSubmit()}
            onBack={action.handleBackToForm}
            confirmButtonRef={action.confirmButtonRef}
          />
        </div>
      ) : (
        <OpenCheckpointTrigger
          label="Aplicar beneficio"
          disabled={!fechaInicio || !fechaFin}
          onRequestConfirm={action.handleRequestConfirm}
          onCancel={action.handleCancel}
          submitButtonRef={action.submitButtonRef}
        />
      )}
    </div>
  );
}

/**
 * Picks `ApplyBenefitForm` or `RenewPaymentForm` — the six fields the two
 * forms share (`membership`…`onRegistered`, minus `beneficioPorcentaje`,
 * which only `RenewPaymentForm` reads) travel once via `...common` instead
 * of being repeated in both JSX call sites in `PaymentsContent` (SonarCloud
 * flagged that repetition on PR #438 too).
 */
function PaymentOrBenefitForm({
  isFullBenefit,
  beneficioPorcentaje,
  ...common
}: {
  membership: MembershipSummary;
  personaId: string;
  coverageEnd: string | null;
  hasPendingPago: boolean;
  autoOpen: boolean;
  studentName: string | null;
  onRegistered: () => void;
  /**
   * A 100% PERCENTAGE benefit: self-service coverage grant, no Pago, no
   * monto, no voucher — see `ApplyBenefitForm`'s header comment for why this
   * replaces the payment form entirely rather than folding into it.
   */
  isFullBenefit: boolean;
  beneficioPorcentaje: number | null;
}): React.ReactElement {
  if (isFullBenefit) {
    return <ApplyBenefitForm {...common} />;
  }
  return <RenewPaymentForm {...common} beneficioPorcentaje={beneficioPorcentaje} />;
}

// ---------------------------------------------------------------------------
// Confirm before the voucher actually uploads (issue #463)
// ---------------------------------------------------------------------------

/**
 * The step between picking a file in the OS dialog and actually sending it:
 * name, size, and the image itself when it is one (a PDF gets a plain
 * attachment icon instead — there is nothing to thumbnail). Nothing here
 * calls the API; `onConfirm`/`onCancel` are the caller's own.
 */
function VoucherUploadPreview({
  file,
  previewUrl,
  uploading,
  onConfirm,
  onCancel,
}: {
  file: File;
  /** An object URL for `file`, or `null` when it is not an image. */
  previewUrl: string | null;
  uploading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <div className="card flex flex-col gap-3 p-4" role="group" aria-label="Confirmar comprobante antes de subir">
      <div className="flex items-center gap-3">
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt=""
            className="h-16 w-16 shrink-0 rounded-ctl object-cover"
          />
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-ctl bg-sunken">
            <Paperclip size={ICON.lg} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{file.name}</p>
          <p className="text-xs text-ink-3">{formatFileSize(file.size)}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={onConfirm} disabled={uploading}>
          {uploading ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          {uploading ? "Subiendo…" : "Confirmar y subir"}
        </Button>
        <Button size="sm" onClick={onCancel} disabled={uploading}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One payment in the history — issue #513: ported to the table+accordion
// pattern `/payments` (the admin validation queue) already uses, via the
// SAME `ResponsiveList`/`Table*`/`Badge` primitives, instead of the flat
// `<ul>` of cards this screen had on its own. Nothing about a payment's
// DATA changes here — amount, discount, voucher, and rejection reason are
// still exactly what `payments-utils.ts` derives; only where each one lives
// (row vs. accordion) does.
// ---------------------------------------------------------------------------

/** The row facts every rendering (table row, mobile card) reads the same way. */
interface PagoRowFields {
  amount: string;
  estado: { label: string; tone: BadgeTone };
  faltaComprobante: boolean;
  method: string;
  period: string;
  /** When the payment was registered — kept on the row itself (a `Método`
   *  sub-line, same two-line shape `TableNameCell` uses elsewhere), not
   *  folded into the accordion: every payment has one, so hiding it behind
   *  detail would have forced a toggle onto rows with nothing else to show. */
  registeredOn: string;
}

function buildPagoRowFields(pago: PagoPersona): PagoRowFields {
  return {
    registeredOn: formatDate(pago.fechaRegistro),
    amount: formatPagoMonto(pago.monto),
    estado: describePagoEstado(pago.estadoPago),
    faltaComprobante: pagoFaltaComprobante(pago),
    method: TIPO_PAGO_LABEL[pago.tipoPago],
    period: formatDateRange(pago.fechaInicio, pago.fechaFin),
  };
}

/**
 * Whether a payment has anything to say behind the accordion at all — the
 * discount, either comprobante, a rejection reason, or the no-voucher
 * exception. Most payments have none of these, and a row with nothing to
 * expand gets no toggle rather than an empty disclosure.
 */
function pagoHasDetail(pago: PagoPersona): boolean {
  return (
    describePagoDescuento(pago) != null ||
    Boolean(pago.voucherUrl) ||
    Boolean(pago.comprobanteOficialUrl) ||
    (pago.estadoPago === "RECHAZADO" && Boolean(pago.motivoRechazo)) ||
    Boolean(pago.motivoExcepcionSinComprobante)
  );
}

/**
 * The secondary facts a payment can have to explain itself — discount,
 * either comprobante, and a rejection reason — behind the per-row
 * accordion now (issue #513, Propuesta A), instead of always inline. The
 * data itself is untouched: same three fields `describePagoDescuento`
 * always derived, same two comprobante links, same rejection paragraph.
 */
function PagoDetailPanel({ pago }: { pago: PagoPersona }): React.ReactElement {
  // `null` en la enorme mayoría de los pagos, y entonces no se dibuja nada.
  const descuento = describePagoDescuento(pago);

  return (
    <div className="flex flex-col gap-2">
      {/* Por qué el monto de la fila es el que es.
       *
       * Hallazgo de QA humana (17/08/2026): «a la hora de pagar no se me
       * muestra el apartado de descuentos». El club ya aplicaba descuentos y
       * el backend ya los congelaba en el pago — lo que faltaba era el lado
       * del socio, que veía un monto final sin explicación. Un monto solo es
       * lo que genera el reclamo. */}
      {descuento && (
        <div data-testid="pago-descuento" className="rounded-ctl bg-sunken px-3.5 py-2.5">
          <p className="text-2xs font-bold uppercase text-ink-3-strong">
            Descuento aplicado por el club
          </p>
          <dl className="mt-1.5 flex flex-wrap gap-x-6 gap-y-field">
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-ink-3-strong">Precio de lista</dt>
              {/* Tachado: es el precio que este pago YA no tuvo. */}
              <dd className="text-xs font-semibold tabular-nums text-ink-3-strong line-through">
                {descuento.precioLista}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-ink-3-strong">Descuento</dt>
              <dd className="text-xs font-semibold tabular-nums text-ink-2">
                {/* U+2212 (signo menos), no un guión: es un número negativo,
                    y en tabular-nums alinea con las cifras de al lado. */}
                {descuento.porcentaje
                  ? `−${descuento.descuento} (${descuento.porcentaje})`
                  : `−${descuento.descuento}`}
              </dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt className="text-xs text-ink-3-strong">Monto final</dt>
              <dd className="text-xs font-bold tabular-nums text-ink">{descuento.montoFinal}</dd>
            </div>
          </dl>
        </div>
      )}

      {pago.voucherUrl && (
        <a
          href={pago.voucherUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[24px] items-center gap-1.5 rounded text-xs font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink"
        >
          <Paperclip size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Ver el comprobante
        </a>
      )}

      {/* Comprobante OFICIAL en PDF que el club genera al aprobar (issue
          #400, criterio 8) — distinto del `voucherUrl` de arriba, que es
          la evidencia que el propio socio subió. Solo existe una vez
          aprobado (la condición la impone la fila `ComprobantePago`
          misma, no un chequeo de `estadoPago` acá). */}
      {pago.comprobanteOficialUrl && (
        <a
          href={pago.comprobanteOficialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[24px] items-center gap-1.5 rounded text-xs font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink"
        >
          <Download size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          Descargar comprobante oficial
        </a>
      )}

      {pago.estadoPago === "RECHAZADO" && pago.motivoRechazo && (
        <div className="rounded-ctl bg-state-bad-bg px-3.5 py-2.5">
          <p className="text-2xs font-bold uppercase text-state-bad">Motivo del rechazo</p>
          <p className="mt-0.5 text-sm text-ink-2">{pago.motivoRechazo}</p>
        </div>
      )}

      {/* Issue #459: cuando el club aprobó esta transferencia sin
          comprobante, es una excepción auditada (verificación directa en
          la cuenta del club), no un dato interno silencioso — el socio
          tiene derecho a ver por qué se activó su membresía sin que él
          hubiera subido nada. Mismo tratamiento visual que el bloque de
          descuento (bg-sunken): es información, no un problema que el
          socio deba resolver. */}
      {pago.motivoExcepcionSinComprobante && (
        <div className="rounded-ctl bg-sunken px-3.5 py-2.5">
          <p className="text-2xs font-bold uppercase text-ink-3-strong">
            Aprobado sin comprobante (excepción)
          </p>
          <p className="mt-0.5 text-sm text-ink-2">{pago.motivoExcepcionSinComprobante}</p>
        </div>
      )}
    </div>
  );
}

/**
 * The accordion trigger for one row's detail — same accessibility contract
 * `components/ui/Accordion.tsx` already establishes for this product (a
 * real `<button>`, `aria-expanded`, `aria-controls`, a chevron that rotates
 * rather than carrying the state alone): a keyboard user gets a focusable,
 * announced toggle, not a `<div onClick>`.
 *
 * Not `<Accordion>` itself — that component's shape is a labelled FAQ
 * group (`role="group"` wrapping question/answer pairs), built for
 * `/ayuda`'s static list and not for a `<tr>`/`<li>` whose panel must be a
 * second table row. This reuses its INTERACTION pattern, not its markup.
 */
function PagoDetailToggle({
  panelId,
  isOpen,
  onToggle,
}: {
  panelId: string;
  isOpen: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-controls={panelId}
      onClick={onToggle}
      className="inline-flex h-8 items-center gap-1 rounded-ctl px-2 text-xs font-semibold text-ink-2 hover:bg-sunken"
    >
      Detalle
      <ChevronDown
        size={ICON.sm}
        strokeWidth={2}
        aria-hidden="true"
        className={cn("flex-none transition-transform duration-200", isOpen && "rotate-180")}
      />
    </button>
  );
}

/** The upload button or the "Registrar un pago nuevo" link — the row's one
 *  primary action, never both (a rejected payment cannot upload, and only a
 *  rejected payment gets the link). Stays visible on the row itself, unlike
 *  the read-only facts `PagoDetailPanel` holds: it is something to DO, not
 *  something to explain. */
function PagoActionSlot({
  pago,
  fields,
  onUploadFile,
  uploadingId,
  registerHref,
}: {
  pago: PagoPersona;
  fields: PagoRowFields;
  onUploadFile: (pagoId: number) => void;
  uploadingId: number | null;
  registerHref: string | null;
}): React.ReactElement | null {
  // "Puede subir su comprobante" termina siendo EXACTAMENTE el mismo caso que
  // "Falta el comprobante" marca: TRANSFERENCIA, PENDIENTE_VALIDACION, sin
  // voucherUrl. EFECTIVO nunca tiene comprobante bancario que subir (#452),
  // y un pago ya resuelto (APROBADO/RECHAZADO) no admite adjuntar nada más
  // -- RECHAZADO en particular responde 400 "pendiente de validación" si se
  // lo intenta (#461, confirmado en vivo).
  const canUpload = fields.faltaComprobante;

  if (canUpload) {
    return (
      <Button size="sm" onClick={() => onUploadFile(pago.id)} disabled={uploadingId === pago.id}>
        {uploadingId === pago.id ? (
          <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        )}
        {/* Issue #459: mismo botón, pero el texto ahora distingue la
            primera subida de un reintento — ver el comentario original en
            el historial de este archivo para el porqué. */}
        {uploadingId === pago.id ? "Subiendo…" : "Reintentar subir comprobante"}
      </Button>
    );
  }

  // Issue #461: un pago RECHAZADO es una decisión ya tomada por el club --
  // no admite adjuntar nada más (el backend responde 400 si se lo intenta,
  // confirmado en vivo). Esta es la única salida real que la fila ofrece en
  // su lugar.
  if (pago.estadoPago === "RECHAZADO" && registerHref) {
    return (
      <Link
        href={registerHref}
        className="inline-flex text-xs font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink"
      >
        Registrar un pago nuevo
      </Link>
    );
  }

  return null;
}

const PAGO_TABLE_COLUMN_COUNT = 5;

/**
 * The desktop table row — `renderRow` returns the COMPLETE row markup, same
 * contract `ResponsiveList`'s own doc comment describes for `/members`'
 * `AccountRow`: a summary `<TableRow>` plus, when this payment has detail to
 * show, a second `<TableRow>` holding the accordion panel, spanning every
 * column. Collapsed by default (`isOpen` starts `false` in `PaymentsContent`)
 * — the accordion the issue asks for, "cerrado por defecto por fila".
 */
function PagoTableRow({
  pago,
  isOpen,
  onToggleDetail,
  onUploadFile,
  uploadingId,
  registerHref,
}: {
  pago: PagoPersona;
  isOpen: boolean;
  onToggleDetail: () => void;
  onUploadFile: (pagoId: number) => void;
  uploadingId: number | null;
  registerHref: string | null;
}): React.ReactElement {
  const fields = buildPagoRowFields(pago);
  const hasDetail = pagoHasDetail(pago);
  const panelId = `pago-detail-desktop-${pago.id}`;

  return (
    <>
      <TableRow>
        <TableCell type="badge">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={fields.estado.tone}>{fields.estado.label}</Badge>
            {/* Distinct from an ordinary "awaiting validation" row: this is
                the payment a failed voucher upload left behind. The owner's
                call (decisiones §7) keeps it, marked, instead of reverting
                it. */}
            {fields.faltaComprobante && <Badge tone="bad">Falta el comprobante</Badge>}
          </div>
        </TableCell>
        <TableCell type="number">{fields.amount}</TableCell>
        <TableCell type="text">{fields.period}</TableCell>
        <TableCell type="text">
          <span className="block">{fields.method}</span>
          <span className="mt-px block text-2xs tracking-flat text-ink-3">
            Registrado el <span className="tabular-nums">{fields.registeredOn}</span>
          </span>
        </TableCell>
        <TableCell type="action">
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <PagoActionSlot
              pago={pago}
              fields={fields}
              onUploadFile={onUploadFile}
              uploadingId={uploadingId}
              registerHref={registerHref}
            />
            {hasDetail && (
              <PagoDetailToggle panelId={panelId} isOpen={isOpen} onToggle={onToggleDetail} />
            )}
          </div>
        </TableCell>
      </TableRow>
      {hasDetail && (
        <TableRow hidden={!isOpen}>
          <TableCell colSpan={PAGO_TABLE_COLUMN_COUNT} id={panelId} className="bg-sunken">
            <PagoDetailPanel pago={pago} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/** The mobile card — same facts as `PagoTableRow`, same accordion contract,
 *  in a `<li>` instead of a table row pair. */
function PagoCard({
  pago,
  isOpen,
  onToggleDetail,
  onUploadFile,
  uploadingId,
  registerHref,
}: {
  pago: PagoPersona;
  isOpen: boolean;
  onToggleDetail: () => void;
  onUploadFile: (pagoId: number) => void;
  uploadingId: number | null;
  registerHref: string | null;
}): React.ReactElement {
  const fields = buildPagoRowFields(pago);
  const hasDetail = pagoHasDetail(pago);
  const panelId = `pago-detail-mobile-${pago.id}`;

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-field">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-base font-bold tabular-nums text-ink">{fields.amount}</span>
            <Badge tone={fields.estado.tone}>{fields.estado.label}</Badge>
            {fields.faltaComprobante && <Badge tone="bad">Falta el comprobante</Badge>}
          </div>
          <p className="mt-1 text-xs text-ink-3-strong">
            {fields.method} · Registrado el{" "}
            <span className="tabular-nums">{fields.registeredOn}</span> · Cubre{" "}
            <span className="tabular-nums">{fields.period}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PagoActionSlot
            pago={pago}
            fields={fields}
            onUploadFile={onUploadFile}
            uploadingId={uploadingId}
            registerHref={registerHref}
          />
          {hasDetail && (
            <PagoDetailToggle panelId={panelId} isOpen={isOpen} onToggle={onToggleDetail} />
          )}
        </div>
      </div>
      {hasDetail && (
        <div id={panelId} hidden={!isOpen}>
          <PagoDetailPanel pago={pago} />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------

function PaymentsContent({
  data,
  hasAlumnoRole,
  accountPersonaId,
  /** True when the reader arrived from the home band's "Registrar un pago". */
  wantsRegisterForm,
  onRegistered,
}: {
  data: StudentPortalSummary;
  hasAlumnoRole: boolean;
  /** The persona behind the SESSION — not the profile being viewed. */
  accountPersonaId: string;
  wantsRegisterForm: boolean;
  onRegistered: () => void;
}): React.ReactElement {
  const { managedProfiles, selectedId, setSelectedId, selectedProfile } = useManagedProfiles(
    data,
    hasAlumnoRole,
    accountPersonaId,
  );

  const [reloadToken, setReloadToken] = useState(0);
  /**
   * A family checking "¿me aprobaron el pago?" comes back to the same filter
   * every time. Remembering it is the whole difference between one glance and
   * three taps.
   */
  const [filter, setFilter] = usePersistentPreference<PagoStatusFilter>(
    "student-payments-filter",
    "TODOS",
    isPagoStatusFilter,
  );
  const [pagosState, setPagosState] = useState<PagosLoadState>({ status: "loading" });
  /**
   * Which payments' accordion detail is open — issue #513: closed by
   * default per row, so a fresh visit shows every row collapsed. Keyed by
   * `Pago.id`, shared between the desktop table and mobile card renderings
   * of the SAME row (`ResponsiveList` mounts both at once; they are the
   * same logical row, so opening one opens the other, even though only one
   * is visible at a time).
   */
  const [openPagoDetailIds, setOpenPagoDetailIds] = useState<ReadonlySet<number>>(new Set());
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploadPagoId, setPendingUploadPagoId] = useState<number | null>(null);
  /** Issue #463 — the file staged by the OS picker, awaiting an explicit
   *  "Confirmar y subir" before `subirVoucherPago` ever runs. */
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  /** Object URL for `previewFile`'s thumbnail — only set for an image, and
   *  always revoked, either when a new file replaces it or on unmount. */
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!previewFile || !previewFile.type.startsWith("image/")) {
      setPreviewObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewFile);
    setPreviewObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  const selectedPersonaId = selectedProfile?.personaId ?? null;

  /**
   * A minor cannot register a payment on their OWN account — but their
   * representative can, from theirs, and the backend agrees: `registrarPago`
   * authorizes "the owner, their representative, or an ADMINISTRADOR" at the
   * service layer.
   *
   * The gate used to read `isMinor(selectedProfile)` alone, which locked a
   * guardian out of paying for their own child — the single most common thing
   * a representante account exists to do — and told them to ask the minor's
   * representative, i.e. themselves.
   */
  const viewingOwnProfile = selectedPersonaId !== null && selectedPersonaId === accountPersonaId;
  const blockedAsMinor = viewingOwnProfile && isMinor(selectedProfile?.fechaNacimiento);

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
          message:
            toUserMessage(error, "No se pudo cargar el historial de pagos."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId, reloadToken]);

  /**
   * The active benefit, read BEFORE the reader pays (issue #400, slice 06).
   *
   * A failure here is swallowed to `null` rather than surfaced as a blocking
   * error: this is an enrichment of the payment screen, not its core job —
   * the reader can still register a normal payment even if this particular
   * read fails, exactly the same reasoning `resolveCoverageEnd` gets from an
   * empty `pagos` array rather than an error state.
   */
  const [beneficio, setBeneficio] = useState<BeneficioAsignado | null>(null);
  useEffect(() => {
    if (!selectedPersonaId) {
      setBeneficio(null);
      return;
    }
    let cancelled = false;
    fetchBeneficio(Number(selectedPersonaId))
      .then((activo) => {
        if (!cancelled) setBeneficio(activo);
      })
      .catch(() => {
        if (!cancelled) setBeneficio(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPersonaId, reloadToken]);

  const beneficioPorcentaje =
    beneficio?.descuento.porcentaje != null ? Number(beneficio.descuento.porcentaje) : null;
  /**
   * A 100% PERCENTAGE benefit swaps the payment form for `ApplyBenefitForm`
   * (no monto, no tipoPago, no voucher — a 100% benefit never creates a
   * `Pago`). A fixed-amount (`monto`) benefit that happens to cover the
   * period exactly is still resolved by `registrarPago`'s normal path on the
   * backend (`CoberturaBonificadaResponseDTO`'s own docstring: "100%" is a
   * property of the PAIR, not the assignment alone) — this client-side gate
   * only recognizes the simple, always-100% case: a percentage discount of
   * exactly 100.
   */
  const isFullBenefit = beneficioPorcentaje != null && Number.isFinite(beneficioPorcentaje) && beneficioPorcentaje === 100;

  // Memoised so the empty-list branch does not hand a fresh array to the three
  // derivations below on every render.
  const pagos = useMemo(
    () => (pagosState.status === "ready" ? pagosState.pagos : NO_PAGOS),
    [pagosState],
  );
  const coverageEnd = useMemo(() => resolveCoverageEnd(pagos), [pagos]);
  const counts = useMemo(() => countPagosByStatus(pagos), [pagos]);
  const filteredPagos = useMemo(
    () => sortPagosByDate(filterPagosByStatus(pagos, filter)),
    [pagos, filter],
  );
  const hasPendingPago = pagos.some((pago) => pago.estadoPago === "PENDIENTE_VALIDACION");

  /**
   * The dependent's given name, or `null` when the reader IS the student.
   *
   * Everything on this screen that used to say "su" says this instead when it
   * is somebody else's money and somebody else's coverage.
   */
  const studentName = viewingOwnProfile ? null : firstNameOf(selectedProfile?.nombres ?? "");

  /**
   * The same reading the home screen's band shows, from the same function.
   *
   * This screen only borrows two things from it — the sentence a blocked minor
   * gets, and nothing else — because the `MembershipCard` right below already
   * carries the coverage date and the price in the shape this screen owns.
   * What matters is that the two screens can no longer disagree about who a
   * minor should turn to.
   */
  const situation = describePaymentSituation({
    studentName: studentName ?? firstNameOf(selectedProfile?.nombres ?? ""),
    viewingOwnProfile,
    blockedAsMinor,
    representanteName: selectedProfile?.representante
      ? `${selectedProfile.representante.nombres} ${selectedProfile.representante.apellidos}`.trim()
      : null,
    hasMembership: selectedProfile?.membership != null,
    planName: selectedProfile?.membership?.categoria ?? null,
    monthlyPrice: selectedProfile?.membership?.montoAplicado ?? null,
    coverageEnd,
    pendingCount: pagos.filter((pago) => pago.estadoPago === "PENDIENTE_VALIDACION").length,
    esGratuidadFamiliar: selectedProfile?.membership?.esGratuidadFamiliar ?? false,
  });

  /**
   * Issue #400 (slice 4c-b): the amount-driven renewal form below
   * (`RenewPaymentForm`) asks for a monto and derives months from it —
   * there is no honest monto to ask a gratuitous member for, since the
   * charge is $0 regardless of `membership.montoAplicado` (the real
   * tariff, which this slice stopped zeroing). Rather than redesign the
   * form around a months-only input, this reader gets the same "blocked,
   * with an explanation" treatment `blockedAsMinor` already gets below.
   */
  const isGratuitous = selectedProfile?.membership?.esGratuidadFamiliar ?? false;

  /**
   * Whether the form above is actually reachable for this reader — the only
   * condition under which the empty history may offer "Registrar un pago" as
   * its way out (D11). It restates the four gates `RenewPaymentForm` already
   * applies, in the order it applies them: a minor on their own account never
   * registers, a persona with no `Membresia` has nothing to renew, a
   * gratuitous membership has nothing to pay, and a pending payment blocks a
   * second one until the club rules on it.
   */
  const canRegisterHere =
    !blockedAsMinor && selectedProfile?.membership != null && !isGratuitous && !hasPendingPago;

  /**
   * Issue #461: the same door D11's empty-state action already opens,
   * offered again from a REJECTED payment's own row — the one real next
   * step once that row stops offering "Subir comprobante". `null` under the
   * same gates `canRegisterHere` already applies: a rejected row is not the
   * place to promise a form the reader cannot actually reach.
   */
  const registerHref =
    canRegisterHere && selectedProfile
      ? withSelectedStudent("/student/payments?registrar=1", selectedProfile.personaId)
      : null;

  function handleSelectFile(pagoId: number): void {
    setUploadError(null);
    setPendingUploadPagoId(pagoId);
    fileInputRef.current?.click();
  }

  function togglePagoDetail(pagoId: number): void {
    setOpenPagoDetailIds((prev) => {
      const next = new Set(prev);
      if (next.has(pagoId)) next.delete(pagoId);
      else next.add(pagoId);
      return next;
    });
  }

  /**
   * Issue #463: picking a file from the OS picker used to fire the real
   * `POST .../voucher` in the same tick as the selection (confirmed live
   * with `browser_network_requests` — no intermediate state existed at all,
   * so a wrong file or a change of mind could only be reacted to AFTER the
   * upload had already happened). This now only stages the file for
   * `VoucherUploadPreview` below; the request fires from
   * `handleConfirmUpload`, never from here.
   */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    // Issue #482: `accept` alone lets a reader pick a `.txt` via "All Files"
    // — caught here before it ever reaches the preview/confirm step below.
    const typeError = voucherFileTypeError(file);
    if (typeError) {
      setUploadError(typeError);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploadError(null);
    setPreviewFile(file);
  }

  async function handleConfirmUpload(): Promise<void> {
    if (!previewFile || !pendingUploadPagoId) return;
    const file = previewFile;
    const pagoId = pendingUploadPagoId;
    setUploadingId(pagoId);
    setUploadError(null);
    try {
      await subirVoucherPago(pagoId, file);
      setReloadToken((n) => n + 1);
    } catch (err) {
      // Inline, not `alert()`: a browser dialog cannot be styled, cannot be
      // read by the surrounding context, and blocks the page it interrupts.
      setUploadError(toUserMessage(err, "No se pudo subir el comprobante."));
    } finally {
      setUploadingId(null);
      setPendingUploadPagoId(null);
      setPreviewFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleCancelUpload(): void {
    setPendingUploadPagoId(null);
    setPreviewFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleRegistered(): void {
    setReloadToken((n) => n + 1);
    onRegistered();
  }

  if (selectedProfile === null) {
    return (
      <EmptyState
        icon={<CreditCard size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title="No se encontraron estudiantes asociados a esta cuenta"
        description="Inscríbase como jugador o agregue un hijo o dependiente para registrar pagos."
        // Issue #460 (Escenario 2): the description already promised "agregue
        // un hijo o dependiente", but the only action here used to be "Ir a mi
        // cuenta" — a dead end for a representative whose child is already
        // registered under someone else. `/student/add-dependent` is where
        // entering that child's real cédula surfaces the existing
        // "Vincular a mi cuenta" button (`DuplicateIdentityHelp`'s
        // `representative` audience) — same pattern `medical-record/page.tsx`'s
        // own empty state already uses for this account state.
        action={
          <Link href="/student/add-dependent" className={buttonClasses("secondary", "sm")}>
            Agregar hijo o dependiente
          </Link>
        }
      />
    );
  }

  return (
    // Full content width, like `/student` and like every admin screen. The
    // 760px cap left the right half of the column empty at 1440; the width now
    // buys a rail that says HOW a payment is made, which is the thing this
    // screen was missing rather than a thing it was too narrow for.
    <>
      <ManagedStudentPicker
        id="student-select-payments"
        profiles={managedProfiles}
        value={selectedId}
        onChange={(id) => {
          setSelectedId(id);
          setFilter("TODOS");
        }}
      />

      {/* One column, not a rail.
       *
       * The rail existed to hold "Cómo se registra un pago", and that block is
       * behind "Ver ayuda" now (D11c — see the note above `HowToPay`). With it
       * gone there is no second column: the membership summary, the filters
       * and the history are one reading order, top to bottom, and it is the
       * same order a phone already got. A 340px column kept for its own sake
       * would be the "rail does not close vertical emptiness" mistake
       * `PAGE_RAIL`'s own doc comment warns about.
       *
       * The disclosure sits directly under the card whose form it explains,
       * not at the top of the page: the question it answers is the one the
       * reader has while looking at "Registrar un pago". */}
      <MembershipCard
        membership={selectedProfile.membership}
        coverageEnd={coverageEnd}
        studentName={studentName}
      >
        {/* Issue #400 (slice 06): shown BEFORE any payment control, blocked
            or not — a reader who cannot pay from here (a minor on their own
            account) can still see whether they have a benefit waiting. */}
        {selectedProfile.membership && !isGratuitous && <BeneficioNote beneficio={beneficio} />}
        {blockedAsMinor ? (
          <p className="text-sm text-ink-2">
            {/* The old copy sent EVERY minor to "su representante" — including
                the ones whose `representanteId` is null, who were being pointed
                at a person the backend does not have. `describePaymentSituation`
                resolves that from the payload. */}
            {situation.detail}
          </p>
        ) : isGratuitous ? (
          // Issue #400 (slice 4c-b): `situation.detail` already carries the
          // gratuity explanation (`describePaymentSituation`'s "gratuitous"
          // kind) — same source `blockedAsMinor` reads above, so the two
          // blocked states read from one place and cannot disagree.
          <p className="text-sm text-ink-2">{situation.detail}</p>
        ) : selectedProfile.membership ? (
          <PaymentOrBenefitForm
            membership={selectedProfile.membership}
            personaId={selectedProfile.personaId}
            coverageEnd={coverageEnd}
            hasPendingPago={hasPendingPago}
            autoOpen={wantsRegisterForm && pagosState.status === "ready"}
            studentName={studentName}
            isFullBenefit={isFullBenefit}
            beneficioPorcentaje={beneficioPorcentaje}
            onRegistered={handleRegistered}
          />
        ) : (
          <p className="text-sm text-ink-2">
            El club crea la membresía al registrar el primer pago. Acérquese a administración para
            activarla y después podrá renovarla desde aquí.
          </p>
        )}
      </MembershipCard>

      <HowToPay
        studentName={studentName}
        blocked={blockedAsMinor}
        gratuitous={isGratuitous}
        hasMembership={selectedProfile.membership != null}
        monthlyPrice={selectedProfile.membership?.montoAplicado ?? null}
      />

      {/* Selection is coal plus the ball dot — `FilterPill` owns that rule.
          The chips used to sit loose on the canvas here too; the portal
          filters through the same panel the admin screens do. */}
      <FilterPanel
        label="Filtros de pagos"
        chips={
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar pagos por estado">
            {FILTERS.map((option) => (
              <FilterPill
                key={option}
                label={PAGO_FILTER_LABELS[option]}
                count={counts[option]}
                active={filter === option}
                onClick={() => setFilter(option)}
              />
            ))}
          </div>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        data-testid="pago-voucher-input"
        onChange={handleFileChange}
      />

      {/* Issue #463: the confirm/cancel step between picking a file and
          actually uploading it — see `handleFileChange`'s comment for why
          this exists. */}
      {previewFile && (
        <VoucherUploadPreview
          file={previewFile}
          previewUrl={previewObjectUrl}
          uploading={uploadingId !== null}
          onConfirm={() => void handleConfirmUpload()}
          onCancel={handleCancelUpload}
        />
      )}

      {uploadError && (
        <p role="alert" className="text-sm font-semibold text-state-bad">
          {uploadError}
        </p>
      )}

      {pagosState.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando sus pagos…" />
        </div>
      )}
      {pagosState.status === "error" && (
        <ErrorState message={pagosState.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {pagosState.status === "ready" && (
        // `flex-1` when — and only when — the list is empty (D11b).
        //
        // Everything above this is a fixed summary; the history is the only
        // block whose height is a function of the family's real record, so it
        // is the one that may claim the height `AppShell`'s `<main>` already
        // reserved. But claiming it unconditionally was measured and rejected:
        // with one payment on file the card stretched to the foot of the
        // window and drew a 200px empty frame under a single row, which is the
        // same emptiness the redesign is closing, moved inside a border and
        // made MORE visible than the canvas it replaced.
        //
        // Empty is the case where stretching earns its keep, because
        // `EmptyState`'s `fill` centres the statement in the box instead of
        // pinning it to the top — the shape `/members` already uses for its
        // own no-results state. It is also the case D11b says to design for
        // first: a socio nuevo has no payments at all.
        <section
          className={cn("flex flex-col", filteredPagos.length === 0 && "flex-1")}
          aria-labelledby="pagos-title"
        >
          <div className="mb-3 flex items-center gap-3">
            <h2 id="pagos-title" className="flex-1 text-sm font-bold text-ink">
              Historial de pagos
            </h2>
            {filteredPagos.length > 0 && (
              <span className="text-xs font-semibold tabular-nums text-ink-3">
                {filteredPagos.length}
              </span>
            )}
          </div>
          {filteredPagos.length === 0 ? (
            <div className="card flex flex-1 flex-col overflow-hidden">
              <EmptyState
                surface="inset"
                fill
                icon={<CreditCard size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
                title={getEmptyStateMessage(filter)}
                description={
                  filter !== "TODOS"
                    ? "Pruebe con otro estado para ver el resto de su historial."
                    : blockedAsMinor
                      ? // "Cuando registre un pago" is an instruction this
                        // reader cannot follow — the club registers it.
                        "Cuando el club registre un pago suyo aparecerá aquí, con el período que cubre."
                      : "Cuando registre un pago aparecerá aquí, junto con el resultado de su validación."
                }
                // D11's third part. The action used to appear ONLY when a filter
                // was on, which is backwards: a filtered empty list is the
                // recoverable case, and the family with no payments at all — the
                // socio nuevo D11b says to design for FIRST — was the one left
                // with nothing to do. `?registrar=1` is the same door the home
                // screen's band already opens, so this adds a way in, not a
                // behaviour.
                action={
                  filter !== "TODOS" ? (
                    <Button size="sm" onClick={() => setFilter("TODOS")}>
                      Ver todos los pagos
                    </Button>
                  ) : canRegisterHere ? (
                    <Link
                      href={withSelectedStudent(
                        "/student/payments?registrar=1",
                        selectedProfile.personaId,
                      )}
                      className={buttonClasses("secondary", "sm")}
                    >
                      {/* Issue #400 slice 06: a 100% benefit has nothing to
                          "registrar" — this door leads to `ApplyBenefitForm`,
                          not `RenewPaymentForm`, so it says so. */}
                      {isFullBenefit ? "Aplicar mi beneficio" : "Registrar un pago"}
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            // Issue #513: the same `ResponsiveList`/`Table*`/`Badge`
            // primitives `/payments` (the admin validation queue) already
            // uses — same `breakpoint`/`order`, so this history keeps
            // whichever DOM-first order that screen already settled on
            // (see `ResponsiveList`'s own doc comment on why that order is
            // not a no-op). `ResponsiveList` supplies its own `card`
            // surface, which is why the title bar above sits outside one.
            <ResponsiveList
              breakpoint="md"
              order="tableFirst"
              tableTestId="student-payments-table"
              cardsTestId="student-payments-cards"
              items={filteredPagos}
              getKey={(pago) => pago.id}
              columns={[
                <TableHeaderCell key="estado" type="badge">Estado</TableHeaderCell>,
                <TableHeaderCell key="monto" type="number">Monto</TableHeaderCell>,
                <TableHeaderCell key="periodo" type="text">Período</TableHeaderCell>,
                <TableHeaderCell key="metodo" type="text">Método</TableHeaderCell>,
                <TableHeaderCell key="accion" type="action">
                  <span className="sr-only">Acción</span>
                </TableHeaderCell>,
              ]}
              renderRow={(pago) => (
                <PagoTableRow
                  pago={pago}
                  isOpen={openPagoDetailIds.has(pago.id)}
                  onToggleDetail={() => togglePagoDetail(pago.id)}
                  onUploadFile={handleSelectFile}
                  uploadingId={uploadingId}
                  registerHref={registerHref}
                />
              )}
              renderCard={(pago) => (
                <PagoCard
                  pago={pago}
                  isOpen={openPagoDetailIds.has(pago.id)}
                  onToggleDetail={() => togglePagoDetail(pago.id)}
                  onUploadFile={handleSelectFile}
                  uploadingId={uploadingId}
                  registerHref={registerHref}
                />
              )}
            />
          )}
        </section>
      )}

    </>
  );
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function PaymentsPageContent(): React.ReactElement {
  const { session } = useAuth();
  const personaId = session?.user.id ?? "";
  const hasAlumnoRole = session?.user.role === "estudiante";
  // `?registrar=1` is the home band's CTA saying "this reader came here to
  // pay" — the form opens itself instead of asking for a third click.
  const wantsRegisterForm = useSearchParams().get("registrar") === "1";

  const [state, setState] = useState<PortalLoadState>({ status: "loading" });
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
          message: toUserMessage(error, "No se pudo cargar la información."),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [personaId, reloadToken]);

  /**
   * True when this ACCOUNT cannot register a payment anywhere on the screen:
   * its own profile is a minor and it manages nobody else. The row-level gate
   * still lives in `PaymentsContent` (it depends on which profile is
   * selected); this is only the page's own promise to its reader.
   */
  const accountCannotRegister =
    state.status === "ready" &&
    state.data.representados.length === 0 &&
    isMinor(state.data.self?.fechaNacimiento);

  return (
    <AppShell
      // "Pagos", not "Mis pagos": the codebase's own rule is that a nav label
      // IS the destination's page title (see `lib/destinations.ts`), and the
      // sidebar row has always said "Pagos". "Mis" was also a lie to the
      // reader this screen most often serves — a representante paying for a
      // dependent, who has no membership of her own.
      title="Pagos"
      // `measure="short"` (D11b). With the "cómo se registra un pago" rail
      // behind "Ver ayuda" this screen is one column, and one column on the
      // product's WIDEST measure is what the rail was hiding: at 1356px the
      // membership card carried "Pagado hasta el 02/09/2026" on the left and
      // 600px of nothing on its right, and a payment row — an amount, a badge
      // and one meta line — ran the full width for the same reason. The
      // horizontal half of "espacios vacíos" is the same complaint as the
      // vertical one.
      //
      // It qualifies on the rule `AppShell`'s `CONTENT_MEASURE` note states,
      // not on taste: this page's height is a function of how many payments
      // EXIST, and it has no pager.
      measure="short"
      // A minor with no dependants of their own cannot register anything from
      // here — the gate below is deliberate and stays. Telling them to
      // "registre un pago" in the page's own subtitle was an instruction the
      // screen then refused to let them follow.
      subtitle={
        accountCannotRegister
          ? "Consulte su membresía, vea cómo se paga y siga el historial de sus pagos."
          : hasAlumnoRole
            ? "Registre un pago, siga su validación y consulte lo que ya pagó."
            : "Registre el pago de un dependiente, siga su validación y consulte lo que ya pagó."
      }
    >
      {/*
       * Issue #316 hallazgo #70: this screen and `/student/attendance` were
       * the only two second-level screens with no way back at all — `/ayuda`
       * and `/profile`, reached from the very same sidebar, both carry one.
       * The comment this replaced argued the sidebar already does that job,
       * which is the admin rail's own rule — but the admin rail has no
       * `/ayuda` or `/profile` counter-example proving otherwise; the family
       * portal does. Same component, same placement as `/ayuda`'s.
       */}
      <BackLink href="/student" />

      {state.status === "loading" && (
        <div className="card">
          <LoadingState label="Cargando sus pagos…" />
        </div>
      )}
      {state.status === "error" && (
        <ErrorState message={state.message} onRetry={() => setReloadToken((n) => n + 1)} />
      )}
      {state.status === "ready" && (
        <PaymentsContent
          data={state.data}
          hasAlumnoRole={hasAlumnoRole}
          accountPersonaId={personaId}
          wantsRegisterForm={wantsRegisterForm}
          onRegistered={() => setReloadToken((n) => n + 1)}
        />
      )}
    </AppShell>
  );
}

export default function StudentPaymentsPage(): React.ReactElement {
  return (
    <ProtectedRoute allowedRoles={["representante", "estudiante", "unsupported"]}>
      {/* `useSearchParams` needs a boundary to fall back to during prerender
          — the same wrapper `/reset-password` uses for the same reason. */}
      <Suspense>
        <PaymentsPageContent />
      </Suspense>
    </ProtectedRoute>
  );
}
