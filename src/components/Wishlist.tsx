"use client";

import { useState } from "react";
import { addPlace, removePlace, setBeenThere, votePlace } from "@/lib/store";
import type { Group, Place } from "@/lib/types";

const field = "rounded-md border border-line bg-cell px-2 py-1";

// Places still to try first, then the most wanted, then the oldest.
const order = (a: Place, b: Place) => Number(a.beenThere) - Number(b.beenThere) || b.votes.length - a.votes.length;

export function Wishlist({ group }: { group: Group }) {
  const places = [...(group.places ?? [])].sort(order);
  return (
    <section className="rounded-xl border border-line bg-card p-3">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Wishlist</h2>
      {places.length === 0 ? (
        <p className="text-sm text-muted">No places yet. Add a café or restaurant the group wants to try.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {places.map((p) => (
            <PlaceRow key={p.id} place={p} group={group} />
          ))}
        </ul>
      )}
      <AddPlace />
    </section>
  );
}

function PlaceRow({ place: p, group }: { place: Place; group: Group }) {
  const [error, setError] = useState<string | null>(null);
  const run = (write: Promise<string | null>) => write.then(setError);
  const voted = p.votes.includes(group.meId);
  const suggester = group.members.find((m) => m.id === p.suggestedBy);
  const canDelete = p.suggestedBy === group.meId || group.ownerId === group.meId;
  return (
    <li className="flex flex-col gap-1 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span>
          {p.link ? (
            <a href={p.link} target="_blank" rel="noopener noreferrer" className="font-medium underline">
              {p.name}
            </a>
          ) : (
            <span className="font-medium">{p.name}</span>
          )}
          {p.mapLink && (
            <>
              {" · "}
              <a href={p.mapLink} target="_blank" rel="noopener noreferrer" className="text-muted underline">
                Map
              </a>
            </>
          )}
        </span>
        {canDelete && (
          <button
            aria-label={`Remove ${p.name}`}
            className="text-xs text-muted underline"
            onClick={() => confirm(`Remove “${p.name}”?`) && run(removePlace(p.id))}>
            Remove
          </button>
        )}
      </div>
      {p.notes && <p className="text-muted">{p.notes}</p>}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          aria-pressed={voted}
          onClick={() => run(votePlace(p.id, !voted))}
          className={`rounded-full border px-2.5 py-1 ${voted ? "border-foreground font-medium" : "border-line text-muted"}`}
        >
          I want to go · {p.votes.length}
        </button>
        <label className="flex items-center gap-1 text-muted">
          <input type="checkbox" checked={p.beenThere} onChange={(e) => run(setBeenThere(p.id, e.target.checked))} />
          Been there
        </label>
        <span className="text-muted">Suggested by {suggester ? suggester.name.trim() || "Unnamed" : "someone who left"}</span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
}

function AddPlace() {
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [mapLink, setMapLink] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium">Add a place</summary>
      <form
        className="mt-2 flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending) return;
          setSending(true);
          const refused = await addPlace({ name: name.trim(), link: link.trim(), mapLink: mapLink.trim(), notes });
          setSending(false);
          if (refused) return setError(refused);
          setName("");
          setLink("");
          setMapLink("");
          setNotes("");
          setError(null);
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Name</span>
          <input className={field} value={name} maxLength={80} required pattern=".*\S.*" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Website (optional)</span>
          <input className={field} type="url" value={link} maxLength={500} placeholder="https://" onChange={(e) => setLink(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Map link (optional)</span>
          <input className={field} type="url" value={mapLink} maxLength={500} placeholder="https://" onChange={(e) => setMapLink(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Notes (optional)</span>
          <textarea className={field} value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <div>
          <button disabled={sending} className="rounded-md bg-foreground px-3 py-1 font-medium text-background disabled:opacity-50">
            Add
          </button>
        </div>
      </form>
    </details>
  );
}
