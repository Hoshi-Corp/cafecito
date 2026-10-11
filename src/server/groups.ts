import { IANAZone } from "luxon";
import type { Db } from "./db";
import { QUANTA_PER_WEEK } from "../lib/availability";
import { SLOT_OPTIONS, type Group, type Member, type OverrideMark, type SlotMinutes } from "../lib/types";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const bad = (message: string) => new HttpError(400, message);

type MemberRow = {
  id: string;
  name: string;
  color: string;
  time_zone: string;
  pattern: string;
};

export function loadGroup(db: Db, id: string, meId: string): Group {
  const g = db.prepare(`SELECT id, name, slot_minutes FROM "group" WHERE id = ?`).get(id) as
    | { id: string; name: string; slot_minutes: SlotMinutes }
    | undefined;
  if (!g) throw new HttpError(404, "No such group");
  const rows = db
    .prepare(`SELECT id, name, color, time_zone, pattern FROM member WHERE group_id = ? ORDER BY position`)
    .all(id) as MemberRow[];
  const overrides = new Map<string, Record<number, OverrideMark>>();
  for (const o of db
    .prepare(`SELECT member_id, q, mark FROM override WHERE member_id IN (SELECT id FROM member WHERE group_id = ?)`)
    .all(id) as { member_id: string; q: number; mark: OverrideMark }[]) {
    (overrides.get(o.member_id) ?? overrides.set(o.member_id, {}).get(o.member_id)!)[o.q] = o.mark;
  }
  const members: Member[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    timeZone: r.time_zone,
    pattern: r.pattern,
    overrides: overrides.get(r.id) ?? {},
  }));
  const ownerId = (db.prepare(`SELECT id FROM member WHERE group_id = ? AND role = 'owner'`).get(id) as { id: string }).id;
  return { id: g.id, name: g.name, slotMinutes: g.slot_minutes, members, meId, ownerId };
}

/** The member this request may write as: the cookie's member if it belongs to the group, else the group's first. */
export function resolveMe(db: Db, groupId: string, cookie: string | undefined): string {
  const row = db
    .prepare(
      `SELECT id FROM member WHERE group_id = ? ORDER BY (id = ?) DESC, position LIMIT 1`,
    )
    .get(groupId, cookie ?? "") as { id: string } | undefined;
  if (!row) throw new HttpError(404, "No such group");
  return row.id;
}

export function memberGroup(db: Db, memberId: string): string | null {
  return (db.prepare(`SELECT group_id FROM member WHERE id = ?`).get(memberId) as { group_id: string } | undefined)
    ?.group_id ?? null;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export type ProfilePatch = { name?: string; color?: string; timeZone?: string; pattern?: string };

/** Replace the caller's own profile fields. Only the member's own row is ever touched. */
export function updateMe(db: Db, memberId: string, body: unknown) {
  if (!isObject(body)) throw bad("Expected an object");
  const { name, color, timeZone, pattern } = body;
  const set: string[] = [];
  const args: string[] = [];
  const field = (column: string, value: string) => (set.push(`${column} = ?`), args.push(value));
  if (name !== undefined) {
    if (typeof name !== "string" || name.length > 60) throw bad("Invalid name");
    field("name", name);
  }
  if (color !== undefined) {
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) throw bad("Invalid color");
    field("color", color);
  }
  if (timeZone !== undefined) {
    if (typeof timeZone !== "string" || !IANAZone.isValidZone(timeZone)) throw bad("Invalid time zone");
    field("time_zone", timeZone);
  }
  if (pattern !== undefined) {
    if (typeof pattern !== "string" || pattern.length !== QUANTA_PER_WEEK || /[^fm.]/.test(pattern))
      throw bad("Invalid pattern");
    field("pattern", pattern);
  }
  if (set.length) db.prepare(`UPDATE member SET ${set.join(", ")} WHERE id = ?`).run(...args, memberId);
}

// A fully painted year at 15 minutes is 35k; one drag is far smaller. Stops a runaway request.
const MAX_OVERRIDES_PER_REQUEST = 2000;

const isQuantum = (q: unknown): q is number => Number.isSafeInteger(q) && (q as number) >= 0;

/** `set` maps UTC quantum to a mark; `remove` lists quanta to clear. */
export function patchOverrides(db: Db, memberId: string, body: unknown) {
  if (!isObject(body)) throw bad("Expected an object");
  const set = body.set ?? {};
  const remove = body.remove ?? [];
  if (!isObject(set) || !Array.isArray(remove)) throw bad("Invalid overrides");
  if (Object.keys(set).length + remove.length > MAX_OVERRIDES_PER_REQUEST) throw bad("Too many overrides");
  const entries = Object.entries(set).map(([k, mark]) => [Number(k), mark] as const);
  if (!entries.every(([q, mark]) => isQuantum(q) && (mark === "f" || mark === "m" || mark === "b")))
    throw bad("Invalid override");
  if (!remove.every(isQuantum)) throw bad("Invalid override");
  const upsert = db.prepare(
    `INSERT INTO override (member_id, q, mark) VALUES (?, ?, ?)
     ON CONFLICT (member_id, q) DO UPDATE SET mark = excluded.mark`,
  );
  const del = db.prepare(`DELETE FROM override WHERE member_id = ? AND q = ?`);
  db.transaction(() => {
    for (const q of remove) del.run(memberId, q);
    for (const [q, mark] of entries) upsert.run(memberId, q, mark);
  })();
}

/** Group settings are owner-only. */
export function updateGroup(db: Db, groupId: string, memberId: string, body: unknown) {
  if (!isObject(body)) throw bad("Expected an object");
  const role = (db.prepare(`SELECT role FROM member WHERE id = ?`).get(memberId) as { role: string }).role;
  if (role !== "owner") throw new HttpError(403, "Only the owner can change the group");
  const { slotMinutes } = body;
  if (!(SLOT_OPTIONS as readonly unknown[]).includes(slotMinutes)) throw bad("Invalid slot size");
  db.prepare(`UPDATE "group" SET slot_minutes = ? WHERE id = ?`).run(slotMinutes, groupId);
}
