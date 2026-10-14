import webpush from "web-push";
import type { Db } from "./db";
import { HttpError, isObject } from "./groups";

// Web push: which devices want notifications. Nothing is sent from here yet.

// shortcut: a member's sixth device silently replaces their oldest; add a "devices" list to Settings if that confuses anyone.
export const MAX_DEVICES = 5;

/** The server's public VAPID key, which browsers need to subscribe. The pair is made on first use and kept in the database. */
export function publicKey(db: Db) {
  const stored = () => (db.prepare(`SELECT public_key FROM push_key`).get() as { public_key: string } | undefined)?.public_key;
  const existing = stored();
  if (existing) return existing;
  const pair = webpush.generateVAPIDKeys();
  // OR IGNORE: if two first requests race, the first pair stays and the second reads it back.
  db.prepare(`INSERT OR IGNORE INTO push_key (id, public_key, private_key) VALUES (1, ?, ?)`).run(pair.publicKey, pair.privateKey);
  return stored()!;
}

/** Is this device (session) subscribed? */
export const pushState = (db: Db, tokenHash: string) => ({
  publicKey: publicKey(db),
  subscribed: db.prepare(`SELECT 1 FROM push_subscription WHERE token_hash = ?`).get(tokenHash) !== undefined,
});

// shortcut: key length is capped at 200 characters (real keys are under 90); loosen if a browser ever sends longer ones.
const BASE64URL = /^[A-Za-z0-9_-]{1,200}$/;
const isHttps = (s: string) => {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
};

/** Turns notifications on for this device. A device is one session: subscribing again replaces its earlier subscription. */
export function subscribePush(db: Db, memberId: string, tokenHash: string, body: unknown, now = Date.now()) {
  const sub = isObject(body) ? body : {};
  const keys = isObject(sub.keys) ? sub.keys : {};
  const { endpoint } = sub;
  const { p256dh, auth } = keys;
  if (
    typeof endpoint !== "string" || endpoint.length > 2048 || !isHttps(endpoint) ||
    typeof p256dh !== "string" || !BASE64URL.test(p256dh) ||
    typeof auth !== "string" || !BASE64URL.test(auth)
  )
    throw new HttpError(400, "Invalid subscription");
  db.transaction(() => {
    // The endpoint is a secret only that browser knows, so a row for it is replaced whoever held it before.
    db.prepare(`DELETE FROM push_subscription WHERE token_hash = ? OR endpoint = ?`).run(tokenHash, endpoint);
    db.prepare(
      `INSERT INTO push_subscription (endpoint, token_hash, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(endpoint, tokenHash, memberId, p256dh, auth, now);
    db.prepare(
      `DELETE FROM push_subscription WHERE member_id = @m AND endpoint NOT IN
         (SELECT endpoint FROM push_subscription WHERE member_id = @m ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_DEVICES})`,
    ).run({ m: memberId });
  })();
}

/** Turns notifications off for this device. */
export const unsubscribePush = (db: Db, tokenHash: string) =>
  void db.prepare(`DELETE FROM push_subscription WHERE token_hash = ?`).run(tokenHash);
