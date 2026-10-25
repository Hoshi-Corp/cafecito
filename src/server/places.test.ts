import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { deleteMe, exportMe } from "./account";
import { HttpError, createGroup, removeMember } from "./groups";
import { MAX_COMMENTS, MAX_COMMENT_ROWS, MAX_PLACES, MAX_PLACE_ROWS, addComment, clearRating, createPlace, deleteComment, deletePlace, listPlaces, ratePlace, updatePlace, votePlace } from "./places";
import { seed } from "./seed";

const fresh = () => {
  const db = openDb(":memory:");
  seed(db);
  return db;
};
const status = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
  return 0;
};
const add = (db: ReturnType<typeof fresh>, by = "camille", body: object = {}) =>
  createPlace(db, "demo", by, { name: " Café X ", link: "https://x.example/", mapLink: "https://maps.example/x", notes: "Great pastries", ...body }, 1000).id;

/** Rating needs someone to have been. */
const visit = (db: ReturnType<typeof fresh>, id: string) => (updatePlace(db, "demo", "diego", id, { beenThere: true }), id);

describe("wishlist", () => {
  it("adds a place and lists it with its votes", () => {
    const db = fresh();
    const id = add(db);
    votePlace(db, "demo", "diego", id, true);
    votePlace(db, "demo", "diego", id, true); // twice: still one vote
    votePlace(db, "demo", "you", id, true);
    expect(listPlaces(db, "demo")).toEqual([
      { id, name: "Café X", link: "https://x.example/", mapLink: "https://maps.example/x", notes: "Great pastries", suggestedBy: "camille", beenThere: false, createdAt: 1000, archivedAt: null, votes: ["diego", "you"], ratings: {}, comments: [] },
    ]);
    votePlace(db, "demo", "diego", id, false);
    votePlace(db, "demo", "sofia", id, false); // never voted: nothing happens
    expect(listPlaces(db, "demo")[0].votes).toEqual(["you"]);
  });

  it("validates the name, text length and the links", () => {
    const db = fresh();
    const bodies = [
      { name: " " },
      { name: "x".repeat(81) },
      { name: "x", notes: "n".repeat(501) },
      { name: "x", link: "javascript:alert(1)" },
      { name: "x", mapLink: "data:text/html,hi" },
      { name: "x", link: "not a url" },
      { name: "x", link: "ftp://files.example" },
      { name: "x", link: 5 },
      "x",
    ];
    for (const b of bodies) expect(status(() => createPlace(db, "demo", "you", b))).toBe(400);
    expect(status(() => createPlace(db, "demo", "you", { name: "ok" }))).toBe(0); // links and notes are optional
  });

  it("stores links as the parser writes them, so a link missing its slashes is not relative on an http page", () => {
    const db = fresh();
    createPlace(db, "demo", "you", { name: "X", link: "http:cafe.example", mapLink: " https://maps.example/a b " });
    expect(listPlaces(db, "demo")[0]).toMatchObject({ link: "http://cafe.example/", mapLink: "https://maps.example/a%20b" });
  });

  it("caps the wishlist, not counting archived places, and won't bring one back onto a full list", () => {
    const db = fresh();
    const ids = Array.from({ length: MAX_PLACES }, () => add(db));
    expect(status(() => add(db))).toBe(409);
    updatePlace(db, "demo", "camille", ids[0], { archived: true });
    add(db); // archiving made room
    expect(status(() => updatePlace(db, "demo", "camille", ids[0], { archived: false }))).toBe(409);
    expect(listPlaces(db, "demo")[0].archivedAt).not.toBeNull();
    expect(status(() => updatePlace(db, "demo", "diego", ids[0], { archived: false }))).toBe(403); // not theirs: "not allowed", not "full"
    updatePlace(db, "demo", "camille", ids[1], { archived: false }); // not archived: nothing to bring back, so no check
    deletePlace(db, "demo", "camille", ids[2]);
    updatePlace(db, "demo", "camille", ids[0], { archived: false }); // room again
    expect(listPlaces(db, "demo").filter((p) => !p.archivedAt)).toHaveLength(MAX_PLACES);
  });

  it("lets anyone mark it visited, but only its suggester or the owner edit the details", () => {
    const db = fresh();
    const id = add(db);
    updatePlace(db, "demo", "diego", id, { beenThere: true });
    expect(listPlaces(db, "demo")[0].beenThere).toBe(true);
    expect(status(() => updatePlace(db, "demo", "diego", id, { name: "Hijacked" }))).toBe(403);
    expect(status(() => updatePlace(db, "demo", "diego", id, { beenThere: false, notes: "x" }))).toBe(403);
    expect(listPlaces(db, "demo")[0].beenThere).toBe(true); // the refused call changed nothing
    updatePlace(db, "demo", "camille", id, { name: "Café Y", link: "" });
    updatePlace(db, "demo", "you", id, { notes: "" }); // the owner
    expect(listPlaces(db, "demo")[0]).toMatchObject({ name: "Café Y", link: "", notes: "", mapLink: "https://maps.example/x" });
    expect(status(() => updatePlace(db, "demo", "camille", id, {}))).toBe(400);
    expect(status(() => updatePlace(db, "demo", "camille", id, { beenThere: "yes" }))).toBe(400);
    expect(status(() => updatePlace(db, "demo", "camille", id, { link: "javascript:1" }))).toBe(400);
  });

  it("archives and brings back a place, by its suggester or the owner, keeping the first archive date", () => {
    const db = fresh();
    const id = add(db);
    votePlace(db, "demo", "diego", id, true);
    expect(status(() => updatePlace(db, "demo", "diego", id, { archived: true }))).toBe(403);
    updatePlace(db, "demo", "camille", id, { archived: true }, 5000);
    updatePlace(db, "demo", "you", id, { archived: true }, 9000); // already archived: the date stays
    // Still loaded, with its votes, so it can be shown under Archived.
    expect(listPlaces(db, "demo")[0]).toMatchObject({ archivedAt: 5000, votes: ["diego"] });
    expect(status(() => updatePlace(db, "demo", "camille", id, { archived: "yes" }))).toBe(400);
    updatePlace(db, "demo", "you", id, { archived: false });
    expect(listPlaces(db, "demo")[0].archivedAt).toBeNull();
  });

  it("lets only the suggester or the owner delete", () => {
    const db = fresh();
    const id = add(db);
    expect(status(() => deletePlace(db, "demo", "diego", id))).toBe(403);
    deletePlace(db, "demo", "camille", id);
    deletePlace(db, "demo", "you", add(db));
    expect(listPlaces(db, "demo")).toEqual([]);
    expect(status(() => deletePlace(db, "demo", "you", "nope"))).toBe(404);
  });

  it("never reaches a place of another group", () => {
    const db = fresh();
    const other = createGroup(db, { groupName: "Other", name: "Zed" });
    const theirs = createPlace(db, other.groupId, other.memberId, { name: "Theirs" }).id;
    expect(status(() => votePlace(db, "demo", "you", theirs, true))).toBe(404);
    expect(status(() => updatePlace(db, "demo", "you", theirs, { beenThere: true }))).toBe(404);
    expect(status(() => deletePlace(db, "demo", "you", theirs))).toBe(404);
    expect(listPlaces(db, other.groupId)).toMatchObject([{ beenThere: false, votes: [] }]);
  });

  it("keeps a place when its suggester leaves, drops their votes, and goes with the group", () => {
    const db = fresh();
    const id = add(db);
    votePlace(db, "demo", "camille", id, true);
    votePlace(db, "demo", "diego", id, true);
    removeMember(db, "demo", "you", "camille");
    expect(listPlaces(db, "demo")).toMatchObject([{ suggestedBy: null, votes: ["diego"] }]);
    for (const m of ["diego", "sofia", "kenji", "you"]) deleteMe(db, "demo", m);
    expect(db.prepare(`SELECT (SELECT count(*) FROM place) + (SELECT count(*) FROM place_vote) n`).get()).toEqual({ n: 0 });
  });

  it("exports the places I suggested or voted for, and no others", () => {
    const db = fresh();
    add(db, "camille", { name: "Mine" });
    const voted = add(db, "diego", { name: "Voted" });
    add(db, "diego", { name: "Unrelated" });
    votePlace(db, "demo", "camille", voted, true);
    expect(exportMe(db, "camille").places).toEqual([
      { name: "Mine", link: "https://x.example/", mapLink: "https://maps.example/x", notes: "Great pastries", beenThere: false, suggestedByMe: true, votedByMe: false, removed: false, myStars: null, myComments: [] },
      { name: "Voted", link: "https://x.example/", mapLink: "https://maps.example/x", notes: "Great pastries", beenThere: false, suggestedByMe: false, votedByMe: true, removed: false, myStars: null, myComments: [] },
    ]);
  });
});

