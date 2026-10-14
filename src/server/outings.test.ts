import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { deleteMe } from "./account";
import { HttpError, createGroup, loadGroup, prune, removeMember } from "./groups";
import { MAX_OUTINGS, answerOuting, createOuting, deleteOuting, listOutings } from "./outings";
import { seed } from "./seed";
import { toQuantum } from "../lib/availability";

const NOW = Date.UTC(2026, 9, 13);
const Q = toQuantum(NOW);
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
const make = (db: ReturnType<typeof fresh>, by = "camille") =>
  createOuting(db, "demo", by, { title: " Brunch ", place: "Café X", startQ: Q + 100, endQ: Q + 106 }, NOW).id;

describe("outings", () => {
  it("creates, lists and answers", () => {
    const db = fresh();
    const id = make(db);
    answerOuting(db, "demo", "diego", id, { answer: "y" }, NOW);
    answerOuting(db, "demo", "diego", id, { answer: "m" }, NOW);
    expect(listOutings(db, "demo")).toEqual([
      { id, title: "Brunch", place: "Café X", startQ: Q + 100, endQ: Q + 106, createdBy: "camille", rsvps: { diego: "m" } },
    ]);
  });

  it("validates input", () => {
    const db = fresh();
    const bodies = [{ title: "", startQ: Q + 1, endQ: Q + 2 }, { title: "x", startQ: Q + 2, endQ: Q + 2 }, { title: "x", startQ: Q + 1, endQ: Q + 1000 }, { title: "x", startQ: Q - 9, endQ: Q - 8 }, "x"];
    for (const b of bodies) expect(status(() => createOuting(db, "demo", "you", b, NOW))).toBe(400);
    const id = make(db);
    expect(status(() => answerOuting(db, "demo", "you", id, { answer: "x" }))).toBe(400);
    expect(status(() => answerOuting(db, "demo", "you", "nope", { answer: "y" }))).toBe(404);
  });

  it("marks the time busy once, only when asked", () => {
    const db = fresh();
    const id = make(db);
    answerOuting(db, "demo", "diego", id, { answer: "y" }, NOW);
    expect(loadGroup(db, "demo", "you").members.find((m) => m.id === "diego")!.overrides).toEqual({});
    answerOuting(db, "demo", "diego", id, { answer: "y", markBusy: true }, NOW);
    expect(Object.keys(loadGroup(db, "demo", "you").members.find((m) => m.id === "diego")!.overrides)).toHaveLength(6);
  });

  it("lets only the proposer or the owner delete", () => {
    const db = fresh();
    const id = make(db);
    expect(status(() => deleteOuting(db, "demo", "diego", id))).toBe(403);
    deleteOuting(db, "demo", "you", id);
    expect(listOutings(db, "demo")).toEqual([]);
    deleteOuting(db, "demo", "camille", make(db));
    expect(status(() => deleteOuting(db, "demo", "you", "nope"))).toBe(404);
  });

  it("survives its proposer or a responder leaving, and goes with the group", () => {
    const db = fresh();
    const id = make(db);
    answerOuting(db, "demo", "diego", id, { answer: "y" }, NOW);
    removeMember(db, "demo", "you", "camille");
    removeMember(db, "demo", "you", "diego");
    expect(listOutings(db, "demo")).toMatchObject([{ createdBy: null, rsvps: {} }]);
    for (const m of ["sofia", "kenji", "you"]) deleteMe(db, "demo", m);
    expect(db.prepare(`SELECT count(*) n FROM outing`).get()).toEqual({ n: 0 });
  });

  it("prunes outings that ended over a week ago", () => {
    const db = fresh();
    make(db);
    prune(db, NOW + 20 * 86_400_000);
    expect(listOutings(db, "demo")).toEqual([]);
  });

  it("caps the plans a group can have", () => {
    const db = fresh();
    for (let i = 0; i < MAX_OUTINGS; i++) make(db);
    expect(status(() => make(db))).toBe(409);
  });

  it("refuses an answer once the outing is over", () => {
    const db = fresh();
    const id = make(db);
    expect(status(() => answerOuting(db, "demo", "you", id, { answer: "y" }, NOW + 2 * 86_400_000))).toBe(400);
  });

  it("never reaches an outing of another group", () => {
    const db = fresh();
    const other = createGroup(db, { groupName: "Other", name: "Zed" });
    const id = createOuting(db, other.groupId, other.memberId, { title: "x", startQ: Q + 100, endQ: Q + 104 }, NOW).id;
    expect(status(() => answerOuting(db, "demo", "you", id, { answer: "y" }, NOW))).toBe(404);
    expect(status(() => deleteOuting(db, "demo", "you", id))).toBe(404);
    expect(listOutings(db, other.groupId)).toHaveLength(1);
  });
});
