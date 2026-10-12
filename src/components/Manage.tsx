"use client";

import { useEffect, useState } from "react";
import { retryLoad } from "@/lib/store";
import type { Group } from "@/lib/types";
import { AccessLink, field } from "./Entry";

type Invite = { id: string; expiresAt: number; maxUses: number | null; uses: number };

export const call = (path: string, method: string, body?: unknown) =>
  fetch(`/api/groups/me${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Owner-only: invite links and removing people. */
export function Manage({ group }: { group: Group }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [days, setDays] = useState(7);
  const [maxUses, setMaxUses] = useState("");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reissued, setReissued] = useState<{ name: string; token: string } | null>(null);

  const refresh = async () => {
    const res = await fetch("/api/groups/me/invites");
    if (res.ok) setInvites(await res.json());
  };
  useEffect(() => {
    fetch("/api/groups/me/invites")
      .then((res) => (res.ok ? res.json() : []))
      .then(setInvites);
  }, []);

  const create = async () => {
    const res = await call("/invites", "POST", { days, maxUses: maxUses ? Number(maxUses) : null });
    const body = await res.json();
    setError(res.ok ? null : body.error);
    if (res.ok) setLink(`${location.origin}/join/${body.token}`);
    refresh();
  };
  const revoke = async (id: string) => {
    await call(`/invites/${id}`, "DELETE");
    refresh();
  };
  const remove = async (id: string, name: string) => {
    if (!confirm(`Remove ${name}? Their availability is deleted.`)) return;
    await call(`/members/${id}`, "DELETE");
    retryLoad();
  };

  const reissue = async (id: string, name: string) => {
    if (!confirm(`Make a new personal link for ${name}? Their old link stops working, and you will see the new one.`)) return;
    const res = await call(`/members/${id}/access-link`, "POST");
    if (res.ok) setReissued({ name, token: (await res.json()).accessToken });
    else setError("Could not make a new link.");
  };

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Invite people ({group.members.length}/12)</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Expires after
          <select className={field} value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 7, 30].map((d) => (
              <option key={d} value={d}>
                {d === 1 ? "1 day" : `${d} days`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Uses (optional)
          <input className={`${field} w-20`} type="number" min={1} max={12} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </label>
        <button className="rounded-md border border-foreground px-2.5 py-1 font-medium" onClick={create}>
          Create invite link
        </button>
      </div>
      {error && <p role="alert" className="text-danger">{error}</p>}
      {link && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Copy this link now; it is not shown again.
          <input readOnly className={field} value={link} onFocus={(e) => e.target.select()} />
        </label>
      )}
      {invites.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs">
          {invites.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2">
              <span className="text-muted">
                Expires {new Date(i.expiresAt).toLocaleDateString()} · used {i.uses}
                {i.maxUses ? ` of ${i.maxUses}` : ""}
              </span>
              <button className="underline" onClick={() => revoke(i.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">People</h3>
      <ul className="flex flex-col gap-1">
        {group.members
          .filter((m) => m.id !== group.ownerId)
          .map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2">
              {m.name.trim() || "Unnamed"}
              <span className="flex gap-3 text-xs">
                <button className="underline" onClick={() => reissue(m.id, m.name.trim() || "them")}>
                  New link
                </button>
                <button className="underline" onClick={() => remove(m.id, m.name)}>
                  Remove
                </button>
              </span>
            </li>
          ))}
      </ul>
      {reissued && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted">Send this to {reissued.name} privately.</p>
          <AccessLink token={reissued.token} />
        </div>
      )}
    </div>
  );
}
