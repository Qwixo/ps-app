// Export my data (V1.44, local first): an encrypted backup file the person saves wherever they like, and its import.
// The file is encrypted with a passphrase they pick when they save it (PBKDF2-SHA256, 600,000 rounds, then AES-256-GCM),
// never with the device's own key, so it opens on any device, even after this one is lost. Outside the encryption the
// file says only what it is and how the key was made: no names, no counts, no dates of the data.
// Import never deletes anything and never overwrites a record this device has in another version: it adds what is
// missing and folds the settings in (the file's values win there, so a fresh device gets the person's set up back).
import * as C from "./crypto.ts";
import { stableJson } from "./move.ts";

export const BACKUP_FORMAT = "ps-backup";
/** Never in a backup file, either way: Rewind (core/rewind.ts) stays sealed in the vault until its recap on 1 January. */
export const NOT_IN_BACKUP: ReadonlySet<string> = new Set(["rwd"]);
const AAD = "ps-backup-v1";
export interface BackupRecord { id: string; kind: string; data: unknown }
export interface BackupFile { format: typeof BACKUP_FORMAT; v: 1; kdf: { alg: "PBKDF2-SHA256"; iters: number; salt: string }; ct: string }
interface Inner { app: "PS"; exportedAt: string; name: string; records: BackupRecord[]; digest: string }

async function fileKey(pass: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as Uint8Array<ArrayBuffer>, iterations: iters }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
const digestOf = (recs: BackupRecord[]) => C.sha256hex(recs.map((r) => `${r.id}:${stableJson({ kind: r.kind, data: r.data })}`).join("\n"));

/** The backup file's text. `iters` is lower only in tests. */
export async function makeBackup(records: BackupRecord[], pass: string, o: { name?: string; now?: Date; iters?: number } = {}): Promise<string> {
  if (!C.passphraseScore(pass).ok) throw new Error("Pick a stronger passphrase for the file. You need it to open the backup.");
  const recs = records.filter((r) => r && typeof r.id === "string" && typeof r.kind === "string" && r.kind !== "_deleted" && !NOT_IN_BACKUP.has(r.kind))
    .map((r) => ({ id: r.id, kind: r.kind, data: r.data })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const inner: Inner = { app: "PS", exportedAt: (o.now ?? new Date()).toISOString(), name: String(o.name ?? "").slice(0, 40), records: recs, digest: await digestOf(recs) };
  const salt = C.randomBytes(16), iters = o.iters ?? C.KDF_ITERS;
  const file: BackupFile = { format: BACKUP_FORMAT, v: 1, kdf: { alg: "PBKDF2-SHA256", iters, salt: C.b64(salt) }, ct: await C.encryptJson(await fileKey(pass, salt, iters), inner, AAD) };
  return JSON.stringify(file);
}

/** Opens a backup file. Throws plain words for a wrong passphrase, a damaged file, or something that is not one. */
export async function openBackup(text: string, pass: string): Promise<{ exportedAt: string; name: string; records: BackupRecord[] }> {
  let f: BackupFile;
  try { f = JSON.parse(text) as BackupFile; } catch { throw new Error("That file is not a PS app backup."); }
  if (!f || f.format !== BACKUP_FORMAT || f.v !== 1 || f.kdf?.alg !== "PBKDF2-SHA256" || typeof f.ct !== "string") throw new Error("That file is not a PS app backup.");
  const iters = Number(f.kdf.iters);
  if (!Number.isInteger(iters) || iters < 1000 || iters > 5_000_000) throw new Error("That file is not a PS app backup.");
  let inner: Inner;
  try { inner = await C.decryptJson<Inner>(await fileKey(pass, C.unb64(f.kdf.salt), iters), f.ct, AAD); }
  catch { throw new Error("Wrong passphrase for this file, or the file is damaged."); }
  const recs = Array.isArray(inner?.records) ? inner.records.filter((r) => r && typeof r.id === "string" && typeof r.kind === "string") : [];
  if ((await digestOf(recs)) !== inner.digest) throw new Error("This backup file is damaged: its records do not match their check.");
  return { exportedAt: String(inner.exportedAt || ""), name: String(inner.name || ""), records: recs };
}

export interface ImportPlan { add: BackupRecord[]; settings: { id: string; data: Record<string, unknown> } | null; same: number; kept: number }
/** What an import would do here: add the records this device does not have, fold the file's settings into this
 *  device's settings, leave every other existing record as it is. */
export function planImport(file: BackupRecord[], have: Map<string, { kind: string; data: unknown }>, haveSettings: { id: string; data: Record<string, unknown> } | null): ImportPlan {
  const add: BackupRecord[] = [];
  let same = 0, kept = 0;
  let fileSettings: Record<string, unknown> | null = null;
  for (const r of file) {
    if (NOT_IN_BACKUP.has(r.kind)) continue;
    if (r.kind === "settings") { fileSettings = { ...(fileSettings || {}), ...((r.data as Record<string, unknown>) || {}) }; if (have.has(r.id)) same++; continue; }
    const h = have.get(r.id);
    if (!h) add.push(r);
    else if (stableJson({ kind: h.kind, data: h.data }) === stableJson({ kind: r.kind, data: r.data })) same++;
    else kept++;
  }
  const settings = fileSettings ? { id: haveSettings?.id ?? "", data: { ...(haveSettings?.data || {}), ...fileSettings } } : null;
  return { add, settings, same, kept };
}

export const backupFileName = (now = new Date()) => `PS backup ${now.toISOString().slice(0, 10)}.psbackup`;
