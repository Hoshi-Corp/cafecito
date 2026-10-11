import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
  EMPTY_PATTERN,
  QUANTA_PER_DAY,
  bestWindows,
  isSetUp,
  buildWeek,
  markAt,
  paintOverrides,
  paintPattern,
  shiftPattern,
  patternIndexAt,
  slotMark,
  summarize,
  toQuantum,
  weekStartOf,
} from "./availability";
import type { Mark, Member } from "./types";

const q = (iso: string, zone: string) => toQuantum(DateTime.fromISO(iso, { zone }).toMillis());

/** weekday: Monday = 0. */
function pattern(...ranges: [weekday: number, from: number, to: number, mark?: Mark][]) {
  return ranges.reduce(
    (p, [weekday, from, to, mark = "f"]) =>
      paintPattern(p, weekday * QUANTA_PER_DAY + from * 4, (to - from) * 4, mark),
    EMPTY_PATTERN,
  );
}

function member(id: string, timeZone: string, p = EMPTY_PATTERN): Member {
  return { id, name: id, color: "#000", timeZone, pattern: p, overrides: {} };
}

describe("patternIndexAt", () => {
  it("maps an instant to the member's local weekday and time", () => {
    // 2026-10-13 is a Tuesday.
    expect(patternIndexAt(q("2026-10-13T18:30", "America/Toronto"), "America/Toronto")).toBe(
      1 * QUANTA_PER_DAY + 74,
    );
    // The same instant is 07:30 on Wednesday in Tokyo.
    expect(patternIndexAt(q("2026-10-13T18:30", "America/Toronto"), "Asia/Tokyo")).toBe(
      2 * QUANTA_PER_DAY + 30,
    );
  });
});

describe("markAt", () => {
  const ana = member("ana", "America/Toronto", pattern([1, 18, 20]));

  it("keeps the weekly pattern on wall-clock time across DST changes", () => {
    // Toronto leaves DST on 2026-11-01; Tuesdays on both sides stay 18:00 local.
    expect(markAt(ana, q("2026-10-27T18:00", "America/Toronto"))).toBe("f");
    expect(markAt(ana, q("2026-11-03T18:00", "America/Toronto"))).toBe("f");
    expect(markAt(ana, q("2026-11-03T17:45", "America/Toronto"))).toBeNull();
  });

  it("lets overrides win over the pattern, and clears them again", () => {
    const at = q("2026-10-13T18:00", "America/Toronto");
    const busy = { ...ana, overrides: paintOverrides({}, at, 4, "b") };
    expect(markAt(busy, at)).toBeNull();
    expect(markAt(busy, at + 4)).toBe("f");
    // The following Tuesday is untouched.
    expect(markAt(busy, q("2026-10-20T18:00", "America/Toronto"))).toBe("f");

    const cleared = { ...busy, overrides: paintOverrides(busy.overrides, at, 4, null) };
    expect(markAt(cleared, at)).toBe("f");
  });
});

describe("slotMark", () => {
  it("needs the whole slot free, which matters for half-hour-offset zones", () => {
    // Free 18:00-20:00 in Kolkata (UTC+5:30) is 12:30-14:30 UTC.
    const ravi = member("ravi", "Asia/Kolkata", pattern([1, 18, 20]));
    expect(slotMark(ravi, q("2026-10-13T12:00", "utc"), 4)).toBeNull();
    expect(slotMark(ravi, q("2026-10-13T13:00", "utc"), 4)).toBe("f");
    expect(slotMark(ravi, q("2026-10-13T12:30", "utc"), 2)).toBe("f");
  });

  it("downgrades to maybe when any part of the slot is maybe", () => {
    const eli = member("eli", "utc", pattern([1, 18, 19], [1, 19, 20, "m"]));
    expect(slotMark(eli, q("2026-10-13T18:00", "utc"), 4)).toBe("f");
    expect(slotMark(eli, q("2026-10-13T18:30", "utc"), 4)).toBe("m");
  });
});

describe("patternIndexAt across a transition", () => {
  it("stays exact in an hour that contains a clock change", () => {
    // Lord Howe moves from UTC+10:30 to +11:00 at 15:30 UTC on 2026-10-03, mid-hour.
    const zone = "Australia/Lord_Howe";
    const sunday = 6 * QUANTA_PER_DAY;
    expect(patternIndexAt(q("2026-10-03T15:15Z", "UTC"), zone)).toBe(sunday + 1 * 4 + 3); // 01:45
    expect(patternIndexAt(q("2026-10-03T15:45Z", "UTC"), zone)).toBe(sunday + 2 * 4 + 3); // 02:45
  });
});

