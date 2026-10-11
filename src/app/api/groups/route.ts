import { getDb } from "@/server/db";
import { createGroup } from "@/server/groups";
import { device, failure, json, setSessionCookie } from "@/server/http";
import { MINUTE, clientIp, limit } from "@/server/limit";

export async function POST(req: Request) {
  try {
    limit(`create:${clientIp(req)}`, 5, 60 * MINUTE);
    const { token } = createGroup(getDb(), await json(req), device(req));
    await setSessionCookie(token);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
