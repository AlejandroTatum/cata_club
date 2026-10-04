/**
 * Regularize a membership's owed months — the admin bookkeeping tool for
 * issue #284 (a membership whose coverage lapsed and whose unpaid months the
 * normal payment flow silently forgives).
 *
 * The debt is DERIVED (no stored column): owed months from the last approved
 * coverage to today, fetched from the backend when the form opens. The admin
 * records explicit retroactive dates (inicio/fin) + a mandatory motivo; the
 * backend validates no-overlap with approved coverage, then the payment enters
 * APROBADO directly. The monto is NOT typed (QA3 ADM-09): the backend quotes it
 * from the period (monthly price x months, minus the person's active discount)
 * and rejects any other amount, so the form shows that quote and submits it.
 *
 * It doubles as the migration tool for existing members (issue #1492): the
 * admin loads the real paid dates from the club's notebook, and when the
 * period covers today the backend also activates the membership.
 *
 * Partial regularization is allowed: covering 1 of 4 months settles that month
 * and the other 3 stay visible as debt on the next fetch.
 *
 * This form is admin-only by construction: the members page it lives on is
 * `allowedRoles={["admin"]}` and the backend endpoints demand ADMINISTRADOR.
 */

"use client";

import LinkifiedText from "@/components/LinkifiedText";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Wallet } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import {
  fetchCotizacionRegularizacion,
  fetchMembresiaDeuda,
  regularizarDeuda,
  type CotizacionRegularizacion,
} from "@/services/api";
import { calendarIsoDate, clubIsoDate, clubToday } from "@/lib/club-date";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { toUserMessage } from "@/lib/error-message";
import CampoFormularioAdmin from "@/components/admin/CampoFormularioAdmin";
import {
  MAX_MESES_COBERTURA,
  MENSAJE_MESES_MAXIMO_EXCEDIDO,
} from "@/app/student/payments/payments-utils";
import { MIN_TARGET_CLASS } from "@/lib/target-size";
import { ACTION_TRIGGER, PRIMARY_ACTION_TRIGGER } from "./payment-action-styles";

interface RegularizarDeudaFormProps {
  /** Backend membership id (the one the admin BFF aggregates, not the display label). */
  membresiaId: number;
  /** Monthly price (monto_aplicado) — shown as a hint next to the quoted amount. */
  montoMensual: number;
  /**
   * `Membresia.esGratuidadFamiliar` (issue #400, slice 4c-b) — since that
   * slice `montoMensual` stays the real, nonzero tariff even for a
   * gratuitous membership (E04-RF002 stopped zeroing it), so this form
   * would otherwise quote a real dollar amount as if it were owed. It is
   * not: the backend only accepts $0 when a 100% discount
   * quotes it, and a gratuitous member who does not pay has
   * no dollar amount to "catch up on" — the form is blocked entirely for
   * this case rather than showing a number that does not apply.
   */
  esGratuidadFamiliar?: boolean;
  /** Called after a successful regularization so the page can refetch its data. */
  onRegularized: () => void;
  /** Draw the trigger as the dialog's one red primary (when there is debt to clear). */
  primary?: boolean;
}

