// "Last online" in the network monitor (the developer, 4 Nov 2026): the pure half. This Mac's drops come from PS
// (ps-mac Sources/NetUptime.swift); the other devices' "last seen" is worked out from records the Tab list
// already holds (its copy of the vault: Second Computer hellos and heartbeats, the phone's screen time and
// notes). Nothing here asks a server: no new polling, no Supabase egress.
import type { Doc } from "./model";
import { isOnline, ONLINE_MS, FUTURE_SKEW } from "./second.ts";
import { parseEnv, secondView, type SecondLocal } from "../second/view.ts";

export type DropCause = "wifi-off" | "wifi-lost" | "no-link" | "no-route" | "vpn" | "dns" | "unknown";
export interface Drop { start: number; end?: number; cause: DropCause; also?: DropCause[]; via?: string; note?: string }
/** What PS sends: {kind:"uptime"}. `since`: offline since (online false) or online since (0 = not known yet). */
export interface Uptime { online: boolean; since: number; cause?: DropCause; checkedAt: number; goodAt: number; keepDays: number; drops: Drop[] }

export const CAUSES: Record<DropCause, { label: string; why: string; tone: "bad" | "warn" }> = {
  "wifi-off": { label: "Wi-Fi off", why: "Wi-Fi was switched off and no cable was in.", tone: "warn" },
  "wifi-lost": { label: "Wi-Fi lost", why: "Wi-Fi was on but not joined to any network.", tone: "bad" },
  "no-link": { label: "No cable or Wi-Fi", why: "No Ethernet link and no Wi-Fi network.", tone: "bad" },
  "no-route": { label: "No route", why: "Connected, but the network gave no way out (no router).", tone: "bad" },
  vpn: { label: "VPN tunnel down", why: "The VPN app was reconnecting and blocking traffic. Usually the line before the VPN (router or provider) was down.", tone: "bad" },
  dns: { label: "DNS failing", why: "The tunnel was up but DNS gave no answer, so names could not be looked up.", tone: "warn" },
  unknown: { label: "Unknown", why: "PS app could not tell why.", tone: "bad" },
};
export const causeOf = (c: string | undefined): DropCause => (c && c in CAUSES ? (c as DropCause) : "unknown");

/** "25 s", "12 min", "1 h 4 min", "2 d 3 h". */
export function dur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`;
}

/** The figures over the list: drops in the last day and week, time offline this week, the longest in the kept days. */
export function dropStats(drops: Drop[], now: number) {
  const D = 86_400_000;
  const len = (d: Drop) => Math.max(0, (d.end ?? now) - d.start);
  const overlap = (d: Drop, from: number) => Math.max(0, (d.end ?? now) - Math.max(d.start, from));
  const inLast = (ms: number) => drops.filter((d) => (d.end ?? now) >= now - ms);
  let longest: Drop | null = null;
  for (const d of drops) if (!longest || len(d) > len(longest)) longest = d;
  return {
    day: inLast(D).length,
    week: inLast(7 * D).length,
    weekMs: drops.reduce((s, d) => s + overlap(d, now - 7 * D), 0),
    longest, longestMs: longest ? len(longest) : 0,
  };
}

/** Group the drops (newest first) by local day for the list. */
export function byDay(drops: Drop[], tz?: string): { day: string; drops: Drop[] }[] {
  const key = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  const out: { day: string; drops: Drop[] }[] = [];
  for (const d of [...drops].sort((a, b) => b.start - a.start)) {
    const k = key(d.start);
    const last = out[out.length - 1];
    if (last && last.day === k) last.drops.push(d); else out.push({ day: k, drops: [d] });
  }
  return out;
}

export interface Seen { id: string; kind: "mac" | "phone"; name: string; detail: string; at: number; online: boolean; source: string }

/** The other Macs and the phone, newest first, from records the vault already holds. Times from a clock more than
 *  5 minutes ahead are ignored (they would read "online" for ever). */
export function devicesSeen(docs: Doc[], local: SecondLocal, now = Date.now()): Seen[] {
  const ok = (t: unknown) => (typeof t === "number" && Number.isFinite(t) && t > 0 && t - now < FUTURE_SKEW ? t : 0);
  const v = secondView(docs, local, now);
  const out: Seen[] = [];
  for (const m of v.others) {
    if (m.me) continue;
    const at = ok(m.at);
    out.push({ id: m.device, kind: "mac", name: m.name || "Mac", detail: [m.chip, m.app ? `PS app ${m.app}` : ""].filter(Boolean).join(" · "),
      at, online: isOnline({ at }, now), source: m.off ? "its hello (Second Computer is off there)" : "Second Computer heartbeat" });
  }
  // The phone: its newest screen time save, note or announcement (it only writes while PS GOS runs).
  let phone = 0, from = "";
  const take = (t: number, what: string) => { if (t > phone) { phone = t; from = what; } };
  for (const d of docs) {
    if (d.kind === "screentime") {
      const x = d.data as { device?: string; updatedAt?: string };
      if (x.device === "gos") take(ok(Date.parse(String(x.updatedAt || ""))), "screen time from the phone");
    } else if (d.kind === "smsg") {
      const x = d.data as { phone?: boolean; at?: number };
      if (x.phone) take(ok(Number(x.at)), "a note from the phone");
    } else if (d.kind === "scmd") {
      const b = parseEnv<{ at?: number; from?: string }>((d.data as { env?: unknown }).env);
      if (b && v.phones.some((p) => p.device === b.from)) take(ok(Number(b.at)), "a command from the phone");
    }
  }
  for (const p of v.phones) take(ok(p.at), "the phone's key announcement");
  if (phone || v.phones.length) out.push({ id: "phone", kind: "phone", name: v.phones[0]?.name || "Phone", detail: "PS app GOS", at: phone, online: phone > 0 && now - phone < ONLINE_MS, source: from || "nothing yet" });
  return out.sort((a, b) => b.at - a.at);
}
