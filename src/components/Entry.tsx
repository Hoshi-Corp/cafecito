"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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

/** POSTs JSON; returns the server's error message, or null on success. */
async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.ok ? null : ((await res.json().catch(() => null))?.error ?? "Something went wrong");
}

function ProfileForm({
  title,
  children,
  footer,
  submit,
  onSubmit,
}: {
  title: string;
  children?: ReactNode;
  /** Shown below the form. */
  footer?: ReactNode;
  submit: string;
  onSubmit: (profile: Profile, form: FormData) => Promise<string | null>;
}) {
  const [color, setColor] = useState(() => COLORS[Math.floor(Math.random() * COLORS.length)][0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = Intl.supportedValuesOf("timeZone");

  const submitForm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(await onSubmit({ name: String(form.get("name")), color, timeZone: String(form.get("timeZone")) }, form));
    setBusy(false);
  };

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
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-xs text-muted">Your color</legend>
          <div className="flex gap-2">
            {COLORS.map(([c, name]) => (
              <button
                type="button"
                key={c}
                aria-label={name}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`size-7 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                style={{ background: c }}
              />
            ))}
          </div>
        </fieldset>
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
      onSubmit={async (profile, form) => {
        const error = await post("/api/groups", { ...profile, groupName: form.get("groupName") });
        if (!error) retryLoad();
        return error;
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
      onSubmit={async (profile) => {
        const error = await post(`/api/invites/${token}`, profile);
        // A full load, so the app starts signed in.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        if (!error) location.href = "/";
        return error;
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

/** Where an emailed link lands. Signing in takes a click, so a mail scanner opening the link does not use it up. */
export function SignInLink({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-10 pb-16 text-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to Cafecito</h1>
      <p className="text-muted">This signs you in on this device. The link works once.</p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <button
        className="rounded-md bg-foreground px-3 py-2 font-medium text-background"
        onClick={async () => {
          const error = await post(`/api/sign-in/${token}`, {});
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
