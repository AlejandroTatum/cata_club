/**
 * The card-wrapped "mobile cards below a breakpoint, desktop table above
 * it, pager at the foot" list — issue #400 (Sonar duplication follow-up,
 * second pass). `/payments` and `/members` each built the FULL thing by
 * hand: the wrapping markup (round 1's fix) AND the `.map()` over the same
 * items array, twice, feeding a `<Table>`/`<TableBody>` and a `<ul>`
 * respectively, AND the `totalPages > 1 && <Pagination .../>` conditional.
 * Round 1 only moved the wrapper into a shared place and left every call
 * site rebuilding the `.map()`/`<Table>`/pagination-conditional locally —
 * which is exactly the part that was actually duplicated between the two
 * call sites, so Sonar kept flagging it, just one level removed. This
 * internalizes THAT: the caller now hands over data and per-item render
 * FUNCTIONS, not pre-built JSX blocks.
 *
 * One divergence from a naive "one `<TableRow>` per item" version: `/members`'
 * `AccountRow` needs to emit a SECOND `<TableRow>` for some accounts (the
 * expanded roster panel, `canExpand && playersOpen`) — a fixed columns→cells
 * mapping cannot express that. `renderRow` therefore returns the COMPLETE
 * row markup (one `<TableRow>`, or more) and this component does not wrap
 * it in a `<TableRow>` of its own; only `columns` (the head) stays a plain
 * list, since a head has no such per-item variability.
 */

import { Fragment, type ReactElement, type ReactNode } from "react";
import { Table, TableBody, TableHead, TableRow } from "./Table";
import Pagination from "./Pagination";

interface ResponsiveListPagination {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  pageSize: number;
  itemNoun: string;
  itemNounPlural?: string;
}

interface ResponsiveListProps<T> {
  /**
   * The Tailwind breakpoint at which the desktop table takes over from the
   * mobile card list — `/members` uses `"sm"`, `/payments` uses `"md"`.
   * Each screen keeps its own, already-established breakpoint: this is a
   * parameter precisely so neither screen's visual behavior has to change
   * to share this component.
   */
  breakpoint: "sm" | "md";
  /**
   * Which of the two mutually-exclusive renderings comes FIRST in the DOM —
   * `/members` had cards before the table, `/payments` had the table
   * before cards. CSS makes exactly one of them visible at a time, so this
   * has no visual effect in a real browser — but it is NOT a no-op: with
   * both elements still mounted, `document.querySelector`/programmatic
   * `.focus()` (used by `/payments`' own back-navigation focus restore,
   * `focusQueueAction`) resolve the FIRST DOM match regardless of CSS
   * visibility. A hardcoded order silently flipped which one that was in
   * round 1 — caught by `PaymentsPage.test.tsx`'s focus-return test — so
   * each caller keeps declaring its own prior order explicitly.
   */
  order: "cardsFirst" | "tableFirst";
  /** Content above the split, inside the same card (`/members`' "N
   *  resultados mostrados" banner + capped-source alert). `/payments` has
   *  none. */
  header?: ReactNode;
  items: T[];
  getKey: (item: T) => string | number;
  /** The mobile card for one item — a single element (`AccountCard`'s
   *  `<DataRow>`, `/payments`' `<li>`). Keyed by this component. */
  renderCard: (item: T) => ReactNode;
  /** The `<TableHeaderCell>` elements of the head row, in order. */
  columns: ReactNode[];
  /** The COMPLETE desktop row markup for one item (see the file doc for
   *  why this is not just "cells" — `AccountRow` needs to return more than
   *  one `<TableRow>` for an expanded account). Keyed by this component. */
  renderRow: (item: T) => ReactNode;
  cardsTestId?: string;
  tableTestId?: string;
  /** Omitted (or `totalPages <= 1`): no pager renders — same as the old
   *  `totalPages > 1 && <Pagination .../>` each caller used to write. */
  pagination?: ResponsiveListPagination;
}

export default function ResponsiveList<T>({
  breakpoint,
  order,
  header,
  items,
  getKey,
  renderCard,
  columns,
  renderRow,
  cardsTestId,
  tableTestId,
  pagination,
}: ResponsiveListProps<T>): ReactElement {
  const cardsHiddenClass = breakpoint === "sm" ? "sm:hidden" : "md:hidden";
  const tableVisibleClass =
    breakpoint === "sm" ? "hidden overflow-x-auto sm:block" : "hidden overflow-x-auto md:block";

  const cardsList = (
    <ul data-testid={cardsTestId} className={`divide-y divide-line ${cardsHiddenClass}`}>
      {items.map((item) => (
        <Fragment key={getKey(item)}>{renderCard(item)}</Fragment>
      ))}
    </ul>
  );

  const tableBlock = (
    <div data-testid={tableTestId} className={tableVisibleClass}>
      <Table>
        <TableHead>
          <TableRow>{columns}</TableRow>
        </TableHead>
        <TableBody>
          {items.map((item) => (
            <Fragment key={getKey(item)}>{renderRow(item)}</Fragment>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="card overflow-hidden">
      {header}
      {order === "cardsFirst" ? (
        <>
          {cardsList}
          {tableBlock}
        </>
      ) : (
        <>
          {tableBlock}
          {cardsList}
        </>
      )}
      {pagination && pagination.totalPages > 1 && (
        <Pagination
          variant="footer"
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={pagination.onPageChange}
          totalItems={pagination.totalItems}
          pageSize={pagination.pageSize}
          itemNoun={pagination.itemNoun}
          itemNounPlural={pagination.itemNounPlural}
        />
      )}
    </div>
  );
}
