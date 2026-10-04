import { describe, expect, it } from "vitest";
import { CROP_INICIAL, GALERIA_ASPECT, cropRect, isAllowedRatio, moverRecorte, tamanoSalida } from "../crop";

describe("isAllowedRatio", () => {
  it("accepts a 3:2 photo and a near-3:2 one within 1%", () => {
    expect(isAllowedRatio(3000, 2000)).toBe(true);
    expect(isAllowedRatio(1500, 1004)).toBe(true);
  });
  it("rejects panoramic, tall and square photos", () => {
    expect(isAllowedRatio(4000, 1000)).toBe(false);
    expect(isAllowedRatio(1000, 3000)).toBe(false);
    expect(isAllowedRatio(1000, 1000)).toBe(false);
  });
  it("is false for an unmeasured photo", () => {
    expect(isAllowedRatio(0, 0)).toBe(false);
  });
});

describe("cropRect", () => {
  it("centres the largest 3:2 window in a wide photo", () => {
    const r = cropRect(4000, 1000, CROP_INICIAL);
    expect(r.sh).toBe(1000);
    expect(r.sw).toBe(1500);
    expect(r.sx).toBe(1250);
    expect(r.sy).toBe(0);
  });
  it("centres the largest 3:2 window in a tall photo", () => {
    const r = cropRect(1500, 3000, CROP_INICIAL);
    expect(r.sw).toBe(1500);
    expect(r.sh).toBe(1000);
    expect(r.sy).toBe(1000);
  });
  it("always keeps the window at 3:2", () => {
    for (const [w, h] of [[4000, 1000], [1000, 3000], [3000, 2000], [900, 900]]) {
      const r = cropRect(w, h, { zoom: 1.7, x: 0.2, y: 0.9 });
      expect(r.sw / r.sh).toBeCloseTo(GALERIA_ASPECT, 5);
    }
  });
  it("zooms in by shrinking the window and clamps the position inside the photo", () => {
    const r = cropRect(3000, 2000, { zoom: 2, x: 5, y: -3 });
    expect(r.sw).toBe(1500);
    expect(r.sx).toBe(1500);
    expect(r.sy).toBe(0);
  });
  it("treats a zoom below 1 as 1", () => {
    expect(cropRect(3000, 2000, { zoom: 0.2, x: 0.5, y: 0.5 }).sw).toBe(3000);
  });
});

describe("moverRecorte", () => {
  it("dragging right shows what is to the left (the window moves the other way)", () => {
    const antes = { zoom: 1, x: 0.5, y: 0.5 };
    const despues = moverRecorte(4000, 1000, antes, 0.1, 0);
    expect(despues.x).toBeLessThan(0.5);
  });
  it("cannot drag past the edges of the photo", () => {
    expect(moverRecorte(4000, 1000, CROP_INICIAL, -10, 0).x).toBe(1);
    expect(moverRecorte(4000, 1000, CROP_INICIAL, 10, 0).x).toBe(0);
  });
  it("does not move on an axis with no slack", () => {
    expect(moverRecorte(4000, 1000, CROP_INICIAL, 0, 0.3).y).toBe(0.5);
  });
});

describe("tamanoSalida", () => {
  it("never upscales and keeps 3:2", () => {
    expect(tamanoSalida(900)).toEqual({ width: 900, height: 600 });
  });
  it("caps the width", () => {
    expect(tamanoSalida(6000)).toEqual({ width: 1800, height: 1200 });
  });
});
