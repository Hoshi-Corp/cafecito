# Cafecito: architecture

Audience: contributors. For what is built today, see the [README](../README.md); for what comes next, see the [roadmap](ROADMAP.md); to run it, see the [deployment guide](DEPLOY.md); for the auth review, see [security](SECURITY.md).

## Purpose

Cafecito answers one question for a group of friends: **when can we all get together?** Each person marks their availability once; the group sees one overlaid calendar and a short list of best times. Anything that does not make that answer faster or more accurate is out of scope until the roadmap says otherwise.

## Concepts

| Term | Meaning |
|---|---|
| Quantum | 15 minutes. The only unit availability is stored in. |
| Slot | What the grid shows: 1, 2 or 4 quanta, set per group (15/30/60 min). A display choice, never a storage format. |
| Typical week | A member's recurring availability: 672 chars (7 days x 96 quanta, Monday 00:00 first) in the member's own wall-clock time. `f` free, `m` maybe, `.` unmarked. |
| Override | A date-specific `f`, `m` or `b` (busy), keyed by UTC quantum. Wins over the typical week. Stored as ranges, sent to the browser one key per quantum. |
| Best window | A stretch of at least an hour in the next two weeks where everyone, or (groups of 4+) all but one, is free. |

## Rules that must not break

1. **Storage is always 15 minutes.** Changing slot size must never lose data.
2. **Typical week is local wall-clock; overrides are UTC.** "Free Tuesday 6pm" survives DST; "busy on 14 Oct" is an absolute instant.
3. **A slot is free for a member only if every quantum in it is free.** One `m` makes it maybe; one unmarked quantum makes it unavailable.
4. **Every viewer sees the calendar in their own time zone.**
5. All of the above lives in `src/lib/availability.ts` and is covered by `availability.test.ts`. Change behavior there first, with a test.

## Code map

