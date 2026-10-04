import { beforeEach, describe, expect, it, vi } from "vitest";

const shrinkImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/shrink-image", () => ({ shrinkImage }));

import { MAX_VOUCHER_BYTES, prepareVoucher } from "../payments-utils";

const MB = 1024 * 1024;
const fileOf = (size: number, type: string, name = "comprobante"): File =>
  new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  shrinkImage.mockReset();
});

describe("prepareVoucher (FAM-26)", () => {
  it("passes a file under the limit through untouched", async () => {
    const file = fileOf(MB, "image/jpeg");
    expect(await prepareVoucher(file)).toEqual({ file });
    expect(shrinkImage).not.toHaveBeenCalled();
  });

  it("shrinks a photo over 5 MB and hands back the smaller file", async () => {
    const small = fileOf(2 * MB, "image/jpeg", "foto.jpg");
    shrinkImage.mockResolvedValue(small);
    expect(await prepareVoucher(fileOf(6 * MB, "image/jpeg"))).toEqual({ file: small });
    expect(shrinkImage).toHaveBeenCalledWith(expect.any(File), MAX_VOUCHER_BYTES);
  });

  it("shrinks a PNG too", async () => {
    shrinkImage.mockResolvedValue(fileOf(MB, "image/jpeg"));
    const result = await prepareVoucher(fileOf(6 * MB, "image/png"));
    expect("file" in result && result.file.type).toBe("image/jpeg");
  });

  it("never touches a PDF: an oversized one keeps the 5 MB message", async () => {
    expect(await prepareVoucher(fileOf(6 * MB, "application/pdf"))).toEqual({
      error: "El comprobante supera el límite de 5 MB (6,0 MB).",
    });
    expect(shrinkImage).not.toHaveBeenCalled();
  });

  it("falls back to the existing 5 MB message when shrinking fails", async () => {
    shrinkImage.mockRejectedValue(new Error("no canvas"));
    expect(await prepareVoucher(fileOf(6 * MB, "image/jpeg"))).toEqual({
      error: "El comprobante supera el límite de 5 MB (6,0 MB).",
    });
  });

  it("keeps the type and empty-file errors", async () => {
    expect(await prepareVoucher(fileOf(10, "text/plain"))).toEqual({
      error: "El comprobante debe ser un archivo PDF, JPG o PNG.",
    });
    expect(await prepareVoucher(fileOf(0, "image/png"))).toEqual({ error: "El comprobante está vacío." });
  });
});
