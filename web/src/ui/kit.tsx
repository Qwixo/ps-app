// Shared UI pieces and helpers. Views import from here so the app looks like one thing.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { vaultStore, type Snapshot } from "../core/vault";

export function useVault(): Snapshot {
  return useSyncExternalStore(vaultStore.subscribe, vaultStore.get, vaultStore.get);
}

// ---------- dates (all local time, ISO date strings "YYYY-MM-DD") ----------
export const todayISO = () => toISODate(new Date());
export function toISODate(d: Date) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function parseISODate(s: string) {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(iso: string, n: number) {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
export function daysFromToday(iso: string) {
  return Math.round((parseISODate(iso).getTime() - parseISODate(todayISO()).getTime()) / 864e5);
}
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Wed 21 Oct" (adds the year when it is not this year) */
export function fmtDate(iso?: string | null) {
  if (!iso) return "";
  const d = parseISODate(iso);
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}${y}`;
}
/** "Today", "Tomorrow", "Yesterday", "In 3 days", "4 days late", else fmtDate */
export function relDate(iso?: string | null) {
  if (!iso) return "";
  const n = daysFromToday(iso);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 1 && n <= 6) return `In ${n} days`;
  if (n < -1 && n >= -30) return `${-n} days late`;
  return fmtDate(iso);
}
export function fmtDateTime(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${fmtDate(toISODate(d))}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// ---------- money ----------
export function money(amount?: number | null, currency = "USD") {
  if (amount == null || isNaN(amount)) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}
/** Sums by currency: "$4,000 + GBP 800" */
export function sumMoney(items: { amount: number; currency: string }[]) {
  const by = new Map<string, number>();
  for (const i of items) by.set(i.currency, (by.get(i.currency) || 0) + i.amount);
  if (!by.size) return money(0, "USD");
  return [...by.entries()].map(([c, a]) => money(a, c)).join(" + ");
}

// ---------- toasts ----------
type ToastT = { id: number; text: string; action?: { label: string; run: () => void } };
let toasts: ToastT[] = [];
const tl = new Set<() => void>();
export function toast(text: string, action?: ToastT["action"], ms = 5000) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, action }];
  tl.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); tl.forEach((l) => l()); }, ms);
}
export function Toasts() {
  const list = useSyncExternalStore((l) => { tl.add(l); return () => tl.delete(l); }, () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div className="toast" key={t.id}>
          <span style={{ flex: 1 }}>{t.text}</span>
          {t.action && <button className="btn sm" onClick={() => { t.action!.run(); toasts = toasts.filter((x) => x.id !== t.id); tl.forEach((l) => l()); }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  );
}

// ---------- modal ----------
export function Modal({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal stack" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="row between">
          <h2 className="h2">{title}</h2>
          <button className="btn quiet icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        {children}
        {footer && <div className="row wrap-ok" style={{ justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

export function confirmAsk(text: string) {
  return window.confirm(text);
}

// ---------- small components ----------
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M23 8.5A10 10 0 1 0 23 23.5" fill="none" stroke="var(--pink)" strokeWidth="4" strokeLinecap="round" />
      <rect x="20" y="13" width="7" height="6" rx="1.5" fill="var(--pink-d)" />
    </svg>
  );
}

export function Ring({ pct, size = 64, stroke = 7, amber }: { pct: number; size?: number; stroke?: number; amber?: boolean }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${pct}% done`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--soft)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={amber ? "var(--warn)" : "var(--pink)"} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.7,.2,1)" }} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.24} fontWeight={800} fill="var(--ink)">{pct}%</text>
    </svg>
  );
}

