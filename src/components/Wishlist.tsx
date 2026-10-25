"use client";

import { useId, useState } from "react";
import { addComment, addPlace, archivePlace, clearRating, editPlace, ratePlace, removeComment, removePlace, setBeenThere, votePlace } from "@/lib/store";
import type { Group, Place, PlaceFields } from "@/lib/types";
import { Face } from "./Brand";
import { Menu } from "./Menu";
import { Segmented } from "./Segmented";
import { Sheet } from "./Sheet";

/** A member's display name, or null when they are not in the group (any more). */
const nameOf = (group: Group, id: string | null) => {
  const m = group.members.find((m) => m.id === id);
  return m ? m.name.trim() || "Unnamed" : null;
};

/** Whoever wrote or suggested something, and the owner, may change it. */
const mayChange = (group: Group, authorId: string | null) => authorId === group.meId || group.ownerId === group.meId;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 864e5],
  ["month", 30 * 864e5],
  ["week", 7 * 864e5],
  ["day", 864e5],
  ["hour", 36e5],
  ["minute", 6e4],
];
/** "3 weeks ago", "yesterday", "just now". */
export function ago(then: number, now = Date.now()) {
  const [unit, ms] = UNITS.find(([, ms]) => now - then >= ms) ?? [];
  return unit && ms ? relative.format(-Math.floor((now - then) / ms), unit) : "just now";
}

const average = (p: Place) => {
  const all = Object.values(p.ratings);
  return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
};
const ratingText = (p: Place) => {
  const n = Object.keys(p.ratings).length;
  return n ? `${average(p).toFixed(1)} from ${n} ${n === 1 ? "rating" : "ratings"}` : "No ratings yet";
};

type List = "try" | "been" | "archived";
const LISTS: Record<List, { title: string; holds: (p: Place) => boolean; order: (a: Place, b: Place) => number; empty: string }> = {
  // The most wanted first, then the newest.
  try: {
    title: "To try",
    holds: (p) => !p.archivedAt && !p.beenThere,
    order: (a, b) => b.votes.length - a.votes.length || b.createdAt - a.createdAt,
    empty: "Nothing left to try. Add a café or restaurant the group wants to go to.",
  },
  // The best rated first.
  been: {
    title: "Been there",
    holds: (p) => !p.archivedAt && p.beenThere,
    order: (a, b) => average(b) - average(a) || b.votes.length - a.votes.length,
    empty: "Places the group has been to show up here. Mark one with Been there.",
  },
  // The most recently archived first.
  archived: {
    title: "Archived",
    holds: (p) => !!p.archivedAt,
    order: (a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0),
    empty: "Old suggestions you archive wait here, with their ratings and comments, until someone brings them back.",
  },
};

/** Places on a page: about as tall as the week beside it. */
const PAGE = 8;
/** A search box appears once the wishlist is longer than this. */
const SEARCH_FROM = 8;
/** Lower case and without accents, so "cafe" finds "Café". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * The group's places as short rows, a page at a time, in three lists. A row opens the place in a pop-up with
 * everything else: notes, links, stars, comments and the ⋯ menu.
 */
