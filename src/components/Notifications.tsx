"use client";

import { useEffect, useState } from "react";
import { call } from "./Manage";

type State = { publicKey: string; subscribed: boolean };

/** The key the browser wants as bytes, from the URL-safe base64 the server sends. */
const keyBytes = (key: string) =>
  Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** One switch: notifications on this device. */
export function Notifications() {
  const [state, setState] = useState<State | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (supported())
      call("/me/push", "GET")
        .then((res) => (res.ok ? res.json() : null))
        .then(setState)
        .catch(() => {});
  }, []);

  if (!supported())
    return (
      <p className="text-xs text-muted">
        Notifications need a secure (https) address and a browser that supports them. On an iPhone, add Cafecito to the Home Screen first.
      </p>
    );
  if (!state) return null;

  const turnOn = async () => {
    if ((await Notification.requestPermission()) !== "granted") return setNote("Notifications are blocked for this site in your browser settings.");
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
        Tell me when someone proposes a plan
      </label>
      {note && <p role="status" className="text-xs text-muted">{note}</p>}
    </div>
  );
}
