/**
 * ScrollableTable — #821: a horizontally scrollable `overflow-x-auto`
 * container is unreachable by keyboard unless it is itself focusable and
 * named, which is what axe's `scrollable-region-focusable` (serious) checks
 * for. jsdom cannot compute overflow/scrollWidth, so it can never assert the
 * container actually scrolls — these lock the three attributes that make it
 * reachable and identifiable instead.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ScrollableTable from "@/components/ui/ScrollableTable";

describe("ScrollableTable", () => {
  it("puts the scroll container in the tab order", () => {
    render(
      <ScrollableTable label="Horarios, tabla desplazable">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>,
    );

    expect(screen.getByRole("region", { name: "Horarios, tabla desplazable" })).toHaveAttribute(
      "tabIndex",
      "0",
    );
  });

  it("names the region for assistive tech via aria-label", () => {
    render(
      <ScrollableTable label="Listado de pagos, tabla desplazable">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>,
    );

    const region = screen.getByRole("region", { name: "Listado de pagos, tabla desplazable" });
    expect(region).toHaveAttribute("aria-label", "Listado de pagos, tabla desplazable");
  });

  it("keeps the horizontal-scroll class and forwards extra classNames", () => {
    render(
      <ScrollableTable label="Horarios, tabla desplazable" className="mt-4">
        <table>
          <tbody>
            <tr>
              <td>x</td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>,
    );

    const region = screen.getByRole("region", { name: "Horarios, tabla desplazable" });
    expect(region).toHaveClass("overflow-x-auto");
    expect(region).toHaveClass("mt-4");
  });

  it("renders its children inside the scroll region", () => {
    render(
      <ScrollableTable label="Horarios, tabla desplazable">
        <table data-testid="inner-table" />
      </ScrollableTable>,
    );

    expect(screen.getByRole("region")).toContainElement(screen.getByTestId("inner-table"));
  });
});
