import { getDb } from "@/server/db";
import { createSignInLinks } from "@/server/account";
import { HttpError, normalizeEmail } from "@/server/groups";
import { failure, json } from "@/server/http";
import { MINUTE, clientIp, limit } from "@/server/limit";
import { mailSignInLinks, recoveryEnabled } from "@/server/mail";

/** Whether the sign-in screen offers "email me a link". */
export const GET = () => Response.json({ enabled: recoveryEnabled() });

/** Emails a sign-in link to whoever set this recovery address. The answer is the same whether anyone did. */
export async function POST(req: Request) {
  try {
    if (!recoveryEnabled()) throw new HttpError(404, "Email sign-in is not set up on this server");
    limit(`sign-in:${clientIp(req)}`, 5, 15 * MINUTE);
    const email = normalizeEmail(((await json(req)) as { email?: unknown } | null)?.email ?? "");
    if (!email) throw new HttpError(400, "Enter your email address");
    limit(`sign-in-mail:${email}`, 3, 60 * MINUTE);
    // Recovery emails are not verified, so this caps what strangers can make the server send. Counted for every
    // valid request, not only those that send mail, so a refusal says nothing about the address either.
    limit("sign-in-mail", 20, 60 * MINUTE);
    const links = createSignInLinks(getDb(), email);
    // Sent in the background, so neither the answer nor its timing says whether the address is known.
    if (links.length) mailSignInLinks(email, links).catch((e) => console.error("Could not send the sign-in email", e));
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
