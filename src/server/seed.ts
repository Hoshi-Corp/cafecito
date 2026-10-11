import type { Db } from "./db";
import { EMPTY_PATTERN, QUANTA_PER_DAY, paintPattern } from "../lib/availability";
import { startSession } from "./groups";
import type { Mark } from "../lib/types";

type Range = [weekday: number, fromHour: number, toHour: number, mark?: Mark];

const pattern = (ranges: Range[]) =>
  ranges.reduce(
    (p, [weekday, from, to, mark = "f"]) =>
      paintPattern(p, weekday * QUANTA_PER_DAY + from * 4, (to - from) * 4, mark),
    EMPTY_PATTERN,
  );

// Demo group for development and screenshots (CAFECITO_DEMO=1). Each member gets a session whose token is
// "demo-<id>", so setting the cookie `cafecito_session=demo-camille` signs a browser in as Camille.
export function seed(db: Db) {
  db.prepare(`INSERT INTO "group" (id, name, slot_minutes) VALUES ('demo', 'Café crew', 30)`).run();
  const insert = db.prepare(
    `INSERT INTO member (id, group_id, name, color, time_zone, role, pattern, position)
     VALUES (?, 'demo', ?, ?, ?, ?, ?, ?)`,
  );
  const members: [string, string, string, string, string, Range[]][] = [
    ["you", "You", "#c2410c", "America/Toronto", "owner", []],
    ["camille", "Camille", "#0f766e", "America/Toronto", "member", [
      [0, 18, 21], [1, 12, 13, "m"], [1, 18, 21], [3, 17.5, 22], [4, 17, 23], [5, 10, 15], [6, 10, 13],
    ]],
    ["diego", "Diego", "#7c3aed", "America/Toronto", "member", [
      [1, 18.5, 22], [2, 18, 20, "m"], [3, 18, 21.5], [4, 19, 23], [5, 9, 13], [6, 11, 17],
    ]],
    ["sofia", "Sofia", "#be185d", "America/Vancouver", "member", [
      [0, 15, 18], [1, 15, 19], [3, 14.5, 19], [4, 15, 20], [5, 8, 12], [6, 8, 11, "m"],
    ]],
    ["kenji", "Kenji", "#1d4ed8", "Europe/Lisbon", "member", [
      [1, 22, 24], [2, 0, 1, "m"], [3, 22, 24], [4, 22, 24], [5, 14, 19], [6, 15, 20],
    ]],
  ];
  db.transaction(() =>
    members.forEach(([id, name, color, zone, role, ranges], i) =>
      (insert.run(id, name, color, zone, role, pattern(ranges), i), startSession(db, id, `demo-${id}`)),
    ),
  )();
}
