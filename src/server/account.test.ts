import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUANTUM_MS, toQuantum } from "../lib/availability";
import { createSignInLinks, deleteMe, exportMe, listSessions, signOutOthers, spendSignInLink } from "./account";
import { openDb } from "./db";
import { subscribe } from "./events";
import {
  DAY_MS,
  HttpError,
  MAX_SESSIONS,
  SESSION_IDLE_MS,
  createInvite,
  hash,
  joinGroup,
  loadGroup,
  newAccessToken,
  patchOverrides,
  prune,
  reissueAccessToken,
  resolveSession,
  startSession,
  updateMe,
} from "./groups";
import { clientIp, limit } from "./limit";
import { MIGRATIONS } from "./schema";
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
const ranges = (db: ReturnType<typeof openDb>, memberId = "you") =>
  db.prepare(`SELECT start_q s, end_q e, mark FROM override WHERE member_id = ? ORDER BY start_q`).all(memberId);

describe("overrides stored as ranges", () => {
  it("merges equal neighbours, splits on a removal, and reads back one mark per quantum", () => {
    const db = fresh();
    patchOverrides(db, "you", { set: { 10: "f", 11: "f", 12: "m" } });
    patchOverrides(db, "you", { set: { 13: "m", 9: "f" } });
    expect(ranges(db)).toEqual([
      { s: 9, e: 12, mark: "f" },
      { s: 12, e: 14, mark: "m" },
    ]);
    patchOverrides(db, "you", { remove: [10], set: { 12: "b" } });
    expect(ranges(db)).toEqual([
      { s: 9, e: 10, mark: "f" },
      { s: 11, e: 12, mark: "f" },
      { s: 12, e: 13, mark: "b" },
      { s: 13, e: 14, mark: "m" },
    ]);
    expect(loadGroup(db, "demo", "you").members[0].overrides).toEqual({ 9: "f", 11: "f", 12: "b", 13: "m" });
    patchOverrides(db, "you", { remove: [9, 11, 12, 13, 500] });
    expect(ranges(db)).toEqual([]);
    expect(ranges(db, "camille")).toEqual([]); // nobody else's rows
  });

  it("converts the per-quantum rows of an older database, keeping sessions signed in", () => {
    const dir = mkdtempSync(join(tmpdir(), "cafecito-"));
    try {
      const file = join(dir, "old.db");
      const old = new Database(file);
      old.pragma("foreign_keys = ON");
      MIGRATIONS.slice(0, 2).forEach((sql) => old.exec(sql));
      old.pragma("user_version = 2");
      old.exec(`INSERT INTO "group" VALUES ('g', 'G', 30);
        INSERT INTO member VALUES ('a', 'g', 'Ana', '#000000', 'UTC', 'owner', '', 0);
        INSERT INTO session VALUES ('${hash("tok")}', 'a');`);
      const insert = old.prepare(`INSERT INTO override VALUES ('a', ?, ?)`);
      for (const [q, mark] of [[1, "f"], [2, "f"], [3, "m"], [4, "f"], [5, "f"], [7, "f"]] as const) insert.run(q, mark);
      old.close();

      const db = openDb(file);
      expect(db.pragma("user_version", { simple: true })).toBe(5);
      expect(ranges(db, "a")).toEqual([
        { s: 1, e: 3, mark: "f" },
        { s: 3, e: 4, mark: "m" },
        { s: 4, e: 6, mark: "f" },
        { s: 7, e: 8, mark: "f" },
      ]);
      expect(resolveSession(db, "tok").memberId).toBe("a");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes overrides that ended over a week ago, idle sessions and expired links", () => {
    const db = fresh();
    const now = Date.UTC(2026, 9, 11);
    const q = toQuantum(now);
    patchOverrides(db, "you", { set: { [q - 9 * 96]: "b", [q - 2 * 96]: "f", [q]: "m" } });
    startSession(db, "camille", "", "stale", now - SESSION_IDLE_MS);
    createSignInLinks(db, "nobody@x.test"); // none: no member has it
    db.prepare(`INSERT INTO sign_in_link VALUES ('h', 'you', ?)`).run(now - 1);
    prune(db, now);
    expect(ranges(db).map((r) => (r as { s: number }).s)).toEqual([q - 2 * 96, q]);
    expect(status(() => resolveSession(db, "stale", now))).toBe(401);
    expect(db.prepare(`SELECT count(*) n FROM sign_in_link`).get()).toEqual({ n: 0 });
  });
});

describe("sessions and devices", () => {
  it("expires a session left unused, and records use at most daily", () => {
    const db = fresh();
    const t0 = Date.UTC(2026, 0, 1);
    const token = startSession(db, "diego", "Firefox on macOS", undefined, t0);
    expect(resolveSession(db, token, t0 + 1000).refreshed).toBe(false);
    expect(resolveSession(db, token, t0 + 2 * DAY_MS).refreshed).toBe(true);
    expect(resolveSession(db, token, t0 + 2 * DAY_MS + 1000).refreshed).toBe(false);
    expect(status(() => resolveSession(db, token, t0 + 2 * DAY_MS + SESSION_IDLE_MS + 1))).toBe(401);
  });

  it("keeps only the most recently used sessions, never the one just made", () => {
    const db = fresh();
    const t0 = Date.UTC(2026, 0, 1);
    const phone = startSession(db, "diego", "Phone", undefined, t0);
    const unused = startSession(db, "diego", "Tablet", undefined, t0 + 1000);
    resolveSession(db, phone, t0 + 2 * DAY_MS); // the phone is used a day later, so its last use is recent
    // With the demo session, the phone and the tablet, this is one over the limit.
    const tokens = Array.from({ length: MAX_SESSIONS - 2 }, (_, i) => startSession(db, "diego", "Private window", undefined, t0 + 3 * DAY_MS + i));
    expect(status(() => resolveSession(db, unused, t0 + 3 * DAY_MS))).toBe(401); // never used again: first to go
    expect(resolveSession(db, phone, t0 + 3 * DAY_MS).memberId).toBe("diego"); // older than the others, but used more recently than the tablet
    expect(db.prepare(`SELECT count(*) n FROM session WHERE member_id = 'diego'`).get()).toEqual({ n: MAX_SESSIONS });
    expect(resolveSession(db, tokens.at(-1), t0 + 3 * DAY_MS).memberId).toBe("diego");
    expect(resolveSession(db, "demo-camille").memberId).toBe("camille"); // nobody else's
  });

  it("lists my devices and signs out the others, closing only their streams", () => {
    const db = fresh();
    const other = startSession(db, "you", "Safari on iOS");
    const mine = hash("demo-you");
    expect(listSessions(db, "you", mine)).toMatchObject([
      { device: "Demo", current: true },
      { device: "Safari on iOS", current: false },
    ]);
    const closed: string[] = [];
    subscribe("demo", { memberId: "you", session: mine, send() {}, close: () => closed.push("mine") });
    subscribe("demo", { memberId: "you", session: hash(other), send() {}, close: () => closed.push("other") });
    expect(signOutOthers(db, "demo", "you", mine)).toEqual({ signedOut: 1 });
    expect(closed).toEqual(["other"]);
    expect(status(() => resolveSession(db, other))).toBe(401);
    expect(resolveSession(db, "demo-you").memberId).toBe("you");
  });
});

describe("my data", () => {
  it("keeps the recovery email private to its owner", () => {
    const db = fresh();
    updateMe(db, "camille", { email: "  Cam@Example.org " });
    expect(loadGroup(db, "demo", "camille").email).toBe("cam@example.org");
    expect(loadGroup(db, "demo", "you").email).toBeNull();
    expect(JSON.stringify(loadGroup(db, "demo", "you"))).not.toContain("cam@");
    for (const email of ["nope", "a@b", "a,b@x.co", "<b@x.co>", 5, "x".repeat(250) + "@b.co"]) expect(status(() => updateMe(db, "camille", { email }))).toBe(400);
    updateMe(db, "camille", { email: "" });
    expect(loadGroup(db, "demo", "camille").email).toBeNull();
  });

  it("exports everything stored about me, readably", () => {
    const db = fresh();
    updateMe(db, "camille", { email: "cam@example.org" });
    const q = toQuantum(Date.UTC(2026, 9, 14, 18));
    patchOverrides(db, "camille", { set: { [q]: "b", [q + 1]: "b" } });
    const plan = db.prepare(`INSERT INTO outing (id, group_id, title, place, start_q, end_q, created_by) VALUES (?, 'demo', ?, ?, ?, ?, ?)`);
    plan.run("mine", "Brunch", "Café X", q + 8, q + 12, "camille");
    plan.run("theirs", "Hike", "", q + 20, q + 24, "diego");
    plan.run("unrelated", "Movie", "", q + 30, q + 34, "diego");
    db.prepare(`INSERT INTO rsvp (outing_id, member_id, answer) VALUES ('mine', 'camille', 'y'), ('theirs', 'camille', 'm'), ('unrelated', 'diego', 'y')`).run();
    const data = exportMe(db, "camille");
    expect(data.plans).toEqual([
      { title: "Brunch", place: "Café X", from: new Date((q + 8) * QUANTUM_MS).toISOString(), to: new Date((q + 12) * QUANTUM_MS).toISOString(), proposedByMe: true, myAnswer: "y" },
      { title: "Hike", place: "", from: new Date((q + 20) * QUANTUM_MS).toISOString(), to: new Date((q + 24) * QUANTUM_MS).toISOString(), proposedByMe: false, myAnswer: "m" },
    ]);
    expect(data).toMatchObject({
      group: "Café crew",
      name: "Camille",
      email: "cam@example.org",
      role: "member",
      timeZone: "America/Toronto",
      overrides: [{ from: "2026-10-14T18:00:00.000Z", to: new Date((q + 2) * QUANTUM_MS).toISOString(), mark: "b" }],
      devices: [{ device: "Demo" }],
    });
    expect(data.typicalWeek).toHaveLength(672);
  });

  it("deletes a member's account; an owner's group passes on, and goes when nobody is left", () => {
    const db = fresh();
    deleteMe(db, "demo", "camille");
    expect(loadGroup(db, "demo", "you").members.map((m) => m.id)).not.toContain("camille");
    expect(status(() => resolveSession(db, "demo-camille"))).toBe(401);

    const closed: string[] = [];
    subscribe("demo", { memberId: "you", send() {}, close: () => closed.push("you") });
    deleteMe(db, "demo", "you");
    expect(closed).toEqual(["you"]);
    expect(loadGroup(db, "demo", "diego").ownerId).toBe("diego"); // joined first after the owner

    createInvite(db, "demo", "diego", {});
    for (const id of ["sofia", "kenji", "diego"]) deleteMe(db, "demo", id);
    expect(db.prepare(`SELECT (SELECT count(*) FROM "group") g, (SELECT count(*) FROM invite) i, (SELECT count(*) FROM member) m`).get())
      .toEqual({ g: 0, i: 0, m: 0 });
  });
});

describe("email sign-in links", () => {
  it("makes one link per group with that address; each works once, on a new session", () => {
    const db = fresh();
    const { token: invite } = createInvite(db, "demo", "you", {});
    const other = joinGroup(db, invite, { name: "Ana 2" });
    updateMe(db, "you", { email: "ana@example.org" });
    updateMe(db, other.memberId, { email: "ana@example.org" });
    expect(createSignInLinks(db, "someone@example.org")).toEqual([]);

    const links = createSignInLinks(db, "ana@example.org", 0);
    expect(links.map((l) => l.name).sort()).toEqual(["Ana 2", "You"]);
    expect(status(() => spendSignInLink(db, links[0].token, "", 30 * 60_000))).toBe(404); // expired
    const fresher = createSignInLinks(db, "ana@example.org");
    const session = spendSignInLink(db, fresher[0].token, "Phone");
    expect(resolveSession(db, session).memberId).toBe(fresher[0].name === "You" ? "you" : other.memberId);
    expect(status(() => spendSignInLink(db, fresher[0].token))).toBe(404); // single use
    expect(status(() => spendSignInLink(db, "forged"))).toBe(404);
  });
});

describe("personal links", () => {
  it("is given on joining, signs in any device again and again, and is replaced by a new one", () => {
    const db = fresh();
    const { token: invite } = createInvite(db, "demo", "you", {});
    const { memberId, accessToken } = joinGroup(db, invite, { name: "Ana" });
    expect(db.prepare(`SELECT access_hash FROM member WHERE id = ?`).get(memberId)).toEqual({ access_hash: hash(accessToken) });
    for (const device of ["Phone", "Laptop"]) expect(resolveSession(db, spendSignInLink(db, accessToken, device)).memberId).toBe(memberId);
    const next = newAccessToken(db, memberId);
    expect(status(() => spendSignInLink(db, accessToken))).toBe(404);
    expect(resolveSession(db, spendSignInLink(db, next)).memberId).toBe(memberId);
    expect(status(() => spendSignInLink(db, "forged"))).toBe(404);
  });

  it("lets only the owner replace a member's link, and only within the group", () => {
    const db = fresh();
    const old = newAccessToken(db, "camille");
    expect(status(() => reissueAccessToken(db, "demo", "diego", "camille"))).toBe(403);
    expect(status(() => reissueAccessToken(db, "demo", "you", "nobody"))).toBe(404);
    const next = reissueAccessToken(db, "demo", "you", "camille");
    expect(status(() => spendSignInLink(db, old))).toBe(404);
    expect(resolveSession(db, spendSignInLink(db, next)).memberId).toBe("camille");
  });
});

describe("rate limits", () => {
  it("allows a burst per key and window, then refuses until the window ends", () => {
    for (let i = 0; i < 3; i++) limit("t:a", 3, 1000, 0);
    expect(status(() => limit("t:a", 3, 1000, 999))).toBe(429);
    expect(status(() => limit("t:b", 3, 1000, 999))).toBe(0);
    expect(status(() => limit("t:a", 3, 1000, 1000))).toBe(0);
  });

  it("reads the client address from the proxy's X-Forwarded-For entry", () => {
    const req = (xff?: string) => new Request("http://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });
    expect(clientIp(req("6.6.6.6, 1.2.3.4"))).toBe("1.2.3.4");
    expect(clientIp(req())).toBe("unknown");
  });
});
