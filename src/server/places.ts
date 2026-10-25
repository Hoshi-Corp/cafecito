import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { HttpError, assertOwner, bad, cleanText, isObject } from "./groups";
import type { Place, PlaceComment } from "../lib/types";

/** Places on the list; archived ones don't count, so archiving old suggestions makes room. */
export const MAX_PLACES = 100;
const ACTIVE = `deleted_at IS NULL AND archived_at IS NULL`;
const FULL = `The wishlist can hold ${MAX_PLACES} places; archive or remove some first`;
// shortcut: removed places stay for good and count toward this, so a group that adds and removes 500 places stops being able to add
// more; add a purge of old removed places if that ever happens.
export const MAX_PLACE_ROWS = 500;
// Comments on the list are counted per group, so one group cannot make every load carry a huge list; comments on removed places
// no longer load, so they only count toward the larger overall limit.
export const MAX_COMMENTS = 300;
// shortcut: comments on removed places stay for good and count toward this, so a group that reaches it can no longer comment;
// add a purge of old removed places if that ever happens.
export const MAX_COMMENT_ROWS = 3000;

/** For a table with a `place_id` (bind the group id): the places of one group that are on the list, or all of them, removed ones included. */
const ON_LIST = `place_id IN (SELECT id FROM place WHERE group_id = ? AND deleted_at IS NULL)`;
const EVER_IN_GROUP = `place_id IN (SELECT id FROM place WHERE group_id = ?)`;

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
      `SELECT id, name, link, map_link mapLink, notes, suggested_by suggestedBy, been_there beenThere, created_at createdAt,
              archived_at archivedAt FROM place WHERE group_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid`,
    )
    .all(groupId) as (Omit<Place, "votes" | "beenThere" | "ratings" | "comments"> & { beenThere: number })[];
  const votes = db
    .prepare(`SELECT place_id id, member_id memberId FROM place_vote WHERE ${ON_LIST}`)
    .all(groupId) as { id: string; memberId: string }[];
  const ratings = db.prepare(`SELECT place_id id, member_id memberId, stars FROM place_rating WHERE ${ON_LIST}`).all(groupId) as {
    id: string;
    memberId: string;
    stars: number;
  }[];
  const comments = db
    .prepare(`SELECT id, place_id placeId, member_id memberId, body, created_at createdAt FROM place_comment WHERE ${ON_LIST} ORDER BY created_at, rowid`)
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
  const { n, listed } = db
    .prepare(`SELECT count(*) n, count(*) FILTER (WHERE ${ACTIVE}) listed FROM place WHERE group_id = ?`)
    .get(groupId) as { n: number; listed: number };
  if (listed >= MAX_PLACES) throw new HttpError(409, FULL);
  if (n >= MAX_PLACE_ROWS) throw new HttpError(409, "This group has used up its places, including removed ones");
  const id = randomUUID();
  db.prepare(`INSERT INTO place (id, group_id, name, link, map_link, notes, suggested_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, groupId, ...values, memberId, now,
  );
  return { id };
}

/** The place, if it is in the caller's group and not removed; `suggestedBy` says who may edit it. */
function findPlace(db: Db, groupId: string, placeId: string) {
  const p = db
    .prepare(
      `SELECT suggested_by suggestedBy, archived_at archivedAt, been_there beenThere FROM place WHERE id = ? AND group_id = ? AND deleted_at IS NULL`,
    )
    .get(placeId, groupId) as { suggestedBy: string | null; archivedAt: number | null; beenThere: number } | undefined;
  if (!p) throw new HttpError(404, "No such place");
  return p;
}

/** Who suggested it, or the owner. */
function assertMayEdit(db: Db, memberId: string, suggestedBy: string | null) {
  if (suggestedBy !== memberId) assertOwner(db, memberId);
}

/** The details and archiving need the suggester or the owner; anyone in the group may mark a place as visited. */
export function updatePlace(db: Db, groupId: string, memberId: string, placeId: string, body: unknown, now = Date.now()) {
  if (!isObject(body)) throw bad("Expected an object");
  const { suggestedBy, archivedAt } = findPlace(db, groupId, placeId);
  const set: string[] = [];
  const args: (string | number)[] = [];
  const field = (column: string, value: string | number) => (set.push(`${column} = ?`), args.push(value));
  if (body.name !== undefined) field("name", cleanText(body.name, 80, true));
  if (body.link !== undefined) field("link", cleanUrl(body.link));
  if (body.mapLink !== undefined) field("map_link", cleanUrl(body.mapLink));
  if (body.notes !== undefined) field("notes", cleanText(body.notes, 500, false));
  if (body.archived !== undefined) {
    if (typeof body.archived !== "boolean") throw bad("Invalid value");
    // Who may comes before whether there is room, so someone who may not isn't told the list is full.
    assertMayEdit(db, memberId, suggestedBy);
    const back = !body.archived && archivedAt !== null;
    if (back && (db.prepare(`SELECT count(*) n FROM place WHERE group_id = ? AND ${ACTIVE}`).get(groupId) as { n: number }).n >= MAX_PLACES)
      throw new HttpError(409, FULL);
    // Archiving again keeps the first date.
    set.push(`archived_at = ${body.archived ? "coalesce(archived_at, ?)" : "NULL"}`);
    if (body.archived) args.push(now);
  }
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

/** Takes the place off the list; its votes, ratings and comments stay in the database. */
export function deletePlace(db: Db, groupId: string, memberId: string, placeId: string, now = Date.now()) {
  assertMayEdit(db, memberId, findPlace(db, groupId, placeId).suggestedBy);
  db.prepare(`UPDATE place SET deleted_at = ? WHERE id = ?`).run(now, placeId);
}

/** My own star rating (half a star to 5, in halves), replacing an earlier one; only once someone has been. */
export function ratePlace(db: Db, groupId: string, memberId: string, placeId: string, body: unknown) {
  if (!isObject(body)) throw bad("Expected an object");
  if (!findPlace(db, groupId, placeId).beenThere) throw new HttpError(409, "Mark it as Been there before rating it");
  const { stars } = body;
  if (typeof stars !== "number" || !Number.isInteger(stars * 2) || stars < 0.5 || stars > 5) throw bad("Stars go from half a star to 5, in halves");
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
  const { listed, n } = db
    .prepare(
      `SELECT (SELECT count(*) FROM place_comment WHERE ${ON_LIST}) listed, (SELECT count(*) FROM place_comment WHERE ${EVER_IN_GROUP}) n`,
    )
    .get(groupId, groupId) as { listed: number; n: number };
  if (listed >= MAX_COMMENTS) throw new HttpError(409, `The wishlist can hold ${MAX_COMMENTS} comments`);
  if (n >= MAX_COMMENT_ROWS) throw new HttpError(409, "This group has used up its comments, including those on removed places");
  const id = randomUUID();
  db.prepare(`INSERT INTO place_comment (id, place_id, member_id, body, created_at) VALUES (?, ?, ?, ?, ?)`).run(id, placeId, memberId, text, now);
  return { id };
}

/** Whoever wrote it, or the owner (only the owner for the comment of someone who left). */
export function deleteComment(db: Db, groupId: string, memberId: string, placeId: string, commentId: string) {
  findPlace(db, groupId, placeId);
  const c = db.prepare(`SELECT member_id memberId FROM place_comment WHERE id = ? AND place_id = ?`).get(commentId, placeId) as
    | { memberId: string | null }
    | undefined;
  if (!c) throw new HttpError(404, "No such comment");
  if (c.memberId !== memberId) assertOwner(db, memberId);
  db.prepare(`DELETE FROM place_comment WHERE id = ?`).run(commentId);
}
