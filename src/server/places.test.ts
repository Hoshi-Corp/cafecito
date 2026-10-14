import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { deleteMe, exportMe } from "./account";
import { HttpError, createGroup, removeMember } from "./groups";
import { MAX_PLACES, createPlace, deletePlace, listPlaces, updatePlace, votePlace } from "./places";
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
      { id, name: "Café X", link: "https://x.example", mapLink: "https://maps.example/x", notes: "Great pastries", suggestedBy: "camille", beenThere: false, votes: ["diego", "you"] },
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
      { name: "Mine", link: "https://x.example", mapLink: "https://maps.example/x", notes: "Great pastries", beenThere: false, suggestedByMe: true, votedByMe: false },
      { name: "Voted", link: "https://x.example", mapLink: "https://maps.example/x", notes: "Great pastries", beenThere: false, suggestedByMe: false, votedByMe: true },
    ]);
  });
});
