"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { retryLoad } from "@/lib/store";

type Profile = { name: string; color: string; timeZone: string };

const COLORS: [hex: string, name: string][] = [
  ["#c2410c", "Orange"],
  ["#0f766e", "Teal"],
  ["#7c3aed", "Violet"],
  ["#be185d", "Pink"],
  ["#1d4ed8", "Blue"],
  ["#4d7c0f", "Green"],
  ["#b45309", "Amber"],
  ["#0e7490", "Cyan"],
];
export const field = "rounded-md border border-line bg-cell px-2 py-1";

/** POSTs JSON; returns the server's error message (or null on success) and the reply. */
async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const reply = await res.json().catch(() => null);
  return { error: res.ok ? null : ((reply?.error as string | undefined) ?? "Something went wrong"), reply };
}
const post = async (url: string, body: unknown) => (await postJson(url, body)).error;

/** A personal sign-in link, shown once: it signs in any device, so it is kept like a password. */
export function AccessLink({ token, onDone }: { token: string; onDone?: () => void }) {
  // After the #, so the token never reaches a server log.
  const link = `${location.origin}/sign-in#${token}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-muted">
        This is your personal link. Open it on any device to get back in, so save it somewhere safe (a password manager
        or a note to yourself). It is not shown again, and anyone who has it can sign in as you.
      </p>
      <input readOnly className={field} value={link} aria-label="Your personal link" onFocus={(e) => e.target.select()} />
      <div className="flex gap-2">
        {/* Browsers only offer the clipboard on HTTPS; elsewhere the text box above can still be copied by hand. */}
        {navigator.clipboard && (
          <button
            type="button"
            className="rounded-md border border-foreground px-3 py-1.5 font-medium"
            onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true), () => {})}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        )}
        {onDone && (
          <button type="button" className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background" onClick={onDone}>
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

/** The member's color swatches; the one in use is pressed. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-xs text-muted">Your color</legend>
      <div className="flex flex-wrap gap-2">
        {COLORS.map(([c, name]) => (
          <button
            type="button"
            key={c}
            aria-label={name}
            aria-pressed={value === c}
            onClick={() => onChange(c)}
            className={`size-7 rounded-full border-2 ${value === c ? "border-foreground" : "border-transparent"}`}
            style={{ background: c }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function ProfileForm({
  title,
  children,
  footer,
  submit,
  onSubmit,
  onDone,
}: {
  title: string;
  children?: ReactNode;
  /** Shown below the form. */
  footer?: ReactNode;
  submit: string;
  /** Resolves to an error message, or the personal link token once the person is in. */
  onSubmit: (profile: Profile, form: FormData) => Promise<{ error: string | null; accessToken?: string }>;
  /** Called once the person has seen their personal link. */
  onDone: () => void;
}) {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const continuing = useRef(false);
  const [color, setColor] = useState(() => COLORS[Math.floor(Math.random() * COLORS.length)][0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = Intl.supportedValuesOf("timeZone");

  const submitForm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    const result = await onSubmit({ name: String(form.get("name")), color, timeZone: String(form.get("timeZone")) }, form);
    setError(result.error);
    setAccessToken(result.accessToken ?? null);
    setBusy(false);
  };

  // The link is shown once, so leaving this screen without saving it is worth a warning.
  useEffect(() => {
    if (!accessToken) return;
    const warn = (e: BeforeUnloadEvent) => !continuing.current && e.preventDefault();
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [accessToken]);

  if (accessToken)
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-10 pb-16">
        <h1 className="text-2xl font-semibold tracking-tight">You are in</h1>
        <AccessLink
          token={accessToken}
          onDone={() => {
            continuing.current = true;
            onDone();
          }}
        />
      </main>
    );

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-10 pb-16">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <form onSubmit={submitForm} className="flex flex-col gap-3 text-sm">
        {children}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Your name</span>
          <input name="name" required maxLength={60} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Your time zone</span>
          <select name="timeZone" defaultValue={defaultZone} className={field}>
            {!zones.includes(defaultZone) && <option>{defaultZone}</option>}
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <ColorPicker value={color} onChange={setColor} />
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <button disabled={busy} className="rounded-md bg-foreground px-3 py-2 font-medium text-background disabled:opacity-50">
          {submit}
        </button>
      </form>
      {footer}
    </main>
  );
}

/** Shown when this browser has no session: start a group. Joining happens through an invite link. */
export function Landing() {
  return (
    <ProfileForm
      title="Cafecito"
      submit="Create group"
      footer={<EmailSignIn />}
      onDone={retryLoad}
      onSubmit={async (profile, form) => {
        const { error, reply } = await postJson("/api/groups", { ...profile, groupName: form.get("groupName") });
        return { error, accessToken: reply?.accessToken };
      }}
    >
      <p className="text-muted">
        When can we all get together? Create a group, then send its invite link to your friends. Got an invite link
        already? Open it to join.
      </p>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted">Group name</span>
        <input name="groupName" required maxLength={60} className={field} />
      </label>
    </ProfileForm>
  );
}

export function JoinForm({ token }: { token: string }) {
  const [info, setInfo] = useState<{ groupName: string; members: string[] } | "invalid" | null>(null);
  useEffect(() => {
    fetch(`/api/invites/${token}`)
      .then((res) => (res.ok ? res.json() : "invalid"))
      .catch(() => "invalid" as const)
      .then(setInfo);
  }, [token]);

  if (!info) return <main className="p-6 text-muted">Loading…</main>;
  if (info === "invalid")
    return <main className="p-6">This invite link is no longer valid. Ask the group&apos;s owner for a new one.</main>;
  return (
    <ProfileForm
      title={`Join ${info.groupName}`}
      submit="Join"
      // A full load, so the app starts signed in.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      onDone={() => (location.href = "/")}
      onSubmit={async (profile) => {
        const { error, reply } = await postJson(`/api/invites/${token}`, profile);
        return { error, accessToken: reply?.accessToken };
      }}
    >
      <p className="text-muted">
        Already in: {info.members.map((n) => n.trim() || "Unnamed").join(", ")}. Everyone in the group can see your
        name, your time zone and when you are free or maybe. A busy mark never shows a reason.
      </p>
    </ProfileForm>
  );
}

/** "Lost access?": emails a sign-in link to a recovery address, when the server can send email. */
function EmailSignIn() {
  const [enabled, setEnabled] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/sign-in")
      .then((res) => res.json())
      .then((body) => setEnabled(body.enabled === true))
      .catch(() => {});
  }, []);
  if (!enabled) return null;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const error = await post("/api/sign-in", { email: new FormData(e.currentTarget).get("email") });
    setError(error);
    setSent(!error);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line pt-4 text-sm">
      <h2 className="font-medium">Already in a group on another device?</h2>
      {sent ? (
        <p role="status">If that address is set for recovery in a group, a sign-in link is on its way. It works for 30 minutes.</p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Your recovery email</span>
            <input name="email" type="email" required autoComplete="email" className={field} />
          </label>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <button className="self-start rounded-md border border-foreground px-3 py-1.5 font-medium">Email me a sign-in link</button>
        </>
      )}
    </form>
  );
}

/** Where a personal link (`/sign-in#token`) or an emailed one (`/sign-in/token`) lands. Signing in takes a click, so a mail scanner opening the link does not use it up. */
export function SignInLink({ token }: { token?: string }) {
  const [error, setError] = useState<string | null>(null);
  // Read once, then dropped from the address bar so a screenshot or screen share does not show it.
  const [secret] = useState(() => token ?? (typeof location === "undefined" ? "" : location.hash.slice(1)));
  useEffect(() => {
    if (location.hash) history.replaceState(null, "", location.pathname);
  }, []);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-10 pb-16 text-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to Cafecito</h1>
      <p className="text-muted">This signs you in on this device.</p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <button
        className="rounded-md bg-foreground px-3 py-2 font-medium text-background"
        onClick={async () => {
          const error = await post("/api/sign-in/link", { token: secret });
          // A full load, so the app starts signed in.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          if (!error) location.href = "/";
          setError(error);
        }}
      >
        Sign in on this device
      </button>
    </main>
  );
}
