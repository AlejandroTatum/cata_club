/**
 * Regularize a membership's owed months — the admin bookkeeping tool for
 * issue #284 (a membership whose coverage lapsed and whose unpaid months the
 * normal payment flow silently forgives).
 *
 * The debt is DERIVED (no stored column): owed months from the last approved
 * coverage to today, fetched from the backend when the form opens. The admin
 * records explicit retroactive dates (inicio/fin) + a mandatory motivo; the
 * backend validates no-overlap with approved coverage and that the monto is a
 * multiple of the monthly price, then the payment enters APROBADO directly.
 *
 * Partial regularization is allowed: covering 1 of 4 months settles that month
 * and the other 3 stay visible as debt on the next fetch.
 *
 * This form is admin-only by construction: the members page it lives on is
 * `allowedRoles={["admin"]}` and the backend endpoints demand ADMINISTRADOR.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Wallet } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import { fetchMembresiaDeuda, regularizarDeuda } from "@/services/api";
import { calendarIsoDate, clubIsoDate, clubToday } from "@/lib/club-date";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { toUserMessage } from "@/lib/error-message";
import MotivoObligatorioField from "@/components/admin/MotivoObligatorioField";
import CampoFormularioAdmin from "@/components/admin/CampoFormularioAdmin";

interface RegularizarDeudaFormProps {
  /** Backend membership id (the one the admin BFF aggregates, not the display label). */
  membresiaId: number;
  /** Monthly price (monto_aplicado) — prefills the monto field. */
  montoMensual: number;
  /**
   * `Membresia.esGratuidadFamiliar` (issue #400, slice 4c-b) — since that
   * slice `montoMensual` stays the real, nonzero tariff even for a
   * gratuitous membership (E04-RF002 stopped zeroing it), so this form
   * would otherwise prefill a real dollar amount as if it were owed. It is
   * not: the backend's `RegularizacionDeudaDTO.monto` requires `> 0`
   * (there is no honest zero to submit), and a member who does not pay has
   * no dollar amount to "catch up on" — the form is blocked entirely for
   * this case rather than prefilling a number that does not apply.
   */
  esGratuidadFamiliar?: boolean;
  /** Called after a successful regularization so the page can refetch its data. */
  onRegularized: () => void;
}

