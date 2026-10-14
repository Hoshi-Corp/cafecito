import { createHash, randomBytes, randomUUID } from "node:crypto";
import { IANAZone } from "luxon";
import type { Db } from "./db";
import { disconnect } from "./events";
import { EMPTY_PATTERN, QUANTA_PER_WEEK, toQuantum } from "../lib/availability";
import { SLOT_OPTIONS, type Group, type OverrideChange, type Member, type OverrideMark, type SlotMinutes } from "../lib/types";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const bad = (message: string) => new HttpError(400, message);

export const DAY_MS = 24 * 60 * 60 * 1000;

type MemberRow = {
  id: string;
  name: string;
  color: string;
  time_zone: string;
  pattern: string;
};

function loadMembers(db: Db, groupId: string, onlyId?: string): Member[] {
  const rows = db
    .prepare(
      `SELECT id, name, color, time_zone, pattern FROM member WHERE group_id = ? AND (? IS NULL OR id = ?) ORDER BY position`,
    )
    .all(groupId, onlyId ?? null, onlyId ?? null) as MemberRow[];
  const overrides = new Map<string, Record<number, OverrideMark>>();
  // shortcut: stored as ranges but sent one key per quantum, as the client expects; send ranges if payloads grow.
  for (const o of db
    .prepare(
      `SELECT member_id, start_q, end_q, mark FROM override WHERE member_id IN (SELECT id FROM member WHERE group_id = ? AND (? IS NULL OR id = ?))`,
    )
    .all(groupId, onlyId ?? null, onlyId ?? null) as { member_id: string; start_q: number; end_q: number; mark: OverrideMark }[]) {
    const marks = overrides.get(o.member_id) ?? overrides.set(o.member_id, {}).get(o.member_id)!;
    for (let q = o.start_q; q < o.end_q; q++) marks[q] = o.mark;
  }
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    timeZone: r.time_zone,
    pattern: r.pattern,
    overrides: overrides.get(r.id) ?? {},
  }));
}

export function loadGroup(db: Db, id: string, meId: string): Group {
  const g = db.prepare(`SELECT id, name, slot_minutes FROM "group" WHERE id = ?`).get(id) as
    | { id: string; name: string; slot_minutes: SlotMinutes }
    | undefined;
  if (!g) throw new HttpError(404, "No such group");
  const ownerId = (db.prepare(`SELECT id FROM member WHERE group_id = ? AND role = 'owner'`).get(id) as { id: string }).id;
  // The email is only ever sent to its owner, never inside `members`.
  const { email } = db.prepare(`SELECT email FROM member WHERE id = ?`).get(meId) as { email: string | null };
  return { id: g.id, name: g.name, slotMinutes: g.slot_minutes, members: loadMembers(db, id), meId, ownerId, email };
}

/** One member, as sent to the group's other browsers after a write. */
export const loadMember = (db: Db, groupId: string, memberId: string) => loadMembers(db, groupId, memberId)[0];

export const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A session unused this long is gone; using it pushes the limit back. */
export const SESSION_IDLE_MS = 180 * DAY_MS;

/**
 * Who a session token belongs to. The token is the credential; only its hash is stored.
 * `refreshed` says the session's last use was just recorded (at most daily), so the caller can renew the cookie.
 */
export function resolveSession(db: Db, token: string | undefined, now = Date.now()) {
  const tokenHash = token ? hash(token) : "";
  const row = token
    ? (db
        .prepare(
          `SELECT m.id memberId, m.group_id groupId, s.last_seen lastSeen FROM session s JOIN member m ON m.id = s.member_id
           WHERE s.token_hash = ? AND s.last_seen > ?`,
        )
        .get(tokenHash, now - SESSION_IDLE_MS) as { memberId: string; groupId: string; lastSeen: number } | undefined)
    : undefined;
  if (!row) throw new HttpError(401, "Not signed in");
  const refreshed = now - row.lastSeen > DAY_MS;
  if (refreshed) db.prepare(`UPDATE session SET last_seen = ? WHERE token_hash = ?`).run(now, tokenHash);
  return { memberId: row.memberId, groupId: row.groupId, tokenHash, refreshed };
}

