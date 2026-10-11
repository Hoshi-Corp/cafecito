import { getDb } from "@/server/db";
import { publish } from "@/server/events";
import { inviteInfo, joinGroup } from "@/server/groups";
import { device, failure, json, setSessionCookie } from "@/server/http";
import { MINUTE, clientIp, limit } from "@/server/limit";

// Looking up and using invite links share one budget per address, which slows down guessing.
const limitInvites = (req: Request) => limit(`invite:${clientIp(req)}`, 30, 15 * MINUTE);

export async function GET(req: Request, ctx: RouteContext<"/api/invites/[token]">) {
  try {
    limitInvites(req);
    return Response.json(inviteInfo(getDb(), (await ctx.params).token));
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request, ctx: RouteContext<"/api/invites/[token]">) {
  try {
    limitInvites(req);
    const body = await json(req);
    const { groupId, memberId, token } = joinGroup(getDb(), (await ctx.params).token, body, Date.now(), device(req));
    await setSessionCookie(token);
    publish(groupId, { by: memberId, reload: true });
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
