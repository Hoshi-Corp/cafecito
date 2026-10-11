import { useSyncExternalStore } from "react";
import { EMPTY_PATTERN, QUANTA_PER_DAY, QUANTA_PER_WEEK, paintPattern } from "./availability";
import { SLOT_OPTIONS, type Group, type Mark, type Member } from "./types";

// Demo store: one sample group kept in this browser's localStorage. The
// SQLite-backed store replaces this module (roadmap 0.3): `useGroup`, `updateGroup` and
// `updateMember` carry over; `resetDemo` and `parseGroup` are demo-only.
const STORAGE_KEY = "cafecito:demo:v1";

type Range = [weekday: number, fromHour: number, toHour: number, mark?: Mark];

function seedPattern(ranges: Range[]): string {
  return ranges.reduce(
    (p, [weekday, from, to, mark = "f"]) =>
      paintPattern(p, weekday * QUANTA_PER_DAY + from * 4, (to - from) * 4, mark),
    EMPTY_PATTERN,
  );
}

function seedGroup(): Group {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const member = (
    id: string,
    name: string,
    color: string,
    timeZone: string,
    ranges: Range[],
  ): Member => ({ id, name, color, timeZone, pattern: seedPattern(ranges), overrides: {} });
  return {
    id: "demo",
    name: "Café crew",
    slotMinutes: 30,
    members: [
      member("you", "You", "#c2410c", local, []),
      member("camille", "Camille", "#0f766e", "America/Toronto", [
        [0, 18, 21], [1, 12, 13, "m"], [1, 18, 21], [3, 17.5, 22], [4, 17, 23], [5, 10, 15], [6, 10, 13],
      ]),
      member("diego", "Diego", "#7c3aed", "America/Toronto", [
        [1, 18.5, 22], [2, 18, 20, "m"], [3, 18, 21.5], [4, 19, 23], [5, 9, 13], [6, 11, 17],
      ]),
      member("sofia", "Sofia", "#be185d", "America/Vancouver", [
        [0, 15, 18], [1, 15, 19], [3, 14.5, 19], [4, 15, 20], [5, 8, 12], [6, 8, 11, "m"],
      ]),
      member("kenji", "Kenji", "#1d4ed8", "Europe/Lisbon", [
        [1, 22, 24], [2, 0, 1, "m"], [3, 22, 24], [4, 22, 24], [5, 14, 19], [6, 15, 20],
      ]),
    ],
  };
}

let current: Group | null = null;
const listeners = new Set<() => void>();

/** The saved group, or null when it is missing or not shaped like a group the UI can render. */
export function parseGroup(saved: string | null): Group | null {
  try {
    const g = saved && (JSON.parse(saved) as Group);
    const ok =
      g &&
      (SLOT_OPTIONS as readonly number[]).includes(g.slotMinutes) &&
      Array.isArray(g.members) &&
      g.members.length > 0 &&
      g.members.every(
        (m) =>
          m &&
          typeof m.id === "string" &&
          typeof m.name === "string" &&
          typeof m.timeZone === "string" &&
          typeof m.pattern === "string" &&
          m.pattern.length === QUANTA_PER_WEEK &&
          typeof m.overrides === "object" &&
          m.overrides !== null,
      );
    return ok ? g : null;
  } catch {
    return null;
  }
}

function read(): Group {
  if (current) return current;
  try {
    const saved = parseGroup(localStorage.getItem(STORAGE_KEY));
    if (saved) return (current = saved);
  } catch {
    // Private mode: fall back to a fresh demo group.
  }
  return (current = seedGroup());
}

function write(next: Group) {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep working in memory.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Null while rendering on the server, where there is no stored group. */
export function useGroup(): Group | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function updateGroup(change: (group: Group) => Group) {
  write(change(read()));
}

export function updateMember(id: string, change: (member: Member) => Member) {
  updateGroup((g) => ({ ...g, members: g.members.map((m) => (m.id === id ? change(m) : m)) }));
}

export function resetDemo() {
  write(seedGroup());
}
