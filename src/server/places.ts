import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { HttpError, assertOwner, bad, cleanText, isObject } from "./groups";
import type { Place, PlaceComment } from "../lib/types";

export const MAX_PLACES = 100;
// Comments are counted per group, so one group cannot make every load carry a huge list.
export const MAX_COMMENTS = 300;

/** For a table with a `place_id`: only the places of one group (bind the group id). */
const IN_GROUP = `place_id IN (SELECT id FROM place WHERE group_id = ?)`;

/** "" or an http(s) link: anything else (javascript:, data:) must never become a clickable href. Stored as the parser writes it. */
function cleanUrl(v: unknown) {
  const url = cleanText(v, 500, false);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    // "http:cafe.example" parses, but as an href it is relative on an http page; the parsed form has the slashes.
    if (/^https?:$/.test(parsed.protocol)) return parsed.href;
  } catch {}
  throw bad("Links must start with http:// or https://");
}

export function listPlaces(db: Db, groupId: string): Place[] {
  const rows = db
    .prepare(
      `SELECT id, name, link, map_link mapLink, notes, suggested_by suggestedBy, been_there beenThere FROM place WHERE group_id = ? ORDER BY created_at, rowid`,
    )
    .all(groupId) as (Omit<Place, "votes" | "beenThere" | "ratings" | "comments"> & { beenThere: number })[];
  const votes = db
    .prepare(`SELECT place_id id, member_id memberId FROM place_vote WHERE ${IN_GROUP}`)
    .all(groupId) as { id: string; memberId: string }[];
  const ratings = db.prepare(`SELECT place_id id, member_id memberId, stars FROM place_rating WHERE ${IN_GROUP}`).all(groupId) as {
    id: string;
    memberId: string;
    stars: number;
  }[];
  const comments = db
    .prepare(`SELECT id, place_id placeId, member_id memberId, body, created_at createdAt FROM place_comment WHERE ${IN_GROUP} ORDER BY created_at, rowid`)
    .all(groupId) as (PlaceComment & { placeId: string })[];
  return rows.map((p) => ({
    ...p,
    beenThere: p.beenThere === 1,
    votes: votes.filter((v) => v.id === p.id).map((v) => v.memberId),
    ratings: Object.fromEntries(ratings.filter((r) => r.id === p.id).map((r) => [r.memberId, r.stars])),
    comments: comments.filter((c) => c.placeId === p.id).map(({ id, memberId, body, createdAt }) => ({ id, memberId, body, createdAt })),
  }));
}

