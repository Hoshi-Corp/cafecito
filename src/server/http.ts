import { cookies } from "next/headers";
import { userAgent } from "next/server";
import { getDb, type Db } from "./db";
import { publish } from "./events";
import type { OverrideChange } from "../lib/types";
import { HttpError, loadMember, resolveSession } from "./groups";

export const SESSION_COOKIE = "cafecito_session";

// Secure (HTTPS-only) when the public address is HTTPS, so a plain-HTTP setup on a home network still works.
export const setSessionCookie = async (token: string) =>
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.CAFECITO_URL?.startsWith("https:"),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

/** "Firefox on macOS": how a session is named in the device list. */
export function device(req: Request) {
  const { browser, os } = userAgent(req);
  return `${browser.name ?? "Browser"} on ${os.name ?? "an unknown system"}`;
}

/** The caller's session, checked against the group in the URL ("me" means the caller's own group). */
export async function authenticate(params: Promise<{ id: string }>) {
  const { id } = await params;
  const db = getDb();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const { memberId: meId, groupId, tokenHash, refreshed } = resolveSession(db, token);
  if (id !== "me" && id !== groupId) throw new HttpError(404, "No such group");
  // A session in use keeps its cookie: renewed when the server records the use (at most daily).
  if (refreshed) await setSessionCookie(token!);
  return { db, groupId, meId, tokenHash };
}

export function failure(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
}

/**
 * Runs a handler for the signed-in member, turning HttpError into a JSON error.
 * `change` tells the group's other browsers what happened: this member's profile (sent whole), their override
 * marks (the handler returns just what changed), or something bigger.
 */
export async function handle(
  params: Promise<{ id: string }>,
  run: (ctx: { db: Db; groupId: string; meId: string; tokenHash: string }) => unknown,
  change?: "member" | "overrides" | "group",
) {
  try {
    const ctx = await authenticate(params);
    const out = await run(ctx);
    if (change)
      publish(
        ctx.groupId,
        change === "member"
          ? { by: ctx.meId, member: loadMember(ctx.db, ctx.groupId, ctx.meId) }
          : change === "overrides"
            ? { by: ctx.meId, overrides: out as OverrideChange }
            : { by: ctx.meId, reload: true },
      );
    if (out instanceof Response) return out;
    // The writer already has its own override change, so it is not echoed back.
    return Response.json(change === "overrides" ? { ok: true } : (out ?? { ok: true }));
  } catch (e) {
    return failure(e);
  }
}

export async function json(request: Request): Promise<unknown> {
  // A cross-site form can only send text/plain; refusing it keeps one from changing data or identity.
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new HttpError(415, "Send JSON");
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}
