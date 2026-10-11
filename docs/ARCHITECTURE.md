# Cafecito: architecture

Audience: contributors. For what is built today, see the [README](../README.md); for what comes next, see the [roadmap](ROADMAP.md).

## Purpose

Cafecito answers one question for a group of friends: **when can we all get together?** Each person marks their availability once; the group sees one overlaid calendar and a short list of best times. Anything that does not make that answer faster or more accurate is out of scope until the roadmap says otherwise.

## Concepts

| Term | Meaning |
|---|---|
| Quantum | 15 minutes. The only unit availability is stored in. |
| Slot | What the grid shows: 1, 2 or 4 quanta, set per group (15/30/60 min). A display choice, never a storage format. |
| Typical week | A member's recurring availability: 672 chars (7 days x 96 quanta, Monday 00:00 first) in the member's own wall-clock time. `f` free, `m` maybe, `.` unmarked. |
| Override | A date-specific `f`, `m` or `b` (busy) for one quantum, keyed by UTC quantum. Wins over the typical week. |
| Best window | A stretch of at least an hour in the next two weeks where everyone, or (groups of 4+) all but one, is free. |

## Rules that must not break

1. **Storage is always 15 minutes.** Changing slot size must never lose data.
2. **Typical week is local wall-clock; overrides are UTC.** "Free Tuesday 6pm" survives DST; "busy on 14 Oct" is an absolute instant.
3. **A slot is free for a member only if every quantum in it is free.** One `m` makes it maybe; one unmarked quantum makes it unavailable.
4. **Every viewer sees the calendar in their own time zone.**
5. All of the above lives in `src/lib/availability.ts` and is covered by `availability.test.ts`. Change behavior there first, with a test.

## Code map

```
src/lib/types.ts          Member, Group, Mark, SLOT_OPTIONS
src/lib/availability.ts   quanta math, markAt/slotMark, summarize, bestWindows, paint*
src/lib/store.ts          client store: useGroup / updateGroup / updateMember, optimistic, per-member writes, SSE listener
src/server/               SQLite (db, schema + migrations), validated own-rows-only writes, sessions and invites (groups.ts),
                          in-memory pub/sub (events.ts), request auth (http.ts), opt-in demo data (seed.ts)
src/app/api/              groups (create), groups/[id] (+ me, me/overrides, invites, members, events), invites/[token] (info, join)
src/app/join/[token]      join screen
src/components/GroupApp   screens: typical week, dates, group heatmap, best times
src/components/Entry      create-group and join forms
src/components/Manage     owner: invite links, remove people
src/components/WeekGrid   the paintable grid
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

As built (0.4). One person belongs to one group; a person in several groups waits for 1.6.

```
group(id, name, slot_minutes)
member(id, group_id, name, color, time_zone, role, pattern, position)   -- role: owner | member
override(member_id, q, mark)                                            -- one row per quantum
invite(id, token_hash, group_id, expires_at, max_uses, uses, revoked_at)
session(token_hash, member_id)                                          -- deleted with the member
```

Planned for 1.0: `user` with an optional email for recovery, session expiry and device list, overrides as ranges.

### API

| Call | Purpose |
|---|---|
| `POST /api/groups` | Create a group; the creator becomes owner and is signed in |
| `GET /api/groups/:id` | Group plus every member's availability (`:id` may be `me`) |
| `PATCH /api/groups/:id` | Change the slot size (owner) |
| `PATCH /api/groups/:id/me` | Change my name, color, time zone or typical week |
| `PATCH /api/groups/:id/me/overrides` | Add or remove my overrides |
| `GET`, `POST /api/groups/:id/invites` | List live invites, create one (owner); the token is returned once |
| `DELETE /api/groups/:id/invites/:inviteId` | Revoke an invite (owner) |
| `DELETE /api/groups/:id/members/:memberId` | Remove a member (owner) |
| `GET /api/invites/:token` | What the join screen shows: group name, who is in it |
| `POST /api/invites/:token/join` | Join a group, creates a session |
| `GET /api/groups/:id/events` | SSE stream of changes |

Writes are **per member and own-rows-only**. No call replaces the whole group.

### Live updates

A write that succeeds is published to the group's open streams (`events.ts`, in memory, one process). A profile change carries the member's new state and an override change carries only the marks that changed (a member's override history is never resent); clients apply either without a reload; settings changes, joins and removals carry only `reload`, and clients load the group again. The sender skips an echo of its own change while its writes are in flight, so a stale echo cannot undo a newer local edit. EventSource reconnects by itself and the client reloads on every reconnect, so a missed event is repaired. If the stream is refused three times (say a proxy blocks it), the client stops retrying until the next successful load. Removing a member closes their streams. Streams are not replayed: there is no event log, the reload is the resync.

### Auth

The invite link is the credential: opening it asks for a name and sets a long-lived session cookie. Email magic links are optional and used for device recovery only, so self-hosting needs no mail server. Invite tokens are stored hashed, expire, and can be revoked by the owner.

## Design decisions and known gaps

- **Not set up.** A member with nothing marked (`isSetUp` in `availability.ts`) is left out of the heatmap and best times and listed as "not counted yet", instead of counting as busy. It is derived, not stored; the server model may store it explicitly.
- **Time zone changes.** The typical week is wall-clock, so changing zone keeps "6 pm" as 6 pm by default. Settings offers "keep the same moments", which rotates the week with `shiftPattern`. Overrides are UTC and never move.
- **Overrides are one key per quantum and never pruned.** Fix: store ranges, prune past ones (moved to 1.0).
- **`bestWindows` uses a 31-bit mask**, so groups are capped at 12; joining a full group fails with a 409 (0.4).
- **Repeated hour.** When clocks go back, the grid has one row for the hour that happens twice, so date-specific overrides can only target the first occurrence. The typical week applies to both, and selecting a best time inside the repeated hour still shows who is free (no grid highlight). Pinned by tests in `availability.test.ts`.
- **Zone offsets are cached** per zone and hour in `availability.ts` (exact: hours containing a transition fall back to a direct lookup).
- **Privacy.** Every member sees every other member's free/maybe pattern. "Busy" never carries a reason. State this in the UI when joining.
- **Whole-group writes** are gone: `updateGroup` sends only the slot size, `updateMember` sends only changed fields and override quanta.
- **Sessions** are random 256-bit tokens in an httpOnly cookie; only the hash is stored. They never expire and there is no device list or "sign out other devices" yet (1.0). There is no rate limiting on join (1.0), so an invite token is only as safe as its length (192 bits) and expiry.
- **Create group is open** to anyone who can reach the server. Put the instance behind a proxy or network rule if that matters; an owner-set "allow new groups" switch is not built.
- **Demo mode** (`CAFECITO_DEMO=1`) seeds sessions with public tokens. Development only.
- **Next.js version.** `AGENTS.md` warns this Next.js differs from common knowledge; read `node_modules/next/dist/docs/` before touching routing, caching or the standalone build.
