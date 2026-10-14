import webpush from "web-push";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb } from "./db";
import { deleteMe, exportMe, signOutOthers } from "./account";
import { HttpError, createGroup, hash, removeMember, startSession } from "./groups";
import { MAX_DEVICES, notifyDeleted, notifyProposed, publicKey, pushState, subscribePush, unsubscribePush } from "./push";
import { clearLimits } from "./limit";
import { seed } from "./seed";

vi.mock("web-push", async (original) => {
  const real = await original<{ default: object }>();
  return { default: { ...real.default, sendNotification: vi.fn(async () => ({})) } };
});
const sendNotification = vi.mocked(webpush.sendNotification);
afterEach(() => {
  sendNotification.mockClear();
  sendNotification.mockReset();
  vi.restoreAllMocks();
  clearLimits(); // the hourly limit is shared by the whole file
});

const fresh = () => {
  const db = openDb(":memory:");
  seed(db);
  return db;
};
const sub = (n: number | string = 1) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: { p256dh: "BPkey_-1", auth: "auth_-1" } });
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

  it("accepts the push services of the main browsers", () => {
    const db = fresh();
    const hosts = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-par02p.notify.windows.com"];
    hosts.forEach((host, i) => subscribePush(db, "you", device(db, "you", `h${i}`), { ...sub(), endpoint: `https://${host}/x/${i}` }));
    expect(rows(db)).toBe(hosts.length);
  });

  it("refuses a malformed subscription", () => {
    const db = fresh();
    const a = device(db, "you", "a");
    const bad = [
      null,
      {},
      { ...sub(), endpoint: "http://fcm.googleapis.com/fcm/send/1" },
      { ...sub(), endpoint: "not a url" },
      // Anything but a real push service: the server will POST to this address.
      { ...sub(), endpoint: "https://internal.example/hook" },
      { ...sub(), endpoint: "https://192.168.0.1/admin" },
      { ...sub(), endpoint: "https://fcm.googleapis.com.evil.example/x" },
      { ...sub(), endpoint: "https://fcm.googleapis.com@evil.example/x" },
      { ...sub(), endpoint: "https://fcm.googleapis.com:8443/x" },
      { ...sub(), endpoint: `https://fcm.googleapis.com/${"x".repeat(2100)}` },
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
    expect(kept).toEqual([1, 2, 3, 4, 5].map((i) => `https://fcm.googleapis.com/fcm/send/${i}`));
  });

  it("gives a browser's endpoint to whoever subscribes with it last", () => {
    const db = fresh();
    subscribePush(db, "you", device(db, "you", "a"), sub(1));
    subscribePush(db, "camille", device(db, "camille", "c"), sub(1));
    expect(db.prepare(`SELECT member_id m FROM push_subscription`).all()).toEqual([{ m: "camille" }]);
  });

  it("shows in my export as a count, never as the push address", () => {
    const db = fresh();
    expect(exportMe(db, "you").notificationDevices).toBe(0);
    subscribePush(db, "you", device(db, "you", "a"), sub(1));
    subscribePush(db, "you", device(db, "you", "b"), sub(2));
    subscribePush(db, "camille", device(db, "camille", "c"), sub(3));
    const data = exportMe(db, "you");
    expect(data.notificationDevices).toBe(2);
    expect(JSON.stringify(data)).not.toContain("fcm.googleapis.com");
  });

  it("goes with the member when they delete their account", () => {
    const db = fresh();
    subscribePush(db, "camille", device(db, "camille", "c"), sub(1));
    subscribePush(db, "diego", device(db, "diego", "d"), sub(2));
    deleteMe(db, "demo", "camille");
    expect(db.prepare(`SELECT member_id m FROM push_subscription`).all()).toEqual([{ m: "diego" }]);
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

describe("sending", () => {
  const withDevices = () => {
    const db = fresh();
    const mine = device(db, "you", "a");
    subscribePush(db, "you", mine, sub("you"));
    subscribePush(db, "camille", device(db, "camille", "c1"), sub("camille1"));
    subscribePush(db, "camille", device(db, "camille", "c2"), sub("camille2"));
    subscribePush(db, "diego", device(db, "diego", "d"), sub("diego"));
    return db; // sofia and kenji have no device with notifications on
  };
  const sentTo = () => sendNotification.mock.calls.map(([s]) => (s as { endpoint: string }).endpoint.split("/").pop()).sort();

  it("tells every other member's devices that a plan was proposed, with names only", async () => {
    const db = withDevices();
    await notifyProposed(db, "demo", "you");
    expect(sentTo()).toEqual(["camille1", "camille2", "diego"]); // never the proposer's own device
    const [target, payload, options] = sendNotification.mock.calls[0] as unknown as [{ keys: object }, string, { TTL: number; vapidDetails: { publicKey: string; subject: string } }];
    expect(JSON.parse(payload)).toEqual({ title: "You proposed a plan", body: "Café crew" });
    expect(target.keys).toEqual({ p256dh: "BPkey_-1", auth: "auth_-1" });
    expect(options.TTL).toBe(86_400);
    expect(options.vapidDetails.publicKey).toBe(publicKey(db));
    expect(options.vapidDetails.subject).toMatch(/^(https:|mailto:)/);
  });

  it("tells only the members who said yes, and not the one who deleted, that a plan is gone", async () => {
    const db = withDevices();
    await notifyDeleted(db, "demo", "you", ["you", "camille", "sofia"]);
    expect(sentTo()).toEqual(["camille1", "camille2"]);
    expect(JSON.parse(sendNotification.mock.calls[0][1] as string)).toEqual({ title: "You deleted a plan you said yes to", body: "Café crew" });
    sendNotification.mockClear();
    await notifyDeleted(db, "demo", "you", []); // nobody else said yes: nothing to send
    await notifyDeleted(db, "demo", "you", ["you"]);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("never tells a member of another group, even if their id is passed in", async () => {
    const db = withDevices();
    const other = createGroup(db, { groupName: "Other", name: "Olga" });
    subscribePush(db, other.memberId, device(db, other.memberId, "o"), sub("olga"));
    await notifyDeleted(db, "demo", "you", [other.memberId]);
    expect(sendNotification).not.toHaveBeenCalled();
    await notifyProposed(db, "demo", "you");
    expect(sentTo()).not.toContain("olga");
  });

  it("does not delete a subscription that was renewed while the push to its old session was in flight", async () => {
    const db = withDevices();
    sendNotification.mockImplementation(async (s) => {
      if (!(s as { endpoint: string }).endpoint.endsWith("camille1")) return {} as never;
      subscribePush(db, "camille", device(db, "camille", "c1-new"), sub("camille1")); // the same address, now under a new session
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    });
    await notifyProposed(db, "demo", "you");
    expect(db.prepare(`SELECT count(*) n FROM push_subscription WHERE endpoint LIKE '%camille1'`).get()).toEqual({ n: 1 });
  });

  it("drops a device the push service says is gone, and only that one", async () => {
    const db = withDevices();
    sendNotification.mockImplementation(async (s) => {
      if ((s as { endpoint: string }).endpoint.endsWith("camille1")) throw Object.assign(new Error("gone"), { statusCode: 410 });
      if ((s as { endpoint: string }).endpoint.endsWith("camille2")) throw Object.assign(new Error("gone"), { statusCode: 404 });
      return {} as never;
    });
    await notifyProposed(db, "demo", "you");
    expect((db.prepare(`SELECT endpoint FROM push_subscription ORDER BY endpoint`).all() as { endpoint: string }[]).map((r) => r.endpoint.split("/").pop())).toEqual(["diego", "you"]);
  });

  it("never throws when it cannot even look up who to tell", async () => {
    const db = withDevices();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(notifyProposed(db, "demo", "nobody")).resolves.toBeUndefined(); // the actor is not a member
    await expect(notifyDeleted(db, "demo", "nobody", ["camille"])).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("stops after 10 notifications an hour from one member, so a propose and delete loop cannot buzz everyone, and says so in the log", async () => {
    const db = withDevices();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 10; i++) await notifyProposed(db, "demo", "you"); // each reaches the 3 devices of the others
    expect(sendNotification).toHaveBeenCalledTimes(10 * 3);
    sendNotification.mockClear();
    await notifyProposed(db, "demo", "you");
    await notifyDeleted(db, "demo", "you", ["camille"]);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1); // once, however many events are held back, so a loop cannot flood the log
    await notifyProposed(db, "demo", "sofia"); // someone else is not held back by it
    expect(sendNotification).toHaveBeenCalled();
  });

  it("does not use up the hourly limit when nobody has notifications on", async () => {
    const db = fresh(); // no devices
    for (let i = 0; i < 12; i++) await notifyProposed(db, "demo", "you");
    subscribePush(db, "camille", device(db, "camille", "c"), sub(1));
    await notifyProposed(db, "demo", "you");
    expect(sendNotification).toHaveBeenCalledTimes(1);
  });

  it("keeps the device and does not throw on other failures, and logs without the address", async () => {
    const db = withDevices();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sendNotification.mockRejectedValue(Object.assign(new Error("https://fcm.googleapis.com/fcm/send/secret"), { statusCode: 500 }));
    await expect(notifyProposed(db, "demo", "you")).resolves.toBeUndefined();
    expect(rows(db)).toBe(4);
    expect(log).toHaveBeenCalledWith("push failed:", 500);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});
