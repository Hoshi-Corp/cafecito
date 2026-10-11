import { getDb } from "@/server/db";
import { spendSignInLink } from "@/server/account";
import { device, failure, json, setSessionCookie } from "@/server/http";
import { MINUTE, clientIp, limit } from "@/server/limit";

/**
 * Spends a sign-in link. A POST from the page's button, so mail scanners that open links cannot use it up; JSON only,
 * so another site's form cannot sign a visitor in to an account of its choosing.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sign-in/[token]">) {
  try {
    limit(`sign-in-link:${clientIp(req)}`, 10, 15 * MINUTE);
    await json(req);
    await setSessionCookie(spendSignInLink(getDb(), (await ctx.params).token, device(req)));
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
