// G Squad Leaderboard and Screen time (V1.40), on PS's main page on the Mac (the page
// that holds the vault). The Tab list gets only the finished view (view.board, core/squadboard.ts buildBoard) and
// sends its buttons back as a `boardOp`. The rules (revenue or profit, ranking or exact) are BOARD_RULES in
// core/squadboard.ts.
//
// Hub traffic (its own edge function `board`, signed like the core's; the free plan is small):
//   your cards   20 s after a task is ticked or an answer saved; screen time at most every 15 minutes; each time only
//                the cards whose sealed copy changed (fingerprint), so most looks send nothing at all
//   the squad's  only while the pop-up is open: once when it opens, then every 60 s, each time only changed cards
//   closed       nothing
// What you made last month (V1.43, the developer: "Make it so it doesn't pop up"): nothing opens by itself. From the 1st in
// your G Squad time zone the Leaderboard shows "Add what you made in October" for the whole month, with a quiet dot
// on its tab (core/squadboard.ts moneyDue). No pop-up, no sound, no notification. Money switched off: nothing.
import { docs, put, vaultStore } from "../core/vault";
import { cleanMonth, planMonths, type MonthRec } from "../core/monthhist";
import { saveSettings } from "../core/actions";
import { feature } from "../core/features";
import { historyOn } from "../core/taskhist";
import { settingsData } from "../core/select";
import { currentKey, type SquadRec } from "../core/squadrec";
import { cleanShareOpts } from "../core/squadshare";
import { DEVICE_TZ } from "../core/tz";
import type { ScreenTimeDay, Todo } from "../core/model";
import { answerMoney, buildBoard, cleanBoardOp, cleanMoney, moneyMonthOk, planBoardSync, skipMoney, type BoardKind, type BoardOp, type HeldCard } from "../core/squadboard";
import { HubError } from "./hub";
import { boardApi, takeBoardRows } from "./boardhub";
import { onSquad, patchSquadView, squadMemberIds, squadOpen, squadRecNow, squadView } from "./engine";
import { cleanPastDoc, openPast, planPastSync, type PastDoc, type PastMonth } from "../core/squadpast";

const PUSH_MS = 20_000, SCREEN_EVERY_MS = 15 * 60_000, PULL_MS = 60_000, ROLL_MS = 60 * 60_000;

let rec: SquadRec | null = null;
let api: ReturnType<typeof boardApi> | null = null;
let cards = new Map<string, Map<BoardKind, HeldCard>>();
let since: string | null = null;
let have: Map<string, string> | null = null;
let loaded = false, pulling = false, pushing = false;
let pushTimer: number | undefined, pullTimer: number | undefined;
let lastScreenPut = 0, pushAll = false;
// PS 1.64 Past boards: the months as opened, the change only cursor, and (the owner's PS) what was last published.
let past = new Map<string, PastMonth>();
let pastSince: string | null = null, pastPulling = false, pastPushing = false;
const PAST_SENT = "ps.sqPastSent";   // this device: the signature of the vault's months last published (owner only)

const sameSquad = (a: SquadRec | null, b: SquadRec | null) => !!a && !!b && a.squadId === b.squadId && a.memberId === b.memberId;
const sameRec = (a: SquadRec | null, b: SquadRec | null) => (!a && !b) || (sameSquad(a, b) && currentKey(a!).gen === currentKey(b!).gen);
function reset(next: SquadRec | null) {
  if (sameRec(next, rec)) { rec = next; return; }
  const same = sameSquad(next, rec);
  rec = next;
  api = next ? boardApi(next) : null;
  if (!same) { cards = new Map(); since = null; loaded = false; past = new Map(); pastSince = null; }
  have = null;   // a new key gen: every card is sealed again under it (its fingerprint names the gen)
  if (rec) schedulePush(true, 2_000); else clearTimeout(pushTimer);
  rebuild();
}

// ---------- your cards: change only, through the opt-out gate ----------
function schedulePush(all: boolean, delay = PUSH_MS) {
  if (!rec) return;
  pushAll = pushAll || all;
  clearTimeout(pushTimer);
  pushTimer = window.setTimeout(() => { pushTimer = undefined; void push(); }, delay);
}
async function push() {
  if (!rec || !api || !navigator.onLine) return;
  if (pushing) { schedulePush(pushAll, 5_000); return; }
  pushing = true;
  const all = pushAll; pushAll = false;
  try {
    if (!have) have = new Map((await api.mine()).rows.map((r) => [r.kind, r.fp]));
    const s = vaultStore.get();
    const now = Date.now();
    // Screen time changes every few minutes: its card goes at most every 15 minutes (money and tasks at once).
    const screenDue = all || now - lastScreenPut >= SCREEN_EVERY_MS;
    const only: BoardKind[] = screenDue ? ["money", "tasks", "screen"] : ["money", "tasks"];
    const plan = await planBoardSync({ settings: settingsData(s), todos: docs<Todo>("todo").filter((d) => d.ws === null), screen: docs<ScreenTimeDay>("screentime"),
      squad: rec.squadId, member: rec.memberId, secret: rec.secret, key: currentKey(rec), have, now, deviceTz: DEVICE_TZ, only });
    if (plan.put.length) {
      await api.put(plan.put);
      for (const r of plan.put) { have.set(r.kind, r.fp); if (r.kind === "screen") lastScreenPut = now; }
    }
    if (plan.del.length) { await api.del(plan.del); for (const k of plan.del) have.delete(k); }
    if (!screenDue) schedulePush(false, Math.max(PUSH_MS, lastScreenPut + SCREEN_EVERY_MS - now));
    if (plan.put.length || plan.del.length) { if (squadOpen()) void pull(); }
  } catch (e) {
    if (!(e instanceof HubError && e.status === 403)) have = null;   // read the hub's list again next time
  } finally { pushing = false; }
}

