"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  QUANTA_PER_DAY,
  QUANTUM_MS,
  addWeeks,
  bestWindows,
  buildWeek,
  isSetUp,
  paintOverrides,
  paintPattern,
  patternSlotMark,
  shiftPattern,
  slotHasBusy,
  slotMark,
  summarize,
  toQuantum,
  weekStartOf,
  weeksBetween,
  type MeetWindow,
  type WeekLayout,
} from "@/lib/availability";
import { retryLoad, updateGroup, updateMember, useGroup, useLoadFailed, useRecentChange, useSignedOut } from "@/lib/store";
import { SLOT_OPTIONS, type Group, type Mark, type Member, type OverrideMark } from "@/lib/types";
import { Account } from "./Account";
import { Face, Mark as Logo } from "./Brand";
import { Scenery } from "./Scenery";
import { ColorPicker, Landing } from "./Entry";
import { Manage } from "./Manage";
import { Outings, ProposeForm } from "./Outings";
import { Wishlist } from "./Wishlist";
import { WeekGrid, type CellRange, type GridColumn, type GridRow } from "./WeekGrid";

type Tab = "group" | "mine" | "typical";
type Brush = OverrideMark | null;

const TABS: { id: Tab; label: string }[] = [
  { id: "group", label: "Group" },
  { id: "mine", label: "My week" },
  { id: "typical", label: "Typical week" },
];

const ROW_HEIGHT = { 15: 12, 30: 18, 60: 30 } as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const stripes = (color: string) =>
  `repeating-linear-gradient(135deg, ${color} 0 4px, color-mix(in oklab, ${color} 35%, var(--cell)) 4px 8px)`;

const MARK_STYLE: Record<OverrideMark, CSSProperties> = {
  f: { background: "var(--free)" },
  m: { background: stripes("var(--maybe)") },
  b: { background: stripes("var(--busy)") },
};

const MARK_NAME: Record<Mark, string> = { f: "free", m: "maybe" };

// Heatmap shade for a share of people free (0 to 1, maybes counting half): pale butter through sun to tangerine.
// "Everyone free" is red and raised instead.
const heat = (score: number) =>
  score <= 0.5
    ? `color-mix(in oklab, var(--sun) ${Math.round(30 + 140 * score)}%, var(--butter))`
    : `color-mix(in oklab, var(--tang) ${Math.round((score - 0.5) * 180)}%, var(--sun))`;
const EVERYONE: CSSProperties = { background: "var(--heat-full)", boxShadow: "0 2px 0 var(--red-edge)" };

const at = (q: number, zone: string) => DateTime.fromMillis(q * QUANTUM_MS, { zone });
const time = (q: number, zone: string) => at(q, zone).toLocaleString(DateTime.TIME_SIMPLE);
const day = (q: number, zone: string) =>
  at(q, zone).toLocaleString({ weekday: "short", day: "numeric", month: "short" });
const nameOf = (m: Member) => m.name.trim() || "Unnamed";
const city = (zone: string) => zone.split("/").pop()!.replaceAll("_", " ");
const list = (names: string[]) => new Intl.ListFormat(undefined, { type: "conjunction" }).format(names);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function findCell(week: WeekLayout, q: number) {
  for (let col = 0; col < week.days.length; col++) {
    const row = week.days[col].startQ.findIndex((s) => q >= s && q < s + week.quantaPerSlot);
    if (row >= 0) return { col, row };
  }
  return null;
}

const quantumNow = (prev?: number) => {
  const now = Math.floor(Date.now() / QUANTUM_MS) * QUANTUM_MS;
  return now === prev ? prev : now;
};

export function GroupApp() {
  const group = useGroup();
  const failed = useLoadFailed();
  const signedOut = useSignedOut();
  if (signedOut) return <Landing />;
  // The group is fetched from the server in the browser, so there is nothing to render before that.
  if (!group)
    return (
      <main className="p-6 text-muted">
        {failed ? (
          <>
            Could not load the group.{" "}
            <button className="link" onClick={retryLoad}>
              Retry
            </button>
          </>
        ) : (
          "Loading…"
        )}
      </main>
    );
  return <GroupView group={group} />;
}

