export const SLOT_OPTIONS = [15, 30, 60] as const;
export type SlotMinutes = (typeof SLOT_OPTIONS)[number];

/** "f" = free, "m" = maybe. */
export type Mark = "f" | "m";
/** Overrides can also force a quantum to busy ("b"), hiding the weekly pattern. */
export type OverrideMark = Mark | "b";

export interface Member {
  id: string;
  name: string;
  color: string;
  /** IANA zone, e.g. "America/Toronto". */
  timeZone: string;
  /**
   * Typical week in the member's own wall-clock time: 672 chars, one per
   * 15-minute quantum starting Monday 00:00. "f", "m", or "." for unmarked.
   */
  pattern: string;
  /** Date-specific marks keyed by UTC quantum (epoch ms / 15 min). */
  overrides: Record<number, OverrideMark>;
}

export interface Group {
  id: string;
  name: string;
  slotMinutes: SlotMinutes;
  members: Member[];
  /** The member this browser is signed in as; the only one it may write to. */
  meId: string;
  /** The only member who may change group settings. */
  ownerId: string;
}
