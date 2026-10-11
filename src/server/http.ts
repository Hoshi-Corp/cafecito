import { cookies } from "next/headers";
import { getDb, type Db } from "./db";
import { HttpError, resolveMe } from "./groups";

export const ME_COOKIE = "cafecito_member";

/** Runs a handler against the database and the caller's member, turning HttpError into a JSON error. */
export async function handle(
  params: Promise<{ id: string }>,
  run: (ctx: { db: Db; groupId: string; meId: string }) => unknown,
) {
  try {
    const { id: groupId } = await params;
    const db = getDb();
    const jar = await cookies();
    const meId = resolveMe(db, groupId, jar.get(ME_COOKIE)?.value);
    jar.set(ME_COOKIE, meId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return Response.json(await run({ db, groupId, meId }) ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
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
