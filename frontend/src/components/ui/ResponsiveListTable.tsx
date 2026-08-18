/**
 * ResponsiveListTable — the mobile-card / desktop-table split shared by every
 * paginated "list of records" screen.
 *
 * `/members` and `/discounts` had each hand-rolled the identical shell: a
 * `<ul className="divide-y divide-line sm:hidden">` of cards below `sm`, and
 * a `<div className="hidden overflow-x-auto sm:block"><Table>...</Table></div>`
 * at `sm` and up, both walking the same items in the same order. Issue #388
 * touched a few lines inside Members' copy of this block, and SonarCloud's
 * git-blame "new code" window pulled the whole ~90-line surrounding block
 * into scope — surfacing duplication against Discounts' copy that predates
 * #388 and had gone unmeasured until then.
 *
 * Deliberately NOT here: the loading / empty states, and the card that wraps
 * the whole thing. Members renders its loading state in one `<div className="card">`
 * and its populated state in another (`overflow-hidden`), with the empty
 * state entirely outside any card; Discounts keeps one permanent `<section
 * className="card">` around all three states, with its own title/help strip
 * that has no Members equivalent. Those wrappers are genuinely different
 * shapes per screen, not copies of each other, so forcing them into one
 * component would either bloat it with per-screen branches or quietly change
 * one screen's DOM. What both screens draw identically — and are still free
 * to leave out — is this component's remit: an optional header strip (results
 * count, capped-results warning, whatever a screen has to say), the two
 * responsive renderings of the same items, and an optional footer (typically
 * a footer `<Pagination>`).
 */

import { Fragment, type Key, type ReactElement, type ReactNode } from "react";
import { Table, TableBody, TableHead } from "./Table";

export interface ResponsiveListTableProps<T> {
  items: readonly T[];
  /** React list key for one item — same value passed to both renderings. */
  getKey: (item: T) => Key;
  /** One item as a mobile card (`sm:hidden`) — typically a `DataRow`. */
  renderCard: (item: T) => ReactNode;
  /** One item as a table row (`sm` and up) — typically a `TableRow`. */
  renderRow: (item: T) => ReactNode;
  /** The desktop table's `<thead>` content — a `<TableRow>` of `<TableHeaderCell>`s. */
  tableHead: ReactNode;
  /**
   * Rendered above the responsive list, e.g. a results-count line or a
   * capped-results warning. Omit when the screen has neither (Discounts).
   */
  header?: ReactNode;
  /** Rendered after the desktop table, typically a footer `<Pagination>`. */
  footer?: ReactNode;
  /** Forwarded to the mobile `<ul>` — Discounts' tests read it back. */
  mobileListTestId?: string;
  /** Forwarded to the desktop table's wrapping `<div>` — Discounts' tests read it back. */
  desktopTableTestId?: string;
}

export default function ResponsiveListTable<T>({
  items,
  getKey,
  renderCard,
  renderRow,
  tableHead,
  header,
  footer,
  mobileListTestId,
  desktopTableTestId,
}: ResponsiveListTableProps<T>): ReactElement {
  return (
    <>
      {header}
      <ul className="divide-y divide-line sm:hidden" data-testid={mobileListTestId}>
        {items.map((item) => (
          <Fragment key={getKey(item)}>{renderCard(item)}</Fragment>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block" data-testid={desktopTableTestId}>
        <Table>
          <TableHead>{tableHead}</TableHead>
          <TableBody>
            {items.map((item) => (
              <Fragment key={getKey(item)}>{renderRow(item)}</Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
      {footer}
    </>
  );
}
