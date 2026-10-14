"use client";

import { DateTime } from "luxon";
import { useState } from "react";
import { QUANTUM_MS } from "@/lib/availability";
import { answerOuting, proposeOuting, removeOuting } from "@/lib/store";
import type { Group, Outing, Rsvp } from "@/lib/types";

const ANSWERS: { value: Rsvp; label: string }[] = [
  { value: "y", label: "Yes" },
  { value: "m", label: "Maybe" },
  { value: "n", label: "No" },
];

// shortcut: a proposal covers at most the first 4 hours of a best window, with no time editing; add start/end fields if that is too rigid.
const MAX_PROPOSED_QUANTA = 16;

const when = (o: { startQ: number; endQ: number }, zone: string) => {
  const t = (q: number) => DateTime.fromMillis(q * QUANTUM_MS, { zone }).toLocaleString(DateTime.TIME_SIMPLE);
  const d = DateTime.fromMillis(o.startQ * QUANTUM_MS, { zone }).toLocaleString({ weekday: "short", day: "numeric", month: "short" });
  return `${d} ${t(o.startQ)}–${t(o.endQ)}`;
};

/** Form for turning a best window into an outing. */
export function ProposeForm({
  window: w,
  zone,
  onDone,
}: {
  window: { startQ: number; endQ: number };
  zone: string;
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const slot = { startQ: w.startQ, endQ: Math.min(w.endQ, w.startQ + MAX_PROPOSED_QUANTA) };
  const field = "rounded-md border border-line bg-cell px-2 py-1";
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        proposeOuting({ title: title.trim(), place, ...slot });
        onDone();
      }}
    >
      <h2 className="font-medium">Propose {when(slot, zone)}</h2>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">What</span>
        <input className={field} value={title} maxLength={80} required pattern=".*\S.*" autoFocus onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Where (optional)</span>
        <input className={field} value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <button className="rounded-md bg-foreground px-3 py-1 font-medium text-background">Propose</button>
        <button type="button" className="rounded-md border border-line px-3 py-1" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function Outings({ group, zone, now }: { group: Group; zone: string; now: number }) {
  const upcoming = (group.outings ?? []).filter((o) => o.endQ * QUANTUM_MS > now);
  if (!upcoming.length) return null;
  return (
    <section className="rounded-xl border border-line bg-card p-3">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Plans</h2>
      <ul className="flex flex-col gap-3">
        {upcoming.map((o) => (
          <OutingRow key={o.id} outing={o} group={group} zone={zone} />
        ))}
      </ul>
    </section>
  );
}

function OutingRow({ outing: o, group, zone }: { outing: Outing; group: Group; zone: string }) {
  const [markBusy, setMarkBusy] = useState(false);
  const mine = o.rsvps[group.meId];
  const names = (a: Rsvp) =>
    group.members.filter((m) => o.rsvps[m.id] === a).map((m) => m.name.trim() || "Unnamed").join(", ");
  const canDelete = o.createdBy === group.meId || group.ownerId === group.meId;
  return (
    <li className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span>
          <span className="font-medium">{o.title}</span>
          {o.place && <span className="text-muted"> · {o.place}</span>}
        </span>
        {canDelete && (
          <button className="text-xs text-muted underline" onClick={() => confirm(`Delete “${o.title}”?`) && removeOuting(o.id)}>
            Delete
          </button>
        )}
      </div>
      <span className="tabular-nums text-muted">{when(o, zone)}</span>
      <div className="flex flex-wrap items-center gap-1 text-xs" role="group" aria-label={`Your answer to ${o.title}`}>
        {ANSWERS.map((a) => (
          <button
            key={a.value}
            aria-pressed={mine === a.value}
            onClick={() => answerOuting(o.id, a.value, markBusy)}
            className={`rounded-full border px-2.5 py-1 ${mine === a.value ? "border-foreground font-medium" : "border-line text-muted"}`}
          >
            {a.label}
          </button>
        ))}
        <label className="ml-1 flex items-center gap-1 text-muted">
          <input type="checkbox" checked={markBusy} onChange={(e) => setMarkBusy(e.target.checked)} />
          Mark busy in my week when I say yes
        </label>
      </div>
      {ANSWERS.map((a) => names(a.value) && (
        <p key={a.value} className="text-xs text-muted">
          {a.label}: {names(a.value)}
        </p>
      ))}
    </li>
  );
}
