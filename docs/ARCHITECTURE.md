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
src/lib/store.ts          client store: useGroup / updateGroup / updateMember, optimistic, sends per-member writes
src/server/               SQLite (db, schema + migrations, seed) and the validated, own-rows-only writes (groups.ts)
src/app/api/groups/[id]/  GET group, PATCH group (owner), PATCH me, PATCH me/overrides, POST session (placeholder)
src/components/GroupApp   screens: typical week, dates, group heatmap, best times
src/components/WeekGrid   the paintable grid
```

`store.ts` is the seam. The UI uses `useGroup`, `updateGroup({ slotMinutes })`, `updateMember` and `signInAs`. The caller's identity is the server-set `cafecito_member` cookie (a placeholder until 0.4); write routes take no member id, so another member's row cannot be addressed.

## Target architecture (v1.0)

One Docker container, one process, one SQLite file.

- Next.js (standalone output) + `better-sqlite3`, WAL mode, database on a mounted volume.
- Live updates via Server-Sent Events. One process means in-memory pub/sub; no Redis, no WebSocket server.
- The client keeps computing the heatmap and best windows from everyone's data. The server stores, authorizes and broadcasts.
- Delivery: GitHub Actions test, build and publish the image to GHCR (see the README); `VERSION` drives releases.
- Backups: Litestream to S3-compatible storage, or a nightly `sqlite3 .backup`.

### Data model

```
user(id, email NULL, name, time_zone, color)
group(id, name, slot_minutes, created_by)
membership(group_id, user_id, role)           -- role: owner | member
availability(group_id, user_id, pattern NULL) -- NULL = not set up yet
override(group_id, user_id, start_q, end_q, mark)
invite(token_hash, group_id, expires_at, max_uses, revoked_at)
session(token_hash, user_id, expires_at)
```

### API

| Call | Purpose |
|---|---|
| `GET /api/groups/:id` | Group plus every member's availability |
| `PUT /api/groups/:id/me/pattern` | Replace my typical week |
| `PATCH /api/groups/:id/me/overrides` | Add or remove my override ranges |
| `PATCH /api/groups/:id` | Change group name or slot size (owner) |
| `POST /api/invites/:token/join` | Join a group, creates a session |
| `GET /api/groups/:id/events` | SSE stream of changes |

Writes are **per member and own-rows-only**. No call replaces the whole group.

### Auth

The invite link is the credential: opening it asks for a name and sets a long-lived session cookie. Email magic links are optional and used for device recovery only, so self-hosting needs no mail server. Invite tokens are stored hashed, expire, and can be revoked by the owner.

## Design decisions and known gaps

- **Not set up.** A member with nothing marked (`isSetUp` in `availability.ts`) is left out of the heatmap and best times and listed as "not counted yet", instead of counting as busy. It is derived, not stored; the server model may store it explicitly.
- **Time zone changes.** The typical week is wall-clock, so changing zone keeps "6 pm" as 6 pm by default. Settings offers "keep the same moments", which rotates the week with `shiftPattern`. Overrides are UTC and never move.
- **Overrides are one key per quantum and never pruned.** Fix: store ranges, prune past ones (0.2).
- **`bestWindows` uses a 31-bit mask**, so groups are capped (planned: 12) (0.2).
- **Repeated hour.** When clocks go back, the grid has one row for the hour that happens twice, so date-specific overrides can only target the first occurrence. The typical week applies to both, and selecting a best time inside the repeated hour still shows who is free (no grid highlight). Pinned by tests in `availability.test.ts`.
- **Zone offsets are cached** per zone and hour in `availability.ts` (exact: hours containing a transition fall back to a direct lookup).
- **Privacy.** Every member sees every other member's free/maybe pattern. "Busy" never carries a reason. State this in the UI when joining.
- **Whole-group writes** are gone: `updateGroup` sends only the slot size, `updateMember` sends only changed fields and override quanta.
- **Identity is a forgeable cookie** until 0.4. Anyone who can reach the server can act as any member; do not expose it publicly yet.
- **Next.js version.** `AGENTS.md` warns this Next.js differs from common knowledge; read `node_modules/next/dist/docs/` before touching routing, caching or the standalone build.
