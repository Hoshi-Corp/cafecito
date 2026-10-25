import { useSyncExternalStore } from "react";
import type { Group, GroupEvent, Member, OverrideChange, OverrideMark, PlaceFields, Rsvp, SlotMinutes } from "./types";

// Server-backed store. The UI edits a local copy right away and each change is sent as a
// per-member write (see docs/ARCHITECTURE.md); a failed write reloads the group from the server.
// Writes go to the member the session cookie belongs to, never to another's row. "me" is the caller's own group.
// Other people's changes arrive over Server-Sent Events and are applied without a reload.
const BASE = "/api/groups/me";

let current: Group | null = null;
let loading = false;
let failures = 0;
let failed = false;
let signedOut = false;
let recent: string | null = null;
let recentTimer: ReturnType<typeof setTimeout> | undefined;
let pending = 0;
let events: EventSource | null = null;
let connected = false;
let refusals = 0;
const MAX_LOAD_TRIES = 3;
const RECENT_MS = 8000;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function set(next: Group) {
  current = next;
  listeners.forEach((l) => l());
}

function withOverrides(m: Member, { set, remove }: OverrideChange): Member {
  const gone = new Set(remove);
  const kept = Object.entries(m.overrides).filter(([q]) => !gone.has(+q));
  return { ...m, overrides: { ...Object.fromEntries(kept), ...set } };
}

function listen() {
  if (events || typeof EventSource === "undefined") return;
  const source = (events = new EventSource(`${BASE}/events`));
  // EventSource reconnects by itself; after a drop, load again to catch what was missed.
  source.onopen = () => {
    refusals = 0;
    if (connected) load();
    connected = true;
  };
  source.onmessage = (m) => {
    const event: GroupEvent = JSON.parse(m.data);
    if (event.reload) return void load();
    // While my own writes are in flight the local copy is newer than anything the server can say about me.
    if (!current || (event.by === current.meId && pending)) return;
    const before = current.members.find((x) => x.id === event.by);
    const member = event.member ?? (before && event.overrides && withOverrides(before, event.overrides));
    if (!member) return;
    set({ ...current, members: current.members.map((x) => (x.id === member.id ? member : x)) });
    if (event.by !== current.meId) {
      recent = member.name.trim() || "Someone";
      clearTimeout(recentTimer);
      recentTimer = setTimeout(() => ((recent = null), listeners.forEach((l) => l())), RECENT_MS);
      listeners.forEach((l) => l());
    }
  };
  // A closed source was refused (e.g. signed out): do not retry in a tight loop.
  source.onerror = () => {
    if (source.readyState !== EventSource.CLOSED) return;
    events = null;
    connected = false;
    // Give up after a few refusals (e.g. a proxy blocking the stream); the next successful load tries once more.
    if (++refusals < MAX_LOAD_TRIES) setTimeout(load, 5000);
    else console.error("Live updates are unavailable; changes by others show after a reload");
  };
}

async function load() {
  loading = true;
  try {
    const res = await fetch(BASE, { cache: "no-store" });
    if (res.status === 401) {
      // No session, or the owner removed this person.
      events?.close();
      events = null;
      connected = false;
      current = null;
      signedOut = true;
      return listeners.forEach((l) => l());
    }
    if (!res.ok) throw new Error(`GET: ${res.status}`);
    failures = 0;
    signedOut = false;
    set(await res.json());
    listen();
  } catch (e) {
    console.error("Could not load the group", e);
    // Nothing else would retry: the first subscribe is the only trigger.
    if (!current) {
      if (++failures < MAX_LOAD_TRIES) setTimeout(load, 3000);
      else {
        failed = true;
        listeners.forEach((l) => l());
      }
    }
  } finally {
    loading = false;
  }
}

/**
 * Sends one write after the previous one, so changes land in the order they were made.
 * Resolves to the server's refusal message (or a generic one), or null once the write is saved.
 */
/** `read`, if given, gets the server's answer to a write that went through (a new place's id, say). */
function send(path: string, method: "PATCH" | "POST" | "PUT" | "DELETE", body?: unknown, read?: (answer: unknown) => void): Promise<string | null> {
  pending++;
  let refusal: string | null = null;
  const run = queue
    .then(async () => {
      const res = await fetch(BASE + path, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        refusal = (await res.json().catch(() => null))?.error ?? "Could not save that. Try again.";
        throw new Error(`${method} ${path}: ${res.status}`);
      }
      read?.(await res.json().catch(() => null));
    })
    .catch((e) => {
      console.error("Change not saved, reloading", e);
      refusal ??= "Could not save that. Try again.";
      return load();
    })
    .finally(() => pending--);
  queue = run;
  return run.then(() => refusal);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!current && !loading) load();
  return () => listeners.delete(listener);
}

