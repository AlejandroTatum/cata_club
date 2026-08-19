/**
 * Correcciones financieras auditables + comprobante oficial — issue #400,
 * criterios 7 y 8.
 *
 * Vive en `renderDetail` de `/payments`, SOLO para un pago ya `validado`
 * (aprobado): el backend `corregir_pago` exige un pago APROBADO (los seis
 * campos corregibles son los mismos que congela `registrar_pago` al
 * aprobar), y el comprobante oficial (PDF de Celery, ver
 * `comprobante_tareas.py`) por construcción no existe hasta que el pago fue
 * aprobado — no hace falta repetir ese chequeo de estado acá.
 *
 * Un solo fetch (`fetchPagoDetalle`) trae el comprobante oficial fresco; un
 * segundo (`fetchCorrecciones`) trae el historial de auditoría. Ninguno de
 * los dos vive en el `PagoListItemDTO` que ya carga la cola — de ahí el
 * round-trip extra, solo para el pago que el admin efectivamente abrió.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, History, Loader2, Pencil } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import { Badge, Button } from "@/components/ui";
import {
  fetchPagoDetalle,
  fetchCorrecciones,
  corregirPago,
  type CorreccionPago,
  type CorreccionPagoInput,
} from "@/services/api";
import { formatCurrency, formatDate } from "@/lib/format-utils";
import { toUserMessage } from "@/lib/error-message";
import { useToast } from "@/contexts/ToastContext";
import MotivoObligatorioField from "@/components/admin/MotivoObligatorioField";
import CampoFormularioAdmin from "@/components/admin/CampoFormularioAdmin";

interface PagoCorreccionSectionProps {
  pagoId: number;
  /** Called after a successful correction, so the page can refetch the pago
   *  itself (the corrected monto/fechas live there, not in this section). */
  onCorrected: () => void;
}

/** Los seis campos financieros que `CorreccionPagoDTO` admite, todos opcionales. */
interface FormState {
  tarifaMensualAplicada: string;
  mesesComprados: string;
  montoBase: string;
  monto: string;
  fechaInicio: string;
  fechaFin: string;
  motivo: string;
}

const EMPTY_FORM: FormState = {
  tarifaMensualAplicada: "",
  mesesComprados: "",
  montoBase: "",
  monto: "",
  fechaInicio: "",
  fechaFin: "",
  motivo: "",
};

const EFECTO_LABEL: Record<CorreccionPago["efectoCobertura"], string> = {
  SIN_CAMBIO: "Sin cambio en la cobertura",
  AMPLIADA: "Cobertura ampliada",
  REDUCIDA: "Cobertura reducida",
};

/** Solo los campos con valor se envían — "sin cambio" para el resto. */
function buildInput(form: FormState): CorreccionPagoInput {
  const input: CorreccionPagoInput = { motivo: form.motivo.trim() };
  if (form.tarifaMensualAplicada.trim()) input.tarifaMensualAplicada = form.tarifaMensualAplicada.trim();
  if (form.mesesComprados.trim()) input.mesesComprados = Number(form.mesesComprados);
  if (form.montoBase.trim()) input.montoBase = form.montoBase.trim();
  if (form.monto.trim()) input.monto = form.monto.trim();
  if (form.fechaInicio.trim()) input.fechaInicio = form.fechaInicio.trim();
  if (form.fechaFin.trim()) input.fechaFin = form.fechaFin.trim();
  return input;
}

