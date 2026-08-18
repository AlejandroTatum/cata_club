/**
 * Beneficio del club — a persona's assigned discount (issue #398).
 *
 * This replaces the per-payment discount picker that used to live in
 * `RegisterPaymentForm`: since the backend now resolves a payment's discount
 * from the person's ASSIGNED benefit (and ignores `descuento_ids`
 * altogether), the discount stopped being a per-payment choice and became a
 * standing attribute of the person, assigned and retired here.
 *
 * Always visible (unlike `CreateMembershipForm`/`RegisterPaymentForm`, which
 * only reveal their form on click): an admin needs to see "Sin beneficio" or
 * the active one without an extra click, so this fetches on mount.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { Gift, Loader2, Plus } from "lucide-react";
import { ICON } from "@/lib/icon-size";
import ConfirmDialog from "@/components/ConfirmDialog";
import { DataBox, ErrorState, LoadingState } from "@/components/ui";
import { useToast } from "@/contexts/ToastContext";
import { fetchBeneficio, asignarBeneficio, retirarBeneficio, fetchDescuentos } from "@/services/api";
import type { BeneficioAsignado, DescuentoCatalogo } from "@/services/api";
import { descuentosActivos, descuentoValorLabel } from "@/app/discounts/discounts-utils";
import { toUserMessage } from "@/lib/error-message";

interface BeneficioSectionProps {
  personaId: number;
}

export default function BeneficioSection({ personaId }: BeneficioSectionProps): React.ReactElement {
  const { showSuccess, showError } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [beneficio, setBeneficio] = useState<BeneficioAsignado | null>(null);

  // Assign flow: the catalog is fetched lazily when the picker opens (same
  // lazy-load pattern `RegisterPaymentForm` used to have), and only ACTIVE
  // discounts are ever offered.
  const [assignOpen, setAssignOpen] = useState(false);
  const [catalogo, setCatalogo] = useState<DescuentoCatalogo[] | null>(null);
  const [selectedDescuentoId, setSelectedDescuentoId] = useState<number | "">("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const [pendingRetiro, setPendingRetiro] = useState(false);
  const [retiroLoading, setRetiroLoading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      setBeneficio(await fetchBeneficio(personaId));
    } catch (err) {
      setLoadError(toUserMessage(err, "No se pudo cargar el beneficio."));
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    void load();
  }, [load]);

  function openAssign(): void {
    setAssignOpen(true);
    setAssignError(null);
    setSelectedDescuentoId("");
    if (catalogo === null) {
      fetchDescuentos()
        .then(setCatalogo)
        // A failed catalog fetch never blocks the rest of the panel: the
        // picker simply offers nothing (same as an empty catalog).
        .catch(() => setCatalogo([]));
    }
  }

  async function handleAssign(): Promise<void> {
    if (!selectedDescuentoId) return;
    setAssignLoading(true);
    setAssignError(null);
    try {
      const nuevo = await asignarBeneficio(personaId, Number(selectedDescuentoId));
      setBeneficio(nuevo);
      setAssignOpen(false);
      showSuccess("Beneficio asignado correctamente.");
    } catch (err) {
      const msg = toUserMessage(err, "No se pudo asignar el beneficio.");
      setAssignError(msg);
      showError(msg);
    } finally {
      setAssignLoading(false);
    }
  }

  async function confirmRetiro(): Promise<void> {
    setPendingRetiro(false);
    setRetiroLoading(true);
    try {
      await retirarBeneficio(personaId);
      setBeneficio(null);
      showSuccess("Beneficio retirado. Los pagos históricos no cambian.");
    } catch (err) {
      showError(toUserMessage(err, "No se pudo retirar el beneficio."));
    } finally {
      setRetiroLoading(false);
    }
  }

  const ofrecidos = descuentosActivos(catalogo ?? []);

  return (
    <div className="mt-2.5 rounded-ctl border border-line bg-sunken p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
        <Gift size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
        Beneficio del club
      </p>

      {loading && <LoadingState label="Cargando beneficio…" />}

      {!loading && loadError && <ErrorState message={loadError} onRetry={() => void load()} />}

      {!loading && !loadError && beneficio && (
        <div className="space-y-field">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex flex-col items-start gap-0.5">
              <span className="text-2xs text-ink-3">Beneficio</span>
              <DataBox>{beneficio.descuento.nombre}</DataBox>
            </span>
            <span className="inline-flex flex-col items-start gap-0.5">
              <span className="text-2xs text-ink-3">Valor</span>
              <DataBox>{descuentoValorLabel(beneficio.descuento)}</DataBox>
            </span>
          </div>
          {/* Who granted it — the whole point of an auditable assignment
              (issue #398). The backend exposes only the assigning admin's
              persona id, not their name (`AsignacionDescuentoResponseDTO`
              carries `asignado_por_persona_id`, no nested persona). */}
          <p className="text-2xs text-ink-3">Asignado por persona #{beneficio.asignadoPorPersonaId}</p>
          <button
            type="button"
            onClick={() => setPendingRetiro(true)}
            disabled={retiroLoading}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors hover:bg-paper disabled:opacity-50"
          >
            {retiroLoading ? <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" /> : null}
            Retirar beneficio
          </button>
        </div>
      )}

      {!loading && !loadError && !beneficio && (
        <div className="space-y-field">
          <p className="text-xs text-ink-3">Sin beneficio</p>
          {!assignOpen && (
            <button
              type="button"
              onClick={openAssign}
              className="inline-flex items-center gap-1 rounded-lg bg-cata-red/15 px-2.5 py-1 text-xs font-semibold text-cata-red transition-colors hover:bg-cata-red/25"
            >
              <Plus size={ICON.sm} strokeWidth={2} aria-hidden="true" />
              Asignar beneficio
            </button>
          )}
          {assignOpen && (
            <div className="space-y-field">
              {catalogo === null ? (
                <p className="text-2xs text-ink-3">Cargando catálogo…</p>
              ) : ofrecidos.length === 0 ? (
                <p className="text-2xs text-ink-3">No hay descuentos activos en el catálogo.</p>
              ) : (
                <select
                  value={selectedDescuentoId}
                  onChange={(e) => setSelectedDescuentoId(e.target.value ? Number(e.target.value) : "")}
                  className="input-field text-xs"
                >
                  <option value="">Seleccionar descuento…</option>
                  {ofrecidos.map((descuento) => (
                    <option key={descuento.id} value={descuento.id}>
                      {descuento.nombre} · {descuentoValorLabel(descuento)}
                    </option>
                  ))}
                </select>
              )}
              {assignError && <p className="text-xs text-state-bad">{assignError}</p>}
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleAssign()}
                  disabled={!selectedDescuentoId || assignLoading || catalogo === null}
                  className="inline-flex items-center gap-1 rounded-lg bg-cata-red px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-cata-red/80 disabled:opacity-50"
                >
                  {assignLoading ? (
                    <Loader2 size={ICON.sm} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus size={ICON.sm} aria-hidden="true" />
                  )}
                  Asignar
                </button>
                <button
                  type="button"
                  onClick={() => setAssignOpen(false)}
                  className="rounded-lg border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:bg-paper"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingRetiro}
        variant="danger"
        title="Retirar beneficio"
        message={
          beneficio
            ? `Va a retirar el beneficio «${beneficio.descuento.nombre}» de esta persona. Los pagos históricos no cambian.`
            : ""
        }
        confirmLabel="Retirar"
        onConfirm={() => void confirmRetiro()}
        onCancel={() => setPendingRetiro(false)}
      />
    </div>
  );
}
