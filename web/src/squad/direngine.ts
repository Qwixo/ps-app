// G Squad directory (V1.42) on the page that holds the vault (PS's main page on the Mac, the phone app's page).
// It adds to the plain squad view (squad/engine.ts patchSquadView): `dir` (See available squads and your request)
// and `asks` (requests waiting for you, the admin). Keys stay here, like the rest of the engine.
//
// V1.49 one squad, everyone in: nobody asks any more (squad/autoengine.ts joins by itself). This stays only for PS
// versions before V1.49 that still send Ask to join: the admin's PS lets each checked request in by itself, with no
// card and no button, and nobody lists or claims a squad from here any more.
//
// Egress: the directory is read only when you open See available squads. A request waiting for approval is
// checked every 3 minutes (every 20 s while the pop-up is open), a few dozen bytes. The admin's requests are read
// only when the pulse says the number changed, or when the pop-up opens.
import { docs, put, remove, vaultStore } from "../core/vault";
import { askAgainAt, checkCode, cleanAskRec, LISTED_NAME, type AskRec, type AskView } from "../core/squaddir";
import type { SquadRec } from "../core/squadrec";
import type { HubApi } from "./hub";
import { approveAsk, askToJoin, cancelAsk, checkAsk, listSquads, loadAsks, sayDir } from "./dirflows";
import type { DirView, SquadOp, SquadView } from "./view";

type Post = (m: object) => void;
export interface DirCtx {
  rec: () => SquadRec | null;
  api: () => HubApi | null;
  view: () => SquadView;
  patch: (p: Partial<SquadView>) => void;
  adopt: (r: SquadRec) => Promise<void>;
  /** V1.44: swap the squad record you hold for a new one (the developer moving into The G Squad); the old one is forgotten. */
  replace: (r: SquadRec) => Promise<void>;
  pull: () => void;
  post: Post | null;
}
const PS_PAGE = import.meta.env?.MODE === "ps";
const WAIT_MS = 3 * 60_000, OPEN_MS = 20_000;

let ctx: DirCtx | null = null;
let list: { id: string; name: string; adminBox: string }[] | null = null;
let ask: AskRec | null = null, askId: string | null = null, askCode = "";
let asks = new Map<string, AskView>();
let asksKnown = -1;          // the number of requests the last list had (the pulse says when it changed)
let open = false, busy: string | null = null, error: string | null = null;
let timer: number | undefined, checking = false, retiring = false;
const cards = new Map<string, string>();

function dirView(): DirView {
  return {
    list: list ? list.map((e) => ({ id: e.id, name: e.name })) : null,
    canCreate: false,
    ask: ask ? { squadId: ask.squadId, name: ask.name, me: ask.me, state: ask.state, code: askCode, at: ask.at, againAt: askAgainAt(ask) } : null,
    busy, error,
  };
}
function show() {
  if (!ctx) return;
  const v = ctx.view();
  // V1.49: no request is ever shown or carded: the admin's PS lets them in by itself (refreshAsks).
  ctx.patch({ dir: v.in ? null : dirView(), asks: [] });
  showCards(v.in ? v.name || LISTED_NAME : LISTED_NAME, []);
}

// ---------- your request (kind "squadask" in your own vault) ----------
function readAsk() {
  const top = docs<AskRec>("squadask").map((d) => ({ d, r: cleanAskRec(d.data) })).filter((x) => !!x.r).sort((a, b) => b.r!.at.localeCompare(a.r!.at))[0];
  const next = top?.r ?? null;
  const changed = JSON.stringify(next) !== JSON.stringify(ask);
  ask = next; askId = top?.d.id ?? null;
  if (changed) {
    askCode = "";
    if (ask) { const a = ask; void checkCode(a.squadId, a.sign.pub, a.box.pub, a.adminBox).then((c) => { if (ask === a) { askCode = c; show(); } }); }
    restart();
    show();
  }
}
async function saveAsk(next: AskRec | null) {
  const id = askId;
  ask = next;
  if (next) askId = await put<AskRec>("squadask", next, id ? { id, ws: null } : { ws: null });
  else { askId = null; if (id) await remove(id).catch(() => {}); }
  readAsk();
  show();
}
async function check() {
  if (!ctx || !ask || ask.state !== "open" || ctx.rec() || checking || !navigator.onLine) return;
  checking = true;
  const a = ask;
  try {
    const out = await checkAsk(a);
    if (ask !== a) return;
    if (out.state === "in") { await saveAsk(null); await ctx.adopt(out.rec); return; }
    if (out.state === "declined") await saveAsk({ ...a, state: "declined", settledAt: out.at });
    else if (out.state === "cancelled") await saveAsk(null);
    else if (out.state === "gone") await saveAsk(null);
  } catch { /* try again next time */ } finally { checking = false; }
}
function restart() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  if (!ask || ask.state !== "open") return;
  timer = window.setInterval(() => void check(), open ? OPEN_MS : WAIT_MS);
  void check();
}

