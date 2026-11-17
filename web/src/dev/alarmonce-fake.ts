// DEV ONLY: Just tomorrow (PS 1.65) with fictional alarms, for screenshots. /dev-alarm-once?once=none|later|skip[&screen]
// Never imported in production builds (guarded by import.meta.env.DEV in App.tsx).
import { fakeDocs } from "./fake";
import { __devLoad } from "../core/vault";
import type { Doc } from "../core/model";
import type { AlarmOnce } from "../core/alarmonce";

const ALARMS = [{ id: "a1", at: "09:00", on: true }, { id: "b2", at: "09:10", on: true }, { id: "c3", at: "17:30", on: false }];
export function loadAlarmOnceFake(once: AlarmOnce | null) {
  const docs: Doc[] = fakeDocs().filter((d) => d.kind !== "settings");
  docs.push({ id: "settings-dev", ws: null, kind: "settings", data: { sleepMode: { alarms: ALARMS, once } }, author: null, updatedAt: new Date().toISOString() } as Doc);
  __devLoad(docs);
}
export function startAlarmOnceFake() {
  const q = new URLSearchParams(location.search);
  const day = (() => { const d = new Date(Date.now() + 12 * 3600_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const rings = [{ id: "a1", day }, { id: "b2", day }];
  const kind = q.get("once");
  loadAlarmOnceFake(kind === "later" ? { rings, to: `${day}T10:30`, set: new Date().toISOString() } : kind === "skip" ? { rings, to: null, set: new Date().toISOString() } : null);
  (window as unknown as { __aonLoad: typeof loadAlarmOnceFake }).__aonLoad = loadAlarmOnceFake;
  window.setTimeout(() => {
    if (q.has("screen")) void import("../sleepmode/engine").then((e) => e.goToSleep());
    else void import("../views/SleepSettings").then((s) => s.openSleepSettings("alarms"));
  }, 600);
}
