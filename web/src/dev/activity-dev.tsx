// The dev server only (/dev-activity): the Activity monitor on its own, over a made up Mac (src/dev/activity-fake.ts), for trying it
// and for screenshots. ?open opens it at once, ?tab=perf picks a view, ?noisland grows it out of its button instead of the island.
import { useEffect, useState } from "react";
import { ActivityButton } from "../views/ActivityMonitor";
import { startActivityFake } from "./activity-fake";
import type { Speed } from "../core/activitymon";

const q = new URLSearchParams(location.search);
// Made up screen time for App history (one record a day for the last week).
void import("../core/vault").then((v) => {
  const day = (k: number) => new Date(Date.now() - k * 86400e3).toISOString().slice(0, 10);
  v.__devLoad(Array.from({ length: 7 }, (_, k) => ({ id: `st${k}`, ws: null, kind: "screentime" as const, author: null, updatedAt: null,
    data: { day: day(k), device: "mac", updatedAt: "", apps: [{ id: "com.example.browser", name: "Sample Browser", secs: 9200 - k * 300 }, { id: "com.example.code", name: "Sample Code", secs: 12400 - k * 500 },
      { id: "com.example.chat", name: "Sample Chat", secs: 2100 }, { id: "com.example.music", name: "Sample Music", secs: 900 }, { id: "com.example.mail", name: "Sample Mail", secs: 1300 }, { id: "com.example.notes", name: "Sample Notes", secs: 640 }] } })));
});
startActivityFake({ place: !q.has("noisland"), ticks: q.has("still") ? Number(q.get("still")) || 8 : undefined });

export default function ActivityDev() {
  const [speed, setSpeed] = useState<Speed>(1);
  const [cols, setCols] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    if (!q.has("open")) return;
    const t = window.setTimeout(() => window.dispatchEvent(new CustomEvent("ps-activity-open", { detail: q.get("tab") || undefined })), 300);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="tm-overlay amdev">
      <style>{`html,body{margin:0;height:100%;background:radial-gradient(80% 60% at 30% 20%,#2a1840,#0b0712 70%);color:#fff;font-family:Inter,system-ui,-apple-system,sans-serif;overflow:hidden}
        .amdev{position:fixed;inset:0}.amdev-bar{position:absolute;top:14px;right:18px;display:flex;gap:8px}
        .amdev-bar .tm-pill-btn{width:34px;height:34px;border-radius:999px;display:grid;place-items:center;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);cursor:pointer}
        .amdev-island{position:absolute;left:50%;top:0;width:196px;height:32px;transform:translateX(-50%);background:#000;border-radius:0 0 16px 16px;z-index:60}
        .dx-layer{position:absolute;inset:0;z-index:50}`}</style>
      <div className="amdev-island" />
      <div className="amdev-bar">
        <span className="tm-pill-btn" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18v12h-4.5v3h-9v-3H3z" /></svg></span>
        <ActivityButton speed={speed} cols={cols} save={(p) => { if (p.activitySpeed) setSpeed(p.activitySpeed); if (p.activityCols) setCols(p.activityCols); }} />
      </div>
    </div>
  );
}
