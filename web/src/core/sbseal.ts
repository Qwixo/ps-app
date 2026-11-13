// Sealing a shared Soundboard sound (V1.47, squad/sbshare.ts) and talking to the hub's `sb` function. Pure enough
// for node (scripts/gsquad-sb-hub-check.ts runs this very code against the hub with fictional members).
// A piece is AES-256-GCM under the squad key with its own aad (squad, file, piece number), so the hub cannot swap
// pieces between files or reorder them. The name and note are sealed apart (squadcrypto seal, aad squad and file).
import { signRequest, squadKey, V } from "./squadcrypto.ts";
import { b64, randomBytes, unb64 } from "./crypto.ts";
import type { SquadRec } from "./squadrec.ts";

export const SB_HUB = "https://zxhvchchfrkfqxuyorqo.supabase.co/functions/v1/sb";
export const sbAad = {
  meta: (squad: string, file: string) => `${V}:sbmeta:${squad}:${file}`,
  part: (squad: string, file: string, n: number) => `${V}:sb:${squad}:${file}:${n}`,
};
const te = new TextEncoder();
export async function sealPart(raw: string, bytes: Uint8Array, a: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(a) }, await squadKey(raw), bytes as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv); out.set(ct, 12);
  return b64(out);
}
export async function openPart(raw: string, sealed: string, a: string): Promise<Uint8Array> {
  const all = unb64(sealed);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.subarray(0, 12), additionalData: te.encode(a) }, await squadKey(raw), all.subarray(12)));
}

export class SbError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
/** Bytes up and down per act since start (the egress estimate in the report; never sent anywhere). */
export const sbBytes: Record<string, { calls: number; up: number; down: number }> = {};
export async function sbCall<T>(rec: Pick<SquadRec, "memberId" | "sign">, act: string, args: unknown, fetcher: Fetcher = (u, i) => fetch(u, i)): Promise<T> {
  const body = JSON.stringify(await signRequest(rec.sign.priv, act, rec.memberId, args));
  const init: RequestInit = { method: "POST", headers: { "Content-Type": "application/json" }, body };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") init.signal = AbortSignal.timeout(60_000);
  const res = await fetcher(SB_HUB, init);
  const text = await res.text();
  const b = (sbBytes[act] ??= { calls: 0, up: 0, down: 0 });
  b.calls++; b.up += body.length; b.down += text.length;
  let j: unknown = null;
  try { j = JSON.parse(text); } catch { /* below */ }
  if (!res.ok) throw new SbError(res.status, (j as { error?: string } | null)?.error || String(res.status));
  return j as T;
}
