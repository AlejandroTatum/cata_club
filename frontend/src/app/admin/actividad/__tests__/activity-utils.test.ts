import { describe, it, expect } from "vitest";
import {
  healthCopy,
  NO_READING,
  STALE_AFTER_MINUTES,
  formatAge,
  formatOrDash,
  isStale,
  lastReading,
  shareOrNull,
  formatCount,
  formatDecimal,
  formatMegabytes,
  formatPeriodDetail,
  formatPeriodLabel,
  formatPointLabel,
  formatUpdatedAgo,
  minutesBetween,
  parseView,
  shareOf,
  statusCopy,
  swapTone,
  toneForThresholds,
} from "../activity-utils";

describe("formatUpdatedAgo", () => {
  it.each([
    [0, "Actualizado ahora"],
    [1, "Actualizado hace 1 min"],
    [12, "Actualizado hace 12 min"],
    [60, "Actualizado hace 1 h"],
    [185, "Actualizado hace 3 h"],
  ])("%i min -> %s", (minutes, expected) => {
    expect(formatUpdatedAgo(minutes)).toBe(expected);
  });
});

describe("minutesBetween", () => {
  it("counts whole minutes between two ISO instants, never negative", () => {
    expect(minutesBetween("2026-10-01T15:28:00-05:00", "2026-10-01T15:30:00-05:00")).toBe(2);
    expect(minutesBetween("2026-10-01T15:31:00-05:00", "2026-10-01T15:30:00-05:00")).toBe(0);
  });
});

describe("number formatting", () => {
  it("groups thousands with a dot and uses a decimal comma", () => {
    expect(formatCount(1234)).toBe("1.234");
    expect(formatCount(87)).toBe("87");
    expect(formatDecimal(0.25, 1)).toBe("0,3");
    expect(formatDecimal(12, 1)).toBe("12,0");
  });

  it("writes megabytes up to a gigabyte and gigabytes beyond", () => {
    expect(formatMegabytes(248)).toBe("248 MB");
    expect(formatMegabytes(1536)).toBe("1,5 GB");
    expect(formatMegabytes(1024)).toBe("1 GB");
  });

  it("writes an age as minutes, then hours and minutes", () => {
    expect(formatAge(4)).toBe("4 min");
    expect(formatAge(60)).toBe("1 h");
    expect(formatAge(125)).toBe("2 h 5 min");
  });
});

describe("shareOf", () => {
  it("is the rounded percentage, and 0 for an empty whole", () => {
    expect(shareOf(248, 320)).toBe(78);
    expect(shareOf(1, 0)).toBe(0);
  });
});

describe("toneForThresholds", () => {
  const limits = { warn: 80, bad: 90 };
  it("is ok below warn, warn from warn, bad from bad", () => {
    expect(toneForThresholds(79.9, limits)).toBe("ok");
    expect(toneForThresholds(80, limits)).toBe("warn");
    expect(toneForThresholds(90, limits)).toBe("bad");
  });
});

describe("swapTone", () => {
  it("warns when swap grew over the window and stays ok when flat or empty", () => {
    expect(swapTone([180, 190, 214])).toBe("warn");
    expect(swapTone([200, 201, 202])).toBe("ok");
    expect(swapTone([0, 0, 0])).toBe("ok");
    expect(swapTone([])).toBe("ok");
  });
});

describe("period and point labels", () => {
  it("labels two-hour, daily and six-day periods", () => {
    expect(formatPeriodLabel("2026-10-01T14:00:00-05:00", "2h")).toBe("14 h");
    expect(formatPeriodLabel("2026-09-25T00:00:00-05:00", "1d")).toBe("vie 25");
    expect(formatPeriodLabel("2026-09-02T00:00:00-05:00", "6d")).toBe("2/9");
  });

  it("details a period as a sentence fragment", () => {
    expect(formatPeriodDetail("2026-10-01T14:00:00-05:00", "2h")).toBe("de 14 a 16 h");
    expect(formatPeriodDetail("2026-09-25T00:00:00-05:00", "1d")).toBe("viernes 25 de septiembre");
    expect(formatPeriodDetail("2026-09-26T00:00:00-05:00", "6d")).toBe("del 26 de septiembre al 1 de octubre");
  });

  it("says how long ago a chart point is", () => {
    expect(formatPointLabel(59, 60, 1)).toBe("ahora");
    expect(formatPointLabel(54, 60, 1)).toBe("hace 5 min");
    expect(formatPointLabel(0, 24, 60)).toBe("hace 23 h");
    expect(formatPointLabel(0, 28, 360)).toBe("hace 6 d 18 h");
  });
});

