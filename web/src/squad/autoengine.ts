// One squad, everyone in (V1.49) on the page that holds the vault (PS's main page on the Mac, the phone app's page,
// the web app). The developer, 11 Nov 2026: "I want to make it there's automatically one squad already and we're all
// automatically in it." The steps: squad/autoflows.ts; the rules: core/squadauto.ts.
//
// What runs here, by itself, with nothing to press:
//   not in yet       your PS joins The G Squad as soon as you are signed in, then waits for the squad key (every
//                    3 minutes, every 20 s while G Squad is open), a few dozen bytes each time
//   in               when the pulse says someone is waiting for the squad key, your PS seals it to them
//   in an older squad (made with Create a squad before V1.47): your PS leaves it and joins The G Squad
//   The developer's PS         becomes the admin (the hub asks his vault whether it is his account)
// Leaving on purpose stays left (Join again brings you back); the admin's Take out keeps you out.
//
// V1.57 invite only (the developer, 13 Nov 2026: "Yes, lock it"): joining by itself is now an Ask to join. The hub gives you a
// waiting place and nobody hands you the squad key until the admin lets you in (or you scan a friend's Add friend
// code, which lets you straight in). Your PS leaves your name for the admin once, sealed to the admin's key, and
// shows the check code the admin sees too.
import { docs, put, sb, vaultStore, PROJECT } from "../core/vault";
import { isRedAccount } from "../core/account";
import { settingsData } from "../core/select";
import { autoStage, newPending, pickJoinRec, sayAuto, shouldJoin, whoHash, type AutoView, type JoinRec } from "../core/squadauto";
import { squadAutoOn } from "../core/offswitches";
import { saveSettings } from "../core/actions";
import type { SquadRec } from "../core/squadrec";
import { HubError, type HubApi } from "./hub";
import { askAdmin, autoCheck, autoJoin, handOut, theSquadId } from "./autoflows";
import { checkCode } from "../core/squaddir";
import type { SquadView } from "./view";

export interface AutoCtx {
  rec: () => SquadRec | null;
  api: () => HubApi | null;
  view: () => SquadView;
  patch: (p: Partial<SquadView>) => void;
  adopt: (r: SquadRec) => Promise<void>;
  /** Out of the current squad on this device (its record goes from the vault). */
  drop: () => Promise<void>;
  pull: () => void;
}
const WAIT_MS = 3 * 60_000, OPEN_MS = 20_000, SETTLE_MS = 2 * 60_000, OTHER_MS = 10 * 60_000;

let ctx: AutoCtx | null = null;
let join: { id: string | null; rec: JoinRec | null } = { id: null, rec: null };
let problem: { kind: "full" | "removed" | "error"; text: string } | null = null;
let running = false, again = false, open = false, timer: number | undefined;
let holdUntil = 0;              // a moment to let the vault catch up (another device left, or joined first)
let adminTried = "";            // the member id the developer's PS already asked the admin step for (once per session)
let handing = false;
let asked: { code: string } | null = null;   // V1.57: you asked to join and wait for the admin (the check code)

function eligible() {
  const s = vaultStore.get();
  return s.status === "unlocked" && s.role === "owner" && s.userId !== "ps-overlay" && s.userId !== "dev" && !!s.userId;
}
function readJoin() {
  const top = pickJoinRec(docs<JoinRec>("squadjoin"));
  join = { id: top?.doc.id ?? null, rec: top?.rec ?? null };
}
async function saveJoin(next: JoinRec) {
  join = { id: join.id, rec: next };
  join.id = await put<JoinRec>("squadjoin", next, join.id ? { id: join.id, ws: null } : { ws: null });
}
function show() {
  if (!ctx) return;
  const inNow = !!ctx.rec();
  const stage = autoStage(join.rec, problem?.kind ?? null, autoOn());
  const auto: AutoView | null = inNow ? null : stage === "joining" && asked
    ? { stage: "asked", error: null, code: asked.code || null }
    : { stage, error: problem?.text ?? null };
  ctx.patch({ auto });
}
/** Settings, G Squad, "Join The G Squad automatically" (on unless switched off). Off: while not in, PS does nothing by
 *  itself (no join, no 3 minute wait for the squad key); a join already on its way waits until it is on again. */
