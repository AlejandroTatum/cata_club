import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_SIDE, shrinkImage } from "../shrink-image";

const MB = 1024 * 1024;

function fileOf(size: number, type = "image/jpeg", name = "foto.jpeg"): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** Stubs the browser pieces jsdom lacks: decoding, a 2D canvas and `toBlob`. */
function stubBrowser(opts: { width: number; height: number; blobSizes: number[] }) {
  const drawn: { w: number; h: number }[] = [];
  const qualities: number[] = [];
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: opts.width, height: opts.height, close }));
  const sizes = [...opts.blobSizes];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: vi.fn(),
    drawImage: (_i: unknown, _x: number, _y: number, w: number, h: number) => drawn.push({ w, h }),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb, type, quality) => {
    qualities.push(quality as number);
    cb(new Blob([new Uint8Array(sizes.shift() ?? 0)], { type: type as string }));
  });
  return { drawn, qualities, close };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("shrinkImage (FAM-26)", () => {
  it("scales the long side down to the limit and returns a JPEG under the cap", async () => {
    const { drawn, close } = stubBrowser({ width: 4000, height: 3000, blobSizes: [2 * MB] });
    const out = await shrinkImage(fileOf(6 * MB), 5 * MB);
    expect(MAX_IMAGE_SIDE).toBe(2000);
    expect(drawn).toEqual([{ w: 2000, h: 1500 }]);
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBe(2 * MB);
    expect(out.name).toBe("foto.jpg");
    expect(close).toHaveBeenCalled();
  });

  it("lowers the quality until the result fits", async () => {
    const { qualities } = stubBrowser({ width: 3000, height: 4000, blobSizes: [6 * MB, 5.5 * MB, 3 * MB] });
    const out = await shrinkImage(fileOf(7 * MB, "image/png", "captura.png"), 5 * MB);
    expect(qualities).toHaveLength(3);
    expect(qualities[0]).toBeGreaterThan(qualities[1]);
    expect(out.name).toBe("captura.jpg");
    expect(out.size).toBe(3 * MB);
  });

  it("never enlarges a small image", async () => {
    const { drawn } = stubBrowser({ width: 1200, height: 800, blobSizes: [MB] });
    await shrinkImage(fileOf(6 * MB), 5 * MB);
    expect(drawn).toEqual([{ w: 1200, h: 800 }]);
  });

  it("rejects when the image cannot be decoded", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("bad image")));
    await expect(shrinkImage(fileOf(6 * MB), 5 * MB)).rejects.toThrow();
  });

  it("rejects when even the lowest quality stays over the cap", async () => {
    stubBrowser({ width: 4000, height: 3000, blobSizes: [9 * MB, 9 * MB, 9 * MB, 9 * MB] });
    await expect(shrinkImage(fileOf(12 * MB), 5 * MB)).rejects.toThrow();
  });

  it("rejects when the browser has no canvas support", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    await expect(shrinkImage(fileOf(6 * MB), 5 * MB)).rejects.toThrow();
  });
});