describe("parseView", () => {
  it("accepts only the advanced view by name and defaults to the summary", () => {
    expect(parseView("avanzadas")).toBe("avanzadas");
    expect(parseView("resumen")).toBe("resumen");
    expect(parseView(null)).toBe("resumen");
    expect(parseView("x")).toBe("resumen");
  });
});

describe("statusCopy", () => {
  it("states ok in one sentence and adds an action only when something is wrong", () => {
    expect(statusCopy("app", "ok")).toEqual({ sentence: "La aplicación responde con normalidad.", action: null });
    const warn = statusCopy("notifications", "warn");
    expect(warn.sentence).toMatch(/^Hay correos o avisos/);
    expect(warn.action).toMatch(/técnico/);
    expect(statusCopy("errors", "bad").action).not.toBeNull();
  });
});

describe("missing readings", () => {
  it("writes a missing figure as a dash and formats a present one", () => {
    expect(NO_READING).toBe("—");
    expect(formatOrDash(null)).toBe("—");
    expect(formatOrDash(1234)).toBe("1.234");
    expect(formatOrDash(0.25, (v) => formatDecimal(v, 1))).toBe("0,3");
    expect(formatOrDash(0)).toBe("0");
  });

  it("takes the latest reading of a series, null when that minute has none", () => {
    expect(lastReading([1, 2, 3])).toBe(3);
    expect(lastReading([1, 2, null])).toBeNull();
    expect(lastReading([])).toBeNull();
  });

  it("computes a share only when both figures exist", () => {
    expect(shareOrNull(14, 100)).toBe(14);
    expect(shareOrNull(null, 100)).toBeNull();
    expect(shareOrNull(14, null)).toBeNull();
  });

  it("ignores gaps when judging whether swap keeps growing", () => {
    expect(swapTone([100, null, 150])).toBe("warn");
    expect(swapTone([null, 120, null])).toBe("ok");
    expect(swapTone([null, null])).toBe("ok");
  });

  it("calls a snapshot stale only past three minutes", () => {
    const now = "2026-10-01T15:30:00-05:00";
    expect(STALE_AFTER_MINUTES).toBe(3);
    expect(isStale("2026-10-01T15:27:00-05:00", now)).toBe(false);
    expect(isStale("2026-10-01T15:26:00-05:00", now)).toBe(true);
  });

  it("has plain copy for a status nobody has measured yet", () => {
    for (const key of ["app", "errors", "notifications"] as const) {
      expect(statusCopy(key, "unknown").sentence).toMatch(/Sin datos todavía/);
      expect(statusCopy(key, "unknown").action).toBeNull();
    }
  });
});

describe("healthCopy (ADMB-N1)", () => {
  it("is null when health is missing, null or ok", () => {
    expect(healthCopy(undefined)).toBeNull();
    expect(healthCopy(null)).toBeNull();
    expect(healthCopy({ state: "ok", degraded: false, heartbeatAgeSeconds: 5, components: [] })).toBeNull();
  });

  it("names every degraded component, in usted", () => {
    const copy = healthCopy({
      state: "degraded",
      degraded: true,
      heartbeatAgeSeconds: null,
      components: [
        { key: "workers", reason: "heartbeat_missing" },
        { key: "email", reason: "heartbeat_missing" },
        { key: "outbox", reason: "heartbeat_missing" },
      ],
    });
    expect(copy?.sentence).toBe(
      "Hay una falla en los procesos en segundo plano, el envío de correos y la cola de correos.",
    );
    expect(copy?.action).toMatch(/Avise de inmediato/);
  });

  it("explains a stuck outbox without blaming the workers", () => {
    const copy = healthCopy({
      state: "degraded",
      degraded: true,
      heartbeatAgeSeconds: 30,
      components: [
        { key: "email", reason: "outbox_stale" },
        { key: "outbox", reason: "outbox_stale" },
      ],
    });
    expect(copy?.sentence).toBe("Hay una falla en el envío de correos y la cola de correos.");
    expect(copy?.action).toMatch(/30 minutos/);
  });
});
