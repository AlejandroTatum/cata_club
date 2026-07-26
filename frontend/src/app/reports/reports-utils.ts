/**
 * Pure utility functions for the Reportes admin page.
 *
 * No React dependencies — pure functions for testability. Mirrors the
 * client-side pagination pattern established in members-utils.ts and
 * attendance-utils.ts: each report tab keeps its own page-size constant
 * and paginate/getTotalPages pair since they're independent datasets.
 */

import type { PersonaReporte } from "@/types/domain";
import type { AttendanceRecord } from "@/app/attendance/attendance-utils";
import type { PaymentValidationRequest } from "@/services/api";

// ---------------------------------------------------------------------------
// "Nuevos miembros por período" pagination
// ---------------------------------------------------------------------------

/** Results per page for the persona report table. */
export const PERSONA_REPORT_PAGE_SIZE = 10;

/**
 * Slice a (possibly already filtered) persona report list to a single page.
 *
 * `page` is 1-indexed. Returns an empty array when `page` is beyond the
 * available data — never throws or wraps around.
 */
export function paginatePersonaResults(
  results: PersonaReporte[],
  page: number,
  pageSize: number = PERSONA_REPORT_PAGE_SIZE,
): PersonaReporte[] {
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize);
}

/**
 * Total number of pages for a given persona report result count.
 *
 * Always returns at least 1 (never 0 pages, even for an empty list) so
 * "Página 1 de 1" is a valid state to render.
 */
export function getPersonaReportTotalPages(
  totalResults: number,
  pageSize: number = PERSONA_REPORT_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalResults / pageSize));
}

// ---------------------------------------------------------------------------
// "Asistencia" report pagination
// ---------------------------------------------------------------------------

/** Results per page for the attendance report table. */
export const ASISTENCIA_REPORT_PAGE_SIZE = 10;

/**
 * Slice a (possibly already filtered) attendance report list to a single page.
 *
 * `page` is 1-indexed. Returns an empty array when `page` is beyond the
 * available data — never throws or wraps around.
 */
export function paginateAsistenciaResults(
  results: AttendanceRecord[],
  page: number,
  pageSize: number = ASISTENCIA_REPORT_PAGE_SIZE,
): AttendanceRecord[] {
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize);
}

/**
 * Total number of pages for a given attendance report result count.
 *
 * Always returns at least 1 (never 0 pages, even for an empty list) so
 * "Página 1 de 1" is a valid state to render.
 */
export function getAsistenciaReportTotalPages(
  totalResults: number,
  pageSize: number = ASISTENCIA_REPORT_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalResults / pageSize));
}

// ---------------------------------------------------------------------------
// "Pagos" report pagination
// ---------------------------------------------------------------------------

/** Results per page for the payments report table. */
export const PAGOS_REPORT_PAGE_SIZE = 10;

/**
 * Slice a (possibly already filtered) payments report list to a single page.
 *
 * `page` is 1-indexed. Returns an empty array when `page` is beyond the
 * available data — never throws or wraps around.
 */
export function paginatePagosResults(
  results: PaymentValidationRequest[],
  page: number,
  pageSize: number = PAGOS_REPORT_PAGE_SIZE,
): PaymentValidationRequest[] {
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize);
}

/**
 * Total number of pages for a given payments report result count.
 *
 * Always returns at least 1 (never 0 pages, even for an empty list) so
 * "Página 1 de 1" is a valid state to render.
 */
export function getPagosReportTotalPages(
  totalResults: number,
  pageSize: number = PAGOS_REPORT_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(totalResults / pageSize));
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
//
// The CSV is built HERE, in the browser, and not fetched from the backend —
// because there is no backend to fetch it from. `backend/app/presentacion/
// routers/` exposes exactly three export endpoints, all PDF
// (`/personas/reportes/nuevos-por-periodo/pdf`, `/asistencias/reportes/pdf`,
// `/payments/reportes/pdf`); grepping the whole backend for "csv" finds only
// `.env.example` and `configuracion.py`, neither of which is a route.
//
// Building it client-side is honest here for one specific reason: the page
// already holds the COMPLETE result set. `fetchNuevosPorPeriodo`,
// `fetchAttendanceRecords` and `fetchPagosReporte` each return every row for
// the selected range, and the table's pagination is a pure client-side slice
// (see `paginate*Results` above). So the CSV covers exactly the same rows the
// preview counts and the PDF renders — it is not "the current page dressed up
// as an export". The alternative (disabling the control) would withhold data
// the browser is already holding.
//
// What the client CANNOT do is keep these columns from drifting away from the
// server's PDF column definitions, stream a range too large to hold in memory,
// or leave the backend any record that an export happened. Issue #150 tracks
// the CSV endpoints that fix all three; when they land, this block goes away
// and `/reports` calls `downloadBlob` the way the PDF buttons already do.

/** Excel opens a UTF-8 CSV as Latin-1 unless the file starts with a BOM. */
const UTF8_BOM = "﻿";

/**
 * Characters that make a spreadsheet treat a cell as a formula. A student
 * named "=Ana" or a note starting with "+" would be evaluated on open, which
 * is the CSV-injection foothold; prefixing a single quote makes the cell
 * literal text in Excel, LibreOffice and Sheets alike.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/** One CSV field: neutralised, escaped, and quoted only when it has to be. */
export function csvField(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = FORMULA_TRIGGERS.some((char) => raw.startsWith(char)) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Serialise a header row plus body rows to CSV text (CRLF line endings, which
 * is what RFC 4180 specifies and what Excel expects).
 */
export function toCsv(columns: readonly string[], rows: readonly (string | number)[][]): string {
  const lines = [columns, ...rows].map((row) => row.map(csvField).join(","));
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

/**
 * Name the file the way the backend names its PDFs —
 * `reporte-{slug}_{YYYY-MM-DD}.csv` — so a folder of exports sorts together
 * regardless of which format produced them.
 */
export function csvFilename(slug: string, today: Date = new Date()): string {
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  return `reporte-${slug}_${iso}.csv`;
}

/** Hand a generated CSV to the browser as a download. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
