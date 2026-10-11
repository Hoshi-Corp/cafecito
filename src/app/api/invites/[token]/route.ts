import { getDb } from "@/server/db";
import { publish } from "@/server/events";
import { inviteInfo, joinGroup } from "@/server/groups";
import { failure, json, setSessionCookie } from "@/server/http";

export async function GET(_req: Request, ctx: RouteContext<"/api/invites/[token]">) {
  try {
    return Response.json(inviteInfo(getDb(), (await ctx.params).token));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request, ctx: RouteContext<"/api/invites/[token]">) {
  try {
    const body = await json(req);
    const { groupId, memberId, token } = joinGroup(getDb(), (await ctx.params).token, body);
    await setSessionCookie(token);
    publish(groupId, { by: memberId, reload: true });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