function GroupView({ group }: { group: Group }) {
  // Rounded to the quantum so a tick that changes nothing does not re-render or recompute best times.
  const [now, setNow] = useState(quantumNow);
  // A tab left open overnight must not keep showing yesterday as today.
  useEffect(() => {
    const refresh = () => document.visibilityState === "visible" && setNow(quantumNow);
    const timer = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const [tab, setTab] = useState<Tab>("group");
  const [weekOffset, setWeekOffset] = useState(0);
  const [allHours, setAllHours] = useState(false);
  const [brush, setBrush] = useState<Brush>("f");
  const [scrollTouches, setScrollTouches] = useState(false);
  const [selectedQ, setSelectedQ] = useState<number | null>(null);
  const [proposing, setProposing] = useState<MeetWindow | null>(null);
  const recent = useRecentChange();

  const me = group.members.find((m) => m.id === group.meId) ?? group.members[0];
  const zone = me.timeZone;
  const thisWeek = weekStartOf(now, zone);
  const weekStart = addWeeks(thisWeek, weekOffset);
  const week = useMemo(
    () => buildWeek(zone, weekStart, group.slotMinutes, allHours ? 0 : 7, 24),
    [zone, weekStart, group.slotMinutes, allHours],
  );
  const { quantaPerSlot } = week;
  const today = DateTime.fromMillis(now, { zone }).toISODate();

  const rows: GridRow[] = week.rowMinutes.map((m) => ({
    key: String(m),
    label:
      m % 60 === 0
        ? DateTime.fromObject({ hour: m / 60 }).toLocaleString({ hour: "numeric" })
        : undefined,
  }));
  const dateColumns: GridColumn[] = week.days.map((d, i) => ({
    key: d.date,
    label: WEEKDAYS[i],
    sub: String(DateTime.fromISO(d.date).day),
    highlight: d.date === today,
  }));

  // Someone who has not marked anything yet is not busy, they are just not counted.
  const active = useMemo(() => group.members.filter(isSetUp), [group.members]);
  const waiting = group.members.filter((m) => !isSetUp(m));
  const summaries = useMemo(
    () => week.days.map((d) => d.startQ.map((q) => summarize(active, q, quantaPerSlot))),
    [week, active, quantaPerSlot],
  );
  const windows = useMemo(() => {
    const from = toQuantum(now) + 1;
    return bestWindows(active, from, from + 14 * QUANTA_PER_DAY);
  }, [active, now]);

  const selected = selectedQ === null ? null : findCell(week, selectedQ);
  // A selected time can sit in no grid row (the repeated hour when clocks go back); still show who is free then.
  const weekStartAt = DateTime.fromISO(weekStart, { zone });
  const inWeek =
    selectedQ !== null &&
    selectedQ >= toQuantum(weekStartAt.toMillis()) &&
    selectedQ < toQuantum(weekStartAt.plus({ weeks: 1 }).toMillis());
  const detailQ = selected ? week.days[selected.col].startQ[selected.row] : inWeek ? selectedQ : null;

  const showWindow = (w: MeetWindow) => {
    setTab("group");
    // Windows can start in the early hours the grid hides by default.
    if (at(w.startQ, zone).hour < 7) setAllHours(true);
    setWeekOffset(weeksBetween(thisWeek, weekStartOf(w.startQ * QUANTUM_MS, zone)));
    setSelectedQ(w.startQ);
  };

  const paintWeek = (range: CellRange) =>
    updateMember(me.id, (m) => {
      const starts: number[] = [];
      for (let col = range.col0; col <= range.col1; col++)
        for (let row = range.row0; row <= range.row1; row++) starts.push(week.days[col].startQ[row]);
      return { ...m, overrides: paintOverrides(m.overrides, starts, quantaPerSlot, brush) };
    });

  const patternIndex = (col: number, row: number) =>
    col * QUANTA_PER_DAY + week.rowMinutes[row] / 15;
  const paintTypical = (range: CellRange) =>
    updateMember(me.id, (m) => {
      let pattern = m.pattern;
      for (let col = range.col0; col <= range.col1; col++)
        for (let row = range.row0; row <= range.row1; row++)
          pattern = paintPattern(pattern, patternIndex(col, row), quantaPerSlot, brush === "b" ? null : brush);
      return { ...m, pattern };
    });

  const brushes: { value: Brush; label: string }[] = [
    { value: "f", label: "Free" },
    { value: "m", label: "Maybe" },
    ...(tab === "mine" ? [{ value: "b" as const, label: "Busy" }] : []),
    { value: null, label: tab === "mine" ? "Reset to typical" : "Clear" },
  ];
  const activeBrush = tab === "typical" && brush === "b" ? null : brush;
  const preview = activeBrush ? (MARK_STYLE[activeBrush].background as string) : "var(--line)";
  const tabIndex = TABS.findIndex((t) => t.id === tab);

  return (
    <div className="flex flex-col">
      <Hero
        group={group}
        zone={zone}
        now={now}
        windows={windows}
        total={active.length}
        recent={recent}
        onPropose={setProposing}
        onPick={showWindow}
      />

      <main className="mx-auto grid w-full max-w-[1200px] gap-10 px-5 pt-7 pb-16 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-12 lg:pt-9">
        {/* On phones the week comes right after the best times; on wide screens it gets its own column. */}
        <div className="flex flex-col gap-10 max-lg:contents">
          <div className="flex flex-col gap-4 max-lg:order-1">
            <BestWindows windows={windows} total={active.length} zone={zone} onPick={showWindow} onPropose={setProposing} />
            {waiting.length > 0 && (
              <p className="text-[15px] text-muted">Not counted yet, nothing marked: {waiting.map(nameOf).join(", ")}.</p>
            )}
            {proposing && (
              <ProposeForm key={proposing.startQ} window={proposing} places={group.places ?? []} zone={zone} onDone={() => setProposing(null)} />
            )}
          </div>
          <div className="empty:hidden max-lg:order-3">
            <Outings group={group} zone={zone} now={now} />
          </div>
          <div className="max-lg:order-4">
            <Wishlist group={group} />
          </div>
        </div>

        <section className="min-w-0 max-lg:order-2" aria-labelledby="week-title">
          <h2 id="week-title" className="section-title">
            The week
          </h2>
          <div className="card flex flex-col gap-4 p-4 sm:p-6">
            <nav className="relative grid grid-cols-3 rounded-2xl bg-cell p-1 text-[15px]">
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-xl bg-foreground shadow-[0_3px_0_var(--ledge)] transition-transform duration-500 ease-[cubic-bezier(.3,1.35,.5,1)]"
                style={{ transform: `translateX(${tabIndex * 100}%)` }}
              />
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-pressed={tab === t.id}
                  className={`round relative rounded-xl px-1 py-2.5 font-semibold transition-colors duration-300 ${
                    tab === t.id ? "text-background" : ""
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            <div className="flex flex-wrap items-center justify-between gap-3">
              {tab === "typical" ? (
                <p className="text-[15px] text-muted">Repeats every week, in your local time ({city(zone)}).</p>
              ) : (
                <div className="flex items-center gap-2 text-[15px]">
                  <button className="btn btn-plain w-10 px-0 py-1" aria-label="Previous week" onClick={() => setWeekOffset(weekOffset - 1)}>
                    ‹
                  </button>
                  <button className="btn btn-plain px-3 py-1" onClick={() => setWeekOffset(0)}>
                    Today
                  </button>
                  <button className="btn btn-plain w-10 px-0 py-1" aria-label="Next week" onClick={() => setWeekOffset(weekOffset + 1)}>
                    ›
                  </button>
                  <span className="round ml-1.5 text-lg font-bold">
                    {DateTime.fromISO(weekStart).toLocaleString({ month: "long", year: "numeric" })}
                  </span>
                </div>
              )}
              {tab !== "group" && (
                <div className="flex flex-wrap gap-2 text-sm">
                  {brushes.map((b) => (
                    <button key={b.label} onClick={() => setBrush(b.value)} aria-pressed={activeBrush === b.value} className="chip">
                      <span
                        className="size-3.5 rounded-[4px] ring-1 ring-line"
                        style={b.value ? MARK_STYLE[b.value] : { background: "var(--cell)" }}
                      />
                      {b.label}
                    </button>
                  ))}
                  <button onClick={() => setScrollTouches(!scrollTouches)} aria-pressed={scrollTouches} className="chip">
                    Scroll with touch
                  </button>
                </div>
              )}
            </div>

            {tab === "group" && (
              <>
                <WeekGrid
                  label="Group availability"
                  columns={dateColumns}
                  rows={rows}
                  rowHeight={ROW_HEIGHT[group.slotMinutes]}
                  selected={selected}
                  onSelect={(col, row) => setSelectedQ(week.days[col].startQ[row])}
                  cellLabel={(col, row) => {
                    const s = summaries[col][row];
                    const who =
                      active.length && s.free.length === active.length
                        ? "everyone free"
                        : `${s.free.length} of ${active.length} free${s.maybe.length ? `, ${s.maybe.length} maybe` : ""}`;
                    return `${day(week.days[col].startQ[row], zone)} ${time(week.days[col].startQ[row], zone)}: ${who}`;
                  }}
                  cellStyle={(col, row) => {
                    const s = summaries[col][row];
                    const total = active.length;
                    if (total === 0) return undefined;
                    if (s.free.length === total) return EVERYONE;
                    const score = (s.free.length + s.maybe.length / 2) / total;
                    if (score === 0) return undefined;
                    return { background: heat(score) };
                  }}
                />
                {active.length > 0 && <Legend total={active.length} />}
                {detailQ !== null && (
                  <SlotDetail
                    summary={summarize(active, detailQ, quantaPerSlot)}
                    startQ={detailQ}
                    quanta={quantaPerSlot}
                    zone={zone}
                  />
                )}
              </>
            )}

            {tab === "mine" && (
              <WeekGrid
                label="My availability by date"
                columns={dateColumns}
                rows={rows}
                rowHeight={ROW_HEIGHT[group.slotMinutes]}
                onPaint={paintWeek}
                paintPreview={preview}
                scrollTouches={scrollTouches}
                cellLabel={(col, row) => {
                  const q = week.days[col].startQ[row];
                  const mark = slotMark(me, q, quantaPerSlot);
                  const name = mark ? MARK_NAME[mark] : slotHasBusy(me, q, quantaPerSlot) ? "busy" : "not marked";
                  return `${day(q, zone)} ${time(q, zone)}: ${name}`;
                }}
                cellStyle={(col, row) => {
                  const q = week.days[col].startQ[row];
                  const mark = slotMark(me, q, quantaPerSlot);
                  if (mark) return MARK_STYLE[mark];
                  // A busy override anywhere in the slot hides it, so show it even if the first quantum is clear.
                  return slotHasBusy(me, q, quantaPerSlot) ? MARK_STYLE.b : undefined;
                }}
              />
            )}

            {tab === "typical" && (
              <WeekGrid
                label="My typical week"
                columns={WEEKDAYS.map((label) => ({ key: label, label }))}
                rows={rows}
                rowHeight={ROW_HEIGHT[group.slotMinutes]}
                onPaint={paintTypical}
                paintPreview={preview}
                scrollTouches={scrollTouches}
                cellLabel={(col, row) => {
                  const mark = patternSlotMark(me.pattern, patternIndex(col, row), quantaPerSlot);
                  const t = DateTime.fromObject({ hour: 0 }).plus({ minutes: week.rowMinutes[row] });
                  return `${WEEKDAYS[col]} ${t.toLocaleString(DateTime.TIME_SIMPLE)}: ${mark ? MARK_NAME[mark] : "not marked"}`;
                }}
                cellStyle={(col, row) => {
                  const mark = patternSlotMark(me.pattern, patternIndex(col, row), quantaPerSlot);
                  return mark ? MARK_STYLE[mark] : undefined;
                }}
              />
            )}
          </div>
        </section>

        <div className="max-lg:order-5 lg:col-span-2">
          <Settings group={group} me={me} allHours={allHours} onAllHours={setAllHours} />
        </div>
      </main>
    </div>
  );
}

/** The top of the page: the next time everyone can meet, who that is, and the rainbow. */
function Hero({
  group,
  zone,
  now,
  windows,
  total,
  recent,
  onPropose,
  onPick,
}: {
  group: Group;
  zone: string;
  now: number;
  windows: MeetWindow[];
  total: number;
  recent: string | null;
  onPropose: (w: MeetWindow) => void;
  onPick: (w: MeetWindow) => void;
}) {
  const next = windows[0];
  return (
    <header className="relative isolate overflow-hidden bg-sky pt-5 pb-64 lg:pb-32">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(120%_90%_at_0%_0%,rgb(255_255_255/.45),transparent_60%)]" />
      <Scenery people={group.members.map((m) => ({ id: m.id, name: nameOf(m), color: m.color, free: !!next?.free.some((f) => f.id === m.id) }))} everyone={!!next && next.free.length === group.members.length} />
      {/* Only the content itself takes taps, so the photos on the bunting behind it can be flipped. */}
      <div className="pointer-events-none mx-auto max-w-[1200px] px-5 [&>*]:pointer-events-auto">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div className="mr-auto flex items-center gap-2">
            <Logo size={30} className="text-foreground" />
            <h1 className="round text-lg font-bold">{group.name}</h1>
          </div>
          <span className="text-sm text-muted">Times in {city(zone)}</span>
        </div>
        {recent && (
          <p role="status" className="mt-1 text-sm text-muted">
            Updated by {recent}
          </p>
        )}

        <div className="lg:max-w-[560px]">
          {next ? <NextTime next={next} total={total} zone={zone} now={now} onPropose={onPropose} onPick={onPick} /> : <NoTimeYet />}
          <ul className="mt-5 flex flex-wrap gap-2">
            {group.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-full bg-card/70 py-1 pr-3.5 pl-1 text-[15px]">
                <Face name={nameOf(m)} color={m.color} size={28} />
                <span className="font-semibold">{nameOf(m)}</span>
                <span className="text-muted">
                  {city(m.timeZone)}
                  {m.timeZone !== zone && ` · ${time(toQuantum(now), m.timeZone)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </header>
  );
}

function NextTime({
  next,
  total,
  zone,
  now,
  onPropose,
  onPick,
}: {
  next: MeetWindow;
  total: number;
  zone: string;
  now: number;
  onPropose: (w: MeetWindow) => void;
  onPick: (w: MeetWindow) => void;
}) {
  const start = at(next.startQ, zone);
  const base = DateTime.fromMillis(now, { zone });
  const daysAway = start.startOf("day").diff(base.startOf("day"), "days").days;
  const dayText = start.toLocaleString(daysAway < 7 ? { weekday: "long" } : { weekday: "short", day: "numeric", month: "short" });
  const range = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: zone }).formatRange(
    start.toJSDate(),
    at(next.endQ, zone).toJSDate(),
  );
  const soon = daysAway === 0 ? `Today, ${start.toRelative({ base })}` : upper(start.toRelativeCalendar({ base }) ?? "");
  const everyone = next.free.length === total;
  return (
    <>
      <p className="mt-7 font-semibold text-muted lg:mt-12">{everyone ? "Next time everyone is free" : "Best time coming up"}</p>
      <h2 className="mt-1">
        <span className="lift round block text-[clamp(44px,13vw,76px)] leading-[1.04] font-extrabold tracking-tight">{dayText}</span>
        <span className="mt-2 block text-[clamp(26px,7vw,36px)] leading-tight font-semibold text-accent tabular-nums">{range}</span>
      </h2>
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button className="btn btn-sun px-6 py-3 text-[17px]" onClick={() => onPropose(next)}>
          Propose this time
        </button>
        <span className="text-[15px] text-muted">{soon}</span>
        <button className="link text-[15px] text-muted" onClick={() => onPick(next)}>
          Show in the week
        </button>
      </div>
      <div className="mt-7">
        <div className="flex">
          {next.free.map((m, i) => (
            <Face key={m.id} name={nameOf(m)} color={m.color} ring="var(--sky)" style={i ? { marginLeft: -10 } : undefined} />
          ))}
          {next.maybe.map((m) => (
            <Face key={m.id} name={nameOf(m)} color={m.color} ring="var(--sky)" className="opacity-60" style={{ marginLeft: -10 }} />
          ))}
        </div>
        <p className="mt-3 text-xl leading-snug font-semibold">
          {list(next.free.map(nameOf))} {next.free.length === 1 ? "is" : "are"} free
          {next.maybe.length > 0 && <span className="text-muted">, {list(next.maybe.map(nameOf))} maybe</span>}
        </p>
      </div>
    </>
  );
}

function NoTimeYet() {
  return (
    <>
      <p className="mt-7 font-semibold text-muted lg:mt-12">Next time everyone is free</p>
      <h2 className="lift round mt-1 text-[clamp(36px,10vw,60px)] leading-[1.05] font-extrabold tracking-tight">Not found yet</h2>
      <p className="mt-3 max-w-md text-lg">Mark when you are free in the week below, and the best time shows up here.</p>
    </>
  );
}

function BestWindows({
  windows,
  total,
  zone,
  onPick,
  onPropose,
}: {
  windows: MeetWindow[];
  total: number;
  zone: string;
  onPick: (w: MeetWindow) => void;
  onPropose: (w: MeetWindow) => void;
}) {
  return (
    <section>
      <h2 className="section-title">Best times in the next two weeks</h2>
      {windows.length === 0 ? (
        <p className="card p-5 text-[15px] text-muted">
          {total < 2
            ? "Needs at least two people with a week filled in."
            : `No time yet when ${total > 3 ? "nearly everyone" : "everyone"} is free for an hour. Mark your availability to find one.`}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {windows.map((w) => (
            <li key={w.startQ} className="card flex items-center gap-2 p-2">
              <button
                onClick={() => onPick(w)}
                className="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-x-3 rounded-2xl px-3 py-2 text-left transition-colors hover:bg-background"
              >
                <span className="flex flex-col">
                  <span className="font-bold">{day(w.startQ, zone)}</span>
                  <span className="text-[15px] text-muted tabular-nums">
                    {time(w.startQ, zone)}–{time(w.endQ, zone)}
                  </span>
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-center text-sm font-semibold ${
                    w.free.length === total
                      ? "bg-red text-white shadow-[0_3px_0_var(--red-edge)]"
                      : "bg-butter text-foreground shadow-[0_3px_0_var(--ledge)]"
                  }`}
                >
                  {w.free.length === total ? "Everyone" : `${w.free.length} of ${total}`}
                  {w.maybe.length > 0 && ` · ${w.maybe.map(nameOf).join(", ")} maybe`}
                </span>
              </button>
              <button
                onClick={() => onPropose(w)}
                aria-label={`Propose ${day(w.startQ, zone)} ${time(w.startQ, zone)}`}
                className="btn btn-plain shrink-0 px-3 py-1.5 text-sm"
              >
                Propose
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Legend({ total }: { total: number }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
      <span>0</span>
      {Array.from({ length: total + 1 }, (_, n) => (
        <span
          key={n}
          className="h-3.5 w-5 rounded-[4px]"
          style={n === total ? EVERYONE : { background: n === 0 ? "var(--cell)" : heat(n / total) }}
        />
      ))}
      <span>{total} free</span>
      <span className="ml-auto">Tap a slot to see who</span>
    </div>
  );
}

function SlotDetail({
  summary,
  startQ,
  quanta,
  zone,
}: {
  summary: ReturnType<typeof summarize>;
  startQ: number;
  quanta: number;
  zone: string;
}) {
  const groups: { label: string; mark: Mark | null; members: Member[] }[] = [
    { label: "Free", mark: "f", members: summary.free },
    { label: "Maybe", mark: "m", members: summary.maybe },
    { label: "Not available", mark: null, members: summary.busy },
  ];
  return (
    <section className="rounded-2xl bg-background p-4 text-[15px]">
      <h2 className="round mb-2 text-lg font-bold">
        {day(startQ, zone)}{" "}
        <span className="tabular-nums">
          {time(startQ, zone)}–{time(startQ + quanta, zone)}
        </span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {groups.map(
          (g) =>
            g.members.length > 0 && (
              <div key={g.label}>
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-muted">
                  <span
                    className="size-3 rounded-[4px] ring-1 ring-line"
                    style={g.mark ? MARK_STYLE[g.mark] : { background: "var(--cell)" }}
                  />
                  {g.label} · {g.members.length}
                </h3>
                <ul>
                  {g.members.map((m) => (
                    <li key={m.id} className="flex items-baseline gap-1.5">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: m.color }} />
                      {nameOf(m)}
                      {m.timeZone !== zone && (
                        <span className="text-sm text-muted tabular-nums">
                          {at(startQ, m.timeZone).toLocaleString({ weekday: "short" })}{" "}
                          {time(startQ, m.timeZone)} in {city(m.timeZone)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ),
        )}
      </div>
    </section>
  );
}

function Settings({
  group,
  me,
  allHours,
  onAllHours,
}: {
  group: Group;
  me: Member;
  allHours: boolean;
  onAllHours: (value: boolean) => void;
}) {
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const [keepMoments, setKeepMoments] = useState(false);
  const changeZone = (timeZone: string) =>
    updateMember(me.id, (m) => {
      const offset = (zone: string) => DateTime.now().setZone(zone).offset;
      const shift = keepMoments ? (offset(timeZone) - offset(m.timeZone)) / 15 : 0;
      return { ...m, timeZone, pattern: shiftPattern(m.pattern, shift) };
    });
  return (
    <details className="card p-5 text-[15px] sm:p-6">
      <summary className="round cursor-pointer text-xl font-bold">Settings</summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Your name</span>
          <input
            className="field"
            value={me.name}
            onChange={(e) => updateMember(me.id, (m) => ({ ...m, name: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Your time zone</span>
          <select
            className="field"
            value={me.timeZone}
            onChange={(e) => changeZone(e.target.value)}
          >
            {!zones.includes(me.timeZone) && <option>{me.timeZone}</option>}
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <ColorPicker value={me.color} onChange={(color) => updateMember(me.id, (m) => ({ ...m, color }))} />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted sm:col-span-2">
          <input
            id="keep-moments"
            type="checkbox"
            checked={keepMoments}
            onChange={(e) => setKeepMoments(e.target.checked)}
          />
          <label htmlFor="keep-moments">
            Keep the same moments: shift my typical week to the new zone. Off keeps 6 pm as 6 pm.
          </label>
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm text-muted">Slot size (whole group, owner only)</legend>
          <div className="flex gap-2">
            {SLOT_OPTIONS.map((s) => (
              <button
                key={s}
                aria-pressed={group.slotMinutes === s}
                disabled={me.id !== group.ownerId}
                onClick={() => updateGroup({ slotMinutes: s })}
                className="chip flex-1 justify-center disabled:opacity-50"
              >
                {s === 60 ? "1 h" : `${s} min`}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 self-end py-1">
          <input type="checkbox" checked={allHours} onChange={(e) => onAllHours(e.target.checked)} />
          Show all 24 hours
        </label>
      </div>
      <Account group={group} />
      {me.id === group.ownerId && <Manage group={group} />}
    </details>
  );
}
