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
  subirVoucherPago,
  registrarPago,
} from "@/services/api";
import type {
  StudentPortalSummary,
  StudentProfileSummary,
  PagoPersona,
  MembershipSummary,
  RegistrarPagoInput,
} from "@/services/api";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FilterPanel,
  FilterPill,
  LoadingState,
  buttonClasses,
  cn,
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
  pagoFaltaComprobante,
  countPagosByStatus,
  wholeMonthsFor,
  addMonthsIso,
  TIPO_PAGO_LABEL,
  PAGO_FILTER_LABELS,
  type PagoStatusFilter,
} from "./payments-utils";
import { CreditCard, Loader2, Paperclip, Plus, Upload, X } from "lucide-react";
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
  if (membership?.montoAplicado) {
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
  /** True once the club has a `Membresia` to renew; without one the form cannot be reached at all. */
  hasMembership,
  monthlyPrice,
}: {
  studentName: string | null;
  blocked: boolean;
  hasMembership: boolean;
  monthlyPrice: string | null;
}): React.ReactElement {
  const subject = studentName ? `de ${studentName}` : "suyo";

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
          Abra <b className="font-semibold text-ink">Registrar un pago</b> y escriba el monto{" "}
          {subject === "suyo" ? "" : `${subject} `}y la forma de pago.
          {monthlyPrice ? (
            <>
              {" "}
              Cada {formatCurrency(monthlyPrice)} cubre un mes: el formulario muestra el período
              exacto antes de que confirme.
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
// ---------------------------------------------------------------------------

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
  const [showForm, setShowForm] = useState(false);
  /** The checkpoint between "I filled this in" and "the club has my money". */
  const [confirming, setConfirming] = useState(false);
  const [monto, setMonto] = useState<string>(membership.montoAplicado ?? "");
  const [tipoPago, setTipoPago] = useState<"EFECTIVO" | "TRANSFERENCIA">("TRANSFERENCIA");
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [voucherFile, setVoucherFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const { showSuccess, showWarning } = useToast();

  const monthlyPrice = Number(membership.montoAplicado ?? "") || 0;
  const amount = Number(monto) || 0;
  const months = wholeMonthsFor(amount, monthlyPrice);

  /**
   * Coverage resumes where the paid period ends, not today — otherwise a family
   * paying early loses the days they already paid for. `coverageEnd` is the
   * furthest approved `fechaFin`; `membership.fechaFin`, which the old form
   * read, never reaches this client.
   */
  const fechaFin = useMemo(
    () => (fechaInicio && months !== null ? addMonthsIso(fechaInicio, months) : ""),
    [fechaInicio, months],
  );

  const openForm = useCallback((): void => {
    setShowForm(true);
    setConfirming(false);
    setError(null);
    setVoucherFile(null);
    // Both sides must be CALENDAR dates before they are compared: mixing an
    // instant with a noon-anchored date made the comparison depend on the
    // hour of day.
    const today = clubToday();
    const paidThrough = coverageEnd ? fromIsoDate(coverageEnd) : null;
    setFechaInicio(
      calendarIsoDate(paidThrough && paidThrough.getTime() > today.getTime() ? paidThrough : today),
    );
  }, [coverageEnd]);

  // Once, on arrival. Guarded by a ref rather than by `showForm` so that a
  // reader who deliberately cancels the form is not handed it straight back
  // when the payment history refetches.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpened.current || hasPendingPago) return;
    autoOpened.current = true;
    openForm();
  }, [autoOpen, hasPendingPago, openForm]);

  // The checkpoint's own primary button takes focus when it appears: the
  // control that was focused a moment ago has just unmounted.
  useEffect(() => {
    if (confirming) confirmButtonRef.current?.focus();
  }, [confirming]);

  function handleCancel(): void {
    setShowForm(false);
    setConfirming(false);
    setVoucherFile(null);
    setError(null);
  }

  /** The first thing wrong with the form as it stands, or `null`. */
  function findProblem(): string | null {
    if (amount <= 0) return "Ingrese un monto mayor a 0.";
    if (monthlyPrice > 0 && months === null) {
      return `El monto debe ser un múltiplo del valor mensual (${formatCurrency(monthlyPrice)}): pague uno o más meses completos.`;
    }
    if (!fechaInicio || !fechaFin) return "No se pudo calcular el período que cubre este pago.";
    if (tipoPago === "TRANSFERENCIA" && !voucherFile) {
      return "Adjunte el comprobante de la transferencia para que el club pueda validarla.";
    }
    return null;
  }

  /**
   * "Registrar pago" no longer registers anything. It validates and opens the
   * checkpoint — the reader still has to say yes to a sentence that names the
   * child, the amount and the period, because nothing after this point can be
   * taken back from the portal.
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

  async function handleSubmit(): Promise<void> {
    // Re-checked rather than trusted: the fields stay live behind the
    // checkpoint, so the summary always describes what will actually be sent.
    const problem = findProblem();
    if (problem) {
      setError(problem);
      setConfirming(false);
      return;
    }

    setLoading(true);
    setError(null);

    let nuevoPago: PagoPersona;
    try {
      // No fechaInicio/fechaFin (fix período de cobertura, PAG-5): el
      // backend las calcula solo, a partir del monto y la cuota. Las
      // variables locales siguen existiendo -- son la vista previa que ve
      // el lector antes de confirmar -- pero ya no viajan en la petición.
      nuevoPago = await registrarPago({
        monto: amount,
        tipoPago,
        personaId: Number(personaId),
        membresiaId: membership.id,
      } satisfies RegistrarPagoInput);
    } catch (err) {
      setError(toUserMessage(err, "No se pudo registrar el pago."));
      setLoading(false);
      return;
    }

    // The payment exists in the database from this point on, and it is not
    // reverted if the voucher fails to attach (decisiones-de-negocio
    // §7 — the owner's call, not this screen's). Reoffering "Confirmar y
    // registrar" here used to call registrarPago() again and collide with
    // the payment it had just created ("ya tiene un pago pendiente") — the
    // ghost-payment bug this closes (PAG-1). Instead the form gets out of
    // the way and the payment survives in the history, marked as missing
    // its voucher, with its own upload control (PagoRow).
    if (voucherFile && nuevoPago?.id) {
      try {
        await subirVoucherPago(nuevoPago.id, voucherFile);
      } catch (err) {
        setShowForm(false);
        setConfirming(false);
        setVoucherFile(null);
        setLoading(false);
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

    setShowForm(false);
    setConfirming(false);
    setVoucherFile(null);
    // What happened, and what to do if it was wrong. There is no "Deshacer"
    // to offer (see the block comment above this component), so the toast
    // says plainly where the recovery actually lives.
    showSuccess(
      studentName
        ? `Pago de ${studentName} registrado y en revisión`
        : "Pago registrado y en revisión",
      {
        description: `${formatCurrency(amount)} por el período ${formatDateRange(fechaInicio, fechaFin)}. El club lo valida; si algo está mal lo rechaza indicando el motivo y usted registra el pago correcto.`,
      },
    );
    onRegistered();
    setLoading(false);
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

  if (!showForm) {
    return (
      <Button variant="primary" onClick={openForm}>
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
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASSES}>Monto</span>
          <input
            type="number"
            step={monthlyPrice > 0 ? monthlyPrice : "0.01"}
            min="0"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className={FIELD_CLASSES}
            placeholder="0,00"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASSES}>Forma de pago</span>
          <select
            value={tipoPago}
            onChange={(e) => {
              const value = e.target.value as "EFECTIVO" | "TRANSFERENCIA";
              setTipoPago(value);
              if (value !== "TRANSFERENCIA") setVoucherFile(null);
            }}
            className={FIELD_CLASSES}
          >
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="EFECTIVO">Efectivo</option>
          </select>
        </label>
      </div>

      {/* The consequence of the amount, stated before the reader commits to it. */}
      <div className="rounded-ctl bg-sunken px-3.5 py-3">
        <p className="text-2xs font-bold uppercase text-ink-3-strong">
          Período que cubre
        </p>
        <p className="mt-1 text-sm font-bold tabular-nums text-ink">
          {fechaInicio && fechaFin ? formatDateRange(fechaInicio, fechaFin) : "—"}
        </p>
        {months !== null && (
          <p className="mt-0.5 text-xs text-ink-3-strong">
            {months === 1 ? "1 mes" : `${months} meses`} a {formatCurrency(monthlyPrice)} por mes.
          </p>
        )}
        {months === null && monthlyPrice > 0 && amount > 0 && (
          <p className="mt-0.5 text-xs text-state-bad">
            El monto debe ser un múltiplo de {formatCurrency(monthlyPrice)}.
          </p>
        )}
      </div>

      {tipoPago === "TRANSFERENCIA" && (
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASSES}>Comprobante</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setVoucherFile(e.target.files?.[0] ?? null)}
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
       * PAG-5: `findProblem()` always had the right sentence (a monto that
       * doesn't close, a missing voucher…) but it only ever reached the
       * screen through `error`, which `handleRequestConfirm` only sets on a
       * CLICK — and the button that triggers it is exactly the one this
       * sentence explains is disabled. The reader saw a greyed-out button
       * and nothing else. `liveProblem` is the same function, read on every
       * render instead of waiting for a click; `error` (a submit attempt or
       * an API failure) still wins once it exists, so nothing here changes
       * once the reader has actually tried to submit.
       */}
      {(error || (monto !== "" && findProblem())) && (
        <p role="alert" className="text-sm font-semibold text-state-bad">
          {error ?? findProblem()}
        </p>
      )}

      {confirming ? (
        /* The checkpoint sits where the submit button was, so it lands under
           the eye that just clicked, with every field it describes still on
           screen and still editable above it. A modal would have dimmed
           exactly the numbers the reader is being asked to check. */
        <div data-testid="renew-confirm" className="rounded-ctl border border-line-2 bg-sunken px-4 py-4">
          <p className="text-2xs font-bold uppercase text-ink-3-strong">
            Confirme antes de registrar
          </p>
          <p id="renew-confirm-summary" className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-ink">
            Va a registrar <b className="font-bold tabular-nums">{formatCurrency(amount)}</b>{" "}
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
          <div className="mt-3.5 flex flex-wrap gap-2">
            <Button
              ref={confirmButtonRef}
              variant="primary"
              onClick={() => void handleSubmit()}
              disabled={loading}
              aria-describedby="renew-confirm-summary"
            >
              {loading ? (
                <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
              ) : (
                <CreditCard size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              )}
              {loading ? "Registrando…" : "Confirmar y registrar"}
            </Button>
            <Button variant="tertiary" onClick={handleBackToForm} disabled={loading}>
              Volver a corregir
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            ref={submitButtonRef}
            variant="primary"
            onClick={handleRequestConfirm}
            disabled={!monto || !fechaInicio || !fechaFin}
          >
            <CreditCard size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            Registrar pago
          </Button>
          <Button variant="tertiary" onClick={handleCancel}>
            Cancelar
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One payment in the history
// ---------------------------------------------------------------------------

function PagoRow({
  pago,
  onUploadFile,
  uploadingId,
}: {
  pago: PagoPersona;
  onUploadFile: (pagoId: number) => void;
  uploadingId: number | null;
}): React.ReactElement {
  const estado = describePagoEstado(pago.estadoPago);
  const canUpload = !pago.voucherUrl && pago.estadoPago !== "APROBADO";
  const faltaComprobante = pagoFaltaComprobante(pago);

  return (
    <li className="flex min-h-drow flex-wrap items-start gap-x-4 gap-y-field border-b border-line px-5 py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-base font-bold tabular-nums text-ink">
            {formatPagoMonto(pago.monto)}
          </span>
          <Badge tone={estado.tone}>{estado.label}</Badge>
          {/* Distinct from an ordinary "awaiting validation" row: this is the
              payment a failed voucher upload left behind. The owner's call
              (decisiones §7) keeps it, marked, instead of reverting it. */}
          {faltaComprobante && <Badge tone="bad">Falta el comprobante</Badge>}
        </div>
        <p className="mt-1 text-xs text-ink-3-strong">
          {TIPO_PAGO_LABEL[pago.tipoPago]} · Registrado el{" "}
          <span className="tabular-nums">{formatDate(pago.fechaRegistro)}</span> · Cubre{" "}
          <span className="tabular-nums">{formatDateRange(pago.fechaInicio, pago.fechaFin)}</span>
        </p>

        {pago.voucherUrl && (
          <a
            href={pago.voucherUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex min-h-[24px] items-center gap-1.5 rounded text-xs font-semibold text-ink underline decoration-line-2 decoration-2 underline-offset-4 hover:decoration-ink"
          >
            <Paperclip size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            Ver el comprobante
          </a>
        )}

        {/* The rejection reason is the one thing on this screen that asks the
            reader to act, so it is stated in full rather than truncated into
            the meta line. */}
        {pago.estadoPago === "RECHAZADO" && pago.motivoRechazo && (
          <div className="mt-2 rounded-ctl bg-state-bad-bg px-3.5 py-2.5">
            <p className="text-2xs font-bold uppercase text-state-bad">
              Motivo del rechazo
            </p>
            <p className="mt-0.5 text-sm text-ink-2">{pago.motivoRechazo}</p>
          </div>
        )}
      </div>

      {canUpload && (
        <Button size="sm" onClick={() => onUploadFile(pago.id)} disabled={uploadingId === pago.id}>
          {uploadingId === pago.id ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          {uploadingId === pago.id ? "Subiendo…" : "Subir comprobante"}
        </Button>
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
  const [uploadingId, setUploadingId] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingUploadPagoId, setPendingUploadPagoId] = useState<number | null>(null);

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
  });

  /**
   * Whether the form above is actually reachable for this reader — the only
   * condition under which the empty history may offer "Registrar un pago" as
   * its way out (D11). It restates the three gates `RenewPaymentForm` already
   * applies, in the order it applies them: a minor on their own account never
   * registers, a persona with no `Membresia` has nothing to renew, and a
   * pending payment blocks a second one until the club rules on it.
   */
  const canRegisterHere =
    !blockedAsMinor && selectedProfile?.membership != null && !hasPendingPago;

  function handleSelectFile(pagoId: number): void {
    setUploadError(null);
    setPendingUploadPagoId(pagoId);
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file || !pendingUploadPagoId) return;
    setUploadingId(pendingUploadPagoId);
    setUploadError(null);
    try {
      await subirVoucherPago(pendingUploadPagoId, file);
      setReloadToken((n) => n + 1);
    } catch (err) {
      // Inline, not `alert()`: a browser dialog cannot be styled, cannot be
      // read by the surrounding context, and blocks the page it interrupts.
      setUploadError(toUserMessage(err, "No se pudo subir el comprobante."));
    } finally {
      setUploadingId(null);
      setPendingUploadPagoId(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
        action={
          <Link href="/student" className={buttonClasses("secondary", "sm")}>
            Ir a mi cuenta
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
        {blockedAsMinor ? (
          <p className="text-sm text-ink-2">
            {/* The old copy sent EVERY minor to "su representante" — including
                the ones whose `representanteId` is null, who were being pointed
                at a person the backend does not have. `describePaymentSituation`
                resolves that from the payload. */}
            {situation.detail}
          </p>
        ) : selectedProfile.membership ? (
          <RenewPaymentForm
            membership={selectedProfile.membership}
            personaId={selectedProfile.personaId}
            coverageEnd={coverageEnd}
            hasPendingPago={hasPendingPago}
            autoOpen={wantsRegisterForm && pagosState.status === "ready"}
            studentName={studentName}
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
        onChange={(e) => {
          void handleFileChange(e);
        }}
      />

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
          className={cn("card flex flex-col overflow-hidden", filteredPagos.length === 0 && "flex-1")}
          aria-labelledby="pagos-title"
        >
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
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
                    Registrar un pago
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex flex-col">
              {filteredPagos.map((pago) => (
                <PagoRow
                  key={pago.id}
                  pago={pago}
                  onUploadFile={handleSelectFile}
                  uploadingId={uploadingId}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {/* No "← Volver a mi cuenta" here. The sidebar's "Mi cuenta" row is one
          click away and is highlighted the whole time — the admin screens
          dropped their own back links for exactly this reason (see the header
          comment on `src/app/attendance/page.tsx`), and the family area was
          the last place still carrying one. */}
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
