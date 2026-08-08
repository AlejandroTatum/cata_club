/**
 * Table primitives — `.tbl` from `_sistema.css` (:238-244).
 *
 *   thead th : `--h-thead` 44px, 16px padding, 10.5px/700/.1em uppercase in
 *              `--ink-3-strong`, `sunken` fill, `--line` bottom rule
 *              (the spec shipped `--ink-3` here, which measures 4.21:1 on the
 *              fill — the same sub-AA micro-label the page kicker had, so it
 *              takes the same companion token)
 *   tbody td : `--h-row` 60px, 16px padding, 13.5px in `--ink-2`, `--line`
 *              bottom rule, suppressed on the last row
 *   .nm / .sb: the two-line identity cell (14px/600 `--ink` over 11.5px
 *              `--ink-3`)
 *   .rt      : right alignment, used for the action column
 *
 * The head fill is the one value the spec spelled as a literal (`#FAFAFB`,
 * verbatim in `.tbl thead th`, `.pager` and `.modal .mfoot`). At 1.043:1 on
 * white it was a fill you could not see, so it is now the `sunken` token —
 * same role, 1.10:1, one name.
 */

import type {
  ReactElement,
  ReactNode,
  HTMLAttributes,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cn } from "./cn";
import DataBox from "./DataBox";

/**
 * The column kinds a data table draws, and the ONLY alignment vocabulary that
 * exists for them — there is no "center" member, so a data table cannot be
 * asked to center a column: the type that would say so does not exist.
 *
 *   text   → left   (reading order)
 *   number → right  (lining up digits is what lets a reader compare without
 *                    reading — TableCell also boxes the value, see below)
 *   badge  → left   (a status pill reads with the row, not against it)
 *   action → right  (the product's own convention for the trailing column)
 *
 * The header of a column must be aligned the same as its body — pass the same
 * `type` to both `TableHeaderCell` and `TableCell`.
 */
export type ColumnType = "text" | "number" | "badge" | "action";

const ALIGN_FOR_TYPE: Record<ColumnType, "left" | "right"> = {
  text: "left",
  number: "right",
  badge: "left",
  action: "right",
};

export function Table({
  className,
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement>): ReactElement {
  return (
    <table
      className={cn(
        "w-full border-collapse",
        // `.tbl tbody tr:last-child td { border-bottom: none }`
        "[&_tbody_tr:last-child_td]:border-b-0",
        className,
      )}
      {...rest}
    >
      {children}
    </table>
  );
}

export function TableHead({ children }: { children: ReactNode }): ReactElement {
  return <thead>{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }): ReactElement {
  return <tbody>{children}</tbody>;
}

/**
 * Forwards every `<tr>` attribute, not just `className`.
 *
 * It used to take `className` and `children` and nothing else, which made the
 * primitive unadoptable by any screen whose rows carry state: Descuentos marks
 * its rows `data-inactivo`, and that attribute is what its own tests read to
 * tell a disabled discount from an active one. A primitive that silently drops
 * what it is handed is one screens work around rather than adopt — which is how
 * three lists in this product came to be built by hand.
 */
export function TableRow({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLTableRowElement>): ReactElement {
  return (
    <tr className={className} {...rest}>
      {children}
    </tr>
  );
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /**
   * Right-aligns the column, matching `.tbl .rt`.
   *
   * @deprecated Prefer `type` — the point of a `ColumnType` is that alignment
   * follows from what the column holds instead of being a per-screen choice.
   * Kept so existing call sites keep compiling; `type` overrides it when both
   * are given.
   */
  align?: "left" | "right";
  /** Derives the column's alignment from its data kind. See `ColumnType`. */
  type?: ColumnType;
}

export function TableHeaderCell({
  align = "left",
  type,
  className,
  children,
  ...rest
}: TableHeaderCellProps): ReactElement {
  const resolvedAlign = type ? ALIGN_FOR_TYPE[type] : align;
  return (
    <th
      scope="col"
      className={cn(
        "h-thead whitespace-nowrap border-b border-line bg-sunken px-4",
        "text-2xs font-bold uppercase text-ink-3-strong",
        resolvedAlign === "right" ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  /** @deprecated Prefer `type` — see `TableHeaderCellProps.align`. */
  align?: "left" | "right";
  /**
   * Derives the column's alignment from its data kind. `type="number"` also
   * boxes the cell's own value in a numeric `DataBox` — a table number is
   * still a value nobody should read as running prose.
   */
  type?: ColumnType;
}

export function TableCell({
  align = "left",
  type,
  className,
  children,
  ...rest
}: TableCellProps): ReactElement {
  const resolvedAlign = type ? ALIGN_FOR_TYPE[type] : align;
  return (
    <td
      className={cn(
        "h-row border-b border-line px-4 text-sm text-ink-2",
        resolvedAlign === "right" ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    >
      {type === "number" ? <DataBox variant="numeric">{children}</DataBox> : children}
    </td>
  );
}

export interface TableNameCellProps {
  /** Primary line — `.nm`. */
  name: ReactNode;
  /** Secondary line — `.sb`. */
  sub?: ReactNode;
  className?: string;
}

/** The two-line identity cell every list table opens with. */
export function TableNameCell({ name, sub, className }: TableNameCellProps): ReactElement {
  return (
    <TableCell className={className}>
      <span className="block text-sm font-semibold text-ink">{name}</span>
      {sub ? <span className="mt-px block text-2xs tracking-flat text-ink-3">{sub}</span> : null}
    </TableCell>
  );
}
