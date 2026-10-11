import { createHash, randomBytes, randomUUID } from "node:crypto";
import { IANAZone } from "luxon";
import type { Db } from "./db";
import { disconnect } from "./events";
import { EMPTY_PATTERN, QUANTA_PER_WEEK } from "../lib/availability";
import { SLOT_OPTIONS, type Group, type OverrideChange, type Member, type OverrideMark, type SlotMinutes } from "../lib/types";

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

function loadMembers(db: Db, groupId: string, onlyId?: string): Member[] {
  const rows = db
    .prepare(
      `SELECT id, name, color, time_zone, pattern FROM member WHERE group_id = ? AND (? IS NULL OR id = ?) ORDER BY position`,
    )
    .all(groupId, onlyId ?? null, onlyId ?? null) as MemberRow[];
  const overrides = new Map<string, Record<number, OverrideMark>>();
  for (const o of db
    .prepare(
      `SELECT member_id, q, mark FROM override WHERE member_id IN (SELECT id FROM member WHERE group_id = ? AND (? IS NULL OR id = ?))`,
    )
    .all(groupId, onlyId ?? null, onlyId ?? null) as { member_id: string; q: number; mark: OverrideMark }[]) {
    (overrides.get(o.member_id) ?? overrides.set(o.member_id, {}).get(o.member_id)!)[o.q] = o.mark;
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
  return { id: g.id, name: g.name, slotMinutes: g.slot_minutes, members: loadMembers(db, id), meId, ownerId };
}

/** One member, as sent to the group's other browsers after a write. */
export const loadMember = (db: Db, groupId: string, memberId: string) => loadMembers(db, groupId, memberId)[0];

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Who a session token belongs to. The token is the credential; only its hash is stored. */
export function resolveSession(db: Db, token: string | undefined) {
  const row = token
    ? (db
        .prepare(`SELECT m.id memberId, m.group_id groupId FROM session s JOIN member m ON m.id = s.member_id WHERE s.token_hash = ?`)
        .get(hash(token)) as { memberId: string; groupId: string } | undefined)
    : undefined;
  if (!row) throw new HttpError(401, "Not signed in");
  return row;
}

/** Starts a session for a member and returns the token to set as the cookie. */
export function startSession(db: Db, memberId: string, token = randomBytes(32).toString("base64url")) {
  db.prepare(`INSERT INTO session (token_hash, member_id) VALUES (?, ?)`).run(hash(token), memberId);
  return token;
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
  return { set: Object.fromEntries(entries), remove } as OverrideChange;
}

function assertOwner(db: Db, memberId: string) {
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
function addMember(db: Db, groupId: string, role: "owner" | "member", body: unknown) {
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
    return { memberId: id, token: startSession(db, id) };
  })();
}

/** A new group with its creator as owner. */
export function createGroup(db: Db, body: unknown) {
  if (!isObject(body)) throw bad("Expected an object");
  const { groupName } = body;
  if (typeof groupName !== "string" || !groupName.trim() || groupName.length > 60) throw bad("Invalid group name");
  const groupId = randomUUID();
  return db.transaction(() => {
    db.prepare(`INSERT INTO "group" (id, name, slot_minutes) VALUES (?, ?, 30)`).run(groupId, groupName.trim());
    return { groupId, ...addMember(db, groupId, "owner", body) };
  })();
}

const DAY_MS = 24 * 60 * 60 * 1000;
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

export function joinGroup(db: Db, token: string, body: unknown, now = Date.now()) {
  return db.transaction(() => {
    const invite = liveInvite(db, token, now);
    const joined = addMember(db, invite.groupId, "member", body);
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