export function Wishlist({ group }: { group: Group }) {
  const [list, setList] = useState<List>("try");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  // The place open in the pop-up, and whether it's being edited.
  const [open, setOpen] = useState<{ id: string; editing: boolean } | null>(null);
  // The name of the place just added, so the list turns to its page and marks it.
  const [added, setAdded] = useState<string | null>(null);
  const all = group.places ?? [];
  const q = fold(query.trim());
  const matches = (p: Place) => fold(`${p.name} ${p.notes}`).includes(q);
  const of = (l: List) => all.filter((p) => LISTS[l].holds(p) && matches(p));
  const found = of(list).sort(LISTS[list].order);
  const pages = Math.max(1, Math.ceil(found.length / PAGE));
  const fresh = found.findIndex((p) => p.name === added);
  const current = fresh >= 0 ? Math.floor(fresh / PAGE) : Math.min(page, pages - 1);
  const go = (n: number) => {
    setAdded(null);
    setPage(n);
  };
  const choose = (l: List) => {
    setList(l);
    go(0);
  };
  const opened = open && all.find((p) => p.id === open.id);
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title mb-0">Wishlist</h2>
        <button className="btn btn-sun px-3.5 py-1.5 text-[15px]" onClick={() => setAdding(true)}>
          + Add a place
        </button>
      </div>
      {all.length === 0 ? (
        <p className="card p-5 text-[15px] text-muted">No places yet. Add a café or restaurant the group wants to try.</p>
      ) : (
        <>
          <Segmented
            label="Wishlist"
            options={(Object.keys(LISTS) as List[]).map((id) => ({ id, label: `${LISTS[id].title} · ${all.filter(LISTS[id].holds).length}` }))}
            value={list}
            onChange={choose}
          />
          {(all.length > SEARCH_FROM || query) && (
            <label className="relative block">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted">
                <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
                <path d="M15.5 15.5L20 20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                aria-label="Search the wishlist"
                placeholder="Search by name or notes"
                className="field w-full py-2 pl-10 text-[15px]"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  go(0);
                }}
              />
            </label>
          )}
          {found.length === 0 ? (
            q ? (
              <NoMatch
                query={query.trim()}
                list={list}
                elsewhere={(Object.keys(LISTS) as List[]).filter((l) => l !== list && of(l).length).map((l) => [l, of(l).length])}
                onChoose={choose}
              />
            ) : (
              <p className="px-1 text-[15px] text-muted">{LISTS[list].empty}</p>
            )
          ) : (
            <div className="card relative overflow-hidden pt-2">
              {/* A slice of the rainbow along the top. */}
              <span aria-hidden="true" className="absolute inset-x-0 top-0 h-2 bg-[linear-gradient(90deg,var(--red)_0_25%,var(--tang)_0_50%,var(--sun)_0_75%,var(--teal)_0)]" />
              <ul className="divide-y-2 divide-line">
                {found.slice(current * PAGE, (current + 1) * PAGE).map((p) => (
                  <PlaceRow key={p.id} place={p} group={group} fresh={p.name === added} onOpen={() => setOpen({ id: p.id, editing: false })} />
                ))}
              </ul>
              {pages > 1 && (
                <nav aria-label="Wishlist pages" className="flex items-center justify-between gap-3 border-t-2 border-line bg-background/60 px-3 py-2.5 text-[15px]">
                  <button className="btn btn-plain w-10 px-0 py-1" aria-label="Previous page" disabled={current === 0} onClick={() => go(current - 1)}>
                    ‹
                  </button>
                  <span className="text-muted">
                    Page {current + 1} of {pages}
                  </span>
                  <button className="btn btn-plain w-10 px-0 py-1" aria-label="Next page" disabled={current === pages - 1} onClick={() => go(current + 1)}>
                    ›
                  </button>
                </nav>
              )}
            </div>
          )}
        </>
      )}
      <Sheet title="Add a place" open={adding} onClose={() => setAdding(false)}>
        <PlaceForm
          initial={EMPTY}
          submitLabel="Add"
          onSubmit={async (values) => {
            const refused = await addPlace(values);
            if (!refused) {
              // Show it where it lands: on To try, not hidden by a search, on its page.
              setQuery("");
              choose("try");
              setAdded(values.name);
            }
            return refused;
          }}
          onDone={() => setAdding(false)}
        />
      </Sheet>
      <Sheet title={opened ? (open.editing ? `Edit ${opened.name}` : opened.name) : ""} open={!!opened} onClose={() => setOpen(null)}>
        {opened &&
          (open.editing ? (
            <EditPlace place={opened} onDone={() => setOpen({ id: opened.id, editing: false })} />
          ) : (
            <PlaceDetails place={opened} group={group} onEdit={() => setOpen({ id: opened.id, editing: true })} />
          ))}
      </Sheet>
    </section>
  );
}

/** A search found nothing in this list; it may have found something in another. */
function NoMatch({ query, list, elsewhere, onChoose }: { query: string; list: List; elsewhere: [List, number][]; onChoose: (l: List) => void }) {
  return (
    <div className="flex flex-col items-start gap-2 px-1 text-[15px] text-muted">
      <p>
        Nothing in {LISTS[list].title} matches “{query}”.
      </p>
      {elsewhere.map(([l, n]) => (
        <button key={l} className="mini" onClick={() => onChoose(l)}>
          {n} in {LISTS[l].title}
          <span aria-hidden="true">→</span>
        </button>
      ))}
    </div>
  );
}

