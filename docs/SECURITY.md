# Cafecito: security review of auth and write paths

Audience: contributors and people running an instance. Reviewed for the 1.0 release on 2026-10-11, against the 1.0 code; the 1.1 additions (plans and the wishlist) were reviewed as they were built, see the "Plans" and "Wishlist" rows. Re-review when a route, the session model or the schema changes.

## Threat model

A small group of friends on a self-hosted instance. In scope: someone on the internet without a session, a member trying to read or change what is not theirs, a malicious website a member visits, and a stolen or lost device. Out of scope: whoever runs the server (they have the database file) and an attacker who already controls a member's browser.

## What was checked

| Area | How it works | Verdict |
|---|---|---|
| Identity | A random 256-bit token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` when `CAFECITO_URL` is HTTPS). Only its SHA-256 hash is stored. Sessions expire after 180 days unused. | OK |
| Own-rows-only writes | Every write route resolves the member from the cookie (`authenticate`); no route takes a member id for "me". The URL group must be the session's group or `me`. Owner actions on other members are listed below; deleting a plan, which clears its proposer's marks, is covered under Plans. | OK |
| Owner actions | Slot size, invites, removing people: `assertOwner` on the session's member, and the target row is matched by `group_id` too, so another group's invite or member cannot be addressed. | OK |
| Cross-site requests | Writes with a body require `application/json` (a cross-site form cannot send it). `DELETE` needs a CORS preflight, which the server never grants, and `SameSite=Lax` keeps the cookie off cross-site subrequests anyway. A cross-site `GET` of the export cannot be read by the other site. | OK |
| Login CSRF | Joining and spending a sign-in link are JSON-only POSTs, so another site cannot sign a visitor in to an account of its choosing. | Fixed in this review (the sign-in link POST accepted any body) |
| Invite links | 192-bit tokens, stored hashed, expiring, revocable, with an optional use limit; the join is one transaction with the group cap. Lookups and joins are limited to 30 per 15 minutes per address. | OK |
| Personal link | One per member (`member.access_hash`): 192-bit, stored hashed, shown once at join, reusable until the member or the owner replaces it. The link keeps its token after a `#` (`/sign-in#token`), which browsers never send, and the page posts it in a JSON body, so it stays out of proxy and server logs. Opened through the same click-to-sign-in POST and rate limit as emailed links, so a scanner or another site cannot use it. Removing or deleting the member deletes it. | OK; see the owner note below |
| Email sign-in | Off unless SMTP is configured. Links: 256-bit, hashed, single use, 30 minutes, spent by a click (POST) so mail scanners cannot use them. The link's host comes from `CAFECITO_URL`, never from the request's `Host` header. The request answers the same, and the email is sent in the background, whether or not the address is known. Limited to 5 requests per 15 minutes per client address, 3 per hour per address as typed (variants such as `name+1@` count separately, so this does not bound one inbox) and 20 per hour for the whole server. Addresses with separators such as `,` or `<` are refused, so a mail goes only to the address that was stored. | OK |
| Recovery email privacy | Returned only to its owner (`Group.email`), never inside `members`, the invite screen or live events. | OK |
| Device list | "Sign out other devices" deletes the other sessions and closes their live streams; the current one stays. A member keeps at most 50 sessions: starting another drops the least recently used, whose open live stream closes only when it next reconnects. | OK |
| Account deletion | Deletes the member's row, which cascades to availability, sessions, sign-in links, plan answers, wishlist votes, ratings and comments; closes their streams; the plans and places they suggested stay in the group without an author; ownership passes to the earliest member, or the group with its invites, plans and wishlist goes when nobody is left. | OK |
| Live updates | Each stream is authenticated when opened. Removed members, deleted accounts and signed-out devices have their streams closed. Events carry only what other members may already see. | OK |
| Input validation | Names, colors, time zones (must be usable by the availability code), patterns, emails, slot sizes, invite settings and override marks are checked on the server; up to 2,000 overrides per request. | OK |
| Plans (outings) | The member and group come from the cookie. An outing is looked up by id and the session's group, so another group's plan cannot be answered or deleted. An RSVP is always the caller's own row. A plan may point at a wishlist place; the place id is looked up in the session's group, so another group's place cannot be attached. Proposing marks the proposer's own time busy. Delete: whoever proposed it or the owner, and it clears the proposer's override marks for that time (all of them in the range, including hand-made ones and ones for an overlapping plan). This is the only owner action that changes another member's availability: when the owner deletes a plan, the proposer's marks change. It can only remove marks inside that plan's time range, never set any or touch other times. Title, place, time range (at most 4 hours, inside a window where the group is free) and answer are validated; at most 50 plans per group. | OK |
| Wishlist (places) | The member and group come from the cookie; a place is looked up by id and the session's group, so another group's place cannot be voted on, edited or deleted. A vote is always the caller's own row. Details: the suggester or the owner; "been there": any member. Links must parse as `http:` or `https:`, so a `javascript:` or `data:` link can never become a clickable `href`, and they are stored as parsed (so `http:cafe.example` becomes `http://cafe.example/`, not a relative link); they are only shown as text or `rel="noopener"` links to people already in the group. Name, notes and links have length limits; at most 100 places per group. Ratings (1 to 5) and comments (up to 500 characters, 300 per group) are the caller's own rows; a comment is deleted by its author or the owner, looked up by place and group. Comments render as plain text. | OK |
| Secrets in the repo | None. The demo tokens are public by design and only exist with `CAFECITO_DEMO=1`. | OK |

Tests for these rules: `src/server/groups.test.ts`, `account.test.ts`, `outings.test.ts`, `places.test.ts` and `routes.test.ts`.

## Known limits

- **Rate limits trust the last `X-Forwarded-For` entry.** That is right behind exactly one reverse proxy (the documented setup). With no proxy, a client can fake the header and dodge the limits, so port 4174 must not face the internet directly. Limits live in memory and reset on restart.
- **Override times are not bounded.** A member can store marks far in the past or future; past ones are pruned daily, future ones stay. Every viewer receives them, so a hostile member could make the group page heavy. Members are invited, and the owner can remove them.
- **No request body size limit in the app.** Put one in the proxy if that matters (Caddy: `request_body { max_size 1MB }`).
- **Creating a group is open** to anyone who reaches the server (5 per hour per address). The [deployment guide](DEPLOY.md#limit-who-can-create-groups) shows how to close it in the proxy.
- **The owner can sign in as a member.** Replacing a member's personal link shows the owner the new one, so the owner could use it. The member's old link and devices keep working until they notice, and the owner could always remove them; treat the owner as trusted, as for invites.
- **A personal link is a password.** Anyone who sees it (chat history, a shared screen, browser history) can sign in until it is replaced. The token is after the `#`, so it never reaches a server log or another site.
- **Small timing difference in email sign-in.** When the address is known, the request also stores a link before answering (a single database insert).
- **Whoever reads the recovery mailbox can sign in.** Addresses are not verified when they are set. Setting someone else's address only lets them into your own account.
- **The server can be made to email strangers.** Because addresses are not verified and creating a group is open, anyone can set a stranger's address and ask for links to it. A server-wide cap of 20 sign-in requests an hour bounds this, so the mail provider is not flooded; the same cap means a flood can delay a real recovery by up to an hour. Confirming an address before saving it would close this fully.

## Reporting a problem

Open a private security advisory on the GitHub repository (Security → Advisories), not a public issue.
