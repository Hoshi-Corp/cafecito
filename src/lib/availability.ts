import { DateTime, IANAZone } from "luxon";
import type { Mark, Member, OverrideMark, SlotMinutes } from "./types";

// Availability is stored at 15-minute resolution regardless of the group's
// slot size, so changing the slot size never loses data. Every IANA offset is
// a multiple of 15 minutes, so UTC quanta line up with local ones everywhere.
export const QUANTUM_MINUTES = 15;
export const QUANTUM_MS = QUANTUM_MINUTES * 60_000;
export const QUANTA_PER_DAY = 96;
export const QUANTA_PER_WEEK = 7 * QUANTA_PER_DAY;
// A plan covers at most this long (4 hours); the group screen offers best windows, clipped to it.
export const MAX_OUTING_QUANTA = 16;
export const EMPTY_PATTERN = ".".repeat(QUANTA_PER_WEEK);

export const toQuantum = (ms: number) => Math.floor(ms / QUANTUM_MS);

const HOUR_MS = 3_600_000;
// Offset lookups go through Intl and dominate the cost of every heatmap render. A zone's offset
// is constant within an hour except across a transition, so cache it per zone and hour and fall
// back to a direct lookup for the rare hour that contains one.
// shortcut: cleared whole when it passes 50k entries, swap for an LRU if that ever thrashes.
const offsetCache = new Map<string, number | null>();

function offsetAt(timeZone: string, ms: number): number {
  const zone = IANAZone.create(timeZone);
  const hour = Math.floor(ms / HOUR_MS);
  const key = `${timeZone}|${hour}`;
  let offset = offsetCache.get(key);
  if (offset === undefined) {
    const first = zone.offset(hour * HOUR_MS);
    offset = first === zone.offset((hour + 1) * HOUR_MS - 1) ? first : null;
    if (offsetCache.size > 50_000) offsetCache.clear();
    offsetCache.set(key, offset);
  }
  return offset ?? zone.offset(ms);
}

/** Index into a member's weekly pattern for the UTC quantum `q`. */
export function patternIndexAt(q: number, timeZone: string): number {
  const ms = q * QUANTUM_MS;
  const localQ = Math.floor((ms + offsetAt(timeZone, ms) * 60_000) / QUANTUM_MS);
  const day = Math.floor(localQ / QUANTA_PER_DAY);
  // 1970-01-01 was a Thursday; Monday is weekday 0.
  const weekday = (((day + 3) % 7) + 7) % 7;
  return weekday * QUANTA_PER_DAY + (localQ - day * QUANTA_PER_DAY);
}

export function markAt(member: Member, q: number): Mark | null {
  const override = member.overrides[q];
  if (override) return override === "b" ? null : override;
  const c = member.pattern[patternIndexAt(q, member.timeZone)];
  return c === "f" || c === "m" ? c : null;
}

function combine(marks: Iterable<Mark | null>): Mark | null {
  let result: Mark = "f";
  for (const m of marks) {
    if (m === null) return null;
    if (m === "m") result = "m";
  }
  return result;
}

/** A slot is free only if every quantum in it is; one "maybe" makes it maybe. */
export function slotMark(member: Member, startQ: number, quanta: number): Mark | null {
  return combine(
    (function* () {
      for (let i = 0; i < quanta; i++) yield markAt(member, startQ + i);
    })(),
  );
}

export function patternSlotMark(pattern: string, start: number, quanta: number): Mark | null {
  return combine(
    (function* () {
      for (let i = 0; i < quanta; i++) {
        const c = pattern[(start + i) % QUANTA_PER_WEEK];
        yield c === "f" || c === "m" ? c : null;
      }
    })(),
  );
}

/** Moves a typical week later by `quanta` (negative = earlier), wrapping around the week. */
export function shiftPattern(pattern: string, quanta: number): string {
  const n = (((quanta % QUANTA_PER_WEEK) + QUANTA_PER_WEEK) % QUANTA_PER_WEEK);
  return pattern.slice(QUANTA_PER_WEEK - n) + pattern.slice(0, QUANTA_PER_WEEK - n);
}

/** A member with nothing marked yet is not "busy", they just have not filled in their week. */
export const isSetUp = (m: Member) =>
  /[fm]/.test(m.pattern) || Object.values(m.overrides).some((o) => o !== "b");

export function paintPattern(
  pattern: string,
  start: number,
  quanta: number,
  mark: Mark | null,
): string {
  const chars = pattern.split("");
  for (let i = 0; i < quanta; i++) chars[(start + i) % QUANTA_PER_WEEK] = mark ?? ".";
  return chars.join("");
}

/** `mark: null` removes the overrides so the weekly pattern shows through. */
export function paintOverrides(
  overrides: Record<number, OverrideMark>,
  starts: number[],
  quanta: number,
  mark: OverrideMark | null,
): Record<number, OverrideMark> {
  const next = { ...overrides };
  for (const startQ of starts)
    for (let i = 0; i < quanta; i++) {
      if (mark) next[startQ + i] = mark;
      else delete next[startQ + i];
    }
  return next;
}

/** True if any quantum of the slot has a busy override. */
export function slotHasBusy(member: Member, startQ: number, quanta: number): boolean {
  for (let i = 0; i < quanta; i++) if (member.overrides[startQ + i] === "b") return true;
  return false;
}