export default function RegularizarDeudaForm({
  membresiaId,
  montoMensual,
  esGratuidadFamiliar = false,
  onRegularized,
  primary = false,
}: RegularizarDeudaFormProps): React.ReactElement {
  const { showSuccess, showError } = useToast();

  const [open, setOpen] = useState(false);
  const [mesesAdeudados, setMesesAdeudados] = useState<number | null>(null);
  const [ultimaCoberturaFin, setUltimaCoberturaFin] = useState<string | null>(null);
  const [deudaError, setDeudaError] = useState(false);
  const [fechaInicio, setFechaInicio] = useState<string>(() => clubIsoDate());
  const [fechaFin, setFechaFin] = useState<string>("");
  const [cotizacion, setCotizacion] = useState<CotizacionRegularizacion | null>(null);
  const [cotizando, setCotizando] = useState(false);
  const [cotizacionError, setCotizacionError] = useState<string | null>(null);
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
    } catch {
      // The tool still works without the number (the backend is the authority);
      // the row just shows the debt as unknown.
      setDeudaError(true);
    }
  }, [membresiaId]);

  function handleOpen(): void {
    setOpen(true);
    setError(null);
    setRegularized(false);
    setFechaInicio(clubIsoDate());
    setFechaFin("");
    setCotizacion(null);
    setCotizacionError(null);
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

  // QA3 ADM-09: quote the amount whenever a valid period is set. `cancelado`
  // drops a stale answer when the dates change again mid-flight.
  useEffect(() => {
    setCotizacion(null);
    setCotizacionError(null);
    if (!open || !fechaInicio || !fechaFin || fechaInicio >= fechaFin) return;
    let cancelado = false;
    setCotizando(true);
    fetchCotizacionRegularizacion(membresiaId, fechaInicio, fechaFin)
      .then((resultado) => {
        if (!cancelado) setCotizacion(resultado);
      })
      .catch((err: unknown) => {
        if (!cancelado) {
          setCotizacionError(toUserMessage(err, "No se pudo calcular el monto de la regularización."));
        }
      })
      .finally(() => {
        if (!cancelado) setCotizando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [open, membresiaId, fechaInicio, fechaFin]);

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

  function validate(): string | null {
    if (!fechaInicio || !fechaFin) return "Las fechas son obligatorias.";
    if (fechaInicio >= fechaFin) return "La fecha de inicio debe ser anterior a la de fin.";
    if (!motivo.trim()) return "Debes indicar el motivo de la regularización.";
    if (!cotizacion) return cotizacionError ?? "Espera a que se calcule el monto de la regularización.";
    if (cotizacion.meses > MAX_MESES_COBERTURA) return MENSAJE_MESES_MAXIMO_EXCEDIDO;
    // $0 is valid: a 100% discount quotes zero and the backend accepts exactly that.
    if (!(Number(cotizacion.montoEsperado) >= 0)) return "El monto a regularizar no es válido.";
    return null;
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const invalid = validate();
    if (invalid || !cotizacion) {
      setError(invalid);
      if (invalid) showError(invalid);
      return;
    }

    setLoading(true);
    try {
      await regularizarDeuda(membresiaId, {
        monto: Number(cotizacion.montoEsperado),
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
    <div>
      <button
        type="button"
        onClick={open ? handleClose : handleOpen}
        className={primary ? PRIMARY_ACTION_TRIGGER : ACTION_TRIGGER}
      >
        <Wallet size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        Regularizar deuda
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          // `noValidate` hands every check (including the `required` fields)
          // to `validate()`, so the browser never swallows the `submit` event
          // with a native, English tooltip before the Spanish message runs.
          noValidate
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
              No se pudo calcular la deuda; registra el período directamente.
            </p>
          )}

          <p className="mb-2 text-2xs text-ink-3">
            Registra aquí los meses atrasados que el jugador ya pagó o debe regularizar. Si el
            período incluye hoy, la membresía queda activa.
          </p>

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

          <div className="mt-2" aria-live="polite">
            <p className="text-2xs text-ink-3">Monto a regularizar</p>
            {cotizando && <p className="text-xs text-ink-3">Calculando…</p>}
            {!cotizando && cotizacion && (
              <>
                <p className="text-sm font-semibold text-ink">
                  {formatCurrency(Number(cotizacion.montoEsperado))}
                </p>
                <p className="mt-0.5 text-2xs text-ink-3">
                  {cotizacion.meses} {cotizacion.meses === 1 ? "mes" : "meses"}
                  {montoMensual > 0 ? ` × ${formatCurrency(montoMensual)}` : ""}
                  {Number(cotizacion.descuentoAplicado) > 0
                    ? ` − beneficio de ${formatCurrency(Number(cotizacion.descuentoAplicado))}`
                    : ""}
                </p>
              </>
            )}
            {!cotizando && !cotizacion && !cotizacionError && (
              <p className="text-xs text-ink-3">Indica las fechas para calcular el monto.</p>
            )}
            {cotizacionError && <p className="text-2xs text-cata-red"><LinkifiedText text={cotizacionError} /></p>}
          </div>

          <CampoFormularioAdmin
            label="Motivo (obligatorio)"
            type="textarea"
            value={motivo}
            onChange={setMotivo}
            placeholder="Por qué se regulariza (p. ej. demora del club, acuerdo con el jugador)"
            labelClassName="mt-2 block text-2xs text-ink-3"
            required
          />

          {error && <p className="mt-2 text-2xs text-cata-red"><LinkifiedText text={error} /></p>}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className={`inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1 text-2xs tracking-flat font-semibold text-white transition-colors hover:bg-cata-red/90 disabled:opacity-50 ${MIN_TARGET_CLASS}`}
            >
              {loading ? (
                <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              )}
              {regularized ? "Regularizada" : "Regularizar"}
            </button>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              className={`inline-flex items-center rounded-lg border border-line-2 bg-paper px-2.5 py-1 text-2xs tracking-flat font-semibold text-ink-2 transition-colors hover:bg-surface disabled:opacity-50 ${MIN_TARGET_CLASS}`}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
