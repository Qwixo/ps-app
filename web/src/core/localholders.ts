// Where each device keeps the key that opens its local vault (local first, V1.44; core/localstore.ts KeyHolder):
// - PS on the Mac: the macOS Keychain (ps-mac Sources/LocalKey.swift), this Mac only, never iCloud. The page asks the
//   app; the key comes back in memory only. A Keychain the app may not read yet (a new build before it is allowed)
//   answers "denied", never "missing", so PS asks the person to Allow instead of ever making a new key.
// - PS GOS on the phone: the Android Keystore (ps-gos Keys.kt, the device key, sealed file "localvault.key"), and
//   also the browser key below, so an older phone app still opens it.
// - The mobile web app (and the phone too): a non extractable WebCrypto key kept in the browser's own database. The
//   page can use it but never read it out.
// No key is ever written to a log, a message other than the one answer, or the backup file.
import * as C from "./crypto.ts";
import type { HolderGet, HolderName, KeyHolder } from "./localstore.ts";
import { localKv } from "./localidb.ts";

type Answer = { status: "ok"; key: string } | { status: "missing" } | { status: "denied" } | { status: "error"; error?: string };
type Op = "get" | "create" | "allow" | "forget";
const waiting = new Map<string, (a: Answer) => void>();

/** The shell's answer (`{type:"localkey", req, status, key?}`); true when it was one. ps.ts and gos/bridge.ts call it. */
export function localKeyMessage(m: { type?: string; req?: unknown; status?: unknown; key?: unknown; error?: unknown }): boolean {
  if (m?.type !== "localkey") return false;
  const f = typeof m.req === "string" ? waiting.get(m.req) : undefined;
  if (!f) return true;
  waiting.delete(m.req as string);
  const st = m.status;
  f(st === "ok" && typeof m.key === "string" ? { status: "ok", key: m.key }
    : st === "missing" ? { status: "missing" } : st === "denied" ? { status: "denied" } : { status: "error", error: String(m.error || "") });
  return true;
}

function ask(post: (m: object) => void, op: Op, ms: number): Promise<Answer | null> {
  const req = C.b64url(C.randomBytes(9));
  return new Promise((res) => {
    const t = setTimeout(() => { waiting.delete(req); res(null); }, ms);
    waiting.set(req, (a) => { clearTimeout(t); res(a); });
    try { post({ type: "localkey:" + op, req }); } catch { clearTimeout(t); waiting.delete(req); res(null); }
  });
}
async function importKek(b64: string): Promise<CryptoKey> {
  const raw = C.unb64(b64);
  try {
    if (raw.length !== 32) throw new Error("The device key has the wrong size.");
    return await C.importAesRaw(raw, false);
  } finally { raw.fill(0); }
}

/** A key kept by the native shell (Keychain or Keystore), asked for through its message bridge. */
export function shellHolder(name: Extract<HolderName, "keychain" | "keystore">, post: (m: object) => void, ms = 8000): KeyHolder & { allow(): Promise<HolderGet> } {
  const toGet = async (a: Answer | null): Promise<HolderGet> => {
    if (!a) return { status: "unavailable" };   // an older shell that does not know the message
    if (a.status === "ok") return { status: "ok", kek: await importKek(a.key) };
    if (a.status === "missing") return { status: "missing" };
    if (a.status === "denied") return { status: "denied" };
    return { status: "denied" };   // any other failure is treated as "there but not readable": never a new key
  };
  return {
    name,
    get: async () => toGet(await ask(post, "get", ms)),
    async create() {
      const a = await ask(post, "create", ms);
      if (!a || a.status !== "ok") throw new Error(a?.status === "error" ? a.error || "The device could not keep the key." : "The device could not keep the key.");
      return importKek(a.key);
    },
    /** Mac: after the person's own click, read the Keychain with its question allowed (a new build). */
    allow: async () => toGet(await ask(post, "allow", 120_000)),
    async forget() { await ask(post, "forget", ms); },
  };
}

const DEVICE_KEY = "holder:device";
/** The browser's own key: non extractable, kept as it is in the browser database (structured clone of a CryptoKey). */
export const deviceHolder: KeyHolder = {
  name: "device",
  async get(): Promise<HolderGet> {
    if (typeof indexedDB === "undefined") return { status: "unavailable" };
    let v: unknown;
    try { v = await localKv.get(DEVICE_KEY); } catch { return { status: "unavailable" }; }
    if (v === undefined) return { status: "missing" };
    return typeof CryptoKey !== "undefined" && v instanceof CryptoKey ? { status: "ok", kek: v } : { status: "denied" };
  },
  async create() {
    if ((await localKv.get(DEVICE_KEY)) !== undefined) throw new Error("A key is already there.");
    const k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await localKv.set(DEVICE_KEY, k);
    const back = await localKv.get(DEVICE_KEY);
    if (!(back instanceof CryptoKey)) throw new Error("This browser cannot keep a key.");
    return back;
  },
  async forget() { await localKv.del(DEVICE_KEY); },
};