/** Gives the member a new personal sign-in link token; any earlier one stops working. Returned once, only its hash is kept. */
export function newAccessToken(db: Db, memberId: string) {
  const token = randomBytes(24).toString("base64url");
  db.prepare(`UPDATE member SET access_hash = ? WHERE id = ?`).run(hash(token), memberId);
  return token;
}

/** The owner replaces a member's personal link, for someone who lost theirs. */
export function reissueAccessToken(db: Db, groupId: string, ownerId: string, targetId: string) {
  assertOwner(db, ownerId);
  if (!db.prepare(`SELECT 1 FROM member WHERE id = ? AND group_id = ?`).get(targetId, groupId))
    throw new HttpError(404, "No such member");
  return newAccessToken(db, targetId);
}

// Generous, because `last_seen` is only recorded daily: a day of heavy use must not push out a device used every day.
export const MAX_SESSIONS = 50;

/** Starts a session for a member and returns the token to set as the cookie. `device` labels it in the device list. */
export function startSession(
  db: Db,
  memberId: string,
  device = "",
  token = randomBytes(32).toString("base64url"),
  now = Date.now(),
) {
  db.prepare(`INSERT INTO session (token_hash, member_id, device, created_at, last_seen) VALUES (?, ?, ?, ?, ?)`).run(
    hash(token), memberId, device.slice(0, 100), now, now,
  );
  // A personal link opened over and over would otherwise pile up rows: keep the most recently used.
  db.prepare(
    `DELETE FROM session WHERE member_id = @m AND token_hash NOT IN
       (SELECT token_hash FROM session WHERE member_id = @m ORDER BY token_hash = @t DESC, last_seen DESC LIMIT ${MAX_SESSIONS})`,
  ).run({ m: memberId, t: hash(token) });
  return token;
}

/** A trimmed, lower-cased address, or null for none. Separators are refused, since mail libraries split on them. */
export function normalizeEmail(email: unknown): string | null {
  if (email === null || email === "") return null;
  const e = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (e.length > 254 || !/^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/.test(e)) throw bad("Invalid email address");
  return e;
}

/** A trimmed string of at most `max` characters; "" when absent and not required. */
export const cleanText = (v: unknown, max: number, required: boolean) => {
  if (v === undefined && !required) return "";
  if (typeof v !== "string" || v.length > max || (required && !v.trim())) throw bad("Invalid text");
  return v.trim();
};

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Replace the caller's own profile fields (and recovery email). Only the member's own row is ever touched. */
export function updateMe(db: Db, memberId: string, body: unknown) {
  if (!isObject(body)) throw bad("Expected an object");
  const { name, color, timeZone, pattern, email } = body;
  const set: string[] = [];
  const args: (string | null)[] = [];
  const field = (column: string, value: string | null) => (set.push(`${column} = ?`), args.push(value));
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
  if (email !== undefined) field("email", normalizeEmail(email));
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
  const touched = [...remove, ...entries.map(([q]) => q)];
  if (touched.length) {
    // Rewrite the ranges around the change, including the ones just before and after it so equal marks merge.
    const lo = Math.min(...touched);
    const hi = Math.max(...touched) + 1;
    const near = `member_id = ? AND end_q >= ? AND start_q <= ?`;
    db.transaction(() => {
      const marks = new Map<number, OverrideMark>();
      for (const r of db.prepare(`SELECT start_q s, end_q e, mark FROM override WHERE ${near}`).all(memberId, lo, hi) as {
        s: number;
        e: number;
        mark: OverrideMark;
      }[])
        for (let q = r.s; q < r.e; q++) marks.set(q, r.mark);
      for (const q of remove) marks.delete(q);
      for (const [q, mark] of entries) marks.set(q, mark as OverrideMark);
      db.prepare(`DELETE FROM override WHERE ${near}`).run(memberId, lo, hi);
      const insert = db.prepare(`INSERT INTO override (member_id, start_q, end_q, mark) VALUES (?, ?, ?, ?)`);
      for (const [s, e, mark] of toRanges(marks)) insert.run(memberId, s, e, mark);
    })();
  }
  return { set: Object.fromEntries(entries), remove } as OverrideChange;
}

