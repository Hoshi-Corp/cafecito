import { randomBytes } from "node:crypto";
import type { Db } from "./db";
import { disconnect } from "./events";
import { HttpError, hash, startSession } from "./groups";
import { QUANTUM_MS } from "../lib/availability";

// The caller's own account: devices, export, deletion, and email sign-in links. Every call acts on the caller's row only.

const iso = (ms: number) => new Date(ms).toISOString();

/** The member's signed-in devices, most recently used first. `current` is the device asking. */
export function listSessions(db: Db, memberId: string, tokenHash: string) {
  return (
    db
      .prepare(
        `SELECT device, created_at createdAt, last_seen lastSeen, token_hash = ? current FROM session WHERE member_id = ? ORDER BY current DESC, last_seen DESC`,
      )
      .all(tokenHash, memberId) as { device: string; createdAt: number; lastSeen: number; current: number }[]
  ).map((s) => ({ ...s, current: s.current === 1 }));
}

/** Ends every session of the member but the one asking, and closes those devices' live streams. */
export function signOutOthers(db: Db, groupId: string, memberId: string, tokenHash: string) {
  const { changes } = db.prepare(`DELETE FROM session WHERE member_id = ? AND token_hash != ?`).run(memberId, tokenHash);
  disconnect(groupId, memberId, tokenHash);
  return { signedOut: changes };
}

/** Everything stored about the member, in a form a person can read. */
export function exportMe(db: Db, memberId: string) {
  const me = db
    .prepare(
      `SELECT g.name "group", m.name, m.color, m.time_zone timeZone, m.role, m.email, m.pattern typicalWeek
       FROM member m JOIN "group" g ON g.id = m.group_id WHERE m.id = ?`,
    )
    .get(memberId) as {
    group: string;
    name: string;
    color: string;
    timeZone: string;
    role: string;
    email: string | null;
    typicalWeek: string;
  };
  const overrides = db
    .prepare(`SELECT start_q s, end_q e, mark FROM override WHERE member_id = ? ORDER BY start_q`)
    .all(memberId) as { s: number; e: number; mark: string }[];
  const sessions = db
    .prepare(`SELECT device, created_at, last_seen FROM session WHERE member_id = ? ORDER BY created_at`)
    .all(memberId) as { device: string; created_at: number; last_seen: number }[];
  const plans = db
    .prepare(
      `SELECT o.title, o.place, o.start_q s, o.end_q e, o.created_by = @m proposedByMe, r.answer
       FROM outing o LEFT JOIN rsvp r ON r.outing_id = o.id AND r.member_id = @m
       WHERE o.created_by = @m OR r.member_id = @m ORDER BY o.start_q`,
    )
    .all({ m: memberId }) as { title: string; place: string; s: number; e: number; proposedByMe: number; answer: string | null }[];
  const places = db
    .prepare(
      `SELECT p.name, p.link, p.map_link mapLink, p.notes, p.been_there beenThere, p.suggested_by = @m suggestedByMe,
              EXISTS (SELECT 1 FROM place_vote v WHERE v.place_id = p.id AND v.member_id = @m) votedByMe
       FROM place p WHERE p.suggested_by = @m OR EXISTS (SELECT 1 FROM place_vote v WHERE v.place_id = p.id AND v.member_id = @m)
       ORDER BY p.created_at, p.rowid`,
    )
    .all({ m: memberId }) as { name: string; link: string; mapLink: string; notes: string; beenThere: number; suggestedByMe: number | null; votedByMe: number }[];
  return {
    exportedAt: new Date().toISOString(),
    ...me,
    typicalWeekFormat: "672 characters, one per 15 minutes from Monday 00:00 in timeZone: f free, m maybe, . not marked",
    overrides: overrides.map((o) => ({ from: iso(o.s * QUANTUM_MS), to: iso(o.e * QUANTUM_MS), mark: o.mark })),
    overridesFormat: "UTC times; mark f free, m maybe, b busy",
    plans: plans.map((p) => ({
      title: p.title,
      place: p.place,
      from: iso(p.s * QUANTUM_MS),
      to: iso(p.e * QUANTUM_MS),
      proposedByMe: p.proposedByMe === 1,
      myAnswer: p.answer,
    })),
    plansFormat: "plans I proposed or answered; UTC times; myAnswer y yes, m maybe, n no, null none",
    places: places.map((p) => ({
      name: p.name,
      link: p.link,
      mapLink: p.mapLink,
      notes: p.notes,
      beenThere: p.beenThere === 1,
      suggestedByMe: p.suggestedByMe === 1,
      votedByMe: p.votedByMe === 1,
    })),
    placesFormat: "wishlist places I suggested or voted for",
    devices: sessions.map((s) => ({ device: s.device, signedIn: iso(s.created_at), lastUsed: iso(s.last_seen) })),
  };
}

/**
 * Deletes the member with their availability, sessions and sign-in links. A group keeps an owner: if the owner
 * leaves, the member who joined first takes over; when nobody is left, the group with its invites, plans and wishlist goes too.
 */
export function deleteMe(db: Db, groupId: string, memberId: string) {
  db.transaction(() => {
    db.prepare(`DELETE FROM member WHERE id = ?`).run(memberId);
    db.prepare(
      `UPDATE member SET role = 'owner' WHERE id = (SELECT id FROM member WHERE group_id = @g ORDER BY position LIMIT 1)
       AND NOT EXISTS (SELECT 1 FROM member WHERE group_id = @g AND role = 'owner')`,
    ).run({ g: groupId });
    if (!db.prepare(`SELECT 1 FROM member WHERE group_id = ?`).get(groupId)) {
      db.prepare(`DELETE FROM invite WHERE group_id = ?`).run(groupId);
      db.prepare(`DELETE FROM outing WHERE group_id = ?`).run(groupId);
      db.prepare(`DELETE FROM place WHERE group_id = ?`).run(groupId);
      db.prepare(`DELETE FROM "group" WHERE id = ?`).run(groupId);
    }
  })();
  disconnect(groupId, memberId);
}

const LINK_MS = 30 * 60_000;

/** A one-time sign-in link for each member with this (normalized) address. Empty when nobody has it. */
export function createSignInLinks(db: Db, email: string, now = Date.now()) {
  const members = db
    .prepare(`SELECT m.id, m.name, g.name groupName FROM member m JOIN "group" g ON g.id = m.group_id WHERE m.email = ?`)
    .all(email) as { id: string; name: string; groupName: string }[];
  const insert = db.prepare(`INSERT INTO sign_in_link (token_hash, member_id, expires_at) VALUES (?, ?, ?)`);
  return members.map((m) => {
    const token = randomBytes(32).toString("base64url");
    insert.run(hash(token), m.id, now + LINK_MS);
    return { name: m.name, groupName: m.groupName, token };
  });
}

/** Signs this device in with a personal link (reusable until replaced), or spends an emailed one (once, before it expires). */
export function spendSignInLink(db: Db, token: string, device = "", now = Date.now()) {
  const personal = db.prepare(`SELECT id FROM member WHERE access_hash = ?`).get(hash(token)) as { id: string } | undefined;
  if (personal) return startSession(db, personal.id, device);
  const link = db
    .prepare(`DELETE FROM sign_in_link WHERE token_hash = ? RETURNING member_id memberId, expires_at expiresAt`)
    .get(hash(token)) as { memberId: string; expiresAt: number } | undefined;
  if (!link || link.expiresAt <= now) throw new HttpError(404, "This sign-in link is no longer valid");
  return startSession(db, link.memberId, device);
}
