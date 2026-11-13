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
import { docs, vaultStore } from "../core/vault";
import { saveSettings } from "../core/actions";
import { settingsData } from "../core/select";
import { currentKey, type SquadRec } from "../core/squadrec";
import { cleanShareOpts } from "../core/squadshare";
import { DEVICE_TZ } from "../core/tz";
import type { ScreenTimeDay, Todo } from "../core/model";
import { answerMoney, buildBoard, cleanBoardOp, cleanMoney, moneyMonthOk, planBoardSync, skipMoney, type BoardKind, type BoardOp, type HeldCard } from "../core/squadboard";
import { HubError } from "./hub";
import { boardApi, takeBoardRows } from "./boardhub";
import { onSquad, patchSquadView, squadMemberIds, squadOpen, squadRecNow } from "./engine";

const PUSH_MS = 20_000, SCREEN_EVERY_MS = 15 * 60_000, PULL_MS = 60_000, ROLL_MS = 60 * 60_000;

let rec: SquadRec | null = null;
let api: ReturnType<typeof boardApi> | null = null;
let cards = new Map<string, Map<BoardKind, HeldCard>>();
let since: string | null = null;
let have: Map<string, string> | null = null;
let loaded = false, pulling = false, pushing = false;
let pushTimer: number | undefined, pullTimer: number | undefined;
let lastScreenPut = 0, pushAll = false;

const sameSquad = (a: SquadRec | null, b: SquadRec | null) => !!a && !!b && a.squadId === b.squadId && a.memberId === b.memberId;
const sameRec = (a: SquadRec | null, b: SquadRec | null) => (!a && !b) || (sameSquad(a, b) && currentKey(a!).gen === currentKey(b!).gen);
function reset(next: SquadRec | null) {
  if (sameRec(next, rec)) { rec = next; return; }
  const same = sameSquad(next, rec);
  rec = next;
  api = next ? boardApi(next) : null;
  if (!same) { cards = new Map(); since = null; loaded = false; }
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
  pullTimer = window.setInterval(() => void pull(), PULL_MS);
}

// ---------- the view (the month to add comes ready made in it: board.due) ----------
function rebuild() {
  if (!rec) { patchSquadView({ board: null }); return; }
  const st = settingsData(vaultStore.get());
  const ids = squadMemberIds();
  const members = ids.length ? ids : [{ id: rec.memberId, me: true }];
  for (const id of [...cards.keys()]) if (!members.some((m) => m.id === id)) cards.delete(id);   // left the squad
  const board = buildBoard({ members, cards, myMoney: cleanMoney(st.squadMoney), myShare: cleanShareOpts(st.squadShare), now: Date.now(), deviceTz: DEVICE_TZ, loaded });
  patchSquadView({ board });
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
    rec: (r) => reset(r),
    open: (on) => setOpen(on),
    pulled: () => rebuild(),
  });
  let sigTasks = "", sigScreen = "", sigSettings = "";
  vaultStore.subscribe(() => {
    const s = vaultStore.get();
    if (s.status !== "unlocked") return;
    reset(squadRecNow());
    if (!rec) return;
    let a = "", b = "";
    for (const d of s.docs.values()) {
      if (d.kind === "todo") a += `${d.id}:${d.updatedAt};`;
      else if (d.kind === "screentime") b += `${d.id}:${d.updatedAt};`;
    }
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
