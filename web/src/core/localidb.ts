// The local vault's own browser database (local first, V1.44). One fixed name on every device and for every Supabase
// project: linking a project reloads PS with another project database (core/project.ts localDbName), and the local
// vault must still be here after that. Ciphertext, wraps and one non extractable browser key only (core/localstore.ts).
import type { KV } from "./localstore.ts";

const NAME = "ps-local-vault";
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
  }
  return dbp;
}
function tx(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => void): Promise<void> {
  return db().then((d) => new Promise<void>((res, rej) => {
    const t = d.transaction("kv", mode);
    fn(t.objectStore("kv"));
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error("The save was cut off."));
  }));
}

export const localKv: KV = {
  async get<T>(key: string) {
    const d = await db();
    return new Promise<T | undefined>((res, rej) => {
      const q = d.transaction("kv").objectStore("kv").get(key);
      q.onsuccess = () => res(q.result as T | undefined);
      q.onerror = () => rej(q.error);
    });
  },
  set: (key, val) => tx("readwrite", (s) => { s.put(val, key); }),
  setMany: (entries) => tx("readwrite", (s) => { for (const [k, v] of entries) s.put(v, k); }),
  del: (key) => tx("readwrite", (s) => { s.delete(key); }),
};

/** Asks the browser not to clear this site's storage when space runs low (a phone browser may otherwise). */
export async function keepStorage(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) === true; } catch { return false; }
}
