/**
 * Generic `.xlsx` export for the Reportes admin page.
 *
 * Replaces the browser-side CSV export (issue #864, related #196/#366/#812).
 * CSV had no typed cells — a date, a number and money all rendered as plain
 * text — and Excel needed a BOM just to read the accents. `.xlsx` fixes both:
 * `buildWorkbook` writes real `Date`/numeric cells with the format the rest
 * of the product already uses, and there is exactly ONE builder for the three
 * reports. Each report supplies only its own column spec (see `page.tsx`);
 * nothing here is duplicated per report.
 *
 * `exceljs` is imported dynamically inside `buildWorkbook`, not at module top
 * level, so the library is only fetched when an export actually runs and
 * never inflates the page's initial bundle.
 */

import type ExcelJS from "exceljs";

/** One column of an exported sheet: how to label it, read it and type it. */
export interface XlsxColumn {
  header: string;
  /** Key looked up on each row object — mirrors `ExcelJS.Column.key`. */
  key: string;
  type: "text" | "date" | "number" | "currency";
  /** Column width in characters. Defaults by `type` when omitted. */
  width?: number;
}

/** A single exportable value, as read off a report row before typing. */
type XlsxCellInput = string | number | null | undefined;

/** Column width when the caller does not name one, by cell type. */
const DEFAULT_COLUMN_WIDTH: Record<XlsxColumn["type"], number> = {
  text: 24,
  date: 14,
  number: 10,
  currency: 14,
};

/** The product's canonical date grammar (`dd/mm/yyyy`, see `format-utils.ts`). */
const DATE_NUM_FMT = "dd/mm/yyyy";

/** USD, two decimals — the same money the product renders everywhere else. */
const CURRENCY_NUM_FMT = '"$"#,##0.00';

/**
 * Characters that make a spreadsheet treat a cell as a formula. A student
 * named "=Ana" or a note starting with "+" would be evaluated on open, which
 * is the formula-injection foothold; prefixing a single quote makes the cell
 * literal text in Excel, LibreOffice and Sheets alike.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/** Neutralise a text value that a spreadsheet would otherwise run as a formula. */
export function neutralizeFormula(value: string): string {
  return FORMULA_TRIGGERS.some((char) => value.startsWith(char)) ? `'${value}` : value;
}

/**
 * Parse a date string into a real `Date`, anchored at noon UTC so the
 * calendar day survives every timezone this app runs in — the same guard
 * `parseDateStringLocal` applies in `lib/format-utils.ts`. Accepts the
 * backend's `YYYY-MM-DD` and the product's own `dd/mm/yyyy` display format
 * explicitly (never `new Date("dd/mm/yyyy")`, which silently misreads it as
 * month/day and can roll over into the wrong date). Anything else — an ISO
 * timestamp such as `uploadedAt` — falls back to native parsing, which is
 * safe there because those strings already carry an explicit offset.
 */
function parseCellDate(value: string): Date | null {
  if (!value) return null;

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
  }

  const displayMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (displayMatch) {
    const day = Number(displayMatch[1]);
    const month = Number(displayMatch[2]) - 1;
    const year = Number(displayMatch[3]);
    const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Convert one raw row value to the typed cell value its column calls for. */
function toCellValue(raw: XlsxCellInput, type: XlsxColumn["type"]): string | number | Date | null {
  if (type === "date") {
    return typeof raw === "string" ? parseCellDate(raw) : null;
  }
  if (type === "number" || type === "currency") {
    const value = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(value) ? value : 0;
  }
  return neutralizeFormula(raw === null || raw === undefined ? "" : String(raw));
}

/**
 * Build a one-sheet workbook: header row (bold) plus one typed row per
 * entry of `rows`. `rows[i][column.key]` supplies that cell's raw value.
 *
 * The ONLY place a report's column spec turns into a real worksheet — the
 * three reports on `/reports` each call this with their own `columns` and
 * their own (already-filtered, already-unpaginated) result array, never
 * hand-rolling their own workbook.
 */
export async function buildWorkbook(
  sheetName: string,
  columns: readonly XlsxColumn[],
  rows: readonly Record<string, XlsxCellInput>[],
): Promise<ExcelJS.Workbook> {
  const { default: Excel } = await import("exceljs");
  const workbook = new Excel.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width ?? DEFAULT_COLUMN_WIDTH[column.type],
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const values: Record<string, string | number | Date | null> = {};
    for (const column of columns) {
      values[column.key] = toCellValue(row[column.key], column.type);
    }
    const addedRow = sheet.addRow(values);
    columns.forEach((column, index) => {
      const cell = addedRow.getCell(index + 1);
      if (column.type === "date") cell.numFmt = DATE_NUM_FMT;
      if (column.type === "currency") cell.numFmt = CURRENCY_NUM_FMT;
    });
  }

  return workbook;
}

/** MIME type of a `.xlsx` file (Office Open XML spreadsheet). */
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Name the file the way the backend names its PDFs —
 * `reporte-{slug}_{YYYY-MM-DD}.xlsx` — so a folder of exports sorts together
 * regardless of which format produced them.
 */
export function xlsxFilename(slug: string, today: Date = new Date()): string {
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  return `reporte-${slug}_${iso}.xlsx`;
}

/** Hand a generated workbook to the browser as a `.xlsx` download. */
export async function downloadXlsx(filename: string, workbook: ExcelJS.Workbook): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
