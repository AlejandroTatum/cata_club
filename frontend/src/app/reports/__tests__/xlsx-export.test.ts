/**
 * Unit tests for the Reportes `.xlsx` export utilities — the replacement for
 * `toCsv`/`downloadCsv` (issue #864). Pure functions plus one browser-facing
 * download helper, same pattern as `reports-utils.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ExcelJS from "exceljs";
import {
  buildWorkbook,
  downloadXlsx,
  xlsxFilename,
  neutralizeFormula,
  type XlsxColumn,
} from "../xlsx-export";

describe("neutralizeFormula", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+34600000000", "'+34600000000"],
    ["-5", "'-5"],
    ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
    ["\ttabulado", "'\ttabulado"],
    ["\rretorno", "'\rretorno"],
  ])("prefixes %s with a leading single quote", (input, expected) => {
    expect(neutralizeFormula(input)).toBe(expected);
  });

  it("leaves an ordinary value untouched", () => {
    expect(neutralizeFormula("Ana Vera")).toBe("Ana Vera");
    expect(neutralizeFormula("")).toBe("");
  });
});

describe("buildWorkbook", () => {
  const columns: XlsxColumn[] = [
    { header: "Nombre", key: "nombre", type: "text" },
    { header: "Fecha de nacimiento", key: "fecha", type: "date" },
    { header: "Edad", key: "edad", type: "number" },
    { header: "Monto", key: "monto", type: "currency" },
  ];

  it("creates a single sheet named as given", async () => {
    const workbook = await buildWorkbook("Personas", columns, []);
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.getWorksheet("Personas")).toBeDefined();
  });

  it("writes the header row bold, with the given labels in order", async () => {
    const workbook = await buildWorkbook("Personas", columns, []);
    const sheet = workbook.getWorksheet("Personas")!;
    expect(sheet.getRow(1).values).toEqual([undefined, "Nombre", "Fecha de nacimiento", "Edad", "Monto"]);
    expect(sheet.getRow(1).font?.bold).toBe(true);
  });

  it("still writes a header-only sheet when there are no rows", async () => {
    const workbook = await buildWorkbook("Personas", columns, []);
    const sheet = workbook.getWorksheet("Personas")!;
    expect(sheet.rowCount).toBe(1);
  });

  it("writes a date column as a real Date cell formatted dd/mm/yyyy", async () => {
    const workbook = await buildWorkbook("Personas", columns, [
      { nombre: "Ana", fecha: "2010-05-14", edad: 16, monto: 35 },
    ]);
    const cell = workbook.getWorksheet("Personas")!.getRow(2).getCell(2);
    expect(cell.value).toBeInstanceOf(Date);
    expect((cell.value as Date).getUTCFullYear()).toBe(2010);
    expect((cell.value as Date).getUTCMonth()).toBe(4);
    expect((cell.value as Date).getUTCDate()).toBe(14);
    expect(cell.numFmt).toBe("dd/mm/yyyy");
  });

  it("parses the product's own dd/mm/yyyy display format explicitly, without month/day rollover", async () => {
    const workbook = await buildWorkbook("Personas", columns, [
      { nombre: "Ana", fecha: "05/07/2026", edad: 16, monto: 35 },
    ]);
    const cell = workbook.getWorksheet("Personas")!.getRow(2).getCell(2).value as Date;
    expect(cell.getUTCDate()).toBe(5);
    expect(cell.getUTCMonth()).toBe(6);
  });

  it("writes number and currency columns as numeric cells, currency with a money format", async () => {
    const workbook = await buildWorkbook("Personas", columns, [
      { nombre: "Ana", fecha: "2010-05-14", edad: 16, monto: 35.5 },
    ]);
    const row = workbook.getWorksheet("Personas")!.getRow(2);
    expect(row.getCell(3).value).toBe(16);
    expect(typeof row.getCell(3).value).toBe("number");
    expect(row.getCell(4).value).toBe(35.5);
    expect(row.getCell(4).numFmt).toContain("$");
  });

  it("round-trips accented Spanish characters in text cells", async () => {
    const workbook = await buildWorkbook("Personas", columns, [
      { nombre: "Ordóñez é í ó ú ñ", fecha: "", edad: 0, monto: 0 },
    ]);
    const cell = workbook.getWorksheet("Personas")!.getRow(2).getCell(1);
    expect(cell.value).toBe("Ordóñez é í ó ú ñ");
  });

  it("neutralises a formula-like text value the same way the CSV export did", async () => {
    const workbook = await buildWorkbook("Personas", columns, [
      { nombre: '=HYPERLINK("http://evil")', fecha: "", edad: 0, monto: 0 },
    ]);
    const cell = workbook.getWorksheet("Personas")!.getRow(2).getCell(1);
    expect(cell.value).toBe('\'=HYPERLINK("http://evil")');
  });

  it("applies a default width per column type and honours an explicit override", async () => {
    const withOverride: XlsxColumn[] = [{ header: "Nombre", key: "nombre", type: "text", width: 40 }];
    const workbook = await buildWorkbook("Personas", withOverride, []);
    const sheet = workbook.getWorksheet("Personas")!;
    expect(sheet.getColumn(1).width).toBe(40);

    const defaults = await buildWorkbook("Personas", columns, []);
    const defaultSheet = defaults.getWorksheet("Personas")!;
    expect(defaultSheet.getColumn(2).width).toBe(14); // date
    expect(defaultSheet.getColumn(3).width).toBe(10); // number
  });
});

describe("xlsxFilename", () => {
  it("mirrors the backend's PDF naming, zero-padded, with an .xlsx extension", () => {
    expect(xlsxFilename("periodo", new Date(2026, 6, 5))).toBe("reporte-periodo_2026-07-05.xlsx");
  });
});

describe("downloadXlsx", () => {
  let capturedBlob: Blob | null;
  let capturedFilename: string;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    capturedBlob = null;
    capturedFilename = "";
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob): string => {
      capturedBlob = blob;
      return "blob:mock";
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      capturedFilename = this.download;
    });
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it("hands the workbook to the browser as a .xlsx download with the right MIME type", async () => {
    const workbook = await buildWorkbook("Personas", [{ header: "Nombre", key: "nombre", type: "text" }], [
      { nombre: "Ana" },
    ]);

    await downloadXlsx("reporte-periodo_2026-07-05.xlsx", workbook);

    expect(capturedBlob).not.toBeNull();
    expect(capturedBlob!.type).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(capturedFilename).toBe("reporte-periodo_2026-07-05.xlsx");
  });

  it("revokes the object URL after triggering the download", async () => {
    const workbook = await buildWorkbook("Personas", [{ header: "Nombre", key: "nombre", type: "text" }], []);

    await downloadXlsx("reporte-periodo_2026-07-05.xlsx", workbook);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });

  it("produces a file ExcelJS itself can read back, with the real data intact", async () => {
    const workbook = await buildWorkbook("Personas", [{ header: "Nombre", key: "nombre", type: "text" }], [
      { nombre: "Ordóñez" },
    ]);

    await downloadXlsx("reporte-periodo_2026-07-05.xlsx", workbook);

    const buffer = await capturedBlob!.arrayBuffer();
    const reloaded = new ExcelJS.Workbook();
    await reloaded.xlsx.load(buffer);
    const sheet = reloaded.getWorksheet("Personas")!;
    expect(sheet.getRow(2).getCell(1).value).toBe("Ordóñez");
  });
});
