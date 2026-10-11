import { cookies } from "next/headers";
import { getDb } from "@/server/db";
import { memberGroup } from "@/server/groups";
import { ME_COOKIE, json } from "@/server/http";

// Placeholder identity until invites and real sessions land (0.4): anyone can pick any member.
export async function POST(req: Request, ctx: RouteContext<"/api/groups/[id]/session">) {
  const { id } = await ctx.params;
  const body = (await json(req).catch(() => null)) as { memberId?: unknown } | null;
  const memberId = body?.memberId;
  if (typeof memberId !== "string" || memberGroup(getDb(), memberId) !== id)
    return Response.json({ error: "Unknown member" }, { status: 400 });
  (await cookies()).set(ME_COOKIE, memberId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return Response.json({ ok: true });
}