describe("ratings and comments", () => {
  it("rates from half a star to five in halves, replaces and takes back my own rating", () => {
    const db = fresh();
    const id = visit(db, add(db));
    ratePlace(db, "demo", "diego", id, { stars: 4 });
    ratePlace(db, "demo", "diego", id, { stars: 2.5 });
    ratePlace(db, "demo", "you", id, { stars: 5 });
    ratePlace(db, "demo", "sofia", id, { stars: 0.5 });
    expect(listPlaces(db, "demo")[0].ratings).toEqual({ diego: 2.5, you: 5, sofia: 0.5 });
    clearRating(db, "demo", "sofia", id);
    clearRating(db, "demo", "diego", id);
    clearRating(db, "demo", "sofia", id); // never rated: nothing happens
    expect(listPlaces(db, "demo")[0].ratings).toEqual({ you: 5 });
    expect(status(() => ratePlace(db, "demo", "you", id, "5"))).toBe(400);
    for (const stars of [0, 6, 5.5, 2.25, 0.1, "3", undefined, -1, NaN]) expect(status(() => ratePlace(db, "demo", "you", id, { stars }))).toBe(400);
    expect(listPlaces(db, "demo")[0].ratings).toEqual({ you: 5 });
  });

  it("takes stars only once someone has been, and always lets me take mine back", () => {
    const db = fresh();
    const id = add(db);
    expect(status(() => ratePlace(db, "demo", "you", id, { stars: 4 }))).toBe(409);
    visit(db, id);
    ratePlace(db, "demo", "you", id, { stars: 4 });
    updatePlace(db, "demo", "diego", id, { beenThere: false });
    clearRating(db, "demo", "you", id); // still allowed, though the place is no longer marked as visited
    expect(listPlaces(db, "demo")[0].ratings).toEqual({});
  });

  it("adds comments in order, trimmed, and checks their length", () => {
    const db = fresh();
    const id = add(db);
    addComment(db, "demo", "diego", id, { body: "  Loved the pastries " }, 1000);
    addComment(db, "demo", "you", id, { body: "Too loud" }, 2000);
    expect(listPlaces(db, "demo")[0].comments).toMatchObject([
      { memberId: "diego", body: "Loved the pastries", createdAt: 1000 },
      { memberId: "you", body: "Too loud", createdAt: 2000 },
    ]);
    for (const body of [{ body: "  " }, { body: "x".repeat(501) }, { body: 5 }, {}, "x"]) expect(status(() => addComment(db, "demo", "you", id, body))).toBe(400);
  });

  it("caps comments per group", () => {
    const db = fresh();
    const id = add(db);
    for (let i = 0; i < MAX_COMMENTS; i++) addComment(db, "demo", "you", id, { body: "c" });
    expect(status(() => addComment(db, "demo", "you", id, { body: "c" }))).toBe(409);
  });

  it("lets only the author or the owner delete a comment", () => {
    const db = fresh();
    const id = add(db);
    const mine = addComment(db, "demo", "diego", id, { body: "a" }).id;
    expect(status(() => deleteComment(db, "demo", "sofia", id, mine))).toBe(403);
    deleteComment(db, "demo", "diego", id, mine);
    deleteComment(db, "demo", "you", id, addComment(db, "demo", "diego", id, { body: "b" }).id); // the owner
    expect(listPlaces(db, "demo")[0].comments).toEqual([]);
    expect(status(() => deleteComment(db, "demo", "you", id, "nope"))).toBe(404);
  });

  it("lets only the owner delete the comment of someone who left", () => {
    const db = fresh();
    const id = add(db);
    const orphan = addComment(db, "demo", "diego", id, { body: "bye" }).id;
    removeMember(db, "demo", "you", "diego");
    expect(status(() => deleteComment(db, "demo", "sofia", id, orphan))).toBe(403);
    deleteComment(db, "demo", "you", id, orphan);
    expect(listPlaces(db, "demo")[0].comments).toEqual([]);
  });

  it("never reaches a place or comment of another group", () => {
    const db = fresh();
    const other = createGroup(db, { groupName: "Other", name: "Zed" });
    const theirs = createPlace(db, other.groupId, other.memberId, { name: "Theirs" }).id;
    const comment = addComment(db, other.groupId, other.memberId, theirs, { body: "hi" }).id;
    expect(status(() => ratePlace(db, "demo", "you", theirs, { stars: 3 }))).toBe(404);
    expect(status(() => addComment(db, "demo", "you", theirs, { body: "x" }))).toBe(404);
    expect(status(() => deleteComment(db, "demo", "you", theirs, comment))).toBe(404);
    const mine = add(db);
    expect(status(() => deleteComment(db, "demo", "you", mine, comment))).toBe(404); // right group, wrong place
  });

  it("keeps a leaving member's comments without an author, drops their ratings, and everything goes with the group", () => {
    const db = fresh();
    const id = visit(db, add(db));
    ratePlace(db, "demo", "diego", id, { stars: 4 });
    ratePlace(db, "demo", "sofia", id, { stars: 3 });
    addComment(db, "demo", "diego", id, { body: "mine" });
    addComment(db, "demo", "sofia", id, { body: "kept" });
    removeMember(db, "demo", "you", "diego");
    expect(listPlaces(db, "demo")[0]).toMatchObject({ ratings: { sofia: 3 }, comments: [{ memberId: null, body: "mine" }, { memberId: "sofia", body: "kept" }] });
    for (const m of ["camille", "sofia", "kenji", "you"]) deleteMe(db, "demo", m);
    expect(db.prepare(`SELECT (SELECT count(*) FROM place_rating) + (SELECT count(*) FROM place_comment) n`).get()).toEqual({ n: 0 });
  });

  it("exports my rating and comments, also for places I only rated or commented on", () => {
    const db = fresh();
    const id = visit(db, add(db, "diego", { name: "Rated" }));
    add(db, "diego", { name: "Unrelated" });
    ratePlace(db, "demo", "camille", id, { stars: 5 });
    addComment(db, "demo", "camille", id, { body: "Mine" }, 1000);
    addComment(db, "demo", "diego", id, { body: "Not mine" }, 2000);
    expect(exportMe(db, "camille").places).toEqual([
      expect.objectContaining({ name: "Rated", suggestedByMe: false, votedByMe: false, myStars: 5, myComments: [{ at: new Date(1000).toISOString(), text: "Mine" }] }),
    ]);
  });
});

