# Cafecito: roadmap

Status as of 2026-10-11. Dates are intentionally absent: each release ships when its exit criteria are met. See [architecture](ARCHITECTURE.md) for the design behind it.

## Released

**0.1 Demo calendar.** Mobile-first Next.js app on browser-local demo data. Typical week, date overrides, group heatmap, who-is-free list, best times, per-person time zones, 15/30/60-minute slots.

## Next

### 0.2 Fix the model (no new features)
Make the data model safe to share before sharing it.
- ~~"Not set up" state~~ done early: members with nothing marked are excluded from "everyone free" and listed as not counted. The server model decides whether to store it.
- Store overrides as ranges; drop overrides in the past.
- Cap group size (12) and fail clearly, instead of the 31-member bit-mask limit.
- Tests for each, in `availability.test.ts`.

Exit: all tests pass; remaining items above are done.

### 0.3 Shared storage
- SQLite via `better-sqlite3`; schema and migrations in the repo.
- Per-member write API (see architecture); the server rejects writes to other members' rows.
- A server-backed `store.ts` exporting `useGroup`, `updateGroup` and `updateMember`; remove the Reset button and `resetDemo`/`parseGroup`.
- Add the `/data` volume for the SQLite file to `docker-compose.yml` (the Dockerfile, compose file and release workflow already exist), plus backup instructions.

Exit: two browsers on two accounts see each other's changes after reload; `docker run` works from a clean machine; restore-from-backup tested once.

### 0.4 Groups and invites
- Create a group; owner generates, lists and revokes invite links (expiring, optional use limit).
- Join by link: choose a name, color and time zone; session cookie.
- Owner can remove a member and change the slot size.
- Join screen states what other members can see.

Exit: a new person can go from invite link to filled-in week in under two minutes on a phone.

### 0.5 Live updates
- SSE stream per group; clients apply the changed member without a reload.
- Optimistic painting with rollback on a failed write.
- "Updated by Camille" hint on recent changes.

Exit: a change made on one device appears on another within about a second; a dropped connection reconnects and resyncs.

### 1.0 Self-hosted release
- Optional email magic-link recovery when SMTP is configured; the app works fully without it.
- Rate limiting on join and sign-in; session list with "sign out other devices".
- Export my data; delete my account and data.
- Deployment guide, upgrade notes, backup and restore runbook.
- Accessibility pass (keyboard painting, screen-reader labels for slots, contrast of heatmap shades).

Exit: a non-developer friend can run it from the guide; security review of auth and write paths done.

## Possible future releases

Ordered by how directly they help the core question. None is committed.

### 1.1 Calendar sync (read-only)
Import a Google/Apple/Outlook calendar through its private ICS URL and mark busy time automatically. Kept as a **separate layer** from overrides, so a sync never overwrites a manual "free". Refresh on a schedule; the user can hide individual events. Risk: ICS recurrence and time-zone quirks; test with real exports.

### 1.2 Turn a slot into an event
Pick a best window, propose it with a title and place; members RSVP yes/maybe/no. A "yes" can auto-mark that time as busy for that person. Gives the calendar an outcome instead of just a view.

### 1.3 Notifications
"A new window where everyone is free appeared", "Camille proposed Saturday 10:00", weekly reminder to refresh your week. Web push first; email only if SMTP exists. Every notification type individually mutable.

### 1.4 Café and restaurant wishlist
A shared list per group: name, link, notes, who suggested it, votes, "been there" flag. Optionally attach a place to an event (1.2). No maps dependency in the first version; a link is enough.

### 1.5 Smarter suggestions
Rank windows by preference as well as headcount: preferred days or times per member, minimum and maximum duration, travel buffer, and "not two outings in the same week". Still explainable: each suggestion says why it ranked where it did.

### 1.6 Multiple groups per person
One account in several groups (climbing friends, old coworkers) with a group switcher, and a personal typical week that can be shared across groups or set per group.

### 2.0 Federation or hosted option (only if there is demand)
A hosted instance for people who cannot self-host, with accounts that need email. Changes the privacy and operations story substantially; decide deliberately, not by drift.

### Parking lot
Recurring events, availability by location/place rather than only time, public read-only share link, ICS export of events, import from poll tools, localization (Spanish first, given the name), native wrapper (PWA install first).

## What would change this plan
- If fewer than half the members fill in their week after joining, prioritize onboarding (prefilled templates like "weekday evenings") over 1.1 to 1.4.
- If email is available on most deployments, move magic-link sign-in ahead of 0.5.
- If groups regularly exceed 12 people, replace the bit-mask in `bestWindows` before raising the cap.