// ---------- the admin's requests ----------
async function refreshAsks() {
  if (!ctx) return;
  const rec = ctx.rec(), api = ctx.api();
  if (!rec || !api || !ctx.view().creator) { if (asks.size) { asks = new Map(); show(); } return; }
  try {
    const list = await loadAsks(rec, api);
    // V1.49: no approval step. A request from an older PS that checks out is let in at once; one that does not check
    // out (not sealed to you, or naming other keys than the hub's) is left to run out by itself.
    let let_in = 0;
    for (const a of list) if (a.ok) { try { await approveAsk(rec, api, a); let_in++; } catch { /* the next pulse tries again */ } }
    asks = new Map();
    asksKnown = list.length - let_in;
    show();
    if (let_in) ctx.pull();
  } catch { /* the pulse brings it back */ }
}
/** The pulse's q: requests waiting for you (admin only). Read them only when the number changed. */
export function dirPulse(q: number | undefined) {
  if (typeof q !== "number") return;
  if (q !== asksKnown) void refreshAsks();
}
/** The squad view changed (pulled, joined, left): the directory part follows. */
export function dirSync() { if (ctx && !ctx.rec() && asks.size) asks = new Map(); show(); }
export function dirOpen(on: boolean) {
  open = on;
  restart();
  if (on && ctx?.rec() && ctx.view().creator) void refreshAsks();
  if (!on) { error = null; show(); }
}

// ---------- the request card on the Mac (top right, Approve and Decline; it stays until answered) ----------
function showCards(squad: string, mine: { id: string; name: string; code: string; ok: boolean }[]) {
  const post = ctx?.post;
  if (!post || !PS_PAGE) return;
  const want = new Map<string, string>();
  for (const a of mine) {
    const id = `sqa:${a.id}`;
    want.set(id, JSON.stringify({ id, sticky: true, title: `${a.name} asked to join ${squad}`, sub: "G Squad",
      body: a.ok ? `Check code ${a.code}. Approve lets them in and gives them the squad key.` : "This request could not be checked, so it can only be declined.",
      actions: a.ok ? [{ id: "approve", label: "Approve" }, { id: "decline", label: "Decline" }] : [{ id: "decline", label: "Decline" }] }));
  }
  for (const [id, json] of want) if (cards.get(id) !== json) { cards.set(id, json); post({ type: "cardShow", card: JSON.parse(json) }); }
  for (const id of [...cards.keys()]) if (!want.has(id)) { cards.delete(id); post({ type: "cardHide", id }); }
}
/** The card's buttons (Mac): Approve, Decline. */
export function dirCardMessage(m: { type?: string; id?: string; action?: string }): boolean {
  if (m.type !== "cardAction" || typeof m.id !== "string" || !m.id.startsWith("sqa:")) return false;
  const id = m.id.slice(4);
  if (m.action === "approve" || m.action === "decline") void runDirOp({ op: m.action, id });
  return true;
}

// ---------- what the Tab list asks for ----------
function setBusy(b: string | null, e: string | null = null) { busy = b; error = e; show(); }
export async function runDirOp(o: SquadOp): Promise<void> {
  if (!ctx) return;
  const rec = ctx.rec(), api = ctx.api();
  try {
    switch (o.op) {
      case "dir": {
        if (rec) return;
        setBusy("Looking", null);
        try { list = await listSquads(ask?.sign); }
        catch (e) { list = null; throw e; }   // V1.44: an error shows as an error with Retry, never as "no squads"
        setBusy(null);
        return;
      }
      case "ask": {
        if (rec || (ask && ask.state === "open")) return;
        const entry = list?.find((e) => e.id === o.squad);
        if (!entry) { setBusy(null, "Open the list again and try once more."); return; }
        setBusy("Asking");
        const next = await askToJoin(entry, o.me, ask);
        await saveAsk(next);
        setBusy(null);
        return;
      }
      case "askCancel": {
        if (!ask || ask.state !== "open") return;
        setBusy("Cancelling");
        await cancelAsk(ask);
        await saveAsk(null);
        setBusy(null);
        return;
      }
      case "askClear": {
        if (ask && ask.state !== "open") await saveAsk(null);
        return;
      }
      case "approve": case "decline": {
        if (!rec || !api) return;
        const a = asks.get(o.id);
        if (!a) return;
        if (o.op === "approve") await approveAsk(rec, api, a); else await api.decline(a.id);
        asks.delete(a.id); asksKnown = asks.size;
        show();
        ctx.pull();
        return;
      }
    }
  } catch (e) {
    setBusy(null, sayDir(e));
    if (o.op === "approve" || o.op === "decline") { ctx.patch({ error: sayDir(e) }); void refreshAsks(); }
  }
}

/** Once, from the engine's start. */
export function startDir(c: DirCtx) {
  if (ctx) return;
  ctx = c;
  vaultStore.subscribe(() => {
    const s = vaultStore.get();
    if (s.status !== "unlocked" || s.role !== "owner" || s.userId === "ps-overlay" || s.userId === "dev") {
      if (ask || list) { ask = null; askId = null; list = null; asks = new Map(); restart(); }
      return;
    }
    readAsk();
    // V1.49: a request from before (Ask to join) is called off; this PS joins The G Squad by itself instead.
    if (ask && !retiring) { retiring = true; const a = ask; void (a.state === "open" ? cancelAsk(a) : Promise.resolve()).catch(() => {}).then(() => saveAsk(null)).finally(() => { retiring = false; }); }
  });
  window.addEventListener("online", () => void check());
}