describe("removing a place", () => {
  const counts = (db: ReturnType<typeof fresh>) =>
    db.prepare(`SELECT (SELECT count(*) FROM place_vote) v, (SELECT count(*) FROM place_rating) r, (SELECT count(*) FROM place_comment) c`).get();

  it("takes it off the list and keeps its votes, ratings and comments as history", () => {
    const db = fresh();
    const id = visit(db, add(db));
    votePlace(db, "demo", "diego", id, true);
    ratePlace(db, "demo", "diego", id, { stars: 4 });
    addComment(db, "demo", "diego", id, { body: "Nice" });
    deletePlace(db, "demo", "camille", id, 5000);
    expect(listPlaces(db, "demo")).toEqual([]);
    expect(counts(db)).toEqual({ v: 1, r: 1, c: 1 });
    expect(db.prepare(`SELECT deleted_at deletedAt FROM place WHERE id = ?`).get(id)).toEqual({ deletedAt: 5000 });
  });

  it("can no longer be voted on, rated, commented on, edited or removed again", () => {
    const db = fresh();
    const id = add(db);
    deletePlace(db, "demo", "camille", id);
    expect(status(() => votePlace(db, "demo", "you", id, true))).toBe(404);
    expect(status(() => ratePlace(db, "demo", "you", id, { stars: 3 }))).toBe(404);
    expect(status(() => clearRating(db, "demo", "you", id))).toBe(404);
    expect(status(() => addComment(db, "demo", "you", id, { body: "x" }))).toBe(404);
    expect(status(() => updatePlace(db, "demo", "you", id, { beenThere: true }))).toBe(404);
    expect(status(() => deletePlace(db, "demo", "you", id))).toBe(404);
  });

  it("frees a slot on the list, but removed places still count toward the overall limit", () => {
    const db = fresh();
    for (let i = 0; i < MAX_PLACES; i++) add(db);
    expect(status(() => add(db))).toBe(409);
    deletePlace(db, "demo", "you", listPlaces(db, "demo")[0].id);
    expect(status(() => add(db))).toBe(0);
    for (let i = 0; i < MAX_PLACE_ROWS; i++) {
      const [first] = listPlaces(db, "demo");
      if (!first) break;
      deletePlace(db, "demo", "you", first.id);
      if (status(() => add(db)) !== 0) break;
    }
    expect(db.prepare(`SELECT count(*) n FROM place`).get()).toEqual({ n: MAX_PLACE_ROWS });
    expect(status(() => add(db))).toBe(409);
  });

  it("does not count its comments toward the visible limit, only toward the larger overall one", () => {
    const db = fresh();
    for (let i = 0; i < MAX_COMMENT_ROWS / MAX_COMMENTS; i++) {
      const id = add(db);
      for (let c = 0; c < MAX_COMMENTS; c++) addComment(db, "demo", "you", id, { body: "c" });
      expect(status(() => addComment(db, "demo", "you", id, { body: "one more" }))).toBe(409); // the visible limit still holds
      deletePlace(db, "demo", "you", id);
    }
    const fresh1 = add(db);
    expect(db.prepare(`SELECT count(*) n FROM place_comment`).get()).toEqual({ n: MAX_COMMENT_ROWS });
    expect(status(() => addComment(db, "demo", "you", fresh1, { body: "x" }))).toBe(409); // the overall limit
  });

  it("lets a group keep commenting after removing places whose comments filled the visible limit", () => {
    const db = fresh();
    const old = add(db);
    for (let c = 0; c < MAX_COMMENTS; c++) addComment(db, "demo", "you", old, { body: "c" });
    deletePlace(db, "demo", "you", old);
    expect(status(() => addComment(db, "demo", "you", add(db), { body: "fresh" }))).toBe(0);
  });

  it("is still in my export, marked removed, when I had a part in it", () => {
    const db = fresh();
    const id = visit(db, add(db, "camille", { name: "Gone" }));
    ratePlace(db, "demo", "camille", id, { stars: 2 });
    deletePlace(db, "demo", "camille", id);
    expect(exportMe(db, "camille").places).toEqual([expect.objectContaining({ name: "Gone", removed: true, myStars: 2 })]);
  });

  it("goes for good with its group", () => {
    const db = fresh();
    const id = add(db);
    votePlace(db, "demo", "diego", id, true);
    deletePlace(db, "demo", "camille", id);
    for (const m of ["camille", "diego", "sofia", "kenji", "you"]) deleteMe(db, "demo", m);
    expect(db.prepare(`SELECT (SELECT count(*) FROM place) p`).get()).toEqual({ p: 0 });
    expect(counts(db)).toEqual({ v: 0, r: 0, c: 0 });
  });
});

