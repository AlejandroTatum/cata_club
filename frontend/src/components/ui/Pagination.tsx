/**
 * Pagination — the one pager in the product.
 *
 * The UX audit found SIX paginators in THREE visual treatments: the shared
 * `PaginationControls`, inline duplicates in attendance and payments, a
 * different icon-led variant in trainer and trainer/attendance, and three more
 * inside reports. Every one of them told you which page you were on and none
 * of them told you which RECORDS you were looking at, so an admin reconciling
 * a list against a total had to multiply page numbers by a page size they had
 * to guess.
 *
 * So this component adds the range readout the other six lacked ("11–20 de
 * 137") and routes its buttons through the `Button` primitive, which is what
 * makes the 32px height real instead of nominal.
 *
 * Deliberately NOT here: page-size and page-jump controls. Consolidation plus
 * the readout is the whole remit; a page-size selector is a feature, and a
 * feature belongs to the redesign phase, not to a consistency pass.
 */

import type { ReactElement } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Button from "./Button";
import { cn } from "./cn";

export interface PaginationProps {
  /** 1-indexed current page. */
  page: number;
  /** Always at least 1 — "Página 1 de 1" is a valid state. */
  totalPages: number;
  onPageChange: (page: number) => void;
  /**
   * Total rows across all pages. Supply together with `pageSize` to get the
   * range readout; omit both and only the page count renders.
   */
  totalItems?: number;
  pageSize?: number;
  /** Singular noun for the readout, e.g. "registro" → "registros". */
  itemNoun?: string;
  /** Override when the plural is not simply `itemNoun + "s"`. */
  itemNounPlural?: string;
  className?: string;
}

export default function Pagination({
  page,
  totalPages,
  onPageChange,
  totalItems,
  pageSize,
  itemNoun,
  itemNounPlural,
  className,
}: PaginationProps): ReactElement {
  const hasRange =
    totalItems !== undefined && pageSize !== undefined && pageSize > 0 && totalItems > 0;

  let range = "";
  if (hasRange) {
    const from = (page - 1) * pageSize + 1;
    const to = Math.min(page * pageSize, totalItems);
    // En dash (U+2013) for the numeric span, matching `formatDateRange`.
    const noun = itemNoun
      ? ` ${totalItems === 1 ? itemNoun : (itemNounPlural ?? `${itemNoun}s`)}`
      : "";
    range = `${from}–${to} de ${totalItems}${noun}`;
  }

  return (
    <div
      className={cn(
        "mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row",
        className,
      )}
    >
      {/* Two sibling spans, not one interpolated string: the page count has to
          stay its own exact text node so `getByText("Página 1 de 2")` keeps
          resolving to a single element. */}
      <p className="text-[13px] text-ink-2">
        <span className="font-semibold text-ink">
          Página {page} de {totalPages}
        </span>
        {range ? <span className="tabular-nums"> · {range}</span> : null}
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          aria-label="Página anterior"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          <ChevronLeft size={14} strokeWidth={1.5} aria-hidden="true" />
          Anterior
        </Button>
        <Button
          size="sm"
          aria-label="Página siguiente"
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
        >
          Siguiente
          <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
