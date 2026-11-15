// Is any Gmail account connected (V1.62)? One gmail_status call per page, kept 10 minutes, shared by the email panel and
// Settings, Client emails. Only asked while the answer matters (the panel is empty, or Settings is open), so it adds
// almost no traffic (Supabase egress rule: only move what changed). A failed call counts as "not connected": the prompt
// then shows the way to connect, which is never harmful.
import { useEffect, useSyncExternalStore } from "react";
import { sb } from "../core/vault";
import { gmailKnownFrom, type GmailKnown } from "../core/mailempty";

const KEEP_MS = 10 * 60_000;
let known: GmailKnown = null;
let at = 0;
let asking: Promise<void> | null = null;
const subs = new Set<() => void>();

function ask(): void {
  if (asking || (known !== null && Date.now() - at < KEEP_MS)) return;
  asking = (async () => {
    let next: GmailKnown;
    try { const { data, error } = await sb.rpc("gmail_status"); next = gmailKnownFrom(data, !!error); }
    catch { next = false; }
    known = next; at = Date.now(); asking = null;
    subs.forEach((f) => f());
  })();
}
/** Settings calls this after a change, so the panel asks again on its next look. */
export function forgetGmailKnown(): void { at = 0; }

/** The answer, asking once when `need` is true. */
export function useGmailKnown(need: boolean): GmailKnown {
  const v = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => known);
  useEffect(() => { if (need) ask(); }, [need]);
  return v;
}