function autoOn() { return squadAutoOn(settingsData(vaultStore.get()).squadAutoJoin); }
function myName() {
  return (settingsData(vaultStore.get()).ownerName || "").trim().split(/\s+/)[0] || "";
}

/** One pass: whatever is due now. Never two at once; a call while one runs runs once more after it. */
export async function autoStep(): Promise<void> {
  if (!ctx || !eligible()) return;
  if (running) { again = true; return; }
  running = true;
  try {
    readJoin();
    if (ctx.rec()) await inSquad(ctx.rec()!); else await notIn();
  } catch (e) {
    if (e instanceof HubError) {
      const s = sayAuto(e.status, e.message);
      problem = { kind: s.problem, text: s.text };
      if (s.problem === "removed" && join.rec) await saveJoin({ ...join.rec, removed: true, pending: null });
    } else if (!(e instanceof TypeError || (e as { name?: string })?.name === "TimeoutError")) {
      problem = { kind: "error", text: "Something went wrong. Try again." };
    } else problem = { kind: "error", text: "G Squad could not be reached. Check your internet and try again." };
  } finally {
    running = false;
    show();
    restart();
    if (again) { again = false; void autoStep(); }
  }
}

async function inSquad(rec: SquadRec) {
  problem = null;
  asked = null;
  let j = join.rec;
  // In now: the join on its way is done (on this device or the other one).
  if (j?.pending || j?.left || j?.removed) { j = { v: 1, ...(j.gs ? { gs: j.gs } : {}) }; await saveJoin(j); }
  if (!j?.gs) {
    const gs = await theSquadId(rec.sign);
    if (!gs) return;
    j = { ...(j ?? { v: 1 }), gs };
    await saveJoin(j);
  }
  if (rec.squadId !== j.gs) {
    // An older squad (made with Create a squad before V1.47): out of it, then into The G Squad. Your shared tasks,
    // Fitness and Leaderboard cards come from your own vault, so they go up again in The G Squad by themselves.
    try { await ctx!.api()?.leave(); } catch { /* the older squad just sees you stop working */ }
    await ctx!.drop();
    again = true;
    return;
  }
  // The developer's PS: the admin, checked by the hub with his vault (never a flag in PS alone).
  const v = ctx!.view();
  if (!v.creator && isRedAccount(vaultStore.get()) && adminTried !== rec.memberId) {
    adminTried = rec.memberId;
    const token = (await sb.auth.getSession().catch(() => null))?.data.session?.access_token;
    if (token) { try { await ctx!.api()?.admin(token, PROJECT.key); ctx!.pull(); } catch { /* next session tries again */ } }
  }
}