// ---------- the squad's cards: only while the pop-up is open ----------
async function pull() {
  if (!rec || !api || pulling || !navigator.onLine) return;
  pulling = true;
  const r0 = rec;
  try {
    const p = await api.pull(since);
    if (!sameSquad(rec, r0)) return;
    await takeBoardRows(r0, p.rows, cards);
    since = new Date(Date.parse(p.now) - 5_000).toISOString();   // a little overlap: nothing written as we read is missed
    loaded = true;
    rebuild();
  } catch { /* the core's pull shows any trouble; the board keeps what it has */ } finally { pulling = false; }
}
function setOpen(on: boolean) {
  clearInterval(pullTimer); pullTimer = undefined;
  if (!on) return;
  void pull();
  void pullPast();   // PS 1.64: once per opening (they rarely change): nothing new is a few dozen bytes
  pullTimer = window.setInterval(() => void pull(), PULL_MS);
}

// ---------- PS 1.64 Past boards (core/squadpast.ts) ----------
async function pullPast() {
  if (!rec || !api || pastPulling || !navigator.onLine) return;
  pastPulling = true;
  const r0 = rec;
  try {
    const p = await api.past(pastSince);
    if (!sameSquad(rec, r0)) return;
    for (const r of p.rows) {
      if (r.deleted) { past.delete(r.month); continue; }
      const m = await openPast(r0, r.month, r.ct, r.gen);
      if (m) past.set(r.month, m); else past.delete(r.month);
    }
    pastSince = new Date(Date.parse(p.now) - 5_000).toISOString();
    rebuild();
  } catch { /* an older hub has no Past boards yet: nothing shows */ } finally { pastPulling = false; }
}
/** The owner's vault records of Past boards (scripts/gsquad-past.ts puts them there), newest record per month. */
function pastDocs(): PastDoc[] {
  const by = new Map<string, { d: PastDoc; at: string }>();
  for (const d of docs<unknown>("sqpast")) {
    const p = cleanPastDoc(d.data);
    if (!p) continue;
    const at = d.updatedAt || "";
    if (!by.has(p.month) || at > by.get(p.month)!.at) by.set(p.month, { d: p, at });
  }
  return [...by.values()].map((x) => x.d);
}
const pastSig = (list: PastDoc[]) => JSON.stringify([rec?.squadId, rec ? currentKey(rec).gen : 0, [...list].sort((a, b) => a.month.localeCompare(b.month))]);
/** The owner's PS only: what changed in the vault's months goes to the hub (sealed, by fingerprint). Nothing at all
 *  while there are no records, or when this device already published this exact set under this key. */
async function pushPast() {
  if (!rec || !api || pastPushing || !navigator.onLine || !squadView().creator) return;
  const list = pastDocs();
  if (!list.length) return;
  const sig = pastSig(list);
  let sent: string | null = null;
  try { sent = localStorage.getItem(PAST_SENT); } catch { /* storage off: compare with the hub */ }
  if (sent === sig) return;
  pastPushing = true;
  const r0 = rec;
  try {
    const hub = await api.past(null);   // the fingerprints on the hub now
    const have = new Map(hub.rows.filter((r) => !r.deleted).map((r) => [r.month, r.fp]));
    const plan = await planPastSync(r0, list, have);
    for (let i = 0; i < plan.put.length; i += 4) await api.pastPut(plan.put.slice(i, i + 4), i === 0 ? plan.del : []);
    if (!plan.put.length && plan.del.length) await api.pastPut([], plan.del);
    try { localStorage.setItem(PAST_SENT, sig); } catch { /* storage off */ }
    if (plan.put.length || plan.del.length) void pullPast();
  } catch { /* not the owner on the hub, or offline: tried again on the next change or start */ } finally { pastPushing = false; }
}

