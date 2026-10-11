import { getDb } from "@/server/db";
import { createGroup } from "@/server/groups";
import { failure, json, setSessionCookie } from "@/server/http";

export async function POST(req: Request) {
  try {
    const { token } = createGroup(getDb(), await json(req));
    await setSessionCookie(token);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
