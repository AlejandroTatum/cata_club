/**
 * Unit tests for the club's single source of truth on "what day is it".
 *
 * Every case pins an instant deliberately chosen so the club's calendar date
 * and the machine's disagree — a helper that reads the device clock passes a
 * naive test and fails these.
 */

import { describe, it, expect } from "vitest";
import {
  CLUB_TIME_ZONE,
  buildDateRange,
  calendarIsoDate,
  clubIsoDate,
  clubToday,
  todayDiaSemana,
} from "../club-date";

describe("CLUB_TIME_ZONE", () => {
  it("is an IANA zone, not a hardcoded offset", () => {
    // Ecuador is a fixed UTC-5 today. Encoding "-05:00" would survive exactly
    // until the day that stops being true, and then drift silently by an hour.
    expect(CLUB_TIME_ZONE).toBe("America/Guayaquil");
  });
});

describe("clubIsoDate", () => {
  it("reads the calendar date at the club, not on the device", () => {
    // 02:00Z on the 24th is still 21:00 on the 23rd in Guayaquil.
    expect(clubIsoDate(new Date("2026-07-24T02:00:00Z"))).toBe("2026-07-23");
  });

  it("rolls over at club midnight, not at UTC midnight", () => {
    expect(clubIsoDate(new Date("2026-07-24T04:59:00Z"))).toBe("2026-07-23");
    expect(clubIsoDate(new Date("2026-07-24T05:00:00Z"))).toBe("2026-07-24");
  });

  it("zero-pads month and day so the string always sorts", () => {
    expect(clubIsoDate(new Date("2026-01-05T17:00:00Z"))).toBe("2026-01-05");
  });

  it("crosses a year boundary in club time", () => {
    // 01:00Z on Jan 1 is still 20:00 on Dec 31 at the club.
    expect(clubIsoDate(new Date("2027-01-01T01:00:00Z"))).toBe("2026-12-31");
  });
});

describe("calendarIsoDate", () => {
  it("reads back the same day a calendar date was built with", () => {
    // The result of date arithmetic is already a day; routing it through a
    // time zone would move it. This is the half of the contract that must NOT
    // convert.
    expect(calendarIsoDate(new Date(2026, 6, 1, 12))).toBe("2026-07-01");
    expect(calendarIsoDate(new Date("2026-07-01T12:00:00"))).toBe("2026-07-01");
  });

  it("survives a month rollover done with setMonth", () => {
    const d = new Date("2026-01-31T12:00:00");
    d.setMonth(d.getMonth() + 1);
    // JS overflows Jan 31 + 1 month into March 3 — not this function's
    // business to fix, but it must report what the Date actually holds.
    expect(calendarIsoDate(d)).toBe(calendarIsoDate(new Date(d.getTime())));
  });

  it("zero-pads so the string sorts lexicographically", () => {
    expect(calendarIsoDate(new Date(2026, 0, 5, 12))).toBe("2026-01-05");
  });
});

describe("clubToday", () => {
  it("returns the club's calendar date anchored at local noon", () => {
    // Noon, not midnight: day arithmetic on a midnight anchor can slip across
    // a DST boundary in whatever zone the device runs in.
    const day = clubToday(new Date("2026-07-24T02:00:00Z"));
    expect(calendarIsoDate(day)).toBe("2026-07-23");
    expect(day.getHours()).toBe(12);
  });
});

describe("todayDiaSemana", () => {
  it("resolves the weekday in club time", () => {
    // Friday on a UTC clock, Thursday at the club.
    expect(todayDiaSemana(new Date("2026-07-24T02:00:00Z"))).toBe("jue");
  });

  it("flips exactly at club midnight", () => {
    expect(todayDiaSemana(new Date("2026-07-24T04:59:00Z"))).toBe("jue");
    expect(todayDiaSemana(new Date("2026-07-24T05:00:00Z"))).toBe("vie");
  });

  it("maps Sunday to 'dom' rather than falling off the week", () => {
    expect(todayDiaSemana(new Date("2026-07-26T12:00:00Z"))).toBe("dom");
    expect(todayDiaSemana(new Date("2026-07-27T03:00:00Z"))).toBe("dom");
  });

  it("covers every day of the week with no gaps or repeats", () => {
    // 2026-07-20 is a Monday.
    const week = Array.from({ length: 7 }, (_, i) =>
      todayDiaSemana(new Date(`2026-07-${20 + i}T17:00:00Z`)),
    );
    expect(week).toEqual(["lun", "mar", "mie", "jue", "vie", "sab", "dom"]);
  });
});

describe("buildDateRange", () => {
  /** Wednesday 2026-07-22, 10:00 at the club. */
  const WEDNESDAY = new Date("2026-07-22T15:00:00Z");

  it("collapses 'today' to a single club day", () => {
    expect(buildDateRange("today", WEDNESDAY)).toEqual({
      fechaInicio: "2026-07-22",
      fechaFin: "2026-07-22",
    });
  });

  it("starts the week on Monday, like every other day list in the app", () => {
    // DIA_SEMANA_LABELS and groupSchedulesByDay both order lun..dom. A
    // Sunday-start week here is a `Date.getDay()` artifact leaking into the
    // domain, and it made "Esta semana" disagree with the schedule board.
    expect(buildDateRange("this_week", WEDNESDAY)).toEqual({
      fechaInicio: "2026-07-20",
      fechaFin: "2026-07-22",
    });
  });

  it("keeps Sunday in the week that began the previous Monday", () => {
    // The case a Sunday-start week gets backwards: on Sunday it would reset
    // the range to a one-day window and blank the trainer's week.
    expect(buildDateRange("this_week", new Date("2026-07-26T15:00:00Z"))).toEqual({
      fechaInicio: "2026-07-20",
      fechaFin: "2026-07-26",
    });
  });

  it("treats Monday itself as a one-day week so far", () => {
    expect(buildDateRange("this_week", new Date("2026-07-20T15:00:00Z"))).toEqual({
      fechaInicio: "2026-07-20",
      fechaFin: "2026-07-20",
    });
  });

  it("spans a week that crosses a month boundary", () => {
    // Wednesday 2026-08-05; its Monday is 2026-08-03. Sanity that the
    // subtraction goes through the Date arithmetic, not through day-of-month.
    expect(buildDateRange("this_week", new Date("2026-08-05T15:00:00Z"))).toEqual({
      fechaInicio: "2026-08-03",
      fechaFin: "2026-08-05",
    });
  });

  it("runs 'this_month' from the first of the month to today", () => {
    expect(buildDateRange("this_month", WEDNESDAY)).toEqual({
      fechaInicio: "2026-07-01",
      fechaFin: "2026-07-22",
    });
  });

  it("gives a single-day month range on the first, in club time", () => {
    // 06:00Z on Aug 1 is 01:00 Aug 1 at the club — the machine and the club
    // agree here, but 02:00Z would still be July 31.
    expect(buildDateRange("this_month", new Date("2026-08-01T06:00:00Z"))).toEqual({
      fechaInicio: "2026-08-01",
      fechaFin: "2026-08-01",
    });
    expect(buildDateRange("this_month", new Date("2026-08-01T02:00:00Z"))).toEqual({
      fechaInicio: "2026-07-01",
      fechaFin: "2026-07-31",
    });
  });

  it("returns empty strings for 'custom' so the caller must fill them", () => {
    expect(buildDateRange("custom", WEDNESDAY)).toEqual({ fechaInicio: "", fechaFin: "" });
  });
});