async function notIn() {
  let j = join.rec;
  if (!autoOn()) { problem = null; return; }   // switched off in Settings: nothing by itself (Join on the G Squad screen switches it on)
  if (!shouldJoin(false, j) && !j?.pending) return;   // left on purpose, or taken out
  if (Date.now() < holdUntil) return;
  if (!j) j = { v: 1 };
  let p = j.pending ?? null;
  if (!p) {
    p = await newPending(myName());
    j = { ...j, pending: p };
    await saveJoin(j);   // the keys are in your vault before the hub ever sees them
  }
  if (!p.memberId) {
    const s = vaultStore.get();
    try {
      const r = await autoJoin(await whoHash(PROJECT.url, s.userId!), p);
      p = r.pending;
      j = { ...j, pending: p, gs: r.pending.squadId };
      await saveJoin(j);
    } catch (e) {
      if (e instanceof HubError && e.status === 409 && /already in/.test(e.message)) {
        // Your other device joined a moment ago: its record comes through your vault. Drop this one and wait.
        await saveJoin({ ...j, pending: null });
        holdUntil = Date.now() + OTHER_MS;
        problem = null;
        return;
      }
      throw e;
    }
  }
  problem = null;
  try {
    const out = await autoCheck(p);
    if (out.state === "in") {
      asked = null;
      await saveJoin({ v: 1, gs: out.rec.squadId });
      await ctx!.adopt(out.rec);
    } else if (out.admitted === false) {
      // V1.57: waiting for the admin. Leave your name for them once (sealed to their key), then show the check code.
      if (!p.asked) {
        const box = await askAdmin(p).catch(() => null);
        if (box) { p = { ...p, asked: box }; j = { ...j, pending: p }; await saveJoin(j); }
      }
      asked = { code: p.asked && p.squadId ? await checkCode(p.squadId, p.sign.pub, p.box.pub, p.asked) : "" };
    } else asked = null;
  } catch (e) {
    if (e instanceof HubError && e.status === 403 && /not a member/.test(e.message)) {
      asked = null;
      await saveJoin({ ...j, pending: null });   // the hub let go of a join that waited a week: start over
      again = true;
      return;
    }
    throw e;
  }
}

function restart() {
  if (timer !== undefined) window.clearInterval(timer);
  timer = undefined;
  if (!ctx || ctx.rec() || !join.rec?.pending && !problem) return;
  if (join.rec?.left || join.rec?.removed) return;
  if (!autoOn()) return;   // "Join The G Squad automatically" Off: no 3 minute wait while not in
  timer = window.setInterval(() => void autoStep(), open ? OPEN_MS : WAIT_MS);
}

// ---------- what the engine tells this part ----------
/** The pulse: k people are waiting for the squad key, and you hold it. */
export function autoPulse(k: number | undefined) {
  if (!k || handing || !ctx) return;
  const rec = ctx.rec(), api = ctx.api();
  if (!rec || !api) return;
  handing = true;
  void handOut(rec, api).then((n) => { if (n) ctx?.pull(); }).catch(() => { /* the next pulse tries again */ }).finally(() => { handing = false; });
}
/** G Squad opened or closed: wait more often while it is open. */
export function autoOpen(on: boolean) { open = on; restart(); if (on) void autoStep(); }
/** You left on purpose (Squad settings, Leave): PS does not join again by itself. */
export async function autoLeft() {
  readJoin();
  await saveJoin({ ...(join.rec ?? { v: 1 }), left: true, pending: null });
  problem = null;
  show();
}
/** Join again (after leaving), or Try again (after a problem). */
export async function autoAgain() {
  // A clear yes (Join, Join again, a scanned friend code): "Join The G Squad automatically" goes back on.
  if (!autoOn()) await saveSettings({ squadAutoJoin: true }).catch(() => {});
  readJoin();
  const j = join.rec ?? { v: 1 };
  if (j.left || j.removed) await saveJoin({ v: 1, ...(j.gs ? { gs: j.gs } : {}) });
  problem = null; holdUntil = 0;
  show();
  await autoStep();
}
/** The hub no longer knows you (taken out, or you left on another device): wait a moment for the vault first. */
export function autoGone() { holdUntil = Date.now() + SETTLE_MS; }
/** Something changed (the vault, your squad): look again. */
export function autoSync() { if (ctx) void autoStep(); }

/** Once, from the engine's start. */
export function startAuto(c: AutoCtx) {
  if (ctx) return;
  ctx = c;
  let last = "";
  vaultStore.subscribe(() => {
    if (!eligible()) return;
    // Only when your squad or join records changed, not on every task tick.
    let sig = "";
    for (const d of vaultStore.get().docs.values()) if (d.kind === "squad" || d.kind === "squadjoin") sig += `${d.id}:${d.updatedAt}:${d.pending ? 1 : 0};`;
    sig = (sig || "none") + (autoOn() ? "" : "|off");   // the Settings switch counts too
    if (sig !== last) { last = sig; void autoStep(); }
  });
  window.addEventListener("online", () => void autoStep());
  void autoStep();
}
