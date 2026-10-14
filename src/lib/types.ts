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
  /** My recovery email; never sent for anyone else. */
  email?: string | null;
  /** Whether this server can send sign-in links by email. */
  recovery?: boolean;
}

export interface OverrideChange {
  set: Record<number, OverrideMark>;
  remove: number[];
}

/** Sent to a group's browsers when someone changes something. */
export interface GroupEvent {
  /** Member who made the change. */
  by: string;
  /** Their new state, when only their availability or profile changed. */
  member?: Member;
  /** Only the override marks that changed, so a paint stroke does not resend a member's whole history. */
  overrides?: OverrideChange;
  /** Anything bigger (settings, people joining or leaving): load the group again. */
  reload?: true;
}

export type Rsvp = "y" | "m" | "n";

/** A slot the group proposes to meet in. Times are UTC quanta, like overrides. */
export interface Outing {
  id: string;
  title: string;
  place: string;
  startQ: number;
  endQ: number;
  /** Who proposed it; null once they left the group. */
  createdBy: string | null;
  /** Answers by member id; members who have not answered are absent. */
  rsvps: Record<string, Rsvp>;
}
