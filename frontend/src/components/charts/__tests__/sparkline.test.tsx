/**
 * Sparkline — a tile-sized trend line that names itself in one sentence
 * (minimum, maximum, last) and opens the same tooltip on hover and keyboard.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Sparkline } from "@/components/charts";

const values = [4, 9, 6, 12, 8];
const pointLabels = ["hace 4 min", "hace 3 min", "hace 2 min", "hace 1 min", "ahora"];

describe("Sparkline", () => {
  it("names itself with the minimum, maximum and last value", () => {
    render(<Sparkline values={values} label="Solicitudes por minuto" />);
    expect(
      screen.getByRole("img", { name: "Solicitudes por minuto: mínimo 4, máximo 12, último 8" }),
    ).toBeInTheDocument();
  });

  it("formats the figures and appends the unit when given", () => {
    render(<Sparkline values={[0.4, 1.25]} label="Errores 5xx" unit="%" formatValue={(v) => v.toFixed(1)} />);
    expect(
      screen.getByRole("img", { name: "Errores 5xx: mínimo 0.4 %, máximo 1.3 %, último 1.3 %" }),
    ).toBeInTheDocument();
  });

  it("draws the line and the area in the requested tone", () => {
    render(<Sparkline values={values} label="CPU" tone="warn" />);
    expect(screen.getByTestId("sparkline-line").getAttribute("class")).toContain("stroke-state-warn");
    expect(screen.getByTestId("sparkline-area").getAttribute("class")).toContain("fill-state-warn");
  });

  it("defaults to the coal tone", () => {
    render(<Sparkline values={values} label="CPU" />);
    expect(screen.getByTestId("sparkline-line").getAttribute("class")).toContain("stroke-coal");
  });

  it("draws a threshold line and states it in the summary", () => {
    render(<Sparkline values={values} label="CPU" unit="%" threshold={10} />);
    expect(screen.getByTestId("sparkline-threshold")).toBeInTheDocument();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("umbral 10 %");
  });

  it("draws no threshold line unless asked", () => {
    render(<Sparkline values={values} label="CPU" />);
    expect(screen.queryByTestId("sparkline-threshold")).toBeNull();
  });

  it("survives an empty or single-point series without dividing by zero", () => {
    const { rerender } = render(<Sparkline values={[]} label="CPU" />);
    expect(screen.getByRole("img", { name: "CPU: sin datos" })).toBeInTheDocument();
    expect(screen.queryByTestId("sparkline-line")).toBeNull();
    rerender(<Sparkline values={[7]} label="CPU" />);
    expect(screen.getByTestId("sparkline-line").getAttribute("points")).not.toMatch(/NaN/);
  });

  it("opens the tooltip with the sentence of the point read by keyboard", () => {
    render(<Sparkline values={values} label="CPU" pointLabels={pointLabels} unit="%" />);
    const chart = screen.getByRole("img");
    expect(chart).toHaveAttribute("tabindex", "0");
    fireEvent.focus(chart);
    expect(screen.getByTestId("chart-tooltip").textContent).toBe("ahora: 8 %");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByTestId("chart-tooltip").textContent).toBe("hace 1 min: 12 %");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByTestId("chart-tooltip").textContent).toBe("hace 4 min: 4 %");
    fireEvent.blur(chart);
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });

  it("opens the tooltip under the pointer", () => {
    render(<Sparkline values={values} label="CPU" pointLabels={pointLabels} />);
    const chart = screen.getByRole("img");
    chart.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 20, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.mouseMove(chart, { clientX: 1 });
    expect(screen.getByTestId("chart-tooltip").textContent).toBe("hace 4 min: 4");
    fireEvent.mouseLeave(chart);
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });
});