describe("buildWeek", () => {
  it("lays the week out in the viewer's zone", () => {
    const weekStart = weekStartOf(DateTime.fromISO("2026-10-14T09:00Z").toMillis(), "Europe/Lisbon");
    expect(weekStart).toBe("2026-10-12");
    const week = buildWeek("Europe/Lisbon", weekStart, 30, 7, 24);
    expect(week.days.map((d) => d.date)).toEqual([
      "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
      "2026-10-16", "2026-10-17", "2026-10-18",
    ]);
    expect(week.rowMinutes).toHaveLength(34);
    expect(week.quantaPerSlot).toBe(2);
    expect(week.days[1].startQ[0]).toBe(q("2026-10-13T07:00", "Europe/Lisbon"));
  });

  it("shows a Toronto evening in a Lisbon viewer's night", () => {
    const ana = member("ana", "America/Toronto", pattern([1, 18, 20]));
    const week = buildWeek("Europe/Lisbon", "2026-10-12", 60);
    // Tue 18:00 Toronto (UTC-4) = Tue 23:00 Lisbon (UTC+1).
    expect(summarize([ana], week.days[1].startQ[23], 4).free).toEqual([ana]);
    expect(summarize([ana], week.days[1].startQ[22], 4).busy).toEqual([ana]);
    expect(summarize([ana], week.days[2].startQ[0], 4).free).toEqual([ana]);
  });
});

describe("bestWindows", () => {
  const from = q("2026-10-12T00:00", "utc");
  const to = q("2026-10-19T00:00", "utc");

  it("ranks windows by head count, then by start", () => {
    const a = member("a", "utc", pattern([1, 18, 21], [3, 12, 14]));
    const b = member("b", "utc", pattern([1, 18, 20], [3, 12, 14]));
    const c = member("c", "utc", pattern([1, 19, 22], [3, 12, 14]));
    const d = member("d", "utc", pattern([3, 12, 14], [1, 19, 20, "m"]));
    const windows = bestWindows([a, b, c, d], from, to);

    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({
      startQ: q("2026-10-15T12:00", "utc"),
      endQ: q("2026-10-15T14:00", "utc"),
      free: [a, b, c, d],
      maybe: [],
    });
    expect(windows[1]).toMatchObject({
      startQ: q("2026-10-13T19:00", "utc"),
      endQ: q("2026-10-13T20:00", "utc"),
      free: [a, b, c],
      maybe: [d],
    });
  });

  it("keeps a window whole when someone else is free for only part of it", () => {
    const a = member("a", "utc", pattern([1, 18, 20]));
    const b = member("b", "utc", pattern([1, 18, 20]));
    const c = member("c", "utc", pattern([1, 17, 21]));
    const d = member("d", "utc", pattern([1, 18.5, 19]));
    const windows = bestWindows([a, b, c, d], from, to);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      startQ: q("2026-10-13T18:00", "utc"),
      endQ: q("2026-10-13T20:00", "utc"),
      free: [a, b, c],
    });
  });

  it("drops overlaps shorter than the minimum length", () => {
    const a = member("a", "utc", pattern([1, 18, 19]));
    const b = member("b", "utc", pattern([1, 18.5, 20]));
    expect(bestWindows([a, b], from, to)).toEqual([]);
    expect(bestWindows([a, b], from, to, { minMinutes: 30 })).toHaveLength(1);
  });
});

describe("paintPattern", () => {
  it("wraps a slot that crosses the end of the week into Monday", () => {
    // Sunday 23:30 for one hour: 2 quanta on Sunday, 2 on Monday.
    const p = paintPattern(EMPTY_PATTERN, 6 * QUANTA_PER_DAY + 94, 4, "f");
    expect(p.slice(6 * QUANTA_PER_DAY + 94)).toBe("ff");
    expect(p.slice(0, 4)).toBe("ff..");
  });
});

describe("shiftPattern", () => {
  it("moves the week later and wraps around", () => {
    const tue18 = pattern([1, 18, 19]);
    expect(shiftPattern(tue18, 4)).toBe(pattern([1, 19, 20]));
    expect(shiftPattern(pattern([6, 23, 24]), 8)).toBe(pattern([0, 1, 2]));
    expect(shiftPattern(tue18, -4)).toBe(pattern([1, 17, 18]));
    expect(shiftPattern(tue18, 0)).toBe(tue18);
  });
});

describe("isSetUp", () => {
  it("is false until something other than busy is marked", () => {
    expect(isSetUp(member("a", "UTC"))).toBe(false);
    expect(isSetUp({ ...member("a", "UTC"), overrides: { 1: "b" } })).toBe(false);
    expect(isSetUp(member("a", "UTC", pattern([0, 9, 10])))).toBe(true);
    expect(isSetUp({ ...member("a", "UTC"), overrides: { 1: "f" } })).toBe(true);
  });
});

describe("the repeated hour when clocks go back", () => {
  // Toronto, Sun 2026-11-01: 01:00-02:00 happens twice (EDT, then EST).
  const secondOne = q("2026-11-01T01:30-05:00", "UTC");
  const week = buildWeek("America/Toronto", "2026-10-26", 60);
  const inGrid = (quantum: number) =>
    week.days.some((d) => d.startQ.some((s) => quantum >= s && quantum < s + week.quantaPerSlot));

  it("has no grid row for the second occurrence, so only the first can be painted", () => {
    expect(inGrid(q("2026-11-01T01:30-04:00", "UTC"))).toBe(true);
    expect(inGrid(secondOne)).toBe(false);
  });

  it("still applies the typical week to both occurrences", () => {
    const ana = member("ana", "America/Toronto", pattern([6, 1, 2]));
    expect(markAt(ana, q("2026-11-01T01:30-04:00", "UTC"))).toBe("f");
    expect(markAt(ana, secondOne)).toBe("f");
  });
});
