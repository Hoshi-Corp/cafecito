"use client";

import { useEffect, useState } from "react";
import { call } from "./Manage";

type State = { publicKey: string; subscribed: boolean };

/** The key the browser wants as bytes, from the URL-safe base64 the server sends. */
const keyBytes = (key: string) =>
  Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const BLOCKED = "Notifications are blocked for this site in your browser settings.";

/** Why this browser cannot do push, in words for the person. iPhones only allow it for an app added to the Home Screen. */
const whyNot = () =>
  !window.isSecureContext
    ? "Notifications need a secure (https) address, and this page is not on one. Ask whoever runs this server."
    : /iPhone|iPad|iPod/.test(navigator.userAgent)
      ? "On an iPhone or iPad, add Cafecito to the Home Screen first (Share, then Add to Home Screen) and open it from there."
      : "This browser cannot show notifications.";

/** One switch: notifications on this device. */
export function Notifications() {
  const [state, setState] = useState<State | null>(null);
  const [note, setNote] = useState<string | null>(() => (supported() && Notification.permission === "denied" ? BLOCKED : null));

  useEffect(() => {
    if (supported())
      call("/me/push", "GET")
        .then((res) => (res.ok ? res.json() : null))
        .then(setState)
        .catch(() => {});
  }, []);

  if (!supported()) return <p className="text-xs text-muted">{whyNot()}</p>;
  if (!state) return null;

  const turnOn = async () => {
    if ((await Notification.requestPermission()) !== "granted") return setNote(BLOCKED);
    const registration = await navigator.serviceWorker.register("/sw.js");
    const sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(state.publicKey) });
    const res = await call("/me/push", "PUT", sub.toJSON());
    if (!res.ok) return setNote("Could not turn notifications on.");
    setState({ ...state, subscribed: true });
  };

  const turnOff = async () => {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
    await call("/me/push", "DELETE");
    setState({ ...state, subscribed: false });
  };

  const toggle = async () => {
    setNote(null);
    try {
      await (state.subscribed ? turnOff() : turnOn());
    } catch {
      setNote("Could not change notifications on this device.");
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs text-muted">Notifications on this device</h4>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={state.subscribed} onChange={toggle} />
        Tell me when a plan is proposed, or deleted after I said yes
      </label>
      {note && <p role="status" className="text-xs text-muted">{note}</p>}
    </div>
  );
}
