"use client";

/** Payment registration and benefit forms for /student/payments. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/contexts/ToastContext";
import { fetchPagosDePersona, subirVoucherPago, registrarPago, aplicarBeneficio } from "@/services/api";
import type { PagoPersona, MembershipSummary, RegistrarPagoInput, BeneficioAsignado, CoberturaBonificada } from "@/services/api";
import { Button, DataBox } from "@/components/ui";
import { formatCurrency, formatDateRange } from "@/lib/format-utils";
import { calendarIsoDate, clubToday } from "@/lib/club-date";
import { addMonthsIso, estimateTotal, prepareVoucher } from "./payments-utils";
import { CreditCard, Loader2, Minus, Paperclip, Plus, Upload, X } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { toUserMessage } from "@/lib/error-message";
import { ProofPreview } from "./ProofPreview";
import LinkifiedText from "@/components/LinkifiedText";

/** `_sistema.css` `.fld` — the one input shape, 40px like every other control. */
export const FIELD_CLASSES =
  "h-ctl w-full rounded-ctl border border-line-2 bg-paper px-3.5 text-sm text-ink " +
  "placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-45";

const FIELD_LABEL_CLASSES = "text-2xs font-bold uppercase text-ink-3-strong";

/** Parse an ISO date at local noon — the same anchoring `format-utils` uses, for the same reason. */
export function fromIsoDate(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
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

export function BeneficioNote({ beneficio }: { beneficio: BeneficioAsignado | null }): React.ReactElement | null {
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
      <span className="text-ink-3-strong">{descuento.nombre}</span>
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
    <fieldset className="flex flex-col gap-1.5">
      <legend className={FIELD_LABEL_CLASSES}>
        Meses a pagar <span aria-hidden="true" className="text-state-bad">*</span>
      </legend>
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
    </fieldset>
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
   * The active benefit's percentage or fixed amount — issue #400 slice 06. Only
   * feeds the CLIENT-SIDE preview total (`estimateTotal`); the request this
   * form sends never carries it, same as it never carried `monto`. A 100%
   * benefit never reaches this component: `PaymentsContent` renders
   * `ApplyBenefitForm` instead in that case.
   */
  beneficioPorcentaje,
  beneficioMonto,
  onRegistered,
}: {
  membership: MembershipSummary;
  personaId: string;
  coverageEnd: string | null;
  hasPendingPago: boolean;
  autoOpen: boolean;
  studentName: string | null;
  beneficioPorcentaje: number | null;
  beneficioMonto: number | null;
  onRegistered: () => void;
}): React.ReactElement {
  /** Issue #400: a discrete month count, never a typed monto. */
  const [months, setMonths] = useState<number>(MESES_MINIMO);
  const [tipoPago, setTipoPago] = useState<"EFECTIVO" | "TRANSFERENCIA">("TRANSFERENCIA");
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const [voucherFile, setVoucherFile] = useState<File | null>(null);
  /** FAM-20: why the last picked file was refused. Kept until a valid file is picked. */
  const [voucherRejection, setVoucherRejection] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showSuccess, showWarning } = useToast();

  const monthlyPrice = Number(membership.montoAplicado ?? "") || 0;
  /** What the checkpoint shows BEFORE confirming — a preview, not the authoritative total (see `estimateTotal`). */
  const estimatedTotal = estimateTotal(monthlyPrice, months, beneficioPorcentaje, beneficioMonto);

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
    setVoucherRejection(null);
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
      // FAM-20: a refused file is not «no file»; say why it was refused.
      if (voucherRejection) return voucherRejection;
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
    setVoucherRejection(null);
  }

  /**
   * Issue #482: `accept` on the voucher `<input>` only filters the OS
   * picker's own dropdown — a reader who switches it to "All Files" can
   * still pick a `.txt`. Issue #1226 adds the same reasoning for size: the
   * BFF's own 5 MB limit only rejects after `registrarPago` already created
   * the payment. Reject either case here, the moment it is selected,
   * instead of letting `registrarPago` succeed and only failing the
   * follow-up `subirVoucherPago` call once the backend checks catch it.
   * FAM-26: a photo over 5 MB is shrunk before that check (`prepareVoucher`).
   */
  async function handleVoucherChange(picked: File | null): Promise<void> {
    let file = picked;
    if (picked) {
      const prepared = await prepareVoucher(picked);
      if ("error" in prepared) {
        setVoucherFile(null);
        setVoucherRejection(prepared.error);
        action.setError(prepared.error);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      file = prepared.file;
    }
    setVoucherFile(file);
    setVoucherRejection(null);
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
          ? `Ya hay un pago de ${studentName} esperando validación. Espere a que el club lo apruebe para registrar otro; en el historial de abajo verá si queda aprobado o rechazado.`
          : "Ya tiene un pago esperando validación. Espere a que el club lo apruebe para registrar otro; en el historial de abajo verá si queda aprobado o rechazado."}
      </p>
    );
  }

  if (!action.showForm) {
    return (
      // The hint sits beside the button so the card's foot is a sentence long
      // rather than a lone button with a blank row to its right.
      <div className="flex flex-col gap-2.5">
        <Button variant="primary" onClick={action.open} className="w-full">
          <Plus size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          {studentName ? `Registrar un pago de ${studentName}` : "Registrar un pago"}
        </Button>
        <p className="min-w-0 text-sm text-ink-3-strong">
          Elija los meses y la forma de pago; el club valida cada pago y lo verá «En revisión» en
          el historial.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {studentName && (
        <p className="text-sm text-ink-2">
          Este pago se registra a nombre de <b className="font-semibold text-ink">{studentName}</b>.
        </p>
      )}
      <div className="grid gap-3">
        <MonthCountField value={months} onChange={setMonths} disabled={action.loading} />
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL_CLASSES}>Forma de pago <span aria-hidden="true" className="text-state-bad">*</span></span>
          <select
            value={tipoPago}
            required
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
          <span className={FIELD_LABEL_CLASSES}>Comprobante <span aria-hidden="true" className="text-state-bad">*</span></span>
          <input
            ref={fileInputRef}
            type="file"
            aria-required="true"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => void handleVoucherChange(e.target.files?.[0] ?? null)}
            className="hidden"
            data-testid="renew-voucher-input"
          />
          {voucherFile ? (
            <ProofPreview
              file={voucherFile}
              onReplace={() => fileInputRef.current?.click()}
              onRemove={() => {
                setVoucherFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-ctl border border-dashed border-line-2 bg-sunken px-3 py-4 text-sm font-semibold text-ink-2 hover:border-ink-3 hover:text-ink"
            >
              <Upload size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Seleccionar archivo
            </button>
          )}
          <span className="text-xs text-ink-3-strong">PDF, JPG o PNG — máximo 5 MB.</span>
          {voucherRejection && !voucherFile && (
            <span data-testid="voucher-rejection" className="text-xs font-semibold text-state-bad">
              {voucherRejection}
            </span>
          )}
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
          <LinkifiedText text={action.error} />
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
  const [fechaInicio, setFechaInicio] = useState<string>("");
  const { showSuccess } = useToast();

  // Issue #1369: no month selector — one activation grants EXACTLY one
  // month, decided by the backend. The preview and the confirmation both
  // derive the period from that fixed length.
  const fechaFin = useMemo(
    () => (fechaInicio ? addMonthsIso(fechaInicio, 1) : ""),
    [fechaInicio],
  );

  const seedForm = useCallback((): void => {
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
      cobertura = await aplicarBeneficio(membership.id);
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

      <div className="rounded-ctl bg-sunken px-3.5 py-3">
        <p className="text-2xs font-bold uppercase text-ink-3-strong">Período que cubre</p>
        <p className="mt-1 text-sm font-bold tabular-nums text-ink">
          {fechaInicio && fechaFin ? formatDateRange(fechaInicio, fechaFin) : "—"}
        </p>
        <p className="mt-0.5 text-xs text-ink-3-strong">
          1 mes, sin costo — el beneficio cubre el 100%.
        </p>
      </div>

      {action.error && (
        <p role="alert" className="text-sm font-semibold text-state-bad">
          <LinkifiedText text={action.error} />
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
export function PaymentOrBenefitForm({
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
  beneficioMonto: number | null;
}): React.ReactElement {
  if (isFullBenefit) {
    return <ApplyBenefitForm {...common} />;
  }
  return <RenewPaymentForm {...common} beneficioPorcentaje={beneficioPorcentaje} />;
}