export function DueText({ iso, done }: { iso?: string | null; done?: boolean }) {
  if (!iso) return null;
  const n = daysFromToday(iso);
  const cls = done ? "muted" : n < 0 ? "err" : n === 0 ? "" : "muted";
  return <span className={`small num ${cls}`} style={n === 0 && !done ? { color: "var(--warn)", fontWeight: 650 } : undefined}>{relDate(iso)}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

export function useHash(): string {
  const [h, setH] = useState(location.hash || "#/today");
  useEffect(() => {
    const f = () => setH(location.hash || "#/today");
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return h;
}
export const go = (hash: string) => { location.hash = hash; };

export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { window.prompt("Copy this:", text); }
}

// ---------- icons (inline, stroke based) ----------
const P: Record<string, ReactNode> = {
  today: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  todo: <><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></>,
  clients: <><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="17" y="4" width="4" height="7" rx="1.5" /></>,
  proposals: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  meetings: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10l5-3v10l-5-3" /></>,
  emails: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  cal: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 18l-6-6 6-6" />,
  check: <path d="M5 12l5 5L20 7" />,
  map: <><path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" /><path d="M9 4v13.5M15 6.5V20" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></>,
  sync: <><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16" /><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" /><path d="M21 3v5h-5M3 21v-5h5" /></>,
  money: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  door: <><path d="M5 21V4a1 1 0 0 1 1-1h9l4 2v16" /><path d="M3 21h18" /><path d="M15 3v18" /><circle cx="11.5" cy="12.5" r=".9" fill="currentColor" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></>,
  up: <path d="M12 19V5M5 12l7-7 7 7" />,
  down: <path d="M12 5v14M19 12l-7 7-7-7" />,
  grip: <><circle cx="9" cy="6" r="1.3" /><circle cx="15" cy="6" r="1.3" /><circle cx="9" cy="12" r="1.3" /><circle cx="15" cy="12" r="1.3" /><circle cx="9" cy="18" r="1.3" /><circle cx="15" cy="18" r="1.3" /></>,
  dots: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  wifi: <><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0" /><circle cx="12" cy="19.5" r="1" /></>,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
};
export function Icon({ name, size = 18 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name] ?? null}
    </svg>
  );
}

// ---------- client time zones ----------
export const TIMEZONES: { tz: string; label: string }[] = [
  { tz: "America/Los_Angeles", label: "Los Angeles (Pacific)" },
  { tz: "America/Phoenix", label: "Phoenix (Arizona)" },
  { tz: "America/Denver", label: "Denver (Mountain)" },
  { tz: "America/Chicago", label: "Chicago, Dallas (Central)" },
  { tz: "America/New_York", label: "New York, Florida, Ohio, Kentucky (Eastern)" },
  { tz: "America/Toronto", label: "Toronto" },
  { tz: "Europe/London", label: "London (UK)" },
  { tz: "Europe/Paris", label: "Paris, Berlin (Central Europe)" },
  { tz: "Asia/Dubai", label: "Dubai" },
  { tz: "Asia/Karachi", label: "Pakistan" },
  { tz: "Australia/Perth", label: "Perth" },
  { tz: "Australia/Sydney", label: "Sydney, Melbourne" },
  { tz: "Pacific/Auckland", label: "Auckland" },
];

function tzOffsetMin(tz: string, at = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round((Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - at.getTime()) / 60000);
}

/** "3:42 PM", "8h behind you", whether it is night there. */
export function clientClock(tz?: string | null) {
  if (!tz) return null;
  try {
    const now = new Date();
    const time = now.toLocaleTimeString([], { timeZone: tz, hour: "numeric", minute: "2-digit" });
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now));
    const diffH = (tzOffsetMin(tz, now) + now.getTimezoneOffset()) / 60;
    const n = Math.abs(diffH);
    const h = Number.isInteger(n) ? `${n}h` : `${n.toFixed(1)}h`;
    const diff = diffH === 0 ? "same time as you" : diffH < 0 ? `${h} behind you` : `${h} ahead of you`;
    const city = TIMEZONES.find((t) => t.tz === tz)?.label.split(" (")[0].split(",")[0] ?? tz.split("/").pop()!.replace(/_/g, " ");
    return { time, diff, city, night: hour < 8 || hour >= 21 };
  } catch {
    return null;
  }
}

function useMinuteTick() {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), 60_000); return () => clearInterval(t); }, []);
}

/** Small live clock for a client: "3:42 PM in Cleveland · 5h behind you". */
export function TzClock({ tz, compact }: { tz?: string | null; compact?: boolean }) {
  useMinuteTick();
  const c = clientClock(tz);
  if (!c) return null;
  return (
    <span className={`small num ${c.night ? "" : "muted"}`} style={c.night ? { color: "var(--warn)" } : undefined}
      title={`${c.city}: ${c.time}, ${c.diff}${c.night ? ". Probably outside working hours" : ""}`}>
      {compact ? `${c.time} ${c.city}` : `${c.time} in ${c.city} · ${c.diff}${c.night ? " · after hours" : ""}`}
    </span>
  );
}

export function TzSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = TIMEZONES.some((t) => t.tz === value);
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Not set</option>
      {!known && value && <option value={value}>{value}</option>}
      {TIMEZONES.map((t) => <option key={t.tz} value={t.tz}>{t.label}</option>)}
    </select>
  );
}
