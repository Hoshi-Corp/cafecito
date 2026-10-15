import { HttpError } from "./groups";

// Fixed-window counters in memory: one process, so nothing to share; a restart forgets them.
const hits = new Map<string, { count: number; resetAt: number }>();

/** Counts one attempt for `key`; past `max` within `windowMs` it throws a 429 until the window ends. */
export function limit(key: string, max: number, windowMs: number, now = Date.now()) {
  const h = hits.get(key);
  if (!h || h.resetAt <= now) {
    // Expired entries go once the map is big, so a flood of addresses cannot grow it forever.
    if (hits.size > 10_000) hits.forEach((v, k) => v.resetAt <= now && hits.delete(k));
    hits.set(key, { count: 1, resetAt: now + windowMs });
  } else if (++h.count > max) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");
}

/** Like `limit`, but answers whether the attempt is within `max` instead of throwing. */
export function withinLimit(key: string, max: number, windowMs: number, now = Date.now()) {
  try {
    limit(key, max, windowMs, now);
    return true;
  } catch (e) {
    if (e instanceof HttpError) return false;
    throw e;
  }
}

/**
 * The client's address: the last X-Forwarded-For entry, which the reverse proxy in front adds (Next.js sets it to
 * the socket address when there is no proxy). Behind more than one proxy, that is the nearest one's view.
 */
export const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "unknown";

export const MINUTE = 60_000;

/** Forgets every count. For tests, which share this module-level state. */
export const clearLimits = () => {
  if (process.env.NODE_ENV === "production") throw new Error("clearLimits is for tests");
  hits.clear();
};
