import { describe, it, expect } from "vitest";
import { buildTimelineLayout, formatMinutes, toMinutes, type TimelineItem } from "../timeline-layout";
import { groupTone } from "../group-palette";

function item(id: string, start: string, end: string): TimelineItem {
  return { id, start, end, title: id, status: "pending", statusLabel: "Pendiente" };
}

describe("toMinutes / formatMinutes", () => {
  it("round-trips a valid hour and rejects nonsense", () => {
    expect(toMinutes("15:30")).toBe(930);
    expect(formatMinutes(930)).toBe("15:30");
    expect(toMinutes("25:00")).toBeNull();
    expect(toMinutes("abc")).toBeNull();
  });
});

describe("buildTimelineLayout", () => {
  it("sizes the window from the first start to the last end and positions by real hours", () => {
    const layout = buildTimelineLayout([item("a", "15:00", "16:00"), item("b", "16:00", "18:00")], null)!;
    expect(layout.startLabel).toBe("15:00");
    expect(layout.endLabel).toBe("18:00");
    expect(layout.blocks[0]).toMatchObject({ leftPercent: 0, lane: 0 });
    expect(layout.blocks[0].widthPercent).toBeCloseTo(33.33, 1);
    expect(layout.blocks[1].leftPercent).toBeCloseTo(33.33, 1);
    expect(layout.blocks[1].widthPercent).toBeCloseTo(66.67, 1);
  });

  it("stacks simultaneous sessions in lanes and keeps one lane otherwise", () => {
    expect(buildTimelineLayout([item("a", "15:00", "16:00"), item("b", "16:00", "17:00")], null)!.lanes).toBe(1);
    const stacked = buildTimelineLayout([item("a", "15:00", "17:00"), item("b", "16:00", "17:00")], null)!;
    expect(stacked.lanes).toBe(2);
    expect(stacked.blocks[1].lane).toBe(1);
  });

  it("places the clock inside the window, and not at all outside it", () => {
    const items = [item("a", "15:00", "17:00")];
    expect(buildTimelineLayout(items, 16 * 60)!.nowPercent).toBe(50);
    expect(buildTimelineLayout(items, 3 * 60)!.nowPercent).toBeNull();
    expect(buildTimelineLayout(items, null)!.nowPercent).toBeNull();
  });

  it("skips undrawable items and returns null when none can be drawn", () => {
    expect(buildTimelineLayout([item("a", "17:00", "16:00")], null)).toBeNull();
    expect(buildTimelineLayout([], null)).toBeNull();
    expect(buildTimelineLayout([item("a", "??", "16:00"), item("b", "15:00", "16:00")], null)!.blocks).toHaveLength(1);
  });

  it("ticks whole hours inside the window", () => {
    const layout = buildTimelineLayout([item("a", "15:00", "18:00")], null)!;
    expect(layout.ticks.map((t) => t.label)).toEqual(["15:00", "16:00", "17:00", "18:00"]);
  });
});

describe("groupTone", () => {
  it("pins the club's groups, ignoring case and accents", () => {
    expect(groupTone("Formativo")).toBe(groupTone("  FORMATIVO "));
    expect(groupTone("Formativo")).not.toBe(groupTone("Infantil"));
  });

  it("gives an unknown group the same colour every time", () => {
    expect(groupTone("Sub-12")).toBe(groupTone("Sub-12"));
  });
});
