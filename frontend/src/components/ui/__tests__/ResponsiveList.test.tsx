/**
 * ResponsiveList — the wrapper hooks a screen can use without forking the
 * component.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ResponsiveList from "@/components/ui/ResponsiveList";

describe("ResponsiveList — tableClassName", () => {
  it("lands on the desktop table's scroll wrapper, next to the breakpoint classes", () => {
    render(
      <ResponsiveList
        breakpoint="md"
        order="tableFirst"
        tableTestId="table"
        tableClassName="[&_td]:px-3"
        items={[{ id: 1 }]}
        getKey={(item) => item.id}
        columns={[]}
        renderRow={() => null}
        renderCard={() => null}
      />,
    );
    const wrapper = screen.getByTestId("table");
    expect(wrapper).toHaveClass("[&_td]:px-3", "hidden", "md:block");
  });

  it("changes nothing when omitted", () => {
    render(
      <ResponsiveList
        breakpoint="sm"
        order="cardsFirst"
        tableTestId="table"
        items={[]}
        getKey={() => 0}
        columns={[]}
        renderRow={() => null}
        renderCard={() => null}
      />,
    );
    expect(screen.getByTestId("table").className).toBe("hidden overflow-x-auto sm:block");
  });
});
