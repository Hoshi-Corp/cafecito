import webpush from "web-push";
import type { Db } from "./db";
import { HttpError, isObject } from "./groups";
import { MINUTE, withinLimit } from "./limit";

// Web push: which devices want notifications, and sending to them.

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
// shortcut: only the big browsers' push services are accepted, because the server will POST to whatever address is stored
// (a member could otherwise aim it at a service on the server's own network). Add a host here for another service, such as UnifiedPush.
const PUSH_HOSTS = /^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/;
const isPushService = (s: string) => {
  try {
    const url = new URL(s);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.test(url.hostname);
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
    typeof endpoint !== "string" || endpoint.length > 2048 || !isPushService(endpoint) ||
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

type Target = { endpoint: string; tokenHash: string; p256dh: string; auth: string };
type Message = { title: string; body: string };

// Push services want a contact for the sender; the public address is the natural one (it is already required for HTTPS cookies and email).
// shortcut: without CAFECITO_URL a placeholder is used, which Apple's push service may refuse; set CAFECITO_URL.
const contact = () => (process.env.CAFECITO_URL?.startsWith("https:") ? process.env.CAFECITO_URL : "mailto:cafecito@example.invalid");
const DAY_SECONDS = 24 * 60 * 60;

/**
 * Looks up who to tell (`audience`, which returns null for nobody) and sends to every device, with no retries. A 404 or 410 means the
 * browser dropped the subscription, so that row goes; any other failure is logged by code only (the endpoint works as a secret).
 * Never throws, lookups included: a push must not fail the request that caused it.
 * shortcut: all devices are sent to at once, each with a 10 second timeout (12 members x 5 devices at most); queue them if groups grow.
 */
async function notify(db: Db, audience: () => { targets: Target[]; message: Message } | null) {
  try {
    const found = audience();
    if (!found) return;
    publicKey(db); // makes the pair if nobody has asked for it yet
    const keys = db.prepare(`SELECT public_key, private_key FROM push_key`).get() as { public_key: string; private_key: string };
    const payload = JSON.stringify(found.message);
    await Promise.all(
      found.targets.map(async (t) => {
        try {
          await webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, {
            TTL: DAY_SECONDS,
            timeout: 10_000,
            vapidDetails: { subject: contact(), publicKey: keys.public_key, privateKey: keys.private_key },
          });
        } catch (e) {
          const { statusCode, code } = e as { statusCode?: number; code?: string };
          // Keyed on the session too, so a late "gone" answer cannot delete a subscription the device has since renewed.
          if (statusCode === 404 || statusCode === 410)
            db.prepare(`DELETE FROM push_subscription WHERE endpoint = ? AND token_hash = ?`).run(t.endpoint, t.tokenHash);
          else console.error("push failed:", statusCode ?? code ?? "unknown error");
        }
      }),
    );
  } catch (e) {
    console.error("push failed:", e instanceof Error ? e.name : "unknown error");
  }
}

const NOTIFICATIONS_PER_HOUR = 10;

// shortcut: at most 10 notifications per member per hour (a proposal or a deletion each counts once, however many devices it reaches),
// so a loop of propose and delete cannot buzz everyone's phone. The plan itself still works. Counted in memory, so a restart forgets
// them. Raise the number if real use hits it.
const mayPush = (actorId: string) => {
  if (withinLimit(`push:${actorId}`, NOTIFICATIONS_PER_HOUR, 60 * MINUTE)) return true;
  // Logged once an hour, so a loop cannot flood the log.
  if (withinLimit(`push-logged:${actorId}`, 1, 60 * MINUTE))
    console.warn(`push skipped: this member already sent ${NOTIFICATIONS_PER_HOUR} notifications in the last hour`);
  return false;
};

const names = (db: Db, memberId: string) =>
  db.prepare(`SELECT m.name, g.name "group" FROM member m JOIN "group" g ON g.id = m.group_id WHERE m.id = ?`).get(memberId) as { name: string; group: string };

/**
 * Who to tell and what to say: the actor's name and the group's, never the plan (the text passes through the browser maker's server).
 * Null when there is nobody, which costs nothing from the hourly limit, or when the actor has used it up.
 */
function toTell(db: Db, actorId: string, targets: Target[], say: (name: string) => string) {
  if (!targets.length || !mayPush(actorId)) return null;
  const { name, group } = names(db, actorId);
  return { targets, message: { title: say(name), body: group } };
}

/** Tells everyone else in the group that this member proposed a plan. */
export const notifyProposed = (db: Db, groupId: string, actorId: string) =>
  notify(db, () =>
    toTell(
      db,
      actorId,
      db
        .prepare(
          `SELECT s.endpoint, s.token_hash tokenHash, s.p256dh, s.auth FROM push_subscription s JOIN member m ON m.id = s.member_id WHERE m.group_id = ? AND m.id != ?`,
        )
        .all(groupId, actorId) as Target[],
      (name) => `${name} proposed a plan`,
    ),
  );

/** Tells the members of this group who said yes (not the one deleting) that the plan is gone. */
export const notifyDeleted = (db: Db, groupId: string, actorId: string, yesMemberIds: string[]) =>
  notify(db, () => {
    const ids = yesMemberIds.filter((id) => id !== actorId);
    if (!ids.length) return null; // `IN ()` is not valid SQL, and there is nobody to tell
    return toTell(
      db,
      actorId,
      db
        .prepare(
          `SELECT s.endpoint, s.token_hash tokenHash, s.p256dh, s.auth FROM push_subscription s JOIN member m ON m.id = s.member_id
           WHERE m.group_id = ? AND s.member_id IN (${ids.map(() => "?").join(",")})`,
        )
        .all(groupId, ...ids) as Target[],
      (name) => `${name} deleted a plan you said yes to`,
    );
  });
