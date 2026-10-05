"use client";

/** Read-only "Bonificaciones" list for the admin payments review (issue #1609). */

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { formatCurrency } from "@/lib/format-utils";
import { ICON } from "@/lib/icon-size";

interface BonificacionItem {
  id: number;
  personaId: number;
  personaNombreCompleto: string;
  membresiaId: number;
  monto: string;
  fechaInicio: string;
  fechaFin: string;
  otorgadaEn: string;
}

/**
 * 100% benefit coverages never create a `Pago`, so they are not in the queue
 * above; this lists them read-only with the amount charged ($0,00) and the
 * same "Recibo oficial" the student downloads. Renders nothing while loading,
 * on error, or when there are none — the queue is the screen's job.
 */
export function BonificacionesSection(): React.ReactElement | null {
  const [items, setItems] = useState<BonificacionItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/membresias/coberturas/todas?skip=0&limit=50")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { items?: BonificacionItem[] } | null) => {
        if (!cancelled && body?.items) setItems(body.items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="bonificaciones-title" className="mt-8" data-testid="bonificaciones-section">
      <h2 id="bonificaciones-title" className="text-base font-bold text-ink">
        Bonificaciones
      </h2>
      <p className="mt-0.5 text-sm text-ink-3-strong">
        Coberturas otorgadas con un beneficio del 100%. No generan cobro.
      </p>
      <ul className="mt-3 flex flex-col divide-y divide-line rounded-ctl border border-line">
        {items.map((item) => (
          <li key={item.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:gap-5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">{item.personaNombreCompleto}</p>
              <p className="mt-0.5 text-xs text-ink-3-strong">
                <span className="tabular-nums">{formatDateRange(item.fechaInicio, item.fechaFin)}</span> · Otorgada el{" "}
                <span className="tabular-nums">{formatDate(item.otorgadaEn)}</span>
              </p>
            </div>
            <p className="flex-none text-lg font-extrabold tabular-nums text-ink md:w-24 md:text-right">
              {formatCurrency(item.monto)}
            </p>
            <a
              href={`/api/membresias/coberturas/${item.id}/comprobante`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Descargar recibo oficial de ${item.personaNombreCompleto}`}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-ctl bg-coal px-3 text-xs font-semibold text-white hover:bg-ink md:w-48"
            >
              <Download size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Recibo oficial
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
