// Sentry mode's restart if not unlocked, told to the Mac (V1.49). The Mac's restart helper pop up (ps-mac
// HelperAlert.swift) shows whenever auto reboot or this restart is on, and only the page knows this setting.
// Sent as {type:"sentryPrefs", restartH} when it changes and every minute (a restarted shell catches up). While the
// vault is locked nothing is sent: the Mac keeps the last value it got (8 hours, the default, until then).
import { vaultStore } from "./core/vault";
import { settingsData } from "./core/select";
import { sentryPrefsMsg } from "./core/sentry";

type Post = (m: object) => void;

export function startSentryPrefs(post: Post) {
  let last = "";
  const sync = (force = false) => {
    const s = vaultStore.get();
    if (s.status !== "unlocked" || s.role !== "owner") return;
    const msg = sentryPrefsMsg(settingsData(s) as { sentry?: unknown });
    const json = JSON.stringify(msg);
    if (!force && json === last) return;
    last = json;
    post({ type: "sentryPrefs", ...msg });
  };
  let t = 0;
  vaultStore.subscribe(() => { clearTimeout(t); t = window.setTimeout(() => sync(), 150); });
  window.setInterval(() => sync(true), 60_000);
  sync();
}