// ---------- the view (the month to add comes ready made in it: board.due) ----------
// Month history (PS 1.65, core/monthhist.ts): a private copy of your earnings and the boards you saw, in your own vault only.
let monthBusy = false;
async function saveMonths(members: { id: string; me: boolean }[]) {
  const s = vaultStore.get();
  if (monthBusy || !feature("fuller-history") || !historyOn(settingsData(s)) || s.status !== "unlocked" || s.role !== "owner") return;
  monthBusy = true;
  try {
    const stored = docs<unknown>("mhist", null);
    const have = new Map<string, MonthRec>(), ids = new Map<string, string>();
    for (const d of stored) { const r = cleanMonth(d.data); if (r) { have.set(r.month, r); ids.set(r.month, d.id); } }
    const st = settingsData(s);
    for (const r of planMonths({ have, money: cleanMoney(st.squadMoney), members, cards, now: Date.now(), loaded })) await put<MonthRec>("mhist", r, { id: ids.get(r.month), ws: null });
  } catch { /* a bonus copy, tried again on the next change */ } finally { monthBusy = false; }
}
function rebuild() {
  if (!rec) { patchSquadView({ board: null }); return; }
  const st = settingsData(vaultStore.get());
  const ids = squadMemberIds();
  const members = ids.length ? ids : [{ id: rec.memberId, me: true }];
  for (const id of [...cards.keys()]) if (!members.some((m) => m.id === id)) cards.delete(id);   // left the squad
  const board = buildBoard({ members, cards, myMoney: cleanMoney(st.squadMoney), myShare: cleanShareOpts(st.squadShare), now: Date.now(), deviceTz: DEVICE_TZ, loaded });
  void saveMonths(members);
  patchSquadView({ board: { ...board, past: [...past.values()].sort((a, b) => b.month.localeCompare(a.month)) } });
}

// ---------- what the Tab list asks for ----------
export async function runBoardOp(raw: unknown): Promise<void> {
  const o: BoardOp | null = cleanBoardOp(raw);
  const s = vaultStore.get();
  if (!o || s.status !== "unlocked" || s.role !== "owner") return;
  const money = cleanMoney(settingsData(s).squadMoney);
  switch (o.op) {
    // Late is fine (any day of the month, or later to fix it): any month that has ended, back 12 months.
    case "money": if (!moneyMonthOk(o.month, money, Date.now())) return; await saveSettings({ squadMoney: answerMoney(money, o.month, o.amount) }); break;
    case "skip": if (!moneyMonthOk(o.month, money, Date.now())) return; await saveSettings({ squadMoney: skipMoney(money, o.month) }); break;
    case "tz": await saveSettings({ squadMoney: { ...money, tz: o.tz } }); break;
  }
  schedulePush(false, 3_000);
}

// ---------- start (PS's main page on the Mac only) ----------
let started = false;
export function startSquadBoard() {
  if (started) return;
  started = true;
  onSquad({
    rec: (r) => { reset(r); void pushPast(); },
    open: (on) => setOpen(on),
    pulled: () => { rebuild(); void pushPast(); },   // the owner flag comes with the squad's pull
  });
  let sigTasks = "", sigScreen = "", sigSettings = "", sigPast = "";
  vaultStore.subscribe(() => {
    const s = vaultStore.get();
    if (s.status !== "unlocked") return;
    reset(squadRecNow());
    if (!rec) return;
    let a = "", b = "", c0 = "";
    for (const d of s.docs.values()) {
      if (d.kind === "todo") a += `${d.id}:${d.updatedAt};`;
      else if (d.kind === "screentime") b += `${d.id}:${d.updatedAt};`;
      else if (d.kind === "sqpast") c0 += `${d.id}:${d.updatedAt};`;
    }
    if (c0 !== sigPast) { sigPast = c0; if (c0) void pushPast(); }   // PS 1.64: the owner's Past boards changed in the vault
    // Only the settings that change a card (what you share, the months you added).
    const st = settingsData(s);
    const c = JSON.stringify([st.squadShare ?? null, st.squadMoney ?? null]);
    const tasksChanged = a !== sigTasks, settingsChanged = c !== sigSettings, screenChanged = b !== sigScreen;
    sigTasks = a; sigScreen = b; sigSettings = c;
    if (settingsChanged) { schedulePush(true, 3_000); rebuild(); }   // a switch turned off: its card goes at once
    else if (tasksChanged) { schedulePush(false); rebuild(); }
    else if (screenChanged && pushTimer === undefined) schedulePush(false);
  });
  // The days and months roll on even when nothing changes (the 7 day window, a new month).
  window.setInterval(() => { if (rec) { schedulePush(false, 1_000); rebuild(); } }, ROLL_MS);
  window.addEventListener("online", () => { if (rec) schedulePush(false, 2_000); });
  reset(squadRecNow());
}
/** Woken (the Mac's "wake"): a new month may have started while asleep (the month to add, the 7 day window). */
export function boardWake() { if (started && rec) rebuild(); }
