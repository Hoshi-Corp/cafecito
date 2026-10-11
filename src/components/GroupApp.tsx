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
  slotMark,
  summarize,
  toQuantum,
  weekStartOf,
  weeksBetween,
  type MeetWindow,
  type WeekLayout,
} from "@/lib/availability";
import { retryLoad, signInAs, updateGroup, updateMember, useGroup, useLoadFailed } from "@/lib/store";
import { SLOT_OPTIONS, type Group, type Mark, type Member, type OverrideMark } from "@/lib/types";
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

const at = (q: number, zone: string) => DateTime.fromMillis(q * QUANTUM_MS, { zone });
const time = (q: number, zone: string) => at(q, zone).toLocaleString(DateTime.TIME_SIMPLE);
const day = (q: number, zone: string) =>
  at(q, zone).toLocaleString({ weekday: "short", day: "numeric", month: "short" });
const nameOf = (m: Member) => m.name.trim() || "Unnamed";
const city = (zone: string) => zone.split("/").pop()!.replaceAll("_", " ");

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
  // The group is fetched from the server in the browser, so there is nothing to render before that.
  if (!group)
    return (
      <main className="p-6 text-muted">
        {failed ? (
          <>
            Could not load the group.{" "}
            <button className="underline" onClick={retryLoad}>
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
      let overrides = m.overrides;
      for (let col = range.col0; col <= range.col1; col++)
        for (let row = range.row0; row <= range.row1; row++)
          overrides = paintOverrides(overrides, week.days[col].startQ[row], quantaPerSlot, brush);
      return { ...m, overrides };
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

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-5 pb-16">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{group.name}</h1>
        <span className="text-xs text-muted">Times in {city(zone)}</span>
      </header>

      <ul className="flex flex-wrap gap-1.5">
        {group.members.map((m) => (
          <li
            key={m.id}
            className="flex items-center gap-1.5 rounded-full border border-line bg-card py-1 pr-2.5 pl-2 text-xs"
          >
            <span className="size-2 rounded-full" style={{ background: m.color }} />
            <span className="font-medium">{nameOf(m)}</span>
            <span className="text-muted">
              {city(m.timeZone)}
              {m.timeZone !== zone && ` · ${time(toQuantum(now), m.timeZone)}`}
            </span>
          </li>
        ))}
      </ul>

      <BestWindows windows={windows} total={active.length} zone={zone} onPick={showWindow} />
      {waiting.length > 0 && (
        <p className="-mt-2 text-xs text-muted">
          Not counted yet, nothing marked: {waiting.map(nameOf).join(", ")}.
        </p>
      )}

      <nav className="flex rounded-lg border border-line bg-card p-0.5 text-sm">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`flex-1 rounded-md px-2 py-1.5 ${
              tab === t.id ? "bg-foreground font-medium text-background" : "text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {tab === "typical" ? (
          <p className="text-sm text-muted">Repeats every week, in your local time ({city(zone)}).</p>
        ) : (
          <div className="flex items-center gap-1 text-sm">
            <button className="rounded-md border border-line px-2 py-1" aria-label="Previous week" onClick={() => setWeekOffset(weekOffset - 1)}>
              ‹
            </button>
            <button className="rounded-md border border-line px-2 py-1" onClick={() => setWeekOffset(0)}>
              Today
            </button>
            <button className="rounded-md border border-line px-2 py-1" aria-label="Next week" onClick={() => setWeekOffset(weekOffset + 1)}>
              ›
            </button>
            <span className="ml-2 font-medium">
              {DateTime.fromISO(weekStart).toLocaleString({ month: "long", year: "numeric" })}
            </span>
          </div>
        )}
        {tab !== "group" && (
          <div className="flex flex-wrap gap-1 text-xs">
            {brushes.map((b) => (
              <button
                key={b.label}
                onClick={() => setBrush(b.value)}
                aria-pressed={activeBrush === b.value}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                  activeBrush === b.value ? "border-foreground font-medium" : "border-line text-muted"
                }`}
              >
                <span
                  className="size-3 rounded-sm border border-line"
                  style={b.value ? MARK_STYLE[b.value] : { background: "var(--cell)" }}
                />
                {b.label}
              </button>
            ))}
            <button
              onClick={() => setScrollTouches(!scrollTouches)}
              aria-pressed={scrollTouches}
              className={`rounded-full border px-2.5 py-1 ${
                scrollTouches ? "border-foreground font-medium" : "border-line text-muted"
              }`}
            >
              Scroll with touch
            </button>
          </div>
        )}
      </div>

      {tab === "group" && (
        <>
          <WeekGrid
            columns={dateColumns}
            rows={rows}
            rowHeight={ROW_HEIGHT[group.slotMinutes]}
            selected={selected}
            onSelect={(col, row) => setSelectedQ(week.days[col].startQ[row])}
            cellLabel={(col, row) => {
              const s = summaries[col][row];
              return `${day(week.days[col].startQ[row], zone)} ${time(week.days[col].startQ[row], zone)}: ${s.free.length} of ${active.length} free`;
            }}
            cellStyle={(col, row) => {
              const s = summaries[col][row];
              const total = active.length;
              if (total === 0) return undefined;
              if (s.free.length === total) return { background: "var(--heat-full)" };
              const score = (s.free.length + s.maybe.length / 2) / total;
              if (score === 0) return undefined;
              return {
                background: `color-mix(in oklab, var(--heat) ${Math.round(12 + 60 * score)}%, var(--cell))`,
              };
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
          columns={dateColumns}
          rows={rows}
          rowHeight={ROW_HEIGHT[group.slotMinutes]}
          onPaint={paintWeek}
          paintPreview={preview}
          scrollTouches={scrollTouches}
          cellLabel={(col, row) => {
            const q = week.days[col].startQ[row];
            const mark = slotMark(me, q, quantaPerSlot);
            const name = me.overrides[q] === "b" ? "busy" : mark ? MARK_NAME[mark] : "not marked";
            return `${day(q, zone)} ${time(q, zone)}: ${name}`;
          }}
          cellStyle={(col, row) => {
            const q = week.days[col].startQ[row];
            // Show a busy override only where it actually hides something.
            if (me.overrides[q] === "b") return MARK_STYLE.b;
            const mark = slotMark(me, q, quantaPerSlot);
            return mark ? MARK_STYLE[mark] : undefined;
          }}
        />
      )}

      {tab === "typical" && (
        <WeekGrid
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

      <Settings
        group={group}
        me={me}
        allHours={allHours}
        onAllHours={setAllHours}
      />
    </main>
  );
}

function BestWindows({
  windows,
  total,
  zone,
  onPick,
}: {
  windows: MeetWindow[];
  total: number;
  zone: string;
  onPick: (w: MeetWindow) => void;
}) {
  return (
    <section className="rounded-xl border border-line bg-card p-3">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
        Best times in the next two weeks
      </h2>
      {windows.length === 0 ? (
        <p className="text-sm text-muted">
          {total < 2
            ? "Needs at least two people with a week filled in."
            : `No time yet when ${total > 3 ? "nearly everyone" : "everyone"} is free for an hour. Mark your availability to find one.`}
        </p>
      ) : (
        <ul className="flex flex-col">
          {windows.map((w) => (
            <li key={w.startQ}>
              <button
                onClick={() => onPick(w)}
                className="flex w-full flex-wrap items-baseline justify-between gap-x-3 rounded-md px-1.5 py-1 text-left text-sm hover:bg-background"
              >
                <span>
                  <span className="font-medium">{day(w.startQ, zone)}</span>{" "}
                  <span className="tabular-nums">
                    {time(w.startQ, zone)}–{time(w.endQ, zone)}
                  </span>
                </span>
                <span className={w.free.length === total ? "font-medium text-free" : "text-muted"}>
                  {w.free.length === total ? "Everyone" : `${w.free.length} of ${total}`}
                  {w.maybe.length > 0 && ` · ${w.maybe.map(nameOf).join(", ")} maybe`}
                </span>
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
    <div className="flex items-center gap-1.5 text-xs text-muted">
      <span>0</span>
      {Array.from({ length: total + 1 }, (_, n) => (
        <span
          key={n}
          className="h-3 w-5 rounded-sm border border-line"
          style={{
            background:
              n === total
                ? "var(--heat-full)"
                : n === 0
                  ? "var(--cell)"
                  : `color-mix(in oklab, var(--heat) ${Math.round(12 + (60 * n) / total)}%, var(--cell))`,
          }}
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
    <section className="rounded-xl border border-line bg-card p-3 text-sm">
      <h2 className="mb-2 font-medium">
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
                <h3 className="mb-1 flex items-center gap-1.5 text-xs text-muted">
                  <span
                    className="size-2.5 rounded-sm border border-line"
                    style={g.mark ? MARK_STYLE[g.mark] : undefined}
                  />
                  {g.label} · {g.members.length}
                </h3>
                <ul>
                  {g.members.map((m) => (
                    <li key={m.id} className="flex items-baseline gap-1.5">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: m.color }} />
                      {nameOf(m)}
                      {m.timeZone !== zone && (
                        <span className="text-xs text-muted tabular-nums">
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
  const field = "rounded-md border border-line bg-cell px-2 py-1";
  return (
    <details className="rounded-xl border border-line bg-card p-3 text-sm">
      <summary className="cursor-pointer font-medium">Settings</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Your name</span>
          <input
            className={field}
            value={me.name}
            onChange={(e) => updateMember(me.id, (m) => ({ ...m, name: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Your time zone</span>
          <select
            className={field}
            value={me.timeZone}
            onChange={(e) => changeZone(e.target.value)}
          >
            {!zones.includes(me.timeZone) && <option>{me.timeZone}</option>}
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1.5 text-xs text-muted sm:col-span-2">
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
          <legend className="mb-1 text-xs text-muted">Slot size (whole group, owner only)</legend>
          <div className="flex gap-1">
            {SLOT_OPTIONS.map((s) => (
              <button
                key={s}
                aria-pressed={group.slotMinutes === s}
                disabled={me.id !== group.ownerId}
                onClick={() => updateGroup({ slotMinutes: s })}
                className={`flex-1 rounded-md border px-2 py-1 ${
                  group.slotMinutes === s ? "border-foreground font-medium" : "border-line text-muted"
                } disabled:opacity-50`}
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
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs text-muted">
        <span>Shared with everyone using this server. No sign-in yet, so anyone can act as anyone.</span>
        <label className="flex items-center gap-1.5">
          Act as
          <select className={field} value={me.id} onChange={(e) => signInAs(e.target.value)}>
            {group.members.map((m) => (
              <option key={m.id} value={m.id}>
                {nameOf(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}
