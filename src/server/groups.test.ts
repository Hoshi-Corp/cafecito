import { describe, expect, it } from "vitest";
import { EMPTY_PATTERN } from "../lib/availability";
import { openDb } from "./db";
import { publish, subscribe } from "./events";
import {
  HttpError,
  MAX_MEMBERS,
  createGroup,
  createInvite,
  inviteInfo,
  joinGroup,
  listInvites,
  loadGroup,
  patchOverrides,
  removeMember,
  resolveSession,
  revokeInvite,
  startSession,
  updateGroup,
  updateMe,
} from "./groups";
import { seed } from "./seed";

const fresh = () => {
  const db = openDb(":memory:");
  seed(db);
  return db;
};
const profile = { name: "Zed", color: "#112233", timeZone: "Europe/Paris" };
const status = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
  return 0;
};

describe("shared storage", () => {
  it("seeds a demo group", () => {
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

  it("returns exactly the marks it changed, for the live event", () => {
    const db = fresh();
    expect(patchOverrides(db, "you", { set: { 4: "f" }, remove: [9] })).toEqual({ set: { 4: "f" }, remove: [9] });
  });

  it("caps how many overrides one request may carry", () => {
    const db = fresh();
    const many = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [i, "f"]));
    expect(status(() => patchOverrides(db, "you", { set: many }))).toBe(400);
  });
});

describe("sessions", () => {
  it("knows a member by the token, never stores it, and rejects anything else", () => {
    const db = fresh();
    expect(resolveSession(db, "demo-camille")).toEqual({ memberId: "camille", groupId: "demo" });
    const token = startSession(db, "diego");
    expect(resolveSession(db, token).memberId).toBe("diego");
    expect(db.prepare(`SELECT count(*) n FROM session WHERE token_hash = ?`).get(token)).toEqual({ n: 0 });
    expect(status(() => resolveSession(db, "nope"))).toBe(401);
    expect(status(() => resolveSession(db, undefined))).toBe(401);
  });
});

describe("groups and invites", () => {
  it("creates a group whose creator is the owner, signed in", () => {
    const db = openDb(":memory:");
    const { groupId, memberId, token } = createGroup(db, { ...profile, groupName: " Climbers " });
    expect(resolveSession(db, token)).toEqual({ memberId, groupId });
    expect(loadGroup(db, groupId, memberId)).toMatchObject({ name: "Climbers", ownerId: memberId, slotMinutes: 30 });
    expect(loadGroup(db, groupId, memberId).members[0]).toMatchObject({ name: "Zed", timeZone: "Europe/Paris" });
  });

  it("creates nothing when the details are invalid", () => {
    const db = openDb(":memory:");
    for (const body of [null, { ...profile, groupName: " " }, { ...profile, groupName: "G", name: " " }, { ...profile, groupName: "G", timeZone: "Mars/Base" }])
      expect(status(() => createGroup(db, body))).toBe(400);
    expect(db.prepare(`SELECT count(*) n FROM "group"`).get()).toEqual({ n: 0 });
    expect(db.prepare(`SELECT count(*) n FROM member`).get()).toEqual({ n: 0 });
  });

  it("lets someone join with a link until it expires, is used up or is revoked", () => {
    const db = fresh();
    const { id, token } = createInvite(db, "demo", "you", { days: 1, maxUses: 1 }, 1000);
    expect(inviteInfo(db, token, 1000)).toEqual({ groupName: "Café crew", members: ["You", "Camille", "Diego", "Sofia", "Kenji"] });
    expect(listInvites(db, "demo", "you", 1000)).toMatchObject([{ id, uses: 0, maxUses: 1 }]);

    const joined = joinGroup(db, token, profile, 1000);
    expect(resolveSession(db, joined.token).memberId).toBe(joined.memberId);
    expect(loadGroup(db, "demo", "you").members.at(-1)).toMatchObject({ name: "Zed", pattern: expect.stringMatching(/^\.+$/) });
    expect(status(() => joinGroup(db, token, profile, 1000))).toBe(404); // single use
    expect(listInvites(db, "demo", "you", 1000)).toEqual([]);

    const again = createInvite(db, "demo", "you", {}, 1000);
    expect(status(() => inviteInfo(db, again.token, 1000 + 8 * 86_400_000))).toBe(404); // expired
    revokeInvite(db, "demo", "you", again.id);
    expect(status(() => inviteInfo(db, again.token, 1000))).toBe(404);
    expect(status(() => revokeInvite(db, "demo", "you", "missing"))).toBe(404);
    expect(status(() => revokeInvite(db, "other", "you", again.id))).toBe(404);
  });

  it("leaves no trace of a join that fails validation", () => {
    const db = fresh();
    const { token } = createInvite(db, "demo", "you", {});
    expect(status(() => joinGroup(db, token, { ...profile, name: "" }))).toBe(400);
    expect(db.prepare(`SELECT uses FROM invite`).get()).toEqual({ uses: 0 });
    expect(db.prepare(`SELECT count(*) n FROM member`).get()).toEqual({ n: 5 });
  });

  it("keeps positions unique after a removal, so the order never flips", () => {
    const db = fresh();
    const { token } = createInvite(db, "demo", "you", {});
    removeMember(db, "demo", "you", "camille");
    joinGroup(db, token, profile);
    joinGroup(db, token, profile);
    const positions = (db.prepare(`SELECT position FROM member`).all() as { position: number }[]).map((r) => r.position);
    expect(new Set(positions).size).toBe(positions.length);
    expect(loadGroup(db, "demo", "you").members.at(-1)?.name).toBe("Zed");
  });

  it("caps the group at 12 people", () => {
    const db = fresh();
    const { token } = createInvite(db, "demo", "you", {});
    for (let i = 5; i < MAX_MEMBERS; i++) joinGroup(db, token, profile);
    expect(status(() => joinGroup(db, token, profile))).toBe(409);
  });

  it("limits invites to the owner and validates their settings", () => {
    const db = fresh();
    expect(status(() => createInvite(db, "demo", "camille", {}))).toBe(403);
    expect(status(() => listInvites(db, "demo", "camille"))).toBe(403);
    expect(status(() => revokeInvite(db, "demo", "camille", "x"))).toBe(403);
    for (const body of [{ days: 0 }, { days: 31 }, { days: 1.5 }, { maxUses: 0 }, { maxUses: 13 }])
      expect(status(() => createInvite(db, "demo", "you", body))).toBe(400);
    expect(status(() => createInvite(db, "demo", "you", null))).toBe(0); // defaults
  });

  it("removes a member with their data and closes their stream, but never the owner", () => {
    const db = fresh();
    const closed: string[] = [];
    const seen: unknown[] = [];
    for (const memberId of ["camille", "diego"])
      subscribe("demo", { memberId, send: (e) => seen.push([memberId, e]), close: () => closed.push(memberId) });
    patchOverrides(db, "camille", { set: { 5: "f" } });
    removeMember(db, "demo", "you", "camille");
    expect(closed).toEqual(["camille"]);
    expect(db.prepare(`SELECT count(*) n FROM override`).get()).toEqual({ n: 0 });
    expect(status(() => resolveSession(db, "demo-camille"))).toBe(401);
    expect(status(() => removeMember(db, "demo", "you", "camille"))).toBe(404);
    expect(status(() => removeMember(db, "demo", "you", "you"))).toBe(400);
    expect(status(() => removeMember(db, "demo", "diego", "sofia"))).toBe(403);
    publish("demo", { by: "you", reload: true });
    expect(seen).toContainEqual(["diego", { by: "you", reload: true }]);
  });
});
