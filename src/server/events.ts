import type { GroupEvent } from "../lib/types";

type Subscriber = { memberId: string; send: (event: GroupEvent) => void; close: () => void };

// One process, so in-memory pub/sub is enough. Survives dev hot reloads like the database does.
const g = globalThis as unknown as { cafecitoSubs?: Map<string, Set<Subscriber>> };
const subs = (): Map<string, Set<Subscriber>> => (g.cafecitoSubs ??= new Map());

export function subscribe(groupId: string, sub: Subscriber) {
  const set = subs().get(groupId) ?? subs().set(groupId, new Set()).get(groupId)!;
  set.add(sub);
  return () => void set.delete(sub);
}

export const publish = (groupId: string, event: GroupEvent) => subs().get(groupId)?.forEach((s) => s.send(event));

/** Closes every stream a member has open, e.g. after they are removed. */
export const disconnect = (groupId: string, memberId: string) =>
  subs().get(groupId)?.forEach((s) => s.memberId === memberId && s.close());
