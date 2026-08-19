/**
 * The card-wrapped "mobile cards below a breakpoint, desktop table above
 * it, pager at the foot" scaffolding — issue #400 (Sonar duplication
 * follow-up). `/payments` and `/members` each built this wrapper by hand,
 * and the two had drifted apart only in incidental ways (which breakpoint,
 * whether there is a header banner above the split) while the SKELETON —
 * card, optional header, `<ul>` of cards hidden at the breakpoint, a table
 * hidden the other way, pager at the foot — was identical.
 *
 * What this does NOT own: the row/card CONTENT. `AccountRow`/`AccountCard`
 * (with their own expand/collapse state) and `/payments`' inline `<TableRow>`/
 * `<li>` rendering stay exactly as they were, as caller-supplied elements —
 * only the wrapping markup moved here. Extracting further (a generic row
 * renderer) was considered and rejected: the two screens' rows differ in
 * column count, statefulness and card primitive, and forcing them through
 * one shape would have cost more real complexity than the few wrapper lines
 * it would save.
 */

interface ResponsiveListProps {
  /**
   * The Tailwind breakpoint at which the desktop table takes over from the
   * mobile card list — `/members` uses `"sm"`, `/payments` uses `"md"`.
   * Each screen keeps its own, already-established breakpoint: this is a
   * parameter precisely so neither screen's visual behavior has to change
   * to share this wrapper.
   */
  breakpoint: "sm" | "md";
  /** Content above the split, inside the same card (`/members`' "N
   *  resultados mostrados" banner + capped-source alert). `/payments` has
   *  none. */
  header?: React.ReactNode;
  /** The mobile card list's `<li>`/component elements, already built by
   *  the caller — NOT the `<ul>` wrapper itself. */
  cards: React.ReactNode;
  cardsTestId?: string;
  /** The desktop `<Table>` element, complete (`<TableHead>` + `<TableBody>`),
   *  already built by the caller. */
  table: React.ReactNode;
  tableTestId?: string;
  /** The `<Pagination />` element, or `null`/`undefined` when there is
   *  nothing to page through — the caller still owns the `totalPages > 1`
   *  decision, same as before extraction. */
  pagination?: React.ReactNode;
  /**
   * Which of the two mutually-exclusive renderings comes FIRST in the DOM —
   * `/members` had cards before the table, `/payments` had the table
   * before cards. CSS makes exactly one of them visible at a time, so this
   * has no visual effect in a real browser — but it is NOT a no-op: with
   * both elements still mounted, `document.querySelector`/programmatic
   * `.focus()` (used by `/payments`' own back-navigation focus restore,
   * `focusQueueAction`) resolve the FIRST DOM match regardless of CSS
   * visibility. A hardcoded order here silently flipped which one that
   * was — caught by `PaymentsPage.test.tsx`'s focus-return test — so each
   * caller keeps its own prior order explicitly instead of defaulting to
   * either.
   */
  order: "cardsFirst" | "tableFirst";
}

export default function ResponsiveList({
  breakpoint,
  header,
  cards,
  cardsTestId,
  table,
  tableTestId,
  pagination,
  order,
}: ResponsiveListProps): React.ReactElement {
  const cardsHiddenClass = breakpoint === "sm" ? "sm:hidden" : "md:hidden";
  const tableVisibleClass =
    breakpoint === "sm" ? "hidden overflow-x-auto sm:block" : "hidden overflow-x-auto md:block";

  const cardsList = (
    <ul data-testid={cardsTestId} className={`divide-y divide-line ${cardsHiddenClass}`}>
      {cards}
    </ul>
  );
  const tableBlock = (
    <div data-testid={tableTestId} className={tableVisibleClass}>
      {table}
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
      {pagination}
    </div>
  );
}
