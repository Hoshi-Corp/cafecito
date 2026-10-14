import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { deleteMe } from "./account";
import { HttpError, createGroup, loadGroup, prune, removeMember } from "./groups";
import { MAX_OUTINGS, answerOuting, createOuting, deleteOuting, listOutings } from "./outings";
import { seed } from "./seed";
import { QUANTA_PER_DAY, bestWindows, isSetUp, toQuantum } from "../lib/availability";

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
/** The first best window the group screen would offer at NOW, clipped to an hour. */
const slot = (db: ReturnType<typeof fresh>) => {
  const [w] = bestWindows(loadGroup(db, "demo", "you").members.filter(isSetUp), Q + 1, Q + 1 + 14 * QUANTA_PER_DAY);
  return { startQ: w.startQ, endQ: w.startQ + 4 };
};
const make = (db: ReturnType<typeof fresh>, by = "camille") =>
  createOuting(db, "demo", by, { title: " Brunch ", place: "Café X", ...slot(db) }, NOW).id;

describe("outings", () => {
  it("creates, lists and answers", () => {
    const db = fresh();
    const time = slot(db); // before the proposer's time turns busy
    const id = make(db);
    answerOuting(db, "demo", "diego", id, { answer: "y" }, NOW);
    answerOuting(db, "demo", "diego", id, { answer: "m" }, NOW);
    expect(listOutings(db, "demo")).toEqual([
      { id, title: "Brunch", place: "Café X", ...time, createdBy: "camille", rsvps: { camille: "y", diego: "m" } },
    ]);
  });

  it("validates input", () => {
    const db = fresh();
    const { startQ } = slot(db);
    const bodies = [
      { title: "", ...slot(db) },
      { title: "x", startQ, endQ: startQ },
      { title: "x", startQ, endQ: startQ + 17 },
      { title: "x", startQ: Q - 9, endQ: Q - 8 },
      "x",
    ];
    for (const b of bodies) expect(status(() => createOuting(db, "demo", "you", b, NOW))).toBe(400);
    const id = make(db);
    expect(status(() => answerOuting(db, "demo", "you", id, { answer: "x" }))).toBe(400);
    expect(status(() => answerOuting(db, "demo", "you", "nope", { answer: "y" }))).toBe(404);
  });

  it("marks the proposer busy for the plan's time, and nobody else", () => {
    const db = fresh();
    const { startQ } = slot(db);
    make(db);
    const busy = (id: string) => Object.keys(loadGroup(db, "demo", "you").members.find((m) => m.id === id)!.overrides).map(Number);
    expect(busy("camille")).toEqual([startQ, startQ + 1, startQ + 2, startQ + 3]);
    expect(busy("diego")).toEqual([]);
  });

  it("gives the proposer their week back when the plan is deleted, by them or by the owner", () => {
    const db = fresh();
    const overrides = (id: string) => Object.keys(loadGroup(db, "demo", "you").members.find((m) => m.id === id)!.overrides);
    deleteOuting(db, "demo", "camille", make(db));
    expect(overrides("camille")).toEqual([]);
    deleteOuting(db, "demo", "you", make(db));
    expect(overrides("camille")).toEqual([]);
  });

  it("only accepts a time the group is free for", () => {
    const db = fresh();
    const windows = bestWindows(loadGroup(db, "demo", "you").members.filter(isSetUp), Q + 1, Q + 1 + 14 * QUANTA_PER_DAY, { limit: Infinity });
    const inside = (s: number) => windows.some((w) => w.startQ <= s && s + 4 <= w.endQ);
    let busy = Q + 1;
    while (inside(busy)) busy++;
    expect(status(() => createOuting(db, "demo", "you", { title: "x", startQ: busy, endQ: busy + 4 }, NOW))).toBe(409);
    expect(status(() => createOuting(db, "demo", "you", { title: "x", ...slot(db) }, NOW))).toBe(0);
  });

  it("marks the time busy once, only when asked", () => {
    const db = fresh();
    const id = make(db);
    answerOuting(db, "demo", "diego", id, { answer: "y" }, NOW);
    expect(loadGroup(db, "demo", "you").members.find((m) => m.id === "diego")!.overrides).toEqual({});
    answerOuting(db, "demo", "diego", id, { answer: "y", markBusy: true }, NOW);
    expect(Object.keys(loadGroup(db, "demo", "you").members.find((m) => m.id === "diego")!.overrides)).toHaveLength(4);
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
    expect(status(() => answerOuting(db, "demo", "you", id, { answer: "y" }, NOW + 20 * 86_400_000))).toBe(400);
  });

  it("never reaches an outing of another group", () => {
    const db = fresh();
    const other = createGroup(db, { groupName: "Other", name: "Zed" });
    const id = "theirs";
    db.prepare(`INSERT INTO outing (id, group_id, title, start_q, end_q) VALUES (?, ?, 'x', ?, ?)`).run(id, other.groupId, Q + 100, Q + 104);
    expect(status(() => answerOuting(db, "demo", "you", id, { answer: "y" }, NOW))).toBe(404);
    expect(status(() => deleteOuting(db, "demo", "you", id))).toBe(404);
    expect(listOutings(db, other.groupId)).toHaveLength(1);
  });
});
