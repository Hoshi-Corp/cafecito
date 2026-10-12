import { getDb } from "@/server/db";
import { spendSignInLink } from "@/server/account";
import { HttpError } from "@/server/groups";
import { device, failure, json, setSessionCookie } from "@/server/http";
import { MINUTE, clientIp, limit } from "@/server/limit";

/**
 * Signs this device in with a personal or emailed link. The token comes in the body, not the URL, so it stays out of
 * proxy logs. A POST from the page's button, so mail scanners that open links cannot use up an emailed one; JSON
 * only, so another site's form cannot sign a visitor in to an account of its choosing.
 */
export async function POST(req: Request) {
  try {
    limit(`sign-in-link:${clientIp(req)}`, 10, 15 * MINUTE);
    const token = ((await json(req)) as { token?: unknown } | null)?.token;
    if (typeof token !== "string" || !token) throw new HttpError(400, "This sign-in link is incomplete");
    await setSessionCookie(spendSignInLink(getDb(), token, device(req)));
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
