/**
 * Register a payment against an existing membership — the second of the two
 * independent forms inside a student's edit panel.
 *
 * Administrators can select cash or transfer when registering on a member's behalf.
 * Transfer payments require a voucher; cash payments do not.
 *
 *
 *
 *
 */

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Loader2, Plus, Upload } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { registrarPago } from "@/services/api";
import type { RegistrarPagoInput } from "@/services/api";
import { calendarIsoDate, clubIsoDate, clubToday } from "@/lib/club-date";
import { toUserMessage } from "@/lib/error-message";
import { MIN_TARGET_CLASS } from "@/lib/target-size";
import {
  addMonthsIso,
  excedeMesesMaximo,
  MAX_MESES_COBERTURA,
  MENSAJE_MESES_MAXIMO_EXCEDIDO,
  voucherFileTypeError,
  wholeMonthsFor,
} from "@/app/student/payments/payments-utils";
import type { MemberStudentSummary } from "./members-utils";

interface RegisterPaymentFormProps {
  personaId: number;
  /** Only rendered when the student has one — its id and monthly price drive the whole form. */
  membresia: NonNullable<MemberStudentSummary["membresia"]>;
}

export default function RegisterPaymentForm({
  personaId,
  membresia,
}: RegisterPaymentFormProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const monthlyPrice = membresia.monto != null ? Number(membresia.monto) : 0;

  const [open, setOpen] = useState(false);
  const [monto, setMonto] = useState<string>(membresia.monto != null ? String(membresia.monto) : "");
  const [fechaInicio, setFechaInicio] = useState<string>(() => clubIsoDate());
  const [fechaFin, setFechaFin] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [voucherFile, setVoucherFile] = useState<File | null>(null);
    const [tipoPago, setTipoPago] = useState<"EFECTIVO" | "TRANSFERENCIA">("TRANSFERENCIA");

  // Issue #465: the error message below used to be a plain, unannounced
  // `<p>` — no `id`, no `role="alert"`/`aria-live` on it or on any ancestor
  // up to the enclosing `<dialog>`, and the voucher input carried neither
  // `aria-describedby` nor `aria-invalid`. `errorId` gives the message a
  // stable id to be described-by (via `useId`, not a literal, so two open
  // instances of this form — one per student — never collide).
  const errorId = useId();
  const errorRef = useRef<HTMLParagraphElement>(null);
  // Bumped on every failed `validate()`, even when the message text repeats
  // (e.g. two submits in a row with the same missing field). `error` alone
  // cannot drive the focus effect below for that case: React bails out a
  // `setState` to an Object.is-equal string, so a second identical failure
  // would leave focus stuck on "Registrar pago" with nothing re-announced.
  const [errorAnnounceKey, setErrorAnnounceKey] = useState(0);

  /**
   * `wholeMonthsFor`/`addMonthsIso` (`student/payments/payments-utils.ts`)
   * replace the float division this used to do (`fin.setMonth(fin.getMonth()
   * + amount / monthlyPrice)`, which truncates a fraction the same way the
   * bug documented on `wholeMonthsFor` describes) with the same exact,
   * cents-safe month count the student portal already uses — one clock for
   * "how many months does this amount buy", not two that can quietly
   * disagree.
   */
  function calcEndDate(baseDate: Date, amount: number): string {
    const months = wholeMonthsFor(amount, monthlyPrice);
    if (months === null) return "";
    return addMonthsIso(calendarIsoDate(baseDate), months);
  }

  /**
   * Issue #482: reject an out-of-type voucher the moment it is picked,
   * instead of letting it through `accept`'s soft filter and only failing
   * once the backend's own `content_type` check rejects it after the pago
   * already exists (see `voucherFileTypeError`'s docstring).
   */
  function handleVoucherChange(file: File | null): void {
    if (file) {
      const typeError = voucherFileTypeError(file);
      if (typeError) {
        setVoucherFile(null);
        setError(typeError);
        setErrorAnnounceKey((key) => key + 1);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    }
    setVoucherFile(file);
    setError(null);
  }

  function handleTipoPagoChange(value: "EFECTIVO" | "TRANSFERENCIA"): void {
      setTipoPago(value);
      if (value === "EFECTIVO") {
        setVoucherFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        setError(null);
      }
    }

    /**
     * Issue #666: validates BEFORE computing anything, not after. An amount
     * that would buy more than `MAX_MESES_COBERTURA` months (50,000,000
     * against a real plan, in the original report) used to sail straight
     * into `calcEndDate`, which fed it to `addMonthsIso` and rendered a
     * "Fin: 54109-xx-xx" preview — a real date shown for a request the
     * backend was always going to reject. This short-circuits before that
     * call ever runs, clearing the preview and surfacing the same message
     * `validate()`/`handleSubmit()` would give on submit, without moving
     * focus (this runs on every keystroke — see `errorAnnounceKey`'s own
     * comment on why only discrete actions bump it).
     */
    function handleMontoChange(value: string): void {
    setMonto(value);
    const amount = parseFloat(value.replace(/[^0-9.]/g, "")) || 0;
    if (amount > 0 && excedeMesesMaximo(amount, monthlyPrice)) {
      setFechaFin("");
      setError(MENSAJE_MESES_MAXIMO_EXCEDIDO);
      return;
    }
    if (error === MENSAJE_MESES_MAXIMO_EXCEDIDO) setError(null);
    if (!fechaInicio) return;
    setFechaFin(amount > 0 ? calcEndDate(new Date(fechaInicio + "T12:00:00"), amount) : "");
  }

  function handleOpen(): void {
    setOpen(true);
    setError(null);
    setRegistered(false);
    setVoucherFile(null);
    // A calendar date, so `calcEndDate` adds months to a day rather than to an instant.
    const hoy = clubToday();
    setFechaInicio(calendarIsoDate(hoy));
    const amount = parseFloat(String(monto).replace(/[^0-9.]/g, "")) || 0;
    // Same guard as `handleMontoChange` — `monto` survives a close/reopen
    // (only `fechaInicio`/`error`/etc. reset here), so reopening after
    // typing an over-cap amount and hitting "Cancelar" must not resurrect
    // the absurd preview date from before (issue #666).
    setFechaFin(
      amount > 0 && !excedeMesesMaximo(amount, monthlyPrice) ? calcEndDate(hoy, amount) : "",
    );
  }

  /**
   * `montoNum % monthlyPrice` used to mirror a backend check
   * (`PagoServicio.registrar_pago`'s old "múltiplo exacto" rule). That
   * backend rule is GONE (issue #400/4b: `PagoCreateDTO` takes `meses`, an
   * integer, so there is nothing left to divide). This check survives for a
   * different reason now: this form still collects an AMOUNT from the admin
   * (the month-picker UX is a later phase — see `student/payments/page.tsx`),
   * and `meses` has to come from somewhere. `wholeMonthsFor` is that
   * derivation, and a `null` result means the typed amount cannot become a
   * whole month count, which this form has no way to send.
   */
  function validate(montoNum: number): string | null {
    if (!montoNum || montoNum <= 0) return "El monto debe ser mayor a 0.";
    const meses = wholeMonthsFor(montoNum, monthlyPrice);
    if (meses === null) {
      return monthlyPrice > 0
        ? `El monto debe ser múltiplo de $${monthlyPrice}: registre uno o más meses completos.`
        : "No se pudo calcular a cuántos meses equivale este monto.";
    }
    // Issue #666: re-checked here (not just in `handleMontoChange`) as the
    // last gate before a request is built — `handleSubmit` reads `meses`
    // straight from this same `wholeMonthsFor` call below.
    if (meses > MAX_MESES_COBERTURA) return MENSAJE_MESES_MAXIMO_EXCEDIDO;
    if (!fechaInicio || !fechaFin) return "Las fechas son obligatorias.";
    if (fechaInicio >= fechaFin) return "La fecha de inicio debe ser anterior a la fecha de fin.";
    if (!membresia.id) return "No se encontró la membresía.";
    if (tipoPago === "TRANSFERENCIA" && !voucherFile) {
        return "El comprobante de transferencia es obligatorio.";
      }
    return null;
  }

  // Runs after every failed submit (see `errorAnnounceKey`), including a
  // second identical one — never only on the true→false→true edge a plain
  // `useEffect(..., [error])` would need. `errorRef.current` is populated by
  // the time this runs: effects fire after the DOM commit that mounted the
  // `<p role="alert">` (or, on a repeat failure, it was already mounted).
  useEffect(() => {
    if (error) errorRef.current?.focus();
    // `error` is read above but deliberately left out of the deps below:
    // `errorAnnounceKey` alone must drive re-focus (see the comment on this
    // effect). Adding `error` as a second trigger would double-fire on a
    // genuinely new (different-text) error instead of relying on this one
    // counter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorAnnounceKey]);

  async function handleSubmit(): Promise<void> {
    const montoNum = Number(monto);
    const invalid = validate(montoNum);
    if (invalid) {
      setError(invalid);
      setErrorAnnounceKey((key) => key + 1);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const input: RegistrarPagoInput = {
        // The discount, if any, is no longer chosen here (issue #398): the
        // backend resolves it from the persona's assigned benefit
        // (see BeneficioSection) — this is always just the plain amount.
        //
        // `meses` replaces `monto` (issue #400/4b): `validate()` above
        // already confirmed this typed amount is a whole number of months,
        // so the derivation cannot be `null` here.
        meses: wholeMonthsFor(montoNum, monthlyPrice) as number,
        tipoPago,
        // No fechaInicio/fechaFin (fix período de cobertura, PAG-5): el backend
        // las calcula de `meses`. Las de acá existen solo para la vista
        // previa "Inicio: / Fin:" de más abajo.
        personaId,
        membresiaId: membresia.id,
      };
      const nuevoPago = await registrarPago(input);
      if (tipoPago === "TRANSFERENCIA" && voucherFile && nuevoPago?.id) {
        const { subirVoucherPago } = await import("@/services/api");
        await subirVoucherPago(nuevoPago.id, voucherFile);
      }
      setRegistered(true);
      setOpen(false);
      setVoucherFile(null);
      showSuccess("Pago registrado correctamente.");
    } catch (err) {
      // Issue #666: a 422 on THIS payload (`meses`, `tipoPago`, `personaId`,
      // `membresiaId`) can only realistically come from the backend's own
      // defensive ceiling (`PagoCreateDTO.meses`, `gt=0, le=12`) — `validate()`
      // above already re-derives `meses` from this same `monthlyPrice`, so
      // the only way a request still overshoots it is a stale price between
      // typing and submit. Pydantic's own detail for that ("...less than or
      // equal to 12...") is English and never passes `toUserMessage`'s
      // gate 2, so before this fix it fell through to a bare generic
      // message. This fallback replaces that with one that actually names
      // the limit; it never overrides a real, user-facing backend detail —
      // `toUserMessage` only reaches for the fallback when there isn't one.
      const status = err instanceof Error ? (err as Error & { status?: unknown }).status : null;
      const fallback =
        status === 422 ? MENSAJE_MESES_MAXIMO_EXCEDIDO : "No se pudo registrar el pago.";
      const msg = toUserMessage(err, fallback);
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
  }

  // Issue #400 (slice 4c-b): `membresia.monto` stays the real, nonzero
  // tariff even when `esGratuidadFamiliar` is `true` (E04-RF002 stopped
  // zeroing it) — the amount-driven form below (typed monto → derived
  // months, validated as a multiple of `monthlyPrice`) has no honest monto
  // to collect from an admin for a membership that charges $0 regardless.
  // Blocked here, before any hook-dependent branch, so an admin can never
  // register a real charge against a gratuitous membership.
  if (membresia.esGratuidadFamiliar) {
    return (
      <p className="text-xs text-ink-3">
        Gratuidad familiar: esta membresía no genera ningún cobro. No hay ningún pago que registrar.
      </p>
    );
  }

  if (registered) {
    return (
      <p className="flex items-center gap-1 text-xs text-state-ok">
        <CheckCircle2 size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        Pago registrado. Recarga para verlo.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex h-ctl items-center gap-2 rounded-lg bg-cata-red/15 px-4 text-sm font-semibold text-cata-red transition-colors hover:bg-cata-red/25"
      >
        <Plus size={ICON.base} strokeWidth={2} aria-hidden="true" />
        Registrar pago
      </button>
    );
  }

  // Same derivation as `validate()`/`handleSubmit()`, for the "N meses de
  // vigencia" preview below — `null` (not a whole month count, or no
  // monthlyPrice to divide by) simply hides the line instead of printing a
  // fraction, which is exactly the bug `wholeMonthsFor`'s docstring
  // describes the old float division as having caused. Past `MAX_MESES_COBERTURA`
  // it hides the same way (issue #666): `handleMontoChange` already cleared
  // `fechaFin` and set the over-cap error for this exact amount, so a
  // "625.000 meses de vigencia" line would only contradict it.
  const rawPreviewMonths = wholeMonthsFor(Number(monto) || 0, monthlyPrice);
  const previewMonths =
    rawPreviewMonths !== null && rawPreviewMonths <= MAX_MESES_COBERTURA ? rawPreviewMonths : null;

  return (
    <div className="space-y-field rounded-ctl border border-line bg-sunken p-3">
      {/* Issue #778: one column until `sm`, two from there up. Half of a phone
          is 135px at 412px and 87px at 320px, and "Transferencia" plus
          "Efectivo" need 192px however they are arranged — so on a phone the
          two fields take turns instead of splitting a line neither of them
          fits in. The system's answer to a group that does not fit is less
          per line, never a cut word (DESIGN.md, "la regla de las palabras"). */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
<label className="text-sm font-semibold text-ink-2">
              Monto <span aria-hidden="true" className="text-state-bad">*</span>
          <input
            type="number"
            required
            step={monthlyPrice > 0 ? monthlyPrice : "0.01"}
            min="0"
            // Issue #666: a semantic ceiling matching `MAX_MESES_COBERTURA` —
            // `validate()`/`handleMontoChange()` are the real gate (a spinner
            // `max` does not stop typed digits), but the attribute is still
            // correct and gives assistive tech and browser UI the real bound.
            {...(monthlyPrice > 0 ? { max: monthlyPrice * MAX_MESES_COBERTURA } : {})}
            value={monto}
            onChange={(e) => handleMontoChange(e.target.value)}
            className="mt-0.5 h-ctl w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink"
            placeholder="0.00"
          />
        </label>
        <div className="text-sm font-semibold text-ink-2">
          Método
          {/* `min-h-ctl` and not `h-ctl`: at 320px even a full-width group is
              6px short of the two options, so the second one drops to its own
              line and the box has to grow with it. A fixed height would keep
              the border where it was and clip the wrapped line instead. At
              every width where both fit, `min-h-ctl` still resolves to the
              same 40px the Monto field beside it uses. */}
          <div
            role="radiogroup"
            aria-label="Método de pago"
            className="mt-0.5 flex min-h-ctl w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-paper px-3 py-1.5 text-sm text-ink"
          >
            {/* The 24px of SC 2.5.8 (`lib/target-size.ts`). These labels sat at
                ~20px — the height of their own text — because the 40px came
                from the box around them, and wrapping takes that away. */}
            <label className={`inline-flex items-center gap-1.5 ${MIN_TARGET_CLASS}`}>
              <input
                type="radio"
                name="tipoPago"
                value="TRANSFERENCIA"
                checked={tipoPago === "TRANSFERENCIA"}
                onChange={() => handleTipoPagoChange("TRANSFERENCIA")}
              />
              Transferencia
            </label>
            <label className={`inline-flex items-center gap-1.5 ${MIN_TARGET_CLASS}`}>
              <input
                type="radio"
                name="tipoPago"
                value="EFECTIVO"
                checked={tipoPago === "EFECTIVO"}
                onChange={() => handleTipoPagoChange("EFECTIVO")}
              />
              Efectivo
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-ctl border border-line bg-paper px-2.5 py-2">
        <div className="text-xs">
          <span className="text-ink-3">Inicio: </span>
          <span className="font-semibold text-ink">{fechaInicio || "—"}</span>
        </div>
        <div className="text-xs">
          <span className="text-ink-3">Fin: </span>
          <span className="font-semibold text-ink">{fechaFin || "—"}</span>
        </div>
      </div>

      {previewMonths !== null && (
        <p className="text-2xs tracking-flat text-ink-3">
          {previewMonths}{" "}
          {previewMonths === 1 ? "mes de vigencia" : "meses de vigencia"} (precio
          mensual: ${monthlyPrice})
        </p>
      )}

      {/* Only transfer payments require a voucher
          (see the check in `validate`). */}
{tipoPago === "TRANSFERENCIA" && (
            <label className="block text-sm font-semibold text-ink-2">
              Comprobante <span aria-hidden="true" className="text-state-bad">*</span>
        <div className="mt-0.5 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            aria-required="true"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => handleVoucherChange(e.target.files?.[0] ?? null)}
            className="hidden"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-ctl items-center gap-2 rounded-lg border border-dashed border-line bg-paper px-4 text-sm text-ink-2 transition-colors hover:border-cata-red/30 hover:text-ink"
          >
            <Upload size={ICON.base} strokeWidth={1.5} aria-hidden="true" />
            {voucherFile ? voucherFile.name : "Seleccionar archivo"}
          </button>
          {voucherFile && (
            <button
              type="button"
              onClick={() => setVoucherFile(null)}
              className="h-ctl rounded-lg px-3 text-sm text-ink-3 transition-colors hover:text-state-bad"
            >
              Quitar
            </button>
          )}
        </div>
        </label>
      )}

      {error && (
        // `role="alert"` announces this on mount without waiting for focus;
        // `tabIndex={-1}` + the focus effect above also move focus here so a
        // screen reader always reads it, including on a repeat identical
        // failure. The voucher `<input>` is `display:none` (hidden behind
        // "Seleccionar archivo"), so it cannot receive focus itself — the
        // message is the field-adjacent control that CAN.
        <p
          id={errorId}
          ref={errorRef}
          role="alert"
          tabIndex={-1}
          className="text-xs text-state-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ball focus-visible:shadow-focus-band"
        >
          {error}
        </p>
      )}

      {/* The second group in this form that did not fit (issue #778): 202px of
          buttons in 186px of line at 320px, which cut "Cancelar" — the one
          control that undoes the whole form. Wrapping puts it on its own line
          instead of half off the card. */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading || !monto || !fechaInicio || !fechaFin}
          className="inline-flex h-ctl items-center gap-2 rounded-lg bg-cata-red px-4 text-sm font-semibold text-white transition-colors hover:bg-cata-red/80 disabled:opacity-50"
        >
          {loading ? <Loader2 size={ICON.base} className="animate-spin" /> : <Plus size={ICON.base} />}
          Registrar pago
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setVoucherFile(null);
          }}
          className="inline-flex h-ctl items-center rounded-lg border border-line px-4 text-sm text-ink-2 transition-colors hover:bg-paper"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
