"use client";

/** Read-only "Bonificaciones" list for the admin payments review (issue #1609). */

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { formatCurrency } from "@/lib/format-utils";
import { ICON } from "@/lib/icon-size";
import { Button, buttonClasses } from "@/components/ui";

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

// A load-more batch, not a table page: the list renders every loaded row. Ten
// is the size of every other list's page, so sixty coverages are six short
// steps instead of one 4,000px column.
const LOAD_MORE_BATCH = 10;

interface BonificacionesPage {
  items?: BonificacionItem[];
  total?: number;
}

/**
 * 100% benefit coverages never create a `Pago`, so they are not in the queue
 * above; this lists them read-only with the amount charged ($0,00) and the
 * same "Recibo oficial" the student downloads. Renders nothing while loading,
 * on error, or when there are none — the queue is the screen's job.
 */
export function BonificacionesSection(): React.ReactElement | null {
  const [items, setItems] = useState<BonificacionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/membresias/coberturas/todas?skip=0&limit=${LOAD_MORE_BATCH}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: BonificacionesPage | null) => {
        if (cancelled || !body?.items) return;
        setItems(body.items);
        setTotal(body.total ?? body.items.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(async (): Promise<void> => {
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const res = await fetch(`/api/membresias/coberturas/todas?skip=${items.length}&limit=${LOAD_MORE_BATCH}`);
      const body: BonificacionesPage | null = res.ok ? await res.json() : null;
      const nextItems = body?.items;
      if (!body || !nextItems) throw new Error("bonificaciones page failed");
      setItems((previous) => {
        const seen = new Set(previous.map((i) => i.id));
        return [...previous, ...nextItems.filter((i) => !seen.has(i.id))];
      });
      setTotal(body.total ?? total);
    } catch {
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [items.length, total]);

  if (items.length === 0) return null;

  return (
    <section aria-labelledby="bonificaciones-title" className="card mt-8 overflow-hidden" data-testid="bonificaciones-section">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h2 id="bonificaciones-title" className="text-base font-bold text-ink">
            Bonificaciones
          </h2>
          <p className="mt-0.5 text-sm text-ink-3-strong">
            Coberturas otorgadas con un beneficio del 100%. No generan cobro.
          </p>
        </div>
        <p role="status" className="flex-none text-xs font-semibold tabular-nums text-ink-2">
          {items.length} de {total}
        </p>
      </header>
      <ul className="divide-y divide-line">
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
            {/* One quiet link per row: the page's weight stays on the queue
                above, and sixty black blocks were sixty "primary" actions. */}
            <a
              href={`/api/membresias/coberturas/${item.id}/comprobante`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Descargar recibo oficial de ${item.personaNombreCompleto}`}
              className={buttonClasses("tertiary", "sm", "gap-1.5 md:w-40")}
            >
              <Download size={ICON.sm} strokeWidth={1.5} aria-hidden="true" />
              Recibo oficial
            </a>
          </li>
        ))}
      </ul>
      {moreFailed && (
        <p role="alert" className="border-t border-line px-5 py-3 text-sm text-state-bad">
          {/* App-wide tú register, enforced by lib/__tests__/usted-register.test.ts. */}
          No se pudieron cargar más bonificaciones. Intenta de nuevo.
        </p>
      )}
      {items.length < total && (
        <footer className="border-t border-line px-5 py-3">
          <Button size="sm" onClick={() => void loadMore()} disabled={loadingMore} className="max-md:w-full">
            Cargar más
          </Button>
        </footer>
      )}
    </section>
  );
}
