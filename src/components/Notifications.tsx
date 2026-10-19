"use client";

import { useEffect, useState } from "react";
import { call } from "./Manage";

type State = { publicKey: string; subscribed: boolean };

/** The key the browser wants as bytes, from the URL-safe base64 the server sends. */
const keyBytes = (key: string) =>
  Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** The browser's own push subscription for this site, if it has one. */
const browserSubscription = async () => (await navigator.serviceWorker.getRegistration("/sw.js"))?.pushManager.getSubscription();

/** iPadOS 13 and later says "Macintosh" in its user agent, so a touch screen on a "Mac" is an iPad. */
const isApplePhoneOrTablet = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

const BLOCKED = "Notifications are blocked for this site in your browser settings.";

/** Why this browser cannot do push, in words for the person. iPhones only allow it for an app added to the Home Screen. */
const whyNot = () =>
  !window.isSecureContext
    ? "Notifications need a secure (https) address, and this page is not on one. Ask whoever runs this server."
    : isApplePhoneOrTablet()
      ? "On an iPhone or iPad, add Cafecito to the Home Screen first (Share, then Add to Home Screen) and open it from there. You will need to sign in again there, so keep your personal link handy."
      : "This browser cannot show notifications.";

/** One switch: notifications on this device. */
export function Notifications() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(() => (supported() && Notification.permission === "denied" ? BLOCKED : null));

  useEffect(() => {
    if (supported())
      call("/me/push", "GET")
        .then((res) => (res.ok ? res.json() : null))
        .then(async (s: State | null) => {
          // The server's row can outlive the browser's (permission revoked, site data cleared): show off, and tidy the row.
          if (s?.subscribed && !(Notification.permission === "granted" && (await browserSubscription()))) {
            await call("/me/push", "DELETE").catch(() => {}); // best effort: the switch must show either way
            s = { ...s, subscribed: false };
          }
          setState(s);
        })
        .catch(() => {});
  }, []);

  if (!supported()) return <p className="text-sm text-muted">{whyNot()}</p>;
  if (!state) return null;

  const turnOn = async () => {
    if ((await Notification.requestPermission()) !== "granted") return setNote(BLOCKED);
    await navigator.serviceWorker.register("/sw.js");
    // register() returns before the worker runs, and subscribing needs a running one (the first tap would fail).
    const registration = await navigator.serviceWorker.ready;
    // A subscription made with an earlier server key (a restored backup, say) makes subscribe() throw, so start clean.
    await (await registration.pushManager.getSubscription())?.unsubscribe();
    const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey) });
    const res = await call("/me/push", "PUT", sub.toJSON()).catch(() => null);
    if (!res?.ok) {
      await sub.unsubscribe(); // the server never heard of it, so do not leave the browser holding one
      return setNote("Could not turn notifications on.");
    }
    setState({ ...state, subscribed: true });
  };

  const turnOff = async () => {
    await (await browserSubscription())?.unsubscribe();
    await call("/me/push", "DELETE");
    setState({ ...state, subscribed: false });
  };

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      await (state.subscribed ? turnOff() : turnOn());
    } catch {
      setNote("Could not change notifications on this device.");
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-sm text-muted">Notifications on this device</h4>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={state.subscribed} disabled={busy} onChange={toggle} />
        Tell me when a plan is proposed, or deleted after I said yes
      </label>
      {note && <p role="status" className="text-sm text-muted">{note}</p>}
    </div>
  );
}
