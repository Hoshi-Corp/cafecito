# Cafecito: roadmap

Status as of 2026-10-13. Release dates appear only once a release has shipped (see the table in the [README](../README.md)); each release ships when its exit criteria are met. See [architecture](ARCHITECTURE.md) for the design behind it.

## Released

| Release | Date |
|---|---|
| 0.1 Demo calendar | 2026-10-11 |
| 0.2 Fix the model | 2026-10-11 |
| 0.3 Shared storage | 2026-10-11 |
| 0.4 Groups and invites | 2026-10-11 (in 1.0.0) |
| 0.5 Live updates | 2026-10-11 (in 1.0.0) |
| 1.0 Self-hosted release | 2026-10-11 |

**0.1 Demo calendar.** Mobile-first Next.js app on browser-local demo data. Typical week, date overrides, group heatmap, who-is-free list, best times, per-person time zones, 15/30/60-minute slots.

**0.2 Fix the model.** Shipped the "not set up" state: members with nothing marked are excluded from "everyone free" and listed as not counted. Overrides as ranges did not ship; it moved to 1.0. The group cap (12) shipped in 0.4, where groups first grow.

**0.3 Shared storage.** SQLite through `better-sqlite3`, migrations in the repo, a per-member write API that rejects writes to other members' rows, a server-backed `store.ts`, the `/data` volume and backup instructions. Verified: `docker build` and `docker run` on a fresh volume, one backup and restore. The two-browser check was done in 0.4 (see below).

## Built, awaiting release

0.4, 0.5 and 1.0 shipped together as 1.0.0, so their sections below are history. 1.0.1 ships with the next manual release (a `patch` bump).

### 0.4 Groups and invites
- ✅ Create a group; the owner generates, lists and revokes invite links (expiring, optional use limit). Tokens are stored hashed and shown once.
- ✅ Join by link: choose a name, color and time zone; session cookie.
- ✅ Owner can remove a member (their data and sessions go with them) and change the slot size.
- ✅ Join screen states what other members can see.
- ✅ Group size capped at 12 (from 0.2).
- The 0.3 "Act as" switch and shared demo group are gone; demo data is opt-in (`CAFECITO_DEMO=1`).

Exit: a new person can go from invite link to filled-in week in under two minutes on a phone. **Not timed yet**; the flow works end to end in a real browser (create, invite, join, remove).

### 0.5 Live updates
- ✅ One SSE stream per group; a profile change is sent as the member, an override change as just the marks that changed; both apply without a reload. Settings changes, joins and removals trigger a reload.
- ✅ Optimistic painting with rollback: a refused write reloads the group.
- ✅ "Updated by Camille" hint for a few seconds after someone else's change.
- ✅ A dropped connection reconnects (EventSource) and resyncs with a reload; a removed member's stream is closed and they are signed out.

Exit: a change made on one device appears on another within about a second. Measured about 30 ms between two browser sessions on one machine; **not measured across a real network or reverse proxy**.

