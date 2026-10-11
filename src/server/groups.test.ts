import { describe, expect, it } from "vitest";
import { EMPTY_PATTERN } from "../lib/availability";
import { openDb } from "./db";
import { HttpError, loadGroup, patchOverrides, resolveMe, updateGroup, updateMe } from "./groups";

const fresh = () => openDb(":memory:");
const status = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
  return 0;
};

describe("shared storage", () => {
  it("seeds a group once and keeps it across reopen", () => {
    const db = fresh();
    expect(loadGroup(db, "demo", "you").members.map((m) => m.id)).toEqual(["you", "camille", "diego", "sofia", "kenji"]);
    expect(db.prepare(`SELECT count(*) n FROM "group"`).get()).toEqual({ n: 1 });
  });

  it("only ever writes the caller's own row", () => {
    const db = fresh();
    updateMe(db, "camille", { name: "Cam", timeZone: "Europe/Paris" });
    patchOverrides(db, "camille", { set: { 100: "b", 101: "f" }, remove: [] });
    const g = loadGroup(db, "demo", "camille");
    const [cam, diego] = [g.members.find((m) => m.id === "camille")!, g.members.find((m) => m.id === "diego")!];
    expect(cam).toMatchObject({ name: "Cam", timeZone: "Europe/Paris", overrides: { 100: "b", 101: "f" } });
    expect(diego).toMatchObject({ name: "Diego", timeZone: "America/Toronto", overrides: {} });
    patchOverrides(db, "camille", { set: {}, remove: [100] });
    expect(loadGroup(db, "demo", "camille").members[1].overrides).toEqual({ 101: "f" });
  });

  it("identifies the caller by cookie, falling back to the first member", () => {
    const db = fresh();
    expect(resolveMe(db, "demo", "diego")).toBe("diego");
    expect(resolveMe(db, "demo", "nobody")).toBe("you");
    expect(resolveMe(db, "demo", undefined)).toBe("you");
    expect(status(() => resolveMe(db, "missing", undefined))).toBe(404);
  });

  it("rejects malformed writes", () => {
    const db = fresh();
    expect(status(() => updateMe(db, "you", { pattern: "ff" }))).toBe(400);
    expect(status(() => updateMe(db, "you", { pattern: "x".repeat(EMPTY_PATTERN.length) }))).toBe(400);
    expect(status(() => updateMe(db, "you", { timeZone: "Mars/Base" }))).toBe(400);
    expect(status(() => updateMe(db, "you", { color: "red" }))).toBe(400);
    expect(status(() => updateMe(db, "you", null))).toBe(400);
    expect(status(() => patchOverrides(db, "you", { set: { 1.5: "f" } }))).toBe(400);
    expect(status(() => patchOverrides(db, "you", { set: { 1: "x" } }))).toBe(400);
    expect(status(() => patchOverrides(db, "you", { remove: ["1"] }))).toBe(400);
  });

  it("lets only the owner change the slot size", () => {
    const db = fresh();
    expect(status(() => updateGroup(db, "demo", "camille", { slotMinutes: 60 }))).toBe(403);
    expect(status(() => updateGroup(db, "demo", "you", { slotMinutes: 45 }))).toBe(400);
    updateGroup(db, "demo", "you", { slotMinutes: 60 });
    expect(loadGroup(db, "demo", "you").slotMinutes).toBe(60);
  });
});

describe("input limits", () => {
  it("rejects time zones that luxon accepts but the availability code cannot use", () => {
    const db = fresh();
    for (const zone of ["local", "system", "UTC+3"]) expect(status(() => updateMe(db, "you", { timeZone: zone }))).toBe(400);
    expect(status(() => updateMe(db, "you", { timeZone: "Europe/Lisbon" }))).toBe(0);
  });

  it("caps how many overrides one request may carry", () => {
    const db = fresh();
    const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [i, "f"]));
    expect(status(() => patchOverrides(db, "you", { set: many }))).toBe(400);
  });
});
