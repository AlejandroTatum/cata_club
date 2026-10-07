/**
 * «Socio antiguo» — the admin loads a migrated member's last payment date and
 * the existing regularization does the rest (QA round 2, L17).
 *
 * Shown from the member's Pagos panel while the member has no coverage yet.
 * The last payment date is the START of a one-month period (`+1 month`, the
 * end clamped to the month's last day like the backend's `_sumar_meses`),
 * registered through the same quote + `regularizar-deuda` the «Regularizar
 * deuda» action uses, so the amount is always computed server-side. When the
 * member has no membership yet, it is created first (this form then asks for
 * the plan). If the regularization fails after that, the membership is kept
 * and only the regularization is retried.
 */

"use client";

import LinkifiedText from "@/components/LinkifiedText";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { useToast } from "@/contexts/ToastContext";
import {
  crearMembresia,
  fetchBeneficio,
  fetchCotizacionRegularizacion,
  fetchTiposMembresia,
  regularizarDeuda,
  type TipoMembresiaCatalogo,
} from "@/services/api";
import { clubIsoDate } from "@/lib/club-date";
import { toUserMessage } from "@/lib/error-message";
import { addMonthsIso } from "@/app/student/payments/payments-utils";
import { planOptionLabel } from "@/app/student/enroll/enroll-utils";
import CampoFormularioAdmin from "@/components/admin/CampoFormularioAdmin";
import { describeEstadoMigracion } from "./members-utils";
import { ACTION_TRIGGER, PRIMARY_ACTION_TRIGGER } from "./payment-action-styles";

export const MOTIVO_MIGRACION = "Migración: socio antiguo";

interface MigrarSocioAntiguoFormProps {
  personaId: number;
  /** Existing membership (INACTIVA, never covered); absent → the form creates one. */
  membresiaId?: number;
  /** Called with the «Al día hasta X» / «Debe desde X» line once everything is registered. */
  onDone: (resultado: string) => void;
  /** Refetch without finishing (membership created, regularization pending → use «Regularizar deuda»). */
  onRefetch: () => void;
  onBack: () => void;
}

export default function MigrarSocioAntiguoForm({
  personaId,
  membresiaId,
  onDone,
  onRefetch,
  onBack,
}: MigrarSocioAntiguoFormProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const hoy = clubIsoDate();
  const [tipos, setTipos] = useState<TipoMembresiaCatalogo[]>([]);
  const [tipoId, setTipoId] = useState<number | "">("");
  const [ultimoPago, setUltimoPago] = useState("");
  const [tieneBeneficio, setTieneBeneficio] = useState(false);
  const [aplicarDescuento, setAplicarDescuento] = useState(true);
  const [creadaId, setCreadaId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const necesitaPlan = membresiaId === undefined && creadaId === null;

  useEffect(() => {
    let cancelado = false;
    fetchBeneficio(personaId)
      .then((beneficio) => {
        if (!cancelado) setTieneBeneficio(beneficio !== null);
      })
      .catch(() => undefined);
    if (membresiaId === undefined) {
      fetchTiposMembresia({ soloActivas: true })
        .then((lista) => {
          if (!cancelado) setTipos(lista);
        })
        .catch(() => {
          if (!cancelado) setError("No se pudieron cargar los tipos de membresía.");
        });
    }
    return () => {
      cancelado = true;
    };
  }, [personaId, membresiaId]);

  async function handleSubmit(): Promise<void> {
    if (!ultimoPago) return;
    if (ultimoPago > hoy) {
      setError("La fecha del último pago no puede ser futura.");
      return;
    }
    if (necesitaPlan && !tipoId) {
      setError("Elige el plan del socio.");
      return;
    }
    setLoading(true);
    setError(null);
    let id = membresiaId ?? creadaId;
    let recienCreada = false;
    try {
      if (id === null) {
        id = (await crearMembresia({ personaId, tipoMembresiaId: Number(tipoId) })).id;
        setCreadaId(id);
        recienCreada = true;
      }
      const fechaFin = addMonthsIso(ultimoPago, 1);
      const descuento = tieneBeneficio ? aplicarDescuento : undefined;
      const cotizacion = await fetchCotizacionRegularizacion(id, ultimoPago, fechaFin, descuento);
      await regularizarDeuda(id, {
        monto: Number(cotizacion.montoEsperado),
        fechaInicio: ultimoPago,
        fechaFin,
        motivo: MOTIVO_MIGRACION,
        ...(descuento === undefined ? {} : { aplicarDescuento: descuento }),
      });
      const resultado = describeEstadoMigracion(fechaFin, hoy);
      showSuccess(`Socio antiguo registrado. ${resultado}.`);
      onDone(resultado);
    } catch (err) {
      const detalle = toUserMessage(
        err,
        id === null ? "No se pudo crear la membresía." : "No se pudo registrar el último pago.",
      );
      // Created now or on an earlier attempt: either way the admin must know it exists.
      const message =
        id !== null && (recienCreada || creadaId !== null)
          ? `La membresía se creó, pero no se pudo registrar el último pago: ${detalle} Corrige la fecha y reintenta, o usa «Cargar pagos atrasados».`
          : detalle;
      setError(message);
      showError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-2" role="group" aria-label="Socio antiguo">
      {necesitaPlan && (
        <label className="block text-xs text-ink-3">
          <span>Plan <span aria-hidden="true" className="text-state-bad">*</span></span>
          <select
            value={tipoId}
            onChange={(e) => setTipoId(e.target.value ? Number(e.target.value) : "")}
            className="input-field mt-0.5 text-xs"
          >
            <option value="">Seleccionar plan…</option>
            {tipos.map((tipo) => (
              <option key={tipo.id} value={tipo.id}>
                {planOptionLabel(tipo.categoria, tipo.precio, tipo.periodicidad)}
              </option>
            ))}
          </select>
        </label>
      )}
      <CampoFormularioAdmin
        label="Fecha de su último pago"
        type="date"
        value={ultimoPago}
        onChange={(value) => {
          setUltimoPago(value);
          setError(null);
        }}
        dateMax={hoy}
        required
      />
      {tieneBeneficio && (
        <fieldset>
          <legend className="text-xs text-ink-3">Valor a cobrar</legend>
          <label className="mt-1 flex items-center gap-2 text-xs text-ink">
            <input
              type="radio"
              name="valor-migracion"
              checked={!aplicarDescuento}
              onChange={() => setAplicarDescuento(false)}
            />
            Valor normal
          </label>
          <label className="flex items-center gap-2 text-xs text-ink">
            <input
              type="radio"
              name="valor-migracion"
              checked={aplicarDescuento}
              onChange={() => setAplicarDescuento(true)}
            />
            Aplicar descuento
          </label>
        </fieldset>
      )}
      {error && <p role="alert" className="text-xs text-cata-red"><LinkifiedText text={error} /></p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={loading || !ultimoPago}
          className={`${PRIMARY_ACTION_TRIGGER} w-auto disabled:opacity-50`}
        >
          {loading ? (
            <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
          )}
          Registrar socio antiguo
        </button>
        <button type="button" onClick={onBack} disabled={loading} className={`${ACTION_TRIGGER} w-auto`}>
          Cancelar
        </button>
        {creadaId !== null && error && (
          <button type="button" onClick={onRefetch} disabled={loading} className={`${ACTION_TRIGGER} w-auto`}>
            Cerrar y usar Cargar pagos atrasados
          </button>
        )}
      </div>
    </div>
  );
}
