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

import { useCallback, useEffect, useRef, useState } from "react";
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
import CampoFormularioAdmin from "@/components/admin/CampoFormularioAdmin";

interface PagoCorreccionSectionProps {
  pagoId: number;
  /** Called after a successful correction, so the page can refetch the pago
   *  itself (the corrected monto/fechas live there, not in this section). */
  onCorrected: () => void;
  /**
   * #1668 / S4 — the member's payments page corrects amount, months AND
   * covered dates (start/end), not only the amount. Off by default: the
   * `/payments` queue keeps ADMA-16's amount-only form. The form opens
   * prefilled with what the payment says now and sends only what the admin
   * changed; the history also lists the months and dates that moved.
   */
  extended?: boolean;
  /** Start with the correction form already open (the admin asked to correct). */
  initialOpen?: boolean;
  /** Extended only: the form is the whole section, so it needs its own way out. */
  onCancel?: () => void;
}

/**
 * ADMA-16: by default the admin writes only the correct final amount (and
 * why). `extended` adds months and the two covered dates; for those, "same as
 * the payment now" means "no change" and is never sent.
 */
interface FormState {
  monto: string;
  mesesComprados: string;
  fechaInicio: string;
  fechaFin: string;
  motivo: string;
}

const EMPTY_FORM: FormState = { monto: "", mesesComprados: "", fechaInicio: "", fechaFin: "", motivo: "" };

/** What the payment says right now — the baseline an extended correction is measured against. */
interface PagoActual {
  monto: string;
  fechaInicio: string;
  fechaFin: string;
}

const EFECTO_LABEL: Record<CorreccionPago["efectoCobertura"], string> = {
  SIN_CAMBIO: "Sin cambio en la cobertura",
  AMPLIADA: "Cobertura ampliada",
  REDUCIDA: "Cobertura reducida",
};

/** «22/08» — day and month, for a title that already names the payment. */
function shortDate(iso: string): string {
  return formatDate(iso).slice(0, 5);
}

/** The server derives the base amount and the tariff from the final amount. */
function buildInput(form: FormState): CorreccionPagoInput {
  return { motivo: form.motivo.trim(), monto: form.monto.trim() };
}

/** Extended: only the fields that differ from the payment as it stands today. */
function buildExtendedInput(form: FormState, actual: PagoActual): CorreccionPagoInput {
  const input: CorreccionPagoInput = { motivo: form.motivo.trim() };
  const monto = form.monto.trim();
  if (monto && Number(monto) !== Number(actual.monto)) input.monto = monto;
  const meses = Number(form.mesesComprados);
  if (form.mesesComprados.trim() && Number.isInteger(meses) && meses > 0) input.mesesComprados = meses;
  if (form.fechaInicio && form.fechaInicio !== actual.fechaInicio) input.fechaInicio = form.fechaInicio;
  if (form.fechaFin && form.fechaFin !== actual.fechaFin) input.fechaFin = form.fechaFin;
  return input;
}

/** «Etiqueta: antes → después», only for a value that actually moved. */
function changedLine<T extends string | number | null>(
  label: string,
  before: T,
  after: T,
  format: (value: NonNullable<T>) => string,
): string | null {
  if (before === after || before === null || after === null) return null;
  return `${label}: ${format(before as NonNullable<T>)} → ${format(after as NonNullable<T>)}`;
}

/** Field labels in the app's normal body type (the admin field default is the small caption step). */
const FIELD_LABEL = "mt-2 block text-sm text-ink-2";

