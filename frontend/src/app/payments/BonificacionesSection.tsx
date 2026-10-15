"use client";

/** Read-only "Bonificados" view for the admin payments review (issues #1609, #1683). */

import { useCallback, useEffect, useState } from "react";
import { Download, Gift } from "lucide-react";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import { formatCurrency } from "@/lib/format-utils";
import { ICON } from "@/lib/icon-size";
import { Button, buttonClasses, EmptyState, ErrorState, LoadingState } from "@/components/ui";

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
// The backend's largest page (`le=200`): searching drains the whole set in as
// few round trips as the endpoint allows, so a name is found wherever it sits.
const DRAIN_BATCH = 200;

interface BonificacionesPage {
  items?: BonificacionItem[];
  total?: number;
}

async function fetchCoberturasPage(skip: number, limit: number): Promise<{ items: BonificacionItem[]; total: number }> {
  const res = await fetch(`/api/membresias/coberturas/todas?skip=${skip}&limit=${limit}`);
  const body: BonificacionesPage | null = res.ok ? await res.json() : null;
  if (!body?.items) throw new Error("bonificaciones page failed");
  return { items: body.items, total: body.total ?? body.items.length };
}

/**
 * The "Bonificados" view of the admin payments screen. 100% benefit coverages
 * never create a `Pago`, so they are not in the queue; this lists them
 * read-only with the amount charged ($0,00) and the same "Recibo oficial" the
 * student downloads. Nothing is capped: browsing loads more on demand and a
 * `query` drains every page, then matches on the person's name.
 */
export function BonificacionesSection({ query = "" }: { query?: string }): React.ReactElement {
  const [items, setItems] = useState<BonificacionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const complete = loaded && items.length >= total;

  useEffect(() => {
    let cancelled = false;
    fetchCoberturasPage(0, LOAD_MORE_BATCH)
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setTotal(page.total);
        setFailed(false);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  // A search must cover every coverage, not the ten on screen.
  useEffect(() => {
    if (!normalizedQuery || !loaded || complete) return;
    let cancelled = false;
    (async () => {
      const all: BonificacionItem[] = [];
      let count = 0;
      do {
        const page = await fetchCoberturasPage(all.length, DRAIN_BATCH);
        all.push(...page.items);
        count = page.total;
        if (page.items.length === 0) break;
      } while (all.length < count);
      if (cancelled) return;
      setItems(all);
      setTotal(count);
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [normalizedQuery, loaded, complete, retryToken]);

  const loadMore = useCallback(async (): Promise<void> => {
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await fetchCoberturasPage(items.length, LOAD_MORE_BATCH);
      setItems((previous) => {
        const seen = new Set(previous.map((i) => i.id));
        return [...previous, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setTotal(page.total);
    } catch {
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  }, [items.length]);

  if (failed) {
    return (
      <ErrorState
        message="No se pudieron cargar las bonificaciones."
        onRetry={() => {
          setFailed(false);
          setRetryToken((t) => t + 1);
        }}
      />
    );
  }
  if (!loaded || (normalizedQuery && !complete)) return <LoadingState label="Cargando bonificaciones…" />;

  const visible = normalizedQuery
    ? items.filter((i) => i.personaNombreCompleto.toLowerCase().includes(normalizedQuery))
    : items;
  const shownTotal = normalizedQuery ? visible.length : total;

  if (visible.length === 0) {
    return (
      <EmptyState
        fill
        icon={<Gift size={ICON.lg} strokeWidth={1.5} aria-hidden="true" />}
        title={normalizedQuery ? "Ninguna bonificación coincide con la búsqueda" : "Aún no hay bonificaciones"}
        description={
          normalizedQuery
            ? "Revisa el nombre o limpia la búsqueda para ver todas."
            : "Cuando se otorgue una cobertura con beneficio del 100%, aparecerá aquí."
        }
      />
    );
  }

  return (
    <section aria-labelledby="bonificaciones-title" className="card overflow-hidden" data-testid="bonificaciones-section">
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
          {visible.length} de {shownTotal}
        </p>
      </header>
      <ul className="divide-y divide-line">
        {visible.map((item) => (
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
      {!normalizedQuery && items.length < total && (
        <footer className="border-t border-line px-5 py-3">
          <Button size="sm" onClick={() => void loadMore()} disabled={loadingMore} className="max-md:w-full">
            Cargar más
          </Button>
        </footer>
      )}
    </section>
  );
}
