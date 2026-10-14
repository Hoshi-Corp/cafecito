"use client";

import { useEffect, useState, type FormEvent } from "react";
import { retryLoad } from "@/lib/store";
import type { Group } from "@/lib/types";
import { AccessLink, field } from "./Entry";
import { call } from "./Manage";

type Session = { device: string; createdAt: number; lastSeen: number; current: boolean };

const ME = "/api/groups/me/me";

/** The signed-in person's own account: recovery email, devices, export and deletion. */
export function Account({ group }: { group: Group }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const refresh = () =>
    fetch(`${ME}/sessions`)
      .then((res) => (res.ok ? res.json() : []))
      .then((body) => setSessions(Array.isArray(body) ? body : []))
      .catch(() => {});
  useEffect(() => void refresh(), []);

  const saveEmail = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const res = await call("/me", "PATCH", { email: new FormData(e.currentTarget).get("email") });
    setNote(res.ok ? "Recovery email saved." : ((await res.json().catch(() => null))?.error ?? "Could not save it."));
    if (res.ok) retryLoad();
  };

  const newLink = async () => {
    if (!confirm("Get a new personal link? The old one stops working, so save the new one.")) return;
    const res = await call("/me/access-link", "POST");
    if (res.ok) setAccessToken((await res.json()).accessToken);
    else setNote("Could not make a new link.");
  };

  const signOutOthers = async () => {
    await call("/me/sessions", "DELETE");
    refresh();
  };

  const others = group.members.filter((m) => m.id !== group.meId);
  const deleteMe = async () => {
    const consequence =
      group.meId !== group.ownerId
        ? ""
        : others.length
          ? ` You own this group: ${others[0].name.trim() || "the next person"} becomes its owner.`
          : " Nobody else is in this group, so it is deleted too.";
    // With nobody else left the whole group goes, so there is nothing that stays behind.
    const stays = others.length ? " Plans, wishlist places and comments you wrote stay in the group, without your name." : "";
    if (!confirm(`Delete your account? Your availability is deleted and every device is signed out.${stays}${consequence}`)) return;
    await call("/me", "DELETE");
    retryLoad();
  };

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Your account</h3>
      <div className="flex flex-col gap-1">
        <h4 className="text-xs text-muted">Personal link: opens your account on any device</h4>
        {accessToken && <AccessLink token={accessToken} />}
        <button className="self-start text-xs underline" onClick={newLink}>
          Get a new personal link
        </button>
      </div>
      {group.recovery && (
        <form onSubmit={saveEmail} className="flex flex-wrap items-end gap-2">
          <label className="flex grow flex-col gap-1 text-xs text-muted">
            Recovery email (optional, only you see it): get a sign-in link if you lose this device
            <input name="email" type="email" autoComplete="email" defaultValue={group.email ?? ""} className={field} />
          </label>
          <button className="rounded-md border border-foreground px-2.5 py-1 font-medium">Save</button>
        </form>
      )}
      {note && <p role="status" className="text-xs text-muted">{note}</p>}
      <div className="flex flex-col gap-1">
        <h4 className="text-xs text-muted">Signed-in devices</h4>
        <ul className="flex flex-col gap-0.5 text-xs">
          {sessions.map((s, i) => (
            <li key={i}>
              {s.device || "Unknown device"}
              <span className="text-muted">
                {s.current ? " · this device" : ` · last used ${new Date(s.lastSeen).toLocaleDateString()}`}
              </span>
            </li>
          ))}
        </ul>
        {sessions.length > 1 && (
          <button className="self-start text-xs underline" onClick={signOutOthers}>
            Sign out other devices
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        <a className="underline" href={ME} download>
          Export my data
        </a>
        <button className="text-danger underline" onClick={deleteMe}>
          Delete my account
        </button>
      </div>
    </div>
  );
}
