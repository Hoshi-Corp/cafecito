import { useSyncExternalStore } from "react";
import type { Group, Member, OverrideMark, SlotMinutes } from "./types";

// Server-backed store. The UI edits a local copy right away and each change is sent as a
// per-member write (see docs/ARCHITECTURE.md); a failed write reloads the group from the server.
// Writes go to the member the server signed this browser in as, never to another's row.
const GROUP_ID = "demo";
const BASE = `/api/groups/${GROUP_ID}`;

let current: Group | null = null;
let loading = false;
let failures = 0;
let failed = false;
const MAX_LOAD_TRIES = 3;
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function set(next: Group) {
  current = next;
  listeners.forEach((l) => l());
}

async function load() {
  loading = true;
  try {
    const res = await fetch(BASE, { cache: "no-store" });
    if (!res.ok) throw new Error(`GET: ${res.status}`);
    failures = 0;
    set(await res.json());
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

/** Sends one write after the previous one, so changes land in the order they were made. */
function send(path: string, method: "PATCH" | "POST", body: unknown) {
  queue = queue
    .then(async () => {
      const res = await fetch(BASE + path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
    })
    .catch((e) => {
      console.error("Change not saved, reloading", e);
      return load();
    });
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

/** True once the first load has failed every try; `retryLoad` starts over. */
export function useLoadFailed(): boolean {
  return useSyncExternalStore(subscribe, () => failed, () => false);
}

export function retryLoad() {
  failures = 0;
  failed = false;
  listeners.forEach((l) => l());
  load();
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

/** Placeholder until real sessions (0.4): act as another member of the group. */
export async function signInAs(memberId: string) {
  await queue;
  const res = await fetch(`${BASE}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberId }),
  });
  if (res.ok) await load();
}