/** Null until the first load finishes (and while rendering on the server). */
export function useGroup(): Group | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** True when there is no session for this browser (or it was removed): show the sign-in screen. */
export function useSignedOut(): boolean {
  return useSyncExternalStore(subscribe, () => signedOut, () => false);
}

/** Name of the member whose change just arrived, for a few seconds. */
export function useRecentChange(): string | null {
  return useSyncExternalStore(subscribe, () => recent, () => null);
}

/** True once the first load has failed every try; `retryLoad` starts over. */
export function useLoadFailed(): boolean {
  return useSyncExternalStore(subscribe, () => failed, () => false);
}

export function retryLoad() {
  failures = 0;
  failed = false;
  listeners.forEach((l) => l());
  return load();
}

/** Group settings. Only the owner may change them; anyone else's change is rolled back. */
export function updateGroup(patch: { slotMinutes: SlotMinutes }) {
  if (!current) return;
  set({ ...current, ...patch });
  send("", "PATCH", patch);
}

export function updateMember(id: string, change: (member: Member) => Member) {
  if (!current || id !== current.meId) return;
  const before = current.members.find((m) => m.id === id)!;
  const after = change(before);
  set({ ...current, members: current.members.map((m) => (m === before ? after : m)) });

  const profile: Partial<Pick<Member, "name" | "color" | "timeZone" | "pattern">> = {};
  for (const k of ["name", "color", "timeZone", "pattern"] as const)
    if (after[k] !== before[k]) Object.assign(profile, { [k]: after[k] });
  if (Object.keys(profile).length) send("/me", "PATCH", profile);

  const setMarks: Record<number, OverrideMark> = {};
  for (const [q, mark] of Object.entries(after.overrides)) if (before.overrides[+q] !== mark) setMarks[+q] = mark;
  const remove = Object.keys(before.overrides).map(Number).filter((q) => !(q in after.overrides));
  if (Object.keys(setMarks).length || remove.length) send("/me/overrides", "PATCH", { set: setMarks, remove });
}

// Plans and the wishlist are not painted optimistically. The server's reload event brings the new list to every browser; with
// the live stream down (say a proxy blocks it) a saved write loads the group itself. Each resolves to an error message to show, or null.
async function listWrite(...args: Parameters<typeof send>) {
  const error = await send(...args);
  if (!error && !connected) await load();
  return error;
}

export const proposeOuting = (outing: { title: string; place: string; placeId?: string; startQ: number; endQ: number }) =>
  listWrite("/outings", "POST", outing);

export const answerOuting = (id: string, answer: Rsvp, markBusy = false) =>
  listWrite(`/outings/${id}/rsvp`, "PUT", { answer, markBusy });

export const removeOuting = (id: string) => listWrite(`/outings/${id}`, "DELETE");

/** The new place's id, or why it was refused. */
export async function addPlace(place: PlaceFields): Promise<{ refused: string | null; id: string | null }> {
  let id: string | null = null;
  const refused = await listWrite("/places", "POST", place, (answer) => {
    const given = (answer as { id?: unknown } | null)?.id;
    id = typeof given === "string" ? given : null;
  });
  return { refused, id };
}

export const votePlace = (id: string, on: boolean) => listWrite(`/places/${id}/vote`, on ? "PUT" : "DELETE");

export const setBeenThere = (id: string, beenThere: boolean) => listWrite(`/places/${id}`, "PATCH", { beenThere });

export const removePlace = (id: string) => listWrite(`/places/${id}`, "DELETE");

export const archivePlace = (id: string, archived: boolean) => listWrite(`/places/${id}`, "PATCH", { archived });

export const editPlace = (id: string, fields: Partial<PlaceFields>) =>
  listWrite(`/places/${id}`, "PATCH", fields);

export const ratePlace = (id: string, stars: number) => listWrite(`/places/${id}/rating`, "PUT", { stars });

export const clearRating = (id: string) => listWrite(`/places/${id}/rating`, "DELETE");

export const addComment = (id: string, body: string) => listWrite(`/places/${id}/comments`, "POST", { body });

export const removeComment = (placeId: string, commentId: string) => listWrite(`/places/${placeId}/comments/${commentId}`, "DELETE");
