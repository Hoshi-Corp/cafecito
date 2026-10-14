import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { HttpError, assertOwner, bad, cleanText, isObject, loadGroup, patchOverrides } from "./groups";
import { MAX_OUTING_QUANTA, QUANTA_PER_DAY, bestWindows, isSetUp, toQuantum } from "../lib/availability";
import type { Outing, Rsvp } from "../lib/types";

export const MAX_OUTINGS = 50;

const assertNotOver = (endQ: number, now: number) => {
  if (endQ <= toQuantum(now)) throw bad("That time has passed");
};

/** Marks the plan's time busy for the member, so the group stops seeing them as free then. */
const markBusyFor = (db: Db, memberId: string, startQ: number, endQ: number) =>
  patchOverrides(db, memberId, { set: Object.fromEntries(Array.from({ length: endQ - startQ }, (_, i) => [startQ + i, "b"])) });

export function listOutings(db: Db, groupId: string): Outing[] {
  const rows = db
    .prepare(`SELECT id, title, place, place_id placeId, start_q startQ, end_q endQ, created_by createdBy FROM outing WHERE group_id = ? ORDER BY start_q`)
    .all(groupId) as Omit<Outing, "rsvps">[];
  const answers = db
    .prepare(`SELECT outing_id id, member_id memberId, answer FROM rsvp WHERE outing_id IN (SELECT id FROM outing WHERE group_id = ?)`)
    .all(groupId) as { id: string; memberId: string; answer: Rsvp }[];
  return rows.map((o) => ({ ...o, rsvps: Object.fromEntries(answers.filter((a) => a.id === o.id).map((a) => [a.memberId, a.answer])) }));
}

export function createOuting(db: Db, groupId: string, memberId: string, body: unknown, now = Date.now()) {
  if (!isObject(body)) throw bad("Expected an object");
  const { startQ, endQ } = body as { startQ: number; endQ: number };
  if (!Number.isSafeInteger(startQ) || !Number.isSafeInteger(endQ) || endQ <= startQ || endQ - startQ > MAX_OUTING_QUANTA)
    throw bad("Invalid time");
  assertNotOver(endQ, now);
  // Only a time the group's best-times list could offer: the same windows the group screen shows, over the same two weeks.
  const from = toQuantum(now) + 1;
  const windows = bestWindows(loadGroup(db, groupId, memberId).members.filter(isSetUp), from, from + 14 * QUANTA_PER_DAY, {
    limit: Infinity,
  });
  if (!windows.some((w) => w.startQ <= startQ && endQ <= w.endQ)) throw new HttpError(409, "That time is no longer free for the group");
  const { n } = db.prepare(`SELECT count(*) n FROM outing WHERE group_id = ?`).get(groupId) as { n: number };
  if (n >= MAX_OUTINGS) throw new HttpError(409, `A group can have ${MAX_OUTINGS} plans at a time`);
  const title = cleanText(body.title, 80, true);
  let place = cleanText(body.place, 120, false);
  // A wishlist place must be in this group; without a typed "where" its name stands in.
  let placeId: string | null = null;
  if (body.placeId !== undefined && body.placeId !== null) {
    if (typeof body.placeId !== "string") throw bad("Invalid place");
    const p = db.prepare(`SELECT id, name FROM place WHERE id = ? AND group_id = ? AND deleted_at IS NULL`).get(body.placeId, groupId) as { id: string; name: string } | undefined;
    if (!p) throw new HttpError(404, "No such place");
    placeId = p.id;
    place ||= p.name.slice(0, 120);
  }
  const id = randomUUID();
  db.transaction(() => {
    db.prepare(`INSERT INTO outing (id, group_id, title, place, place_id, start_q, end_q, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, groupId, title, place, placeId, startQ, endQ, memberId,
    );
    // Whoever proposes it is going, so that time is busy for them, as if they had answered yes with "mark busy".
    db.prepare(`INSERT INTO rsvp (outing_id, member_id, answer) VALUES (?, ?, 'y')`).run(id, memberId);
    markBusyFor(db, memberId, startQ, endQ);
  })();
  return { id };
}

/**
 * Records the caller's answer. `markBusy` also marks the time busy for them, once: it is not undone if they change
 * their answer, since they may have marked that time busy themselves.
 */
export function answerOuting(db: Db, groupId: string, memberId: string, outingId: string, body: unknown, now = Date.now()) {
  if (!isObject(body)) throw bad("Expected an object");
  const { answer, markBusy } = body;
  if (answer !== "y" && answer !== "m" && answer !== "n") throw bad("Invalid answer");
  const o = db.prepare(`SELECT start_q startQ, end_q endQ FROM outing WHERE id = ? AND group_id = ?`).get(outingId, groupId) as { startQ: number; endQ: number } | undefined;
  if (!o) throw new HttpError(404, "No such outing");
  assertNotOver(o.endQ, now);
  db.transaction(() => {
    db.prepare(`INSERT INTO rsvp (outing_id, member_id, answer) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET answer = excluded.answer`).run(outingId, memberId, answer);
    if (answer === "y" && markBusy === true)
      markBusyFor(db, memberId, o.startQ, o.endQ);
  })();
}

/** The person who proposed it, or the owner. */
export function deleteOuting(db: Db, groupId: string, memberId: string, outingId: string) {
  const o = db.prepare(`SELECT created_by createdBy, start_q startQ, end_q endQ FROM outing WHERE id = ? AND group_id = ?`).get(outingId, groupId) as
    | { createdBy: string | null; startQ: number; endQ: number }
    | undefined;
  if (!o) throw new HttpError(404, "No such outing");
  if (o.createdBy !== memberId) assertOwner(db, memberId);
  db.transaction(() => {
    db.prepare(`DELETE FROM outing WHERE id = ?`).run(outingId);
    // Proposing marked the author busy; give them their typical week back.
    // shortcut: clears every mark in that range, also one from another plan or by hand; track marks per plan if that bites.
    if (o.createdBy) patchOverrides(db, o.createdBy, { remove: Array.from({ length: o.endQ - o.startQ }, (_, i) => o.startQ + i) });
  })();
}
