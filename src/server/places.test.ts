import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { deleteMe, exportMe } from "./account";
import { HttpError, createGroup, removeMember } from "./groups";
import { MAX_COMMENTS, MAX_PLACES, addComment, clearRating, createPlace, deleteComment, deletePlace, listPlaces, ratePlace, updatePlace, votePlace } from "./places";
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
  createPlace(db, "demo", by, { name: " Café X ", link: "https://x.example", mapLink: "https://maps.example/x", notes: "Great pastries", ...body }, 1000).id;

describe("wishlist", () => {
  it("adds a place and lists it with its votes", () => {
    const db = fresh();
    const id = add(db);
    votePlace(db, "demo", "diego", id, true);
    votePlace(db, "demo", "diego", id, true); // twice: still one vote
    votePlace(db, "demo", "you", id, true);
    expect(listPlaces(db, "demo")).toEqual([
      { id, name: "Café X", link: "https://x.example/", mapLink: "https://maps.example/x", notes: "Great pastries", suggestedBy: "camille", beenThere: false, votes: ["diego", "you"], ratings: {}, comments: [] },
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

  it("caps the wishlist", () => {
    const db = fresh();
    for (let i = 0; i < MAX_PLACES; i++) add(db);
    expect(status(() => add(db))).toBe(409);
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
      { name: "Mine", link: "https://x.example/", mapLink: "https://maps.example/x", notes: "Great pastries", beenThere: false, suggestedByMe: true, votedByMe: false, myStars: null, myComments: [] },
      { name: "Voted", link: "https://x.example/", mapLink: "https://maps.example/x", notes: "Great pastries", beenThere: false, suggestedByMe: false, votedByMe: true, myStars: null, myComments: [] },
    ]);
  });
});

describe("ratings and comments", () => {
  it("rates from one to five, replaces and takes back my own rating", () => {
    const db = fresh();
    const id = add(db);
    ratePlace(db, "demo", "diego", id, { stars: 4 });
    ratePlace(db, "demo", "diego", id, { stars: 2 });
    ratePlace(db, "demo", "you", id, { stars: 5 });
    expect(listPlaces(db, "demo")[0].ratings).toEqual({ diego: 2, you: 5 });
    clearRating(db, "demo", "diego", id);
    clearRating(db, "demo", "sofia", id); // never rated: nothing happens
    expect(listPlaces(db, "demo")[0].ratings).toEqual({ you: 5 });
    expect(status(() => ratePlace(db, "demo", "you", id, "5"))).toBe(400);
    for (const stars of [0, 6, 2.5, "3", undefined, -1]) expect(status(() => ratePlace(db, "demo", "you", id, { stars }))).toBe(400);
    expect(listPlaces(db, "demo")[0].ratings).toEqual({ you: 5 });
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

  it("removes a leaving member's ratings and comments, and everything goes with the group", () => {
    const db = fresh();
    const id = add(db);
    ratePlace(db, "demo", "diego", id, { stars: 4 });
    ratePlace(db, "demo", "sofia", id, { stars: 3 });
    addComment(db, "demo", "diego", id, { body: "mine" });
    addComment(db, "demo", "sofia", id, { body: "kept" });
    removeMember(db, "demo", "you", "diego");
    expect(listPlaces(db, "demo")[0]).toMatchObject({ ratings: { sofia: 3 }, comments: [{ body: "kept" }] });
    for (const m of ["camille", "sofia", "kenji", "you"]) deleteMe(db, "demo", m);
    expect(db.prepare(`SELECT (SELECT count(*) FROM place_rating) + (SELECT count(*) FROM place_comment) n`).get()).toEqual({ n: 0 });
  });

  it("exports my rating and comments, also for places I only rated or commented on", () => {
    const db = fresh();
    const id = add(db, "diego", { name: "Rated" });
    add(db, "diego", { name: "Unrelated" });
    ratePlace(db, "demo", "camille", id, { stars: 5 });
    addComment(db, "demo", "camille", id, { body: "Mine" }, 1000);
    addComment(db, "demo", "diego", id, { body: "Not mine" }, 2000);
    expect(exportMe(db, "camille").places).toEqual([
      expect.objectContaining({ name: "Rated", suggestedByMe: false, votedByMe: false, myStars: 5, myComments: [{ at: new Date(1000).toISOString(), text: "Mine" }] }),
    ]);
  });
});