export default function RegularizarDeudaForm({
  membresiaId,
  montoMensual,
  esGratuidadFamiliar = false,
  onRegularized,
}: RegularizarDeudaFormProps): React.ReactElement {
  const { showSuccess, showError } = useToast();

  const [open, setOpen] = useState(false);
  const [mesesAdeudados, setMesesAdeudados] = useState<number | null>(null);
  const [ultimaCoberturaFin, setUltimaCoberturaFin] = useState<string | null>(null);
  const [deudaError, setDeudaError] = useState(false);
  const [fechaInicio, setFechaInicio] = useState<string>(() => clubIsoDate());
  const [fechaFin, setFechaFin] = useState<string>("");
  const [monto, setMonto] = useState<string>(montoMensual > 0 ? String(montoMensual) : "");
  const [motivo, setMotivo] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regularized, setRegularized] = useState(false);

  const loadDeuda = useCallback(async (): Promise<void> => {
    setDeudaError(false);
    try {
      const deuda = await fetchMembresiaDeuda(membresiaId);
      setMesesAdeudados(deuda.mesesAdeudados);
      setUltimaCoberturaFin(deuda.ultimaCoberturaFin);
      if (montoMensual <= 0) {
        setMonto(deuda.montoMensual > 0 ? String(deuda.montoMensual) : "");
      }
    } catch {
      // The tool still works without the number (the backend is the authority);
      // the row just shows the debt as unknown.
      setDeudaError(true);
    }
  }, [membresiaId, montoMensual]);

  function handleOpen(): void {
    setOpen(true);
    setError(null);
    setRegularized(false);
    setFechaInicio(clubIsoDate());
    setFechaFin("");
    setMonto(montoMensual > 0 ? String(montoMensual) : "");
    setMotivo("");
    void loadDeuda();
  }

  function handleClose(): void {
    setOpen(false);
  }

  // Re-fetch the debt while open after a successful regularization so the
  // remaining months (partial regularization) are visible immediately.
  useEffect(() => {
    if (open && !regularized) return;
    if (open && regularized) {
      void loadDeuda();
    }
  }, [open, regularized, loadDeuda]);

  // Issue #400 (slice 4c-b): after every hook above, so this stays a
  // conditional RENDER, not a conditional HOOK CALL (React's rules of
  // hooks — a `useState`/`useEffect` above this line must run on every
  // render regardless of `esGratuidadFamiliar`, or the hook order breaks
  // the moment a membership's gratuity changes between renders).
  if (esGratuidadFamiliar) {
    return (
      <p className="mt-2.5 text-2xs text-ink-3">
        Gratuidad familiar: esta membresía no genera ningún cobro, así que no hay ningún monto que
        regularizar.
      </p>
    );
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await regularizarDeuda(membresiaId, {
        monto: Number(monto) || 0,
        fechaInicio,
        fechaFin,
        motivo: motivo.trim(),
      });
      setRegularized(true);
      showSuccess("Deuda regularizada correctamente.");
      onRegularized();
    } catch (err) {
      setError(toUserMessage(err, "No se pudo registrar la regularización."));
      showError(toUserMessage(err, "No se pudo registrar la regularización."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={open ? handleClose : handleOpen}
        className="inline-flex items-center gap-1 rounded-lg bg-ink/10 px-2.5 py-1 text-2xs tracking-flat font-semibold text-ink transition-colors hover:bg-ink/20"
      >
        <Wallet size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        Regularizar deuda
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-2 rounded-lg border border-line bg-surface p-3"
          aria-label="Regularizar deuda"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-wider text-ink-3">
              Regularizar deuda
            </p>
            {/*
              Issue #313 (K5 hallazgo #15): "Membresía: Vencida" y "0 meses
              adeudados" a la vez leían como una contradicción, aunque las
              dos cifras son individualmente correctas — el estado se vence
              apenas se pasa la cobertura, la deuda solo cuenta MESES
              CALENDARIO COMPLETOS (paridad con el SQL del club, issue #284).
              Cuando todavía no se completó un mes, este chip ya no dice
              "0 meses adeudados" (lee como "no debe nada"): dice desde
              cuándo está vencida, el mismo dato que ya traía esta consulta
              y que antes se pedía y se descartaba.
            */}
            {!deudaError && mesesAdeudados !== null && mesesAdeudados > 0 && (
              <span className="rounded-full bg-cata-red/15 px-2 py-0.5 text-2xs font-semibold text-cata-red">
                {mesesAdeudados} {mesesAdeudados === 1 ? "mes adeudado" : "meses adeudados"}
              </span>
            )}
            {!deudaError && mesesAdeudados === 0 && ultimaCoberturaFin && (
              <span className="rounded-full bg-state-warn-bg px-2 py-0.5 text-2xs font-semibold text-state-warn">
                Vencida desde el {formatDate(ultimaCoberturaFin)}
              </span>
            )}
          </div>

          {deudaError && (
            <p className="mb-2 text-2xs text-ink-3">
              No se pudo calcular la deuda; registre el período directamente.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <CampoFormularioAdmin
              label="Fecha inicio"
              type="date"
              value={fechaInicio}
              onChange={setFechaInicio}
              dateMax={clubIsoDate()}
              required
            />
            <CampoFormularioAdmin
              label="Fecha fin"
              type="date"
              value={fechaFin}
              onChange={setFechaFin}
              required
            />
          </div>

          <CampoFormularioAdmin
            label="Monto"
            type="number"
            value={monto}
            onChange={setMonto}
            labelClassName="mt-2 block text-2xs text-ink-3"
            required
          />
          {montoMensual > 0 && (
            <p className="mt-0.5 text-2xs text-ink-3">
              Precio mensual: {formatCurrency(montoMensual)} — el monto debe ser múltiplo.
            </p>
          )}

          <MotivoObligatorioField
            value={motivo}
            onChange={setMotivo}
            placeholder="Por qué se regulariza (p. ej. demora del club, acuerdo con el socio)"
            labelClassName="mt-2 block text-2xs text-ink-3"
          />

          {error && <p className="mt-2 text-2xs text-cata-red">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1 text-2xs tracking-flat font-semibold text-white transition-colors hover:bg-cata-red/90 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              )}
              {regularized ? "Regularizada" : "Regularizar"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