export default function PagoCorreccionSection({
  pagoId,
  onCorrected,
  extended = false,
  initialOpen = false,
  onCancel,
}: PagoCorreccionSectionProps): React.ReactElement {
  const { showSuccess, showError } = useToast();
  const [comprobanteUrl, setComprobanteUrl] = useState<string | null>(null);
  const [correcciones, setCorrecciones] = useState<CorreccionPago[]>([]);
  // `initialOpen` applies to the first load only: a refetch after a correction must not reopen the form.
  const autoOpened = useRef(false);
  const [pagoActual, setPagoActual] = useState<PagoActual | null>(null);
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
      const actual = { monto: pago.monto, fechaInicio: pago.fechaInicio, fechaFin: pago.fechaFin };
      setPagoActual(actual);
      if (initialOpen && extended && !autoOpened.current) {
        autoOpened.current = true;
        setForm((current) => (current === EMPTY_FORM ? { ...EMPTY_FORM, ...actual } : current));
        setFormOpen(true);
      }
      setCorrecciones(historial);
    } catch (err) {
      console.error("[payments] PagoCorreccionSection load failed", err);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [pagoId, extended, initialOpen]);

  useEffect(() => {
    void load();
  }, [load]);

  // Extended: the form opens on the payment as it stands, so only edits count.
  function openForm(): void {
    setForm(
      extended && pagoActual
        ? { ...EMPTY_FORM, monto: pagoActual.monto, fechaInicio: pagoActual.fechaInicio, fechaFin: pagoActual.fechaFin }
        : EMPTY_FORM,
    );
    setSubmitError(null);
    setFormOpen(true);
  }

  const input = extended && pagoActual ? buildExtendedInput(form, pagoActual) : buildInput(form);
  const hasChange = extended ? Object.keys(input).length > 1 : Boolean(form.monto.trim());
  // Extended: what will change, as «antes → después», shown before the admin confirms.
  const cambios =
    extended && pagoActual
      ? [
          changedLine("Monto", Number(pagoActual.monto), input.monto ? Number(input.monto) : null, (v) => formatCurrency(v)),
          input.mesesComprados ? `Meses comprados: pasa a ${input.mesesComprados}` : null,
          changedLine("Desde", pagoActual.fechaInicio, input.fechaInicio ?? null, formatDate),
          changedLine("Hasta", pagoActual.fechaFin, input.fechaFin ?? null, formatDate),
        ].filter((line): line is string => line !== null)
      : [];
  const canSubmit = !submitting && hasChange && Boolean(form.motivo.trim());

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await corregirPago(pagoId, input);
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
        <h2 className="flex-1 text-sm font-bold text-ink">
          {extended && pagoActual
            ? `Corregir el pago de ${formatCurrency(Number(pagoActual.monto))} del ${shortDate(pagoActual.fechaInicio)} al ${shortDate(pagoActual.fechaFin)}`
            : "Comprobante y correcciones"}
        </h2>
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
                <li key={c.id} className="text-xs text-ink-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-ink">{formatDate(c.fechaRegistro)}</span>
                    <Badge tone="neutral">{EFECTO_LABEL[c.efectoCobertura]}</Badge>
                  </div>
                  <p className="mt-0.5">
                    Monto: {formatCurrency(Number(c.montoAnterior))} → {formatCurrency(Number(c.montoNuevo))}
                  </p>
                  {extended &&
                    [
                      changedLine("Meses", c.mesesCompradosAnterior, c.mesesCompradosNuevo, String),
                      changedLine("Desde", c.fechaInicioAnterior, c.fechaInicioNuevo, formatDate),
                      changedLine("Hasta", c.fechaFinAnterior, c.fechaFinNuevo, formatDate),
                    ].map((line) => line && <p key={line} className="mt-0.5">{line}</p>)}
                  <p className="mt-0.5 italic text-ink-3">&ldquo;{c.motivo}&rdquo;</p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 border-t border-line pt-3">
            {!extended && (
            <button
              type="button"
              onClick={() => (formOpen ? setFormOpen(false) : openForm())}
              className="inline-flex items-center gap-1 rounded-lg bg-ink/10 px-2.5 py-1 text-xs font-semibold text-ink transition-colors hover:bg-ink/20"
            >
              <Pencil size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Corregir pago
            </button>
            )}

            {formOpen && (
              <form onSubmit={handleSubmit} className="mt-2 rounded-lg border border-line bg-surface p-3">
                {extended && (
                  <p className="mb-2 text-sm text-ink-3">
                    Cambia solo lo que está mal; lo que dejes igual no se modifica. Si te equivocaste de mes,
                    cambia las fechas. El sistema comprueba que los meses no se superpongan con otros pagos.
                  </p>
                )}
                <CampoFormularioAdmin
                  label={extended ? "Monto" : "Monto correcto"}
                  type="number"
                  value={form.monto}
                  onChange={(v) => setForm((f) => ({ ...f, monto: v }))}
                  required={!extended}
                  labelClassName={FIELD_LABEL}
                />
                <p className="mt-1 text-sm text-ink-3">
                  Escribe el monto correcto; el sistema ajusta la tarifa y la base.
                  {extended && " En Meses, déjalo vacío si no cambia."}
                </p>

                {extended && (
                  <>
                    <CampoFormularioAdmin
                      label="Meses"
                      type="number"
                      value={form.mesesComprados}
                      onChange={(v) => setForm((f) => ({ ...f, mesesComprados: v }))}
                      numberStep="1"
                      numberMin="1"
                      numberInputMode="numeric"
                      labelClassName={FIELD_LABEL}
                    />
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <CampoFormularioAdmin
                        label="Desde"
                        type="date"
                        value={form.fechaInicio}
                        onChange={(v) => setForm((f) => ({ ...f, fechaInicio: v }))}
                        labelClassName={FIELD_LABEL}
                      />
                      <CampoFormularioAdmin
                        label="Hasta"
                        type="date"
                        value={form.fechaFin}
                        onChange={(v) => setForm((f) => ({ ...f, fechaFin: v }))}
                        labelClassName={FIELD_LABEL}
                      />
                    </div>
                  </>
                )}

                <CampoFormularioAdmin
                  label="Motivo (obligatorio)"
                  type="textarea"
                  value={form.motivo}
                  onChange={(v) => setForm((f) => ({ ...f, motivo: v }))}
                  placeholder="Por qué se corrige (p. ej. error de tipeo, descuento mal aplicado)"
                  labelClassName={FIELD_LABEL}
                  required
                />

                {cambios.length > 0 && (
                  <div className="mt-3 rounded-ctl border border-line bg-paper p-3 text-sm text-ink">
                    <p className="font-semibold">Se va a cambiar</p>
                    <ul className="mt-1 grid gap-0.5 text-ink-2">
                      {cambios.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {submitError && (
                  <p role="alert" className="mt-2 text-sm text-state-bad">
                    {submitError}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-2">
                  <Button type="submit" size="sm" disabled={!canSubmit}>
                    {submitting ? (
                      <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
                    )}
                    Registrar corrección
                  </Button>
                  <button
                    type="button"
                    onClick={() => (extended && onCancel ? onCancel() : setFormOpen(false))}
                    className="rounded-lg border border-line px-2.5 py-1 text-sm text-ink-2 transition-colors hover:bg-paper"
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
