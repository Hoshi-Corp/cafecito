"use client";

import { useState } from "react";
import { addPlace, editPlace, removePlace, setBeenThere, votePlace } from "@/lib/store";
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
  const [editing, setEditing] = useState(false);
  const run = (write: Promise<string | null>) => write.then(setError);
  const voted = p.votes.includes(group.meId);
  const suggester = group.members.find((m) => m.id === p.suggestedBy);
  const canEdit = p.suggestedBy === group.meId || group.ownerId === group.meId;
  if (editing)
    return (
      <li className="text-sm">
        <h3 className="font-medium">Edit {p.name}</h3>
        <EditPlace place={p} onDone={() => setEditing(false)} />
      </li>
    );
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
        {canEdit && (
          <span className="flex gap-2">
            <button aria-label={`Edit ${p.name}`} className="text-xs text-muted underline" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              aria-label={`Remove ${p.name}`}
              className="text-xs text-muted underline"
              onClick={() => confirm(`Remove “${p.name}”?`) && run(removePlace(p.id))}
            >
              Remove
            </button>
          </span>
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

type Fields = { name: string; link: string; mapLink: string; notes: string };

/** The place fields with a Save button; `onSubmit` resolves to the server's refusal, or null once saved. */
function PlaceForm({
  initial,
  submitLabel,
  onSubmit,
  onDone,
}: {
  initial: Fields;
  submitLabel: string;
  onSubmit: (values: Fields) => Promise<string | null>;
  onDone: (saved: boolean) => void;
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const input = (key: keyof Fields) => ({ value: values[key], onChange: (e: { target: { value: string } }) => setValues({ ...values, [key]: e.target.value }) });
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sending) return;
        setSending(true);
        const refused = await onSubmit({ name: values.name.trim(), link: values.link.trim(), mapLink: values.mapLink.trim(), notes: values.notes });
        setSending(false);
        if (refused) return setError(refused);
        setError(null);
        onDone(true);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Name</span>
        <input className={field} maxLength={80} required pattern=".*\S.*" {...input("name")} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Website (optional)</span>
        <input className={field} type="url" maxLength={500} placeholder="https://" {...input("link")} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Map link (optional)</span>
        <input className={field} type="url" maxLength={500} placeholder="https://" {...input("mapLink")} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Notes (optional)</span>
        <textarea className={field} maxLength={500} rows={2} {...input("notes")} />
      </label>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button disabled={sending} className="rounded-md bg-foreground px-3 py-1 font-medium text-background disabled:opacity-50">
          {submitLabel}
        </button>
        <button type="button" className="rounded-md border border-line px-3 py-1" onClick={() => onDone(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const EMPTY: Fields = { name: "", link: "", mapLink: "", notes: "" };

function AddPlace() {
  // A new key after each add empties the form again.
  const [added, setAdded] = useState(0);
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer font-medium">Add a place</summary>
      <PlaceForm key={added} initial={EMPTY} submitLabel="Add" onSubmit={addPlace} onDone={(saved) => setAdded(added + (saved ? 1 : 0))} />
    </details>
  );
}

/** Saves only what changed; nothing changed means nothing is sent. */
function EditPlace({ place: p, onDone }: { place: Place; onDone: () => void }) {
  const initial = { name: p.name, link: p.link, mapLink: p.mapLink, notes: p.notes };
  return (
    <PlaceForm
      initial={initial}
      submitLabel="Save"
      onSubmit={async (values) => {
        const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== initial[k as keyof Fields]));
        return Object.keys(changed).length ? editPlace(p.id, changed) : null;
      }}
      onDone={onDone}
    />
  );
}