```
src/lib/types.ts          Member, Group, Outing, Place, Mark, SLOT_OPTIONS
src/lib/availability.ts   quanta math, markAt/slotMark, summarize, bestWindows, paint*
src/lib/store.ts          client store: useGroup / updateGroup / updateMember, optimistic, per-member writes, SSE listener
src/server/               SQLite (db, schema + migrations), validated own-rows-only writes, sessions and invites (groups.ts),
                          my account: devices, export, deletion, sign-in links (account.ts), in-memory pub/sub (events.ts),
                          request auth (http.ts), rate limits (limit.ts), optional email (mail.ts), plans and RSVPs (outings.ts), the wishlist (places.ts), opt-in demo data (seed.ts)
src/app/api/              groups (create), groups/[id] (+ me, me/overrides, me/sessions, invites, members, outings, places, events),
                          invites/[token] (info, join), sign-in (+ link)
src/app/join/[token]      join screen
src/app/sign-in, [token]  where a personal link (`/sign-in#token`) or an emailed one (`/sign-in/token`) lands
src/components/GroupApp   screens: typical week, dates, group heatmap, best times
src/components/Outings   propose a best time, the plans list, RSVP
src/components/Entry      create-group, join, "email me a link" and sign-in-link screens
src/components/Account    my account: recovery email, devices, export, delete
src/components/Manage     owner: invite links, remove people
src/components/WeekGrid   the paintable grid (pointer and keyboard)
```

`store.ts` is the seam. The UI uses `useGroup`, `updateGroup({ slotMinutes })`, `updateMember`, `useRecentChange` and `useSignedOut`. The caller's identity is the `cafecito_session` cookie; the URL id `me` means "my group", and write routes take no member id, so another member's row cannot be addressed.

## Target architecture (v1.0)

One Docker container, one process, one SQLite file.

- Next.js (standalone output) + `better-sqlite3`, WAL mode, database on a mounted volume.
- Live updates via Server-Sent Events. One process means in-memory pub/sub; no Redis, no WebSocket server.
- The client keeps computing the heatmap and best windows from everyone's data. The server stores, authorizes and broadcasts.
- Delivery: GitHub Actions test, build and publish the image to GHCR (see the README); `VERSION` drives releases.
- Backups: Litestream to S3-compatible storage, or a nightly `sqlite3 .backup`.

### Data model

As built (1.0). One person belongs to one group; a person in several groups waits for 1.6, which is when a `user` table (holding the recovery email) would earn its place.

```
group(id, name, slot_minutes)
member(id, group_id, name, color, time_zone, role, pattern, position, email)   -- role: owner | member; email optional, private
override(member_id, start_q, end_q, mark)                                      -- non-overlapping [start_q, end_q) ranges
invite(id, token_hash, group_id, expires_at, max_uses, uses, revoked_at)
session(token_hash, member_id, device, created_at, last_seen)                  -- deleted with the member
sign_in_link(token_hash, member_id, expires_at)                                -- single use, 30 minutes
outing(id, group_id, title, place, start_q, end_q, created_by)                 -- created_by is set to null when that member leaves
rsvp(outing_id, member_id, answer)                                             -- answer: y | m | n; deleted with the outing or the member
place(id, group_id, name, link, map_link, notes, suggested_by, been_there, created_at)  -- suggested_by is set to null when that member leaves
place_vote(place_id, member_id)                                                -- one per member and place; deleted with the place or the member
```

A write to overrides rewrites only the ranges around the change, merging equal neighbours. A daily prune deletes overrides and plans that ended more than a week ago, sessions unused for 180 days and expired sign-in links.

### API

| Call | Purpose |
|---|---|
| `POST /api/groups` | Create a group; the creator becomes owner and is signed in |
| `GET /api/groups/:id` | Group plus every member's availability (`:id` may be `me`), my recovery email, whether email sign-in is on |
| `PATCH /api/groups/:id` | Change the slot size (owner) |
| `GET /api/groups/:id/me` | Export my data (a JSON file) |
| `PATCH /api/groups/:id/me` | Change my name, color, time zone, typical week or recovery email |
| `DELETE /api/groups/:id/me` | Delete my account and data |
| `PATCH /api/groups/:id/me/overrides` | Add or remove my overrides |
| `GET`, `DELETE /api/groups/:id/me/sessions` | List my signed-in devices; sign out the others |
| `GET`, `POST /api/groups/:id/invites` | List live invites, create one (owner); the token is returned once |
| `DELETE /api/groups/:id/invites/:inviteId` | Revoke an invite (owner) |
| `DELETE /api/groups/:id/members/:memberId` | Remove a member (owner) |
| `POST /api/groups/:id/me/access-link` | Replace my personal sign-in link; the token is returned once |
| `POST /api/groups/:id/members/:memberId/access-link` | Replace a member's personal link (owner); the token is returned once |
| `GET /api/invites/:token` | What the join screen shows: group name, who is in it |
| `POST /api/invites/:token` | Join a group, creates a session; the reply carries my personal link token |
| `GET /api/sign-in` | Whether email sign-in is on |
| `POST /api/sign-in` | Email a sign-in link to a recovery address |
| `POST /api/sign-in/link` | Sign in with a personal or emailed link (token in the body, not the URL); creates a session |
| `POST /api/groups/:id/outings` | Propose a time with a title and place: it must lie inside a best-times window, at most 4 hours, up to 50 plans per group; the proposer is marked yes and busy for that time; the plans come with `GET /api/groups/:id` |
| `PUT /api/groups/:id/outings/:outingId/rsvp` | Answer yes, maybe or no; a yes may also mark the time busy for me, once |
| `DELETE /api/groups/:id/outings/:outingId` | Delete a plan (whoever proposed it, or the owner). Clears every override mark its proposer has in that time, including ones set by hand or for an overlapping plan, so they fall back to their typical week there |
| `POST /api/groups/:id/places` | Add a café or restaurant to the wishlist (name, optional website and map link, notes; http(s) links only; up to 100 places per group); the places come with `GET /api/groups/:id` |
| `PATCH /api/groups/:id/places/:placeId` | Edit the details (whoever suggested it, or the owner), or mark it as visited (anyone in the group) |
| `PUT`, `DELETE /api/groups/:id/places/:placeId/vote` | Add or take back my own "I want to go" vote |
| `DELETE /api/groups/:id/places/:placeId` | Remove a place (whoever suggested it, or the owner); its votes go with it |
| `GET /api/groups/:id/events` | SSE stream of changes |

Writes are **per member and own-rows-only**. No call replaces the whole group. The owner can also act on other members (remove them, replace their personal link), and deleting a plan adds one more: it clears its proposer's override marks for that plan's time (`deleteOuting`), so when the owner deletes someone else's plan, that member's availability changes. It only removes marks, never sets any.

### Live updates

A write that succeeds is published to the group's open streams (`events.ts`, in memory, one process). A profile change carries the member's new state and an override change carries only the marks that changed (a member's override history is never resent); clients apply either without a reload; settings changes, joins and removals carry only `reload`, and clients load the group again. The sender skips an echo of its own change while its writes are in flight, so a stale echo cannot undo a newer local edit. EventSource reconnects by itself and the client reloads on every reconnect, so a missed event is repaired. If the stream is refused three times (say a proxy blocks it), the client stops retrying until the next successful load. Removing a member closes their streams. Streams are not replayed: there is no event log, the reload is the resync.

### Auth

The invite link is the credential: opening it asks for a name and sets a session cookie. Sessions expire after 180 days unused, and a member keeps at most 50 (the least recently used is dropped first); Settings lists a member's devices and signs out the others. Email sign-in links are optional and only recover access to an existing member, so self-hosting needs no mail server. All tokens (sessions, invites, sign-in links) are random and stored hashed. Joining, invite lookups, group creation and sign-in are rate-limited per client address (`limit.ts`). The review of these paths is in [SECURITY.md](SECURITY.md).

## Design decisions and known gaps

- **Not set up.** A member with nothing marked (`isSetUp` in `availability.ts`) is left out of the heatmap and best times and listed as "not counted yet", instead of counting as busy. It is derived, not stored; the server model may store it explicitly.
- **Time zone changes.** The typical week is wall-clock, so changing zone keeps "6 pm" as 6 pm by default. Settings offers "keep the same moments", which rotates the week with `shiftPattern`. Overrides are UTC and never move.
- **Overrides travel one key per quantum.** They are stored as ranges, but the API and the client still use a mark per quantum, so a long busy stretch is a large payload. Send ranges if that ever matters.
- **`bestWindows` uses a 31-bit mask**, so groups are capped at 12; joining a full group fails with a 409 (0.4).
- **Repeated hour.** When clocks go back, the grid has one row for the hour that happens twice, so date-specific overrides can only target the first occurrence. The typical week applies to both, and selecting a best time inside the repeated hour still shows who is free (no grid highlight). Pinned by tests in `availability.test.ts`.
- **Zone offsets are cached** per zone and hour in `availability.ts` (exact: hours containing a transition fall back to a direct lookup).
- **Accessibility.** Grids are one tab stop: arrows move, Enter or Space paints or selects, Shift with an arrow paints while moving. Every cell has a label with its time and mark (or "3 of 5 free, 1 maybe"). Heatmap shades run from 30% to 80% of `--heat` over the cell, so the faintest is about 1.5:1 against an empty cell and "everyone free" (`--heat-full`) at least 2.2:1 against the next shade; neighbouring counts in a big group cannot all differ visibly, so the labels and the slot detail carry the exact numbers.
- **Privacy.** Every member sees every other member's free/maybe pattern. "Busy" never carries a reason. State this in the UI when joining.
- **Whole-group writes** are gone: `updateGroup` sends only the slot size, `updateMember` sends only changed fields and override quanta.
- **Sessions** are random 256-bit tokens in an httpOnly cookie; only the hash is stored. Their last use is recorded at most daily, which also renews the cookie.
- **Rate limits are in memory** and keyed on the last `X-Forwarded-For` entry, which is trustworthy behind exactly one reverse proxy (the documented setup).
- **Recovery emails are not verified** when set; a link goes to whoever reads that mailbox. Setting someone else's address only lets them into your own account.
- **Create group is open** to anyone who can reach the server (rate-limited). The deployment guide shows how to close it in the proxy; an "allow new groups" switch is not built.
- **Demo mode** (`CAFECITO_DEMO=1`) seeds sessions with public tokens. Development only.
- **Next.js version.** `AGENTS.md` warns this Next.js differs from common knowledge; read `node_modules/next/dist/docs/` before touching routing, caching or the standalone build.