/** One line per place: its name and who suggested it; the vote (or, once visited, the stars) at the end. */
function PlaceRow({ place: p, group, fresh, onOpen }: { place: Place; group: Group; fresh: boolean; onOpen: () => void }) {
  const voted = p.votes.includes(group.meId);
  const [error, setError] = useState<string | null>(null);
  const comments = p.comments.length;
  return (
    <li className={`relative flex items-center gap-2 px-4 py-2.5 transition-colors hover:bg-background/70${fresh ? " bg-butter/50" : ""}`}>
      {/* The whole row opens the place; the vote button sits above it. */}
      <button className="min-w-0 flex-1 text-left after:absolute after:inset-0" onClick={onOpen} aria-label={`Open ${p.name}`}>
        <span className="round block truncate text-[16px] leading-snug font-bold">{p.name}</span>
        <span className="block truncate text-sm text-muted">
          {nameOf(group, p.suggestedBy) ?? "Someone who left"} · {p.archivedAt ? `archived ${ago(p.archivedAt)}` : ago(p.createdAt)}
          {comments > 0 && ` · ${comments} ${comments === 1 ? "comment" : "comments"}`}
        </span>
        {error && (
          <span role="alert" className="block text-sm text-danger">
            {error}
          </span>
        )}
      </button>
      {p.beenThere ? (
        <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted" title={ratingText(p)}>
          <span className="flex" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className="block size-4">
                <Star fill={Math.min(1, Math.max(0, average(p) - (n - 1)))} dim={false} />
              </span>
            ))}
          </span>
          <span className="sr-only">{ratingText(p)}</span>
          {Object.keys(p.ratings).length > 0 && <span aria-hidden="true">{average(p).toFixed(1)}</span>}
        </span>
      ) : (
        <button
          aria-pressed={voted}
          aria-label={`I want to go to ${p.name} · ${p.votes.length}`}
          onClick={() => votePlace(p.id, !voted).then(setError)}
          className="chip relative z-10 shrink-0 px-2.5 py-1 text-sm"
        >
          <span aria-hidden="true">♥</span>
          {p.votes.length}
        </button>
      )}
      <span aria-hidden="true" className="shrink-0 text-lg text-muted">
        ›
      </span>
    </li>
  );
}

