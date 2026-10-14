import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { HttpError, assertOwner, bad, isObject, patchOverrides } from "./groups";
import { toQuantum } from "../lib/availability";
import type { Outing, Rsvp } from "../lib/types";

const MAX_OUTING_QUANTA = 7 * 96;
export const MAX_OUTINGS = 50;

const assertNotOver = (endQ: number, now: number) => {
  if (endQ <= toQuantum(now)) throw bad("That time has passed");
};

const text = (v: unknown, max: number, required: boolean) => {
  if (v === undefined && !required) return "";
  if (typeof v !== "string" || v.length > max || (required && !v.trim())) throw bad("Invalid text");
  return v.trim();
};

export function listOutings(db: Db, groupId: string): Outing[] {
  const rows = db
    .prepare(`SELECT id, title, place, start_q startQ, end_q endQ, created_by createdBy FROM outing WHERE group_id = ? ORDER BY start_q`)
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
  const { n } = db.prepare(`SELECT count(*) n FROM outing WHERE group_id = ?`).get(groupId) as { n: number };
  if (n >= MAX_OUTINGS) throw new HttpError(409, `A group can have ${MAX_OUTINGS} plans at a time`);
  const id = randomUUID();
  db.prepare(`INSERT INTO outing (id, group_id, title, place, start_q, end_q, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id, groupId, text(body.title, 80, true), text(body.place, 120, false), startQ, endQ, memberId,
  );
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
      patchOverrides(db, memberId, { set: Object.fromEntries(Array.from({ length: o.endQ - o.startQ }, (_, i) => [o.startQ + i, "b"])) });
  })();
}

/** The person who proposed it, or the owner. */
export function deleteOuting(db: Db, groupId: string, memberId: string, outingId: string) {
  const o = db.prepare(`SELECT created_by createdBy FROM outing WHERE id = ? AND group_id = ?`).get(outingId, groupId) as { createdBy: string | null } | undefined;
  if (!o) throw new HttpError(404, "No such outing");
  if (o.createdBy !== memberId) assertOwner(db, memberId);
  db.prepare(`DELETE FROM outing WHERE id = ?`).run(outingId);
}
