import type { GroupEvent } from "../lib/types";

type Subscriber = { memberId: string; session?: string; send: (event: GroupEvent) => void; close: () => void };

// One process, so in-memory pub/sub is enough. Survives dev hot reloads like the database does.
const g = globalThis as unknown as { cafecitoSubs?: Map<string, Set<Subscriber>> };
const subs = (): Map<string, Set<Subscriber>> => (g.cafecitoSubs ??= new Map());

export function subscribe(groupId: string, sub: Subscriber) {
  const set = subs().get(groupId) ?? subs().set(groupId, new Set()).get(groupId)!;
  set.add(sub);
  return () => void set.delete(sub);
}

export const publish = (groupId: string, event: GroupEvent) => subs().get(groupId)?.forEach((s) => s.send(event));

/** Closes every stream a member has open, e.g. after they are removed, except the one of the session `keep`. */
export const disconnect = (groupId: string, memberId: string, keep?: string) =>
  subs().get(groupId)?.forEach((s) => s.memberId === memberId && (!keep || s.session !== keep) && s.close());
