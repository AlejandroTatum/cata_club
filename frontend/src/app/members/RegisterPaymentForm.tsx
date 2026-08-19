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

  function calcEndDate(baseDate: Date, amount: number): string {
    if (monthlyPrice <= 0 || amount <= 0) return "";
    const fin = new Date(baseDate);
    fin.setMonth(fin.getMonth() + amount / monthlyPrice);
    return calendarIsoDate(fin);
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

  function validate(montoNum: number): string | null {
    if (!montoNum || montoNum <= 0) return "El monto debe ser mayor a 0.";
    if (monthlyPrice > 0 && montoNum % monthlyPrice !== 0) {
      return `El monto debe ser múltiplo de $${monthlyPrice}.`;
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
        monto: montoNum,
        tipoPago: "TRANSFERENCIA",
        // No fechaInicio/fechaFin (fix período de cobertura, PAG-5): el backend
        // las calcula del monto y la cuota. Las de acá existen solo para la
        // vista previa "Inicio: / Fin:" de más abajo.
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

      {monthlyPrice > 0 && Number(monto) > 0 && (
        <p className="text-2xs tracking-flat text-ink-3">
          {Number(monto) / monthlyPrice}{" "}
          {Number(monto) / monthlyPrice === 1 ? "mes de vigencia" : "meses de vigencia"} (precio
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