export default function PagoCorreccionSection({
  pagoId,
  onCorrected,
}: PagoCorreccionSectionProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [comprobanteUrl, setComprobanteUrl] = useState<string | null>(null);
  const [correcciones, setCorrecciones] = useState<CorreccionPago[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [pago, historial] = await Promise.all([
        fetchPagoDetalle(pagoId),
        fetchCorrecciones(pagoId),
      ]);
      setComprobanteUrl(pago.comprobanteOficialUrl ?? null);
      setCorrecciones(historial);
    } catch (err) {
      console.error("[payments] PagoCorreccionSection load failed", err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [pagoId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!form.motivo.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await corregirPago(pagoId, buildInput(form));
      showSuccess("Corrección registrada correctamente.");
      setFormOpen(false);
      setForm(EMPTY_FORM);
      await load();
      onCorrected();
    } catch (err) {
      const message = toUserMessage(err, "No se pudo registrar la corrección.");
      setSubmitError(message);
      showError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card p-[18px]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <History size={ICON.sm} strokeWidth={1.5} className="text-ink-3" aria-hidden="true" />
        <h2 className="flex-1 text-sm font-bold text-ink">Comprobante y correcciones</h2>
      </div>

      {loading && <p className="text-xs text-ink-3">Cargando…</p>}
      {loadFailed && !loading && (
        <p className="text-xs text-state-bad">
          No se pudo cargar el comprobante oficial ni el historial de correcciones.
        </p>
      )}

      {!loading && !loadFailed && (
        <>
          {comprobanteUrl ? (
            <a
              href={comprobanteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-cata-red underline-offset-2 hover:underline"
            >
              <Download size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Descargar comprobante oficial
            </a>
          ) : (
            <p className="text-xs text-ink-3">El comprobante oficial todavía no está disponible.</p>
          )}

          {correcciones.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              {correcciones.map((c) => (
                <li key={c.id} className="text-2xs text-ink-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-ink">{formatDate(c.fechaRegistro)}</span>
                    <Badge tone="neutral">{EFECTO_LABEL[c.efectoCobertura]}</Badge>
                  </div>
                  <p className="mt-0.5">
                    Monto: {formatCurrency(Number(c.montoAnterior))} → {formatCurrency(Number(c.montoNuevo))}
                  </p>
                  <p className="mt-0.5 italic text-ink-3">&ldquo;{c.motivo}&rdquo;</p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 border-t border-line pt-3">
            <button
              type="button"
              onClick={() => setFormOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg bg-ink/10 px-2.5 py-1 text-2xs tracking-flat font-semibold text-ink transition-colors hover:bg-ink/20"
            >
              <Pencil size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Corregir pago
            </button>

            {formOpen && (
              <form onSubmit={handleSubmit} className="mt-2 rounded-lg border border-line bg-surface p-3">
                <div className="grid grid-cols-2 gap-2">
                  <CampoFormularioAdmin
                    label="Tarifa mensual"
                    type="number"
                    value={form.tarifaMensualAplicada}
                    onChange={(v) => setForm((f) => ({ ...f, tarifaMensualAplicada: v }))}
                  />
                  <CampoFormularioAdmin
                    label="Meses comprados"
                    type="number"
                    value={form.mesesComprados}
                    onChange={(v) => setForm((f) => ({ ...f, mesesComprados: v }))}
                    numberMin="1"
                    numberStep="1"
                    numberInputMode="numeric"
                  />
                  <CampoFormularioAdmin
                    label="Monto base"
                    type="number"
                    value={form.montoBase}
                    onChange={(v) => setForm((f) => ({ ...f, montoBase: v }))}
                  />
                  <CampoFormularioAdmin
                    label="Monto final"
                    type="number"
                    value={form.monto}
                    onChange={(v) => setForm((f) => ({ ...f, monto: v }))}
                  />
                  <CampoFormularioAdmin
                    label="Fecha inicio"
                    type="date"
                    value={form.fechaInicio}
                    onChange={(v) => setForm((f) => ({ ...f, fechaInicio: v }))}
                  />
                  <CampoFormularioAdmin
                    label="Fecha fin"
                    type="date"
                    value={form.fechaFin}
                    onChange={(v) => setForm((f) => ({ ...f, fechaFin: v }))}
                  />
                </div>

                <MotivoObligatorioField
                  value={form.motivo}
                  onChange={(v) => setForm((f) => ({ ...f, motivo: v }))}
                  placeholder="Por qué se corrige (p. ej. error de tipeo, descuento mal aplicado)"
                  labelClassName="mt-2 block text-2xs text-ink-3"
                />

                {submitError && <p className="mt-2 text-2xs text-state-bad">{submitError}</p>}

                <div className="mt-3 flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={submitting || !form.motivo.trim()}>
                    {submitting ? (
                      <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                    )}
                    Registrar corrección
                  </Button>
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-paper"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        </>
      )}
    </section>
  );
}