### 1.0 Self-hosted release
- ✅ Optional email sign-in links for recovery when SMTP is configured (`SMTP_URL`, `SMTP_FROM`, `CAFECITO_URL`); the app works fully without it. Links are single use, last 30 minutes and are spent by a click, so mail scanners cannot use them.
- ✅ Rate limiting on invite lookups, joins, group creation and sign-in; device list with "sign out other devices"; sessions expire after 180 days unused.
- ✅ Carried over from 0.2: overrides stored as ranges (migration 3 converts existing rows); a daily prune drops those that ended over a week ago.
- ✅ Export my data (JSON file); delete my account and data (an owner's group passes to the earliest member, or is deleted when nobody is left).
- ✅ [Deployment guide](DEPLOY.md) with Caddy for HTTPS, upgrade notes, backup and restore runbook. The backup script and restore steps were run against the built image.
- ✅ Accessibility pass: Shift+arrow paints while moving, grids are named and explain their keys, heatmap cells say "3 of 5 free, 1 maybe", the faintest heatmap shade went from 1.2:1 to 1.5:1 against an empty cell, the "Everyone" text from 3.3:1 to 6.5:1, and error messages got a real color.

Exit: a non-developer friend can run it from the guide (**not done yet**: the guide is written for that reader and its commands were tested, but nobody outside the project has followed it); security review of auth and write paths done ([SECURITY.md](SECURITY.md); it found and fixed one login-CSRF gap).

### 1.0.1 Personal links
- ✅ Each member gets a personal link when they join (or create a group), shown once with a copy button (and a warning if you try to leave before saving it). The token sits after a `#` (`/sign-in#token`), so it never reaches a server log. Opening it on any device signs that device in, as often as needed, until it is replaced. Stored hashed, never shown again.
- ✅ "Get a new personal link" in Settings replaces it; the owner can replace anyone's from Manage (*New link*), for people who lost theirs with no recovery email and no other device.
- ✅ Color can be changed after joining (Settings).
- Members who joined before 1.0.1 have no link until they make one in Settings or the owner does.

Exit: lose every device, open the saved link on a new one, and be back in the group with the same name, color and week. **Not tried on a real second device yet.**

## Next minor release

### 1.1 Events, notifications, wishlist and multiple groups
Brings together four features from the earlier plan. Ship order inside the release is open; the wishlist's event link and the notifications depend on events, so events come first.

#### Turn a slot into an event
Pick a best window, propose it with a title and place; members RSVP yes/maybe/no. A "yes" can auto-mark that time as busy for that person. Gives the calendar an outcome instead of just a view.

#### Notifications
"A new window where everyone is free appeared", "Camille proposed Saturday 10:00", weekly reminder to refresh your week. Web push first; email only if SMTP exists. Every notification type individually mutable.

#### Café and restaurant wishlist
A shared list per group: name, link, notes, who suggested it, votes, "been there" flag. Optionally attach a place to an event. Support for optional link to the map. List of restaurants is kept. Members can score (1-5 stars) the restaurant and add comments.

#### Multiple groups per person
One account in several groups (climbing friends, old coworkers) with a group switcher, and a personal typical week that can be shared across groups or set per group.
- **Create a new group while signed in.** Today "Create group" only appears to a browser with no session, so starting a second group means a private window and a separate identity. Add it to the group switcher: the creator becomes owner of the new group with the same account, and can carry over their typical week.
- Joining by invite link while signed in adds the group to the same account instead of starting a new one.

## Possible future releases

Ordered by how directly they help the core question. None is committed.

### 1.2 Calendar sync (read-only)
Import a Google/Apple/Outlook calendar through its private ICS URL and mark busy time automatically. Kept as a **separate layer** from overrides, so a sync never overwrites a manual "free". Refresh on a schedule; the user can hide individual events. Risk: ICS recurrence and time-zone quirks; test with real exports.

### 1.3 Smarter suggestions
Rank windows by preference as well as headcount: preferred days or times per member, minimum and maximum duration, travel buffer, and "not two outings in the same week". Still explainable: each suggestion says why it ranked where it did.

### 2.0 Federation or hosted option (only if there is demand)
A hosted instance for people who cannot self-host, with accounts that need email. Changes the privacy and operations story substantially; decide deliberately, not by drift.

### Parking lot
Recurring events, availability by location/place rather than only time, public read-only share link, ICS export of events, import from poll tools, localization (Spanish first, given the name), native wrapper (PWA install first).

## What would change this plan
- If fewer than half the members fill in their week after joining, prioritize onboarding (prefilled templates like "weekday evenings") over 1.1 and 1.2.
- If email is available on most deployments, move magic-link sign-in ahead of 0.5.
- If groups regularly exceed 12 people, replace the bit-mask in `bestWindows` before raising the cap.
