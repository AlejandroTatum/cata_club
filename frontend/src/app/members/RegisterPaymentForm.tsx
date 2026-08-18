/**
 * Register a payment against an existing membership — the second of the two
 * independent forms inside a student's edit panel.
 *
 * No method picker on purpose: a cash payment is a declaration by whoever
 * handed over the money, so only the payer (or their representative) can
 * register one. An administrator registering on someone else's behalf, which
 * is exactly this form, no longer offers it — TRANSFERENCIA is the only method
 * this form can submit, which is also why the voucher is unconditionally
 * required.
 */

"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Plus, Upload } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { registrarPago } from "@/services/api";
import type { RegistrarPagoInput } from "@/services/api";
import { calendarIsoDate, clubIsoDate, clubToday } from "@/lib/club-date";
import { toUserMessage } from "@/lib/error-message";
import { addMonthsIso, wholeMonthsFor } from "@/app/student/payments/payments-utils";
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

  function handleMontoChange(value: string): void {
    setMonto(value);
    if (!fechaInicio) return;
    const amount = parseFloat(value.replace(/[^0-9.]/g, "")) || 0;
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
    setFechaFin(amount > 0 ? calcEndDate(hoy, amount) : "");
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
    if (wholeMonthsFor(montoNum, monthlyPrice) === null) {
      return monthlyPrice > 0
        ? `El monto debe ser múltiplo de $${monthlyPrice}: registre uno o más meses completos.`
        : "No se pudo calcular a cuántos meses equivale este monto.";
    }
    if (!fechaInicio || !fechaFin) return "Las fechas son obligatorias.";
    if (fechaInicio >= fechaFin) return "La fecha de inicio debe ser anterior a la fecha de fin.";
    if (!membresia.id) return "No se encontró la membresía.";
    if (!voucherFile) return "El comprobante de transferencia es obligatorio.";
    return null;
  }

  async function handleSubmit(): Promise<void> {
    const montoNum = Number(monto);
    const invalid = validate(montoNum);
    if (invalid) {
      setError(invalid);
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
        tipoPago: "TRANSFERENCIA",
        // No fechaInicio/fechaFin (fix período de cobertura, PAG-5): el backend
        // las calcula de `meses`. Las de acá existen solo para la vista
        // previa "Inicio: / Fin:" de más abajo.
        personaId,
        membresiaId: membresia.id,
      };
      const nuevoPago = await registrarPago(input);
      if (voucherFile && nuevoPago?.id) {
        const { subirVoucherPago } = await import("@/services/api");
        await subirVoucherPago(nuevoPago.id, voucherFile);
      }
      setRegistered(true);
      setOpen(false);
      setVoucherFile(null);
      showSuccess("Pago registrado correctamente.");
    } catch (err) {
      const msg = toUserMessage(err, "No se pudo registrar el pago.");
      setError(msg);
      showError(msg);
    } finally {
      setLoading(false);
    }
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
        className="inline-flex items-center gap-1 rounded-lg bg-cata-red/15 px-2.5 py-1 text-xs font-semibold text-cata-red transition-colors hover:bg-cata-red/25"
      >
        <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
        Registrar pago
      </button>
    );
  }

  // Same derivation as `validate()`/`handleSubmit()`, for the "N meses de
  // vigencia" preview below — `null` (not a whole month count, or no
  // monthlyPrice to divide by) simply hides the line instead of printing a
  // fraction, which is exactly the bug `wholeMonthsFor`'s docstring
  // describes the old float division as having caused.
  const previewMonths = wholeMonthsFor(Number(monto) || 0, monthlyPrice);

  return (
    <div className="space-y-field rounded-ctl border border-line bg-sunken p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-ink-2">
          Monto
          <input
            type="number"
            step={monthlyPrice > 0 ? monthlyPrice : "0.01"}
            min="0"
            value={monto}
            onChange={(e) => handleMontoChange(e.target.value)}
            className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-ink"
            placeholder="0.00"
          />
        </label>
        {/* No picker: EFECTIVO is not offered here (see the module comment),
            so there is nothing for the admin to choose between. */}
        <div className="text-xs font-semibold text-ink-2">
          Método
          <p className="mt-0.5 w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs text-ink">
            Transferencia
          </p>
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

      {/* TRANSFERENCIA is the only method, so the voucher is always required
          (see the check in `validate`). */}
      <label className="block text-xs font-semibold text-ink-2">
        Comprobante
        <div className="mt-0.5 flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={(e) => setVoucherFile(e.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-line bg-paper px-2.5 py-1.5 text-xs text-ink-2 transition-colors hover:border-cata-red/30 hover:text-ink"
          >
            <Upload size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
            {voucherFile ? voucherFile.name : "Seleccionar archivo"}
          </button>
          {voucherFile && (
            <button
              type="button"
              onClick={() => setVoucherFile(null)}
              className="text-2xs tracking-flat text-ink-3 hover:text-state-bad"
            >
              Quitar
            </button>
          )}
        </div>
      </label>

      {error && <p className="text-xs text-state-bad">{error}</p>}

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading || !monto || !fechaInicio || !fechaFin}
          className="inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-cata-red/80 disabled:opacity-50"
        >
          {loading ? <Loader2 size={ICON.sm} className="animate-spin" /> : <Plus size={ICON.sm} />}
          Registrar pago
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setVoucherFile(null);
          }}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-paper"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