export function createPlace(db: Db, groupId: string, memberId: string, body: unknown, now = Date.now()) {
  if (!isObject(body)) throw bad("Expected an object");
  const values = [cleanText(body.name, 80, true), cleanUrl(body.link), cleanUrl(body.mapLink), cleanText(body.notes, 500, false)];
  const { n } = db.prepare(`SELECT count(*) n FROM place WHERE group_id = ?`).get(groupId) as { n: number };
  if (n >= MAX_PLACES) throw new HttpError(409, `The wishlist can hold ${MAX_PLACES} places`);
  const id = randomUUID();
  db.prepare(`INSERT INTO place (id, group_id, name, link, map_link, notes, suggested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, groupId, ...values, memberId, now,
  );
  return { id };
}

/** The place, if it is in the caller's group; `suggestedBy` says who may edit it. */
function findPlace(db: Db, groupId: string, placeId: string) {
  const p = db.prepare(`SELECT suggested_by suggestedBy FROM place WHERE id = ? AND group_id = ?`).get(placeId, groupId) as
    | { suggestedBy: string | null }
    | undefined;
  if (!p) throw new HttpError(404, "No such place");
  return p;
}

/** Who suggested it, or the owner. */
function assertMayEdit(db: Db, memberId: string, suggestedBy: string | null) {
  if (suggestedBy !== memberId) assertOwner(db, memberId);
}

/** The details need the suggester or the owner; anyone in the group may mark a place as visited. */
export function updatePlace(db: Db, groupId: string, memberId: string, placeId: string, body: unknown) {
  if (!isObject(body)) throw bad("Expected an object");
  const { suggestedBy } = findPlace(db, groupId, placeId);
  const set: string[] = [];
  const args: (string | number)[] = [];
  const field = (column: string, value: string | number) => (set.push(`${column} = ?`), args.push(value));
  if (body.name !== undefined) field("name", cleanText(body.name, 80, true));
  if (body.link !== undefined) field("link", cleanUrl(body.link));
  if (body.mapLink !== undefined) field("map_link", cleanUrl(body.mapLink));
  if (body.notes !== undefined) field("notes", cleanText(body.notes, 500, false));
  if (set.length) assertMayEdit(db, memberId, suggestedBy);
  if (body.beenThere !== undefined) {
    if (typeof body.beenThere !== "boolean") throw bad("Invalid value");
    field("been_there", body.beenThere ? 1 : 0);
  }
  if (!set.length) throw bad("Nothing to change");
  db.prepare(`UPDATE place SET ${set.join(", ")} WHERE id = ?`).run(...args, placeId);
}

/** My own vote only; voting twice or taking back a vote I never gave changes nothing. */
export function votePlace(db: Db, groupId: string, memberId: string, placeId: string, on: boolean) {
  findPlace(db, groupId, placeId);
  db.prepare(on ? `INSERT OR IGNORE INTO place_vote (place_id, member_id) VALUES (?, ?)` : `DELETE FROM place_vote WHERE place_id = ? AND member_id = ?`).run(
    placeId, memberId,
  );
}

export function deletePlace(db: Db, groupId: string, memberId: string, placeId: string) {
  assertMayEdit(db, memberId, findPlace(db, groupId, placeId).suggestedBy);
  db.prepare(`DELETE FROM place WHERE id = ?`).run(placeId);
}

/** My own star rating (1 to 5), replacing an earlier one. */
export function ratePlace(db: Db, groupId: string, memberId: string, placeId: string, body: unknown) {
  if (!isObject(body)) throw bad("Expected an object");
  findPlace(db, groupId, placeId);
  const { stars } = body;
  if (!Number.isInteger(stars) || (stars as number) < 1 || (stars as number) > 5) throw bad("Stars go from 1 to 5");
  db.prepare(`INSERT INTO place_rating (place_id, member_id, stars) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET stars = excluded.stars`).run(placeId, memberId, stars);
}

/** Takes my rating back; taking back one I never gave changes nothing. */
export function clearRating(db: Db, groupId: string, memberId: string, placeId: string) {
  findPlace(db, groupId, placeId);
  db.prepare(`DELETE FROM place_rating WHERE place_id = ? AND member_id = ?`).run(placeId, memberId);
}

export function addComment(db: Db, groupId: string, memberId: string, placeId: string, body: unknown, now = Date.now()) {
  if (!isObject(body)) throw bad("Expected an object");
  findPlace(db, groupId, placeId);
  const text = cleanText(body.body, 500, true);
  const { n } = db
    .prepare(`SELECT count(*) n FROM place_comment WHERE ${IN_GROUP}`)
    .get(groupId) as { n: number };
  if (n >= MAX_COMMENTS) throw new HttpError(409, `The wishlist can hold ${MAX_COMMENTS} comments`);
  const id = randomUUID();
  db.prepare(`INSERT INTO place_comment (id, place_id, member_id, body, created_at) VALUES (?, ?, ?, ?, ?)`).run(id, placeId, memberId, text, now);
  return { id };
}

/** Whoever wrote it, or the owner. */
export function deleteComment(db: Db, groupId: string, memberId: string, placeId: string, commentId: string) {
  findPlace(db, groupId, placeId);
  const c = db.prepare(`SELECT member_id memberId FROM place_comment WHERE id = ? AND place_id = ?`).get(commentId, placeId) as
    | { memberId: string }
    | undefined;
  if (!c) throw new HttpError(404, "No such comment");
  if (c.memberId !== memberId) assertOwner(db, memberId);
  db.prepare(`DELETE FROM place_comment WHERE id = ?`).run(commentId);
}