/** Runs of consecutive quanta with the same mark, as [start, end) ranges. */
export function toRanges(marks: Map<number, OverrideMark>) {
  const ranges: [number, number, OverrideMark][] = [];
  for (const q of [...marks.keys()].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last && last[1] === q && last[2] === marks.get(q)) last[1]++;
    else ranges.push([q, q + 1, marks.get(q)!]);
  }
  return ranges;
}

/** Daily housekeeping: drops overrides and outings that ended over a week ago (past weeks show the typical week), idle sessions and used-up sign-in links. */
export function prune(db: Db, now = Date.now()) {
  const cutoff = toQuantum(now - 8 * DAY_MS);
  db.prepare(`DELETE FROM override WHERE end_q < ?`).run(cutoff);
  db.prepare(`DELETE FROM outing WHERE end_q < ?`).run(cutoff);
  db.prepare(`DELETE FROM session WHERE last_seen <= ?`).run(now - SESSION_IDLE_MS);
  db.prepare(`DELETE FROM sign_in_link WHERE expires_at <= ?`).run(now);
}

export function assertOwner(db: Db, memberId: string) {
  const role = (db.prepare(`SELECT role FROM member WHERE id = ?`).get(memberId) as { role: string }).role;
  if (role !== "owner") throw new HttpError(403, "Only the owner can do this");
}

/** Group settings are owner-only. */
export function updateGroup(db: Db, groupId: string, memberId: string, body: unknown) {
  if (!isObject(body)) throw bad("Expected an object");
  assertOwner(db, memberId);
  const { slotMinutes } = body;
  if (!(SLOT_OPTIONS as readonly unknown[]).includes(slotMinutes)) throw bad("Invalid slot size");
  db.prepare(`UPDATE "group" SET slot_minutes = ? WHERE id = ?`).run(slotMinutes, groupId);
}

export const MAX_MEMBERS = 12;

/** Adds a member, validating the profile fields like any later edit. Throws (and adds nothing) if invalid or the group is full. */
function addMember(db: Db, groupId: string, role: "owner" | "member", body: unknown, device: string) {
  if (!isObject(body)) throw bad("Expected an object");
  if (typeof body.name !== "string" || !body.name.trim()) throw bad("Enter a name");
  const id = randomUUID();
  return db.transaction(() => {
    // Positions can have gaps after a removal, so the next one is max + 1, not the count.
    const { n, next } = db
      .prepare(`SELECT count(*) n, COALESCE(MAX(position), -1) + 1 next FROM member WHERE group_id = ?`)
      .get(groupId) as { n: number; next: number };
    if (n >= MAX_MEMBERS) throw new HttpError(409, `This group is full (${MAX_MEMBERS} people)`);
    db.prepare(
      `INSERT INTO member (id, group_id, name, color, time_zone, role, pattern, position) VALUES (?, ?, '', '#c2410c', 'UTC', ?, ?, ?)`,
    ).run(id, groupId, role, EMPTY_PATTERN, next);
    updateMe(db, id, { ...body, pattern: undefined });
    return { memberId: id, token: startSession(db, id, device), accessToken: newAccessToken(db, id) };
  })();
}

