import { describe, expect, it } from "vitest";
import { openDb } from "./db";
import { signOutOthers } from "./account";
import { HttpError, hash, removeMember, startSession } from "./groups";
import { MAX_DEVICES, publicKey, pushState, subscribePush, unsubscribePush } from "./push";
import { seed } from "./seed";

const fresh = () => {
  const db = openDb(":memory:");
  seed(db);
  return db;
};
const sub = (n: number | string = 1) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "BPkey_-1", auth: "auth_-1" } });
const device = (db: ReturnType<typeof fresh>, member: string, token: string) => (startSession(db, member, "", token), hash(token));
const status = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? e.status : -1;
  }
  return 0;
};
const rows = (db: ReturnType<typeof fresh>) => (db.prepare(`SELECT count(*) n FROM push_subscription`).get() as { n: number }).n;

describe("push subscriptions", () => {
  it("makes the key pair once and keeps it", () => {
    const db = fresh();
    const first = publicKey(db);
    expect(first).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(publicKey(db)).toBe(first);
    expect(db.prepare(`SELECT count(*) n FROM push_key`).get()).toEqual({ n: 1 });
  });

  it("turns notifications on and off for one device only", () => {
    const db = fresh();
    const a = device(db, "you", "a");
    const b = device(db, "you", "b");
    subscribePush(db, "you", a, sub(1));
    expect(pushState(db, a).subscribed).toBe(true);
    expect(pushState(db, b).subscribed).toBe(false);
    subscribePush(db, "you", a, sub(2)); // the same device again replaces its subscription
    expect(rows(db)).toBe(1);
    unsubscribePush(db, b); // nothing to remove
    expect(rows(db)).toBe(1);
    unsubscribePush(db, a);
    expect(pushState(db, a).subscribed).toBe(false);
  });

  it("refuses a malformed subscription", () => {
    const db = fresh();
    const a = device(db, "you", "a");
    const bad = [
      null,
      {},
      { ...sub(), endpoint: "http://push.example/1" },
      { ...sub(), endpoint: "not a url" },
      { ...sub(), endpoint: `https://push.example/${"x".repeat(2100)}` },
      { endpoint: sub().endpoint },
      { ...sub(), keys: { p256dh: "has space", auth: "ok" } },
      { ...sub(), keys: { p256dh: "ok", auth: 5 } },
    ];
    for (const body of bad) expect(status(() => subscribePush(db, "you", a, body))).toBe(400);
    expect(rows(db)).toBe(0);
  });

  it("keeps the newest five devices of a member", () => {
    const db = fresh();
    for (let i = 0; i < MAX_DEVICES + 1; i++) subscribePush(db, "you", device(db, "you", `t${i}`), sub(i), 1000 + i);
    const kept = (db.prepare(`SELECT endpoint FROM push_subscription ORDER BY created_at`).all() as { endpoint: string }[]).map((r) => r.endpoint);
    expect(kept).toEqual([1, 2, 3, 4, 5].map((i) => `https://push.example/${i}`));
  });

  it("gives a browser's endpoint to whoever subscribes with it last", () => {
    const db = fresh();
    subscribePush(db, "you", device(db, "you", "a"), sub(1));
    subscribePush(db, "camille", device(db, "camille", "c"), sub(1));
    expect(db.prepare(`SELECT member_id m FROM push_subscription`).all()).toEqual([{ m: "camille" }]);
  });

  it("goes with the device's sign-out and with the member", () => {
    const db = fresh();
    const a = device(db, "you", "a");
    subscribePush(db, "you", a, sub(1));
    subscribePush(db, "you", device(db, "you", "b"), sub(2));
    subscribePush(db, "camille", device(db, "camille", "c"), sub(3));
    signOutOthers(db, "demo", "you", a);
    expect(rows(db)).toBe(2); // device b went with its session
    removeMember(db, "demo", "you", "camille");
    expect(db.prepare(`SELECT member_id m FROM push_subscription`).all()).toEqual([{ m: "you" }]);
  });
});