/** Everything about a place, in the pop-up a row opens. */
function PlaceDetails({ place: p, group, onEdit }: { place: Place; group: Group; onEdit: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const run = (write: Promise<string | null>) => write.then(setError);
  const voted = p.votes.includes(group.meId);
  return (
    <div className="flex flex-col gap-4 text-[15px]">
      <div className="flex items-start justify-between gap-2">
        <p className="pt-1.5 text-sm text-muted">
          Suggested by {nameOf(group, p.suggestedBy) ?? "someone who left"} · {ago(p.createdAt)}
          {p.archivedAt ? ` · archived ${ago(p.archivedAt)}` : ""}
        </p>
        {mayChange(group, p.suggestedBy) && (
          <Menu
            label={`Options for ${p.name}`}
            items={[
              { label: "Edit", onSelect: onEdit },
              p.archivedAt
                ? { label: "Bring back", onSelect: () => run(archivePlace(p.id, false)) }
                : { label: "Archive", onSelect: () => run(archivePlace(p.id, true)) },
              { label: "Remove", danger: true, onSelect: () => confirm(`Remove “${p.name}” for good? Its ratings and comments go too.`) && run(removePlace(p.id)) },
            ]}
          />
        )}
      </div>
      {p.notes && <p className="break-words whitespace-pre-line text-muted">{p.notes}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button aria-pressed={voted} onClick={() => run(votePlace(p.id, !voted))} className="chip">
          I want to go · {p.votes.length}
        </button>
        <button aria-pressed={p.beenThere} onClick={() => run(setBeenThere(p.id, !p.beenThere))} className="chip">
          {p.beenThere && <span aria-hidden="true">✓</span>}
          Been there
        </button>
        {p.link && (
          <a href={p.link} target="_blank" rel="noopener noreferrer" className="mini">
            Website
            <span aria-hidden="true">↗</span>
          </a>
        )}
        {p.mapLink && (
          <a href={p.mapLink} target="_blank" rel="noopener noreferrer" className="mini">
            Map
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
      {/* Rated once someone has been. */}
      {p.beenThere && <Rating place={p} meId={group.meId} run={run} />}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Comments place={p} group={group} report={setError} />
    </div>
  );
}

/** The conversation about a place, oldest first, with a box to add to it. */
function Comments({ place: p, group, report }: { place: Place; group: Group; report: (error: string | null) => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const n = p.comments.length;
  return (
    <div className="-mx-5 -mb-5 flex flex-col gap-3 border-t-2 border-line bg-background/60 px-5 pt-4 pb-5 text-sm sm:-mx-6 sm:-mb-6 sm:px-6">
      <h4 className="round font-bold">{n ? `Comments · ${n}` : "No comments yet"}</h4>
      {n > 0 && (
        <ul className="flex flex-col gap-3">
          {p.comments.map((c) => {
            const member = group.members.find((m) => m.id === c.memberId);
            const author = nameOf(group, c.memberId);
            return (
              <li key={c.id} className="flex gap-2.5">
                <Face name={author ?? "?"} color={member?.color ?? "#8a93a6"} size={30} className="mt-0.5 text-[14px]" />
                <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md bg-card px-3.5 py-2.5 shadow-[0_0_0_2px_var(--line)]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="font-bold">{author ?? "Deleted user"}</span>
                      <span className="text-muted"> · {ago(c.createdAt)}</span>
                    </span>
                    {mayChange(group, c.memberId) && (
                      <button
                        aria-label={`Delete comment by ${author ?? "a deleted user"}`}
                        className="shrink-0 font-semibold text-muted hover:text-danger"
                        onClick={() => removeComment(p.id, c.id).then(report)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 text-[15px] break-words whitespace-pre-line">{c.body}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending || !text.trim()) return;
          setSending(true);
          const refused = await addComment(p.id, text.trim());
          setSending(false);
          if (!refused) setText("");
          report(refused);
        }}
      >
        <textarea
          aria-label="Your comment"
          className="field min-h-20 text-[15px]"
          placeholder="How was it? What should people order?"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">{text.length}/500</span>
          <button disabled={sending || !text.trim()} className="btn btn-sun px-4 py-1.5">
            Post
          </button>
        </div>
      </form>
    </div>
  );
}

const STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const starsLabel = (v: number) => `${v} ${v === 1 ? "star" : "stars"}`;

/**
 * Five stars of my own, in halves: the left half of a star gives half a star, the right half a whole one. Pressing
 * my rating again takes it back. From the keyboard it's one stop: the arrow keys move by half a star, Delete clears.
 */
function Rating({ place: p, meId, run }: { place: Place; meId: string; run: (write: Promise<string | null>) => void }) {
  // My new rating shows at once, until the server's copy changes (or the write is refused), so quick taps and arrow
  // presses build on each other.
  const saved = p.ratings[meId] ?? 0;
  const [pending, setPending] = useState<{ from: number; to: number } | null>(null);
  const mine = pending && pending.from === saved ? pending.to : saved;
  const [preview, setPreview] = useState<number | null>(null);
  const count = Object.keys(p.ratings).length;
  /** 0 takes my rating back. */
  const rate = (v: number) => {
    if (v === mine) return;
    setPending({ from: saved, to: v });
    const write = v ? ratePlace(p.id, v) : clearRating(p.id);
    write.then((refused) => refused && setPending(null));
    run(write);
  };
  const shown = preview ?? mine;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <div
        role="radiogroup"
        aria-label={`Your rating of ${p.name}`}
        className="flex"
        onPointerLeave={() => setPreview(null)}
        onKeyDown={(e) => {
          const at = STEPS.indexOf(mine);
          const to = { ArrowRight: at + 1, ArrowUp: at + 1, ArrowLeft: at - 1, ArrowDown: at - 1, Home: 0, End: STEPS.length - 1 }[e.key];
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            rate(0);
          } else if (to !== undefined) {
            e.preventDefault();
            const v = STEPS[Math.min(STEPS.length - 1, Math.max(0, to))];
            rate(v);
            e.currentTarget.querySelector<HTMLElement>(`[data-v="${v}"]`)?.focus();
          }
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`relative block size-8 transition-transform duration-200${preview !== null && Math.ceil(preview) === n ? " scale-110" : ""}`}>
            <Star fill={Math.min(1, Math.max(0, shown - (n - 1)))} dim={preview !== null} />
            {[n - 0.5, n].map((v) => (
              <button
                key={v}
                data-v={v}
                role="radio"
                aria-checked={v === mine}
                aria-label={starsLabel(v)}
                // One stop in the tab order: my rating, or the first half star.
                tabIndex={v === (mine || 0.5) ? 0 : -1}
                className={`absolute inset-y-0 w-1/2 rounded-md ${v % 1 ? "left-0" : "right-0"}`}
                onPointerEnter={(e) => e.pointerType === "mouse" && setPreview(v)}
                onClick={() => rate(v === mine ? 0 : v)}
              />
            ))}
          </span>
        ))}
      </div>
      <span className="text-muted">
        {preview !== null ? starsLabel(preview) : count ? `${average(p).toFixed(1)} from ${count} ${count === 1 ? "rating" : "ratings"}` : "No ratings yet"}
      </span>
    </div>
  );
}

/** A rounded star, filled with sun from the left by `fill` (0 to 1), on an empty one. */
function Star({ fill, dim }: { fill: number; dim: boolean }) {
  const clip = useId();
  const path = "M12 2.8l2.75 5.6 6.15.9-4.45 4.35 1.05 6.12L12 16.87l-5.5 2.9 1.05-6.12L3.1 9.3l6.15-.9z";
  return (
    <svg viewBox="0 0 24 24" className="size-full" aria-hidden="true">
      <path d={path} fill="var(--cell)" stroke="var(--line)" strokeWidth="1.8" strokeLinejoin="round" />
      {fill > 0 && (
        <>
          <clipPath id={clip}>
            <rect width={24 * fill} height="24" />
          </clipPath>
          <path d={path} clipPath={`url(#${clip})`} fill="var(--sun)" stroke="var(--sun-edge)" strokeWidth="1.8" strokeLinejoin="round" opacity={dim ? 0.75 : 1} />
        </>
      )}
    </svg>
  );
}

/** The place fields with a Save button; `onSubmit` resolves to the server's refusal, or null once saved. */
function PlaceForm({
  initial,
  submitLabel,
  onSubmit,
  onDone,
}: {
  initial: PlaceFields;
  submitLabel: string;
  onSubmit: (values: PlaceFields) => Promise<string | null>;
  onDone: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const input = (key: keyof PlaceFields) => ({ value: values[key], onChange: (e: { target: { value: string } }) => setValues({ ...values, [key]: e.target.value }) });
  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sending) return;
        setSending(true);
        const refused = await onSubmit({ name: values.name.trim(), link: values.link.trim(), mapLink: values.mapLink.trim(), notes: values.notes });
        setSending(false);
        if (refused) return setError(refused);
        onDone();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted">Name</span>
        <input className="field" maxLength={80} required pattern=".*\S.*" autoFocus {...input("name")} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted">Website (optional)</span>
        <input className="field" type="url" maxLength={500} placeholder="https://" {...input("link")} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted">Map link (optional)</span>
        <input className="field" type="url" maxLength={500} placeholder="https://" {...input("mapLink")} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm text-muted">Notes (optional)</span>
        <textarea className="field" maxLength={500} rows={3} {...input("notes")} />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button type="button" className="btn btn-plain" onClick={onDone}>
          Cancel
        </button>
        <button disabled={sending} className="btn btn-sun">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

const EMPTY: PlaceFields = { name: "", link: "", mapLink: "", notes: "" };

/** Saves only what changed; nothing changed means nothing is sent. */
function EditPlace({ place: p, onDone }: { place: Place; onDone: () => void }) {
  const initial = { name: p.name, link: p.link, mapLink: p.mapLink, notes: p.notes };
  return (
    <PlaceForm
      initial={initial}
      submitLabel="Save"
      onSubmit={async (values) => {
        const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== initial[k as keyof PlaceFields]));
        return Object.keys(changed).length ? editPlace(p.id, changed) : null;
      }}
      onDone={onDone}
    />
  );
}