/** A new group with its creator as owner. */
export function createGroup(db: Db, body: unknown, device = "") {
  if (!isObject(body)) throw bad("Expected an object");
  const { groupName } = body;
  if (typeof groupName !== "string" || !groupName.trim() || groupName.length > 60) throw bad("Invalid group name");
  const groupId = randomUUID();
  return db.transaction(() => {
    db.prepare(`INSERT INTO "group" (id, name, slot_minutes) VALUES (?, ?, 30)`).run(groupId, groupName.trim());
    return { groupId, ...addMember(db, groupId, "owner", body, device) };
  })();
}

const LIVE = `revoked_at IS NULL AND expires_at > ? AND (max_uses IS NULL OR uses < max_uses)`;

/** The owner makes an invite. The token is returned once; only its hash is kept. */
export function createInvite(db: Db, groupId: string, memberId: string, body: unknown, now = Date.now()) {
  assertOwner(db, memberId);
  const { days = 7, maxUses = null } = isObject(body) ? body : {};
  if (!Number.isInteger(days) || (days as number) < 1 || (days as number) > 30) throw bad("Invalid expiry");
  if (maxUses !== null && (!Number.isInteger(maxUses) || (maxUses as number) < 1 || (maxUses as number) > MAX_MEMBERS))
    throw bad("Invalid use limit");
  const token = randomBytes(24).toString("base64url");
  const id = randomUUID();
  db.prepare(`INSERT INTO invite (id, token_hash, group_id, expires_at, max_uses) VALUES (?, ?, ?, ?, ?)`).run(
    id, hash(token), groupId, now + (days as number) * DAY_MS, maxUses,
  );
  return { id, token };
}

/** Invites that can still be used. */
export function listInvites(db: Db, groupId: string, memberId: string, now = Date.now()) {
  assertOwner(db, memberId);
  return db
    .prepare(`SELECT id, expires_at expiresAt, max_uses maxUses, uses FROM invite WHERE group_id = ? AND ${LIVE} ORDER BY rowid DESC`)
    .all(groupId, now);
}

export function revokeInvite(db: Db, groupId: string, memberId: string, inviteId: string, now = Date.now()) {
  assertOwner(db, memberId);
  const { changes } = db.prepare(`UPDATE invite SET revoked_at = ? WHERE id = ? AND group_id = ?`).run(now, inviteId, groupId);
  if (!changes) throw new HttpError(404, "No such invite");
}

function liveInvite(db: Db, token: string, now: number) {
  const row = db
    .prepare(
      `SELECT id, group_id groupId, (SELECT name FROM "group" WHERE id = group_id) groupName FROM invite WHERE token_hash = ? AND ${LIVE}`,
    )
    .get(hash(token), now) as { id: string; groupId: string; groupName: string } | undefined;
  if (!row) throw new HttpError(404, "This invite link is no longer valid");
  return row;
}

/** What the join screen shows before the person commits. */
export function inviteInfo(db: Db, token: string, now = Date.now()) {
  const { groupId, groupName } = liveInvite(db, token, now);
  return { groupName, members: loadMembers(db, groupId).map((m) => m.name) };
}

export function joinGroup(db: Db, token: string, body: unknown, now = Date.now(), device = "") {
  return db.transaction(() => {
    const invite = liveInvite(db, token, now);
    const joined = addMember(db, invite.groupId, "member", body, device);
    db.prepare(`UPDATE invite SET uses = uses + 1 WHERE id = ?`).run(invite.id);
    return { groupId: invite.groupId, ...joined };
  })();
}

/** The owner removes someone: their availability and sessions go with them, and their live connection is closed. */
export function removeMember(db: Db, groupId: string, memberId: string, targetId: string) {
  assertOwner(db, memberId);
  if (targetId === memberId) throw bad("The owner cannot be removed");
  const { changes } = db.prepare(`DELETE FROM member WHERE id = ? AND group_id = ?`).run(targetId, groupId);
  if (!changes) throw new HttpError(404, "No such member");
  disconnect(groupId, targetId);
}