export interface WeekDay {
  /** ISO date in the viewer's zone. */
  date: string;
  /** UTC quantum of each row's start, in the viewer's zone. */
  startQ: number[];
}

export interface WeekLayout {
  days: WeekDay[];
  /** Minutes after local midnight for each row. */
  rowMinutes: number[];
  quantaPerSlot: number;
}

/** Monday of the week containing `ms`, as an ISO date in `timeZone`. */
export function weekStartOf(ms: number, timeZone: string): string {
  return DateTime.fromMillis(ms, { zone: timeZone }).startOf("week").toISODate()!;
}

export function addWeeks(weekStart: string, weeks: number): string {
  return DateTime.fromISO(weekStart, { zone: "utc" }).plus({ weeks }).toISODate()!;
}

export function weeksBetween(fromWeekStart: string, toWeekStart: string): number {
  const from = DateTime.fromISO(fromWeekStart, { zone: "utc" });
  return Math.round(DateTime.fromISO(toWeekStart, { zone: "utc" }).diff(from, "weeks").weeks);
}

export function buildWeek(
  timeZone: string,
  weekStart: string,
  slotMinutes: SlotMinutes,
  fromHour = 0,
  toHour = 24,
): WeekLayout {
  const rowMinutes: number[] = [];
  for (let m = fromHour * 60; m < toHour * 60; m += slotMinutes) rowMinutes.push(m);
  const monday = DateTime.fromISO(weekStart, { zone: timeZone });
  const days = Array.from({ length: 7 }, (_, d) => {
    const day = monday.plus({ days: d });
    return {
      date: day.toISODate()!,
      // Wall-clock rows: on DST days luxon shifts the skipped hour forward.
      startQ: rowMinutes.map((m) =>
        toQuantum(day.set({ hour: Math.floor(m / 60), minute: m % 60 }).toMillis()),
      ),
    };
  });
  return { days, rowMinutes, quantaPerSlot: slotMinutes / QUANTUM_MINUTES };
}

export interface SlotSummary {
  free: Member[];
  maybe: Member[];
  busy: Member[];
}

export function summarize(members: Member[], startQ: number, quanta: number): SlotSummary {
  const summary: SlotSummary = { free: [], maybe: [], busy: [] };
  for (const member of members) {
    const mark = slotMark(member, startQ, quanta);
    (mark === "f" ? summary.free : mark === "m" ? summary.maybe : summary.busy).push(member);
  }
  return summary;
}

export interface MeetWindow {
  startQ: number;
  /** Exclusive. */
  endQ: number;
  free: Member[];
  /** Not marked free, but free-or-maybe for the whole window. */
  maybe: Member[];
}

/**
 * Windows in [fromQ, toQ) where a set of people is free throughout, ranked by
 * how many people that is and then by how soon it starts. Each window is the
 * longest stretch for its set, and a window is dropped when a larger set
 * covers the same stretch.
 */
export function bestWindows(
  members: Member[],
  fromQ: number,
  toQ: number,
  { minMinutes = 60, limit = 5 }: { minMinutes?: number; limit?: number } = {},
): MeetWindow[] {
  // Everyone, or everyone but one once the group is big enough for that to matter.
  const minPeople = Math.max(2, members.length >= 4 ? members.length - 1 : members.length);
  const minQuanta = Math.ceil(minMinutes / QUANTUM_MINUTES);

  // One bit per member, per quantum.
  const free = new Array<number>(toQ - fromQ);
  for (let q = fromQ; q < toQ; q++) {
    let mask = 0;
    members.forEach((m, i) => {
      if (markAt(m, q) === "f") mask |= 1 << i;
    });
    free[q - fromQ] = mask;
  }
  const size = (mask: number) => members.filter((_, i) => mask & (1 << i)).length;
  const covers = (i: number, mask: number) => i >= 0 && i < free.length && (free[i] & mask) === mask;

  const found = new Map<string, { start: number; end: number; mask: number }>();
  for (let i = 0; i < free.length; i++) {
    if (i > 0 && free[i] === free[i - 1]) continue;
    // Extending right from each change point, the free set only shrinks; each
    // set seen on the way gets its longest stretch around this point.
    let mask = free[i];
    for (let j = i; j < free.length && size(mask) >= minPeople; mask &= free[++j] ?? 0) {
      if (j + 1 < free.length && (free[j + 1] & mask) === mask) continue;
      let start = i;
      while (covers(start - 1, mask)) start--;
      if (j + 1 - start >= minQuanta) found.set(`${start}:${mask}`, { start, end: j + 1, mask });
    }
  }

  const all = [...found.values()];
  return all
    .filter(
      (w) =>
        !all.some(
          (o) => o !== w && (o.mask & w.mask) === w.mask && o.mask !== w.mask && o.start <= w.start && o.end >= w.end,
        ),
    )
    .map((w) => {
      const startQ = fromQ + w.start;
      const endQ = fromQ + w.end;
      const others = members.filter((_, i) => !(w.mask & (1 << i)));
      return {
        startQ,
        endQ,
        free: members.filter((_, i) => w.mask & (1 << i)),
        maybe: others.filter((m) => slotMark(m, startQ, endQ - startQ) !== null),
      };
    })
    .sort((a, b) => b.free.length - a.free.length || a.startQ - b.startQ)
    .slice(0, limit);
}
