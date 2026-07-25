/**
 * Table primitives — `.tbl` from `_sistema.css` (:238-244).
 *
 *   thead th : `--h-thead` 44px, 16px padding, 10.5px/700/.1em uppercase in
 *              `--ink-3`, `#FAFAFB` fill, `--line` bottom rule
 *   tbody td : `--h-row` 60px, 16px padding, 13.5px in `--ink-2`, `--line`
 *              bottom rule, suppressed on the last row
 *   .nm / .sb: the two-line identity cell (14px/600 `--ink` over 11.5px
 *              `--ink-3`)
 *   .rt      : right alignment, used for the action column
 *
 * `#FAFAFB` is the one value here the spec spells as a literal rather than a
 * named token — it appears verbatim in `.tbl thead th`, `.pager` and
 * `.modal .mfoot`. It is reproduced literally rather than given a new name.
 */

import type {
  ReactElement,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cn } from "./cn";

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

export function TableRow({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactElement {
  return <tr className={className}>{children}</tr>;
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-aligns the column, matching `.tbl .rt`. */
  align?: "left" | "right";
}

export function TableHeaderCell({
  align = "left",
  className,
  children,
  ...rest
}: TableHeaderCellProps): ReactElement {
  return (
    <th
      scope="col"
      className={cn(
        "h-thead whitespace-nowrap border-b border-line bg-[#FAFAFB] px-4",
        "text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-3",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: "left" | "right";
}

export function TableCell({
  align = "left",
  className,
  children,
  ...rest
}: TableCellProps): ReactElement {
  return (
    <td
      className={cn(
        "h-row border-b border-line px-4 text-[13.5px] text-ink-2",
        align === "right" ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    >
      {children}
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
      {sub ? <span className="mt-px block text-[11.5px] text-ink-3">{sub}</span> : null}
    </TableCell>
  );
}
