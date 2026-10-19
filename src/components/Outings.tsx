"use client";

import { DateTime } from "luxon";
import { useState } from "react";
import { MAX_OUTING_QUANTA, QUANTUM_MS } from "@/lib/availability";
import { answerOuting, proposeOuting, removeOuting } from "@/lib/store";
import type { Group, Outing, Place, Rsvp } from "@/lib/types";
import { Arcs } from "./Brand";

const ANSWERS: { value: Rsvp; label: string }[] = [
  { value: "y", label: "Yes" },
  { value: "m", label: "Maybe" },
  { value: "n", label: "No" },
];

const when = (o: { startQ: number; endQ: number }, zone: string) => {
  const t = (q: number) => DateTime.fromMillis(q * QUANTUM_MS, { zone }).toLocaleString(DateTime.TIME_SIMPLE);
  const d = DateTime.fromMillis(o.startQ * QUANTUM_MS, { zone }).toLocaleString({ weekday: "short", day: "numeric", month: "short" });
  return `${d} ${t(o.startQ)}–${t(o.endQ)}`;
};

/** Form for turning a best window into an outing. */
export function ProposeForm({
  window: w,
  zone,
  places,
  onDone,
}: {
  window: { startQ: number; endQ: number };
  zone: string;
  places: Place[];
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [place, setPlace] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const slot = { startQ: w.startQ, endQ: Math.min(w.endQ, w.startQ + MAX_OUTING_QUANTA) };
  return (
    <form
      className="card flex flex-col gap-3 p-5 text-[15px]"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sending) return;
        setSending(true);
        const refused = await proposeOuting({ title: title.trim(), place, ...(placeId && { placeId }), ...slot });
        setSending(false);
        if (refused) setError(refused);
        else onDone();
      }}
    >
      <h2 className="round text-lg font-bold">Propose {when(slot, zone)}</h2>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted">What</span>
        <input className="field" value={title} maxLength={80} required pattern=".*\S.*" autoFocus onChange={(e) => setTitle(e.target.value)} />
      </label>
      {places.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">From the wishlist (optional)</span>
          <select
            className="field"
            value={placeId}
            onChange={(e) => {
              setPlaceId(e.target.value);
              const picked = places.find((p) => p.id === e.target.value);
              if (picked) setPlace(picked.name);
            }}
          >
            <option value="">None</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.beenThere ? " (been there)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted">Where (optional)</span>
        <input className="field" value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button disabled={sending} className="btn btn-sun">
          Propose
        </button>
        <button type="button" className="btn btn-plain" onClick={onDone}>
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
    <section>
      <h2 className="section-title">Plans</h2>
      <ul className="flex flex-col gap-4">
        {upcoming.map((o) => (
          <OutingRow key={o.id} outing={o} group={group} zone={zone} />
        ))}
      </ul>
    </section>
  );
}

function OutingRow({ outing: o, group, zone }: { outing: Outing; group: Group; zone: string }) {
  const [markBusy, setMarkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (write: Promise<string | null>) => write.then(setError);
  const mine = o.rsvps[group.meId];
  const names = (a: Rsvp) =>
    group.members.filter((m) => o.rsvps[m.id] === a).map((m) => m.name.trim() || "Unnamed").join(", ");
  const canDelete = o.createdBy === group.meId || group.ownerId === group.meId;
  // The wishlist place's website or map, when the plan points at one that still exists.
  const picked = group.places?.find((p) => p.id === o.placeId);
  const linked = picked?.link || picked?.mapLink || "";
  return (
    <li className="relative isolate flex flex-col gap-2 overflow-hidden rounded-3xl bg-plan p-5 text-[15px] text-[#f4f6fb] shadow-[0_6px_0_var(--plan-edge),0_20px_30px_-18px_rgb(28_40_64/.7)]">
      <Arcs className="absolute -top-8 -right-8 -z-10 w-36 opacity-95" />
      <div className="flex items-baseline justify-between gap-2 pr-16">
        <span>
          <span className="round text-xl font-bold">{o.title}</span>
          {o.place && (
            <span className="text-[#c6cfe0]">
              {" · "}
              {linked ? (
                <a href={linked} target="_blank" rel="noopener noreferrer" className="link">
                  {o.place}
                </a>
              ) : (
                o.place
              )}
            </span>
          )}
        </span>
        {canDelete && (
          <button className="link shrink-0 text-sm text-[#c6cfe0]" onClick={() => confirm(`Delete “${o.title}”?`) && run(removeOuting(o.id))}>
            Delete
          </button>
        )}
      </div>
      <span className="tabular-nums text-[#c6cfe0]">{when(o, zone)}</span>
      <div className="mt-2 grid grid-cols-3 gap-2.5" role="group" aria-label={`Your answer to ${o.title}`}>
        {ANSWERS.map((a) => (
          <button
            key={a.value}
            aria-pressed={mine === a.value}
            onClick={() => run(answerOuting(o.id, a.value, markBusy))}
            className={`btn border-2 px-1.5 py-2.5 text-base ${
              mine === a.value
                ? "border-sun bg-sun text-[#1c2840] shadow-[0_4px_0_var(--sun-edge)]"
                : "border-white/50 shadow-[0_4px_0_rgb(0_0_0/.35)]"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>
      <label className="mt-1 flex items-center gap-2 text-sm text-[#c6cfe0]">
        <input type="checkbox" checked={markBusy} onChange={(e) => {
          setMarkBusy(e.target.checked);
          // Already said yes: ticking the box applies it now, instead of waiting for another click on Yes.
          if (e.target.checked && mine === "y") run(answerOuting(o.id, "y", true));
        }} />
        Mark busy in my week when I say yes
      </label>
      {error && (
        <p role="alert" className="text-sm text-[#ffb3b3]">
          {error}
        </p>
      )}
      {ANSWERS.map((a) => names(a.value) && (
        <p key={a.value} className="text-sm text-[#c6cfe0]">
          {a.label}: {names(a.value)}
        </p>
      ))}
    </li>
  );
}
