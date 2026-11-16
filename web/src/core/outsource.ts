// Outsource work to your other computer: the page's engine (PS 1.65). It joins the rules in core/second.ts to the person's own vault
// and to the Mac (core/secondbridge.ts). Everything it touches comes in through `Deps`, so tests/outsource.test.ts runs a fake
// second computer with no vault, no Mac and no network. The screen is views/OutsourceSettings.tsx and stays thin.
//
// Rules this file keeps:
//  - Change only sync: it writes a record only when something changed, plus one small "still here" status every 10 minutes while
//    PS is open on the other computer. Nothing polls while PS is closed: there is no timer without an open page.
//  - The other computer runs a job only after acceptJob (signed by the paired main computer, sealed for it, not expired, not seen
//    before, no secret). Anything else becomes a refusal the main computer can read.
//  - The main computer accepts a result only from the paired other computer and only for a job it sent.
//  - Private keys never sit in the page's storage on a Mac: the Mac keeps them in its Keychain and hands them back at every start.
//    (A phone, which can only ask for a restart, keeps its own small key in the phone app's private storage.)
//  - Nothing is tied to an app version: the pairing is a pair of public keys plus a device id, so updates never ask to pair again.
//  - The vault stays small: pieces of a bundle go once it landed, finished jobs go after 30 days.
import type { Doc, Kind } from "./model.ts";
import type { KeepRecord, MacToPage, OtherStatus, PageToMac, PlainJob, BridgeRole, CliRequest } from "./secondbridge.ts";
import { BRIDGE_VERSION } from "./secondbridge.ts";
import { b64, unb64, b64url, randomBytes, sha256hex } from "./crypto.ts";
import {
  acceptCmd, acceptJob, acceptResult, BUNDLE_MAX, codeOk, fileRefusal, isOnline, jobRunning, JOB_KEEP_MS, KEEPALIVE_MS, makeCmd, makeCode, makeJob,
  makeKeys, makeStatus, openEnv, PAIR_CODE_MS, pairCheck, pairCode, remember, signBody, TAIL_FINAL, tail, looksSecret, outsourceTitle, OJOB_MAX_RUNNING,
  OJOB_MINUTES, type Env, type JobArgs, type JobBody, type JobState, type JobStatusBody, type Keys, type Peer, type Seen, type StatBody,
} from "./second.ts";

export const FEATURE_ID = "second-computer";
export type Store = {
  docs<T = unknown>(kind: Kind): Doc<T>[];
  put(kind: Kind, data: unknown, id: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  /** Tells the person's other devices to look now (an empty signal on their own private topic, no data in it). */
  poke(k: "job" | "stat" | "cmd" | "msg" | "file"): void;
};
export type Local = { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void };
/** native: a Mac (it keeps the keys); phone: the phone app (it may only pair to restart the other computer). */
export type Deps = { store: Store; post(m: PageToMac): void; local: Local; now(): number; native: boolean; phone?: boolean };

const K_PHONE_KEEP = "ps-os-phone", K_MY_JOBS = "ps-os-myjobs", K_LANDED = "ps-os-landed";
const OLD_KEYS = ["ps-os-keep", "ps-os-seen", "ps-os-phones"];   // an earlier test build kept these in the page: removed on start
const RUN_WRITE_MS = 20_000;
const TIDY_MS = 3600_000;
const SENT_WAIT = 4;   // jobs that may wait for the other computer at once

export type JobRowView = {
  id: string; title: string; at: number; state: JobState | "sent"; step?: string; tail?: string; reason?: string;
  report?: string; bundle?: { name: string; size: number }; path?: string; mine: boolean; endedAt?: number;
};
export type View = {
  role: BridgeRole;
  phone: boolean;
  paired: boolean;
  device: string;
  name: string;
  peerName: string;
  /** Four words both screens show once paired, to see the two computers paired with each other. */
  check: string;
  /** Pairing in progress on this computer (the other computer shows it). */
  code: string;
  codeExpires: number;
  online: boolean;
  seenAt: number;
  status: OtherStatus | null;
  jobs: JobRowView[];
  note: string;
  canSend: boolean;
  folder: string;
  phones: number;
  /** The Mac has handed back its kept pairing (or there is none). Until then the tab shows a quiet "Loading". */
  ready: boolean;
};

type DevDoc = { t: "dev"; device: string; name: string; role: BridgeRole | "phone"; pub: string; encPub: string; at: number };
type OfferDoc = { t: "offer"; device: string; name: string; pub: string; encPub: string; proof: string; at: number };
type AnswerDoc = { t: "answer"; offer: string; device: string; name: string; pub: string; encPub: string; proof: string; kind: "main" | "phone"; at: number };
type JobDoc = { id: string; to: string; from: string; at: number; exp: number; env: Env; title: string };
type ResDoc = { job: string; to: string; from: string; at: number; env: Env; final?: boolean };
type ChunkDoc = { job: string; i: number; to: string; env: Env };
type CmdDoc = { id: string; to: string; from: string; at: number; exp: number; env: Env };
type StatDoc = { device: string; to: string; at: number; env: Env };
type FileBodyLite = { v: number; t: "file"; id: string; from: string; to: string; at: number; job: string; chunk: string; n: number };

const j = <T,>(s: string | null, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
const FINAL: JobState[] = ["done", "failed", "cancelled", "timeout", "refused"];

export function createEngine(deps: Deps) {
  const { store, local } = deps;
  for (const k of OLD_KEYS) local.del(k);
  // A Mac's record comes from the Mac (op "state"). A phone keeps its own.
  let keep: KeepRecord | null = deps.native ? null : j<KeepRecord | null>(local.get(K_PHONE_KEEP), null);
  let ready = !deps.native;
  let mac: Extract<MacToPage, { op: "state" }> | null = null;
  let offer: { code: string; at: number } | null = null;
  let note = "";
  let status: OtherStatus | null = null;
  let peerStat: { at: number; st: StatBody | null } = { at: 0, st: null };
  const subs = new Set<() => void>();
  let lastRunWrite = 0, lastHeartbeat = 0, lastStatKey = "", lastTidy = 0;
  const processed = new Set<string>();                  // docs already handled this session (the kept replay list is the real guard)
  const landed = new Map<string, { path: string }>(Object.entries(j<Record<string, { path: string }>>(local.get(K_LANDED), {})));
  const live = new Map<string, JobRowView>();          // the other computer: jobs taken this session
  const decoded = new Map<string, JobStatusBody>();
  const pendingBundle = new Map<string, { n: number; sha: string; size: number; name: string; got: Map<number, string>; report: string; state: JobState; exit?: number; shots?: string[] }>();

  const emit = () => subs.forEach((f) => f());
  const setNote = (s: string) => { note = s; emit(); };
  const keys = (): Keys | null => (keep && keep.priv ? { device: keep.device, pub: keep.pub, encPub: keep.encPub, priv: keep.priv } : null);
  const peer = (): Peer | null => (keep?.peer ? { device: keep.peer.device, name: keep.peer.name, pub: keep.peer.pub, encPub: keep.peer.encPub, role: keep.role === "other" ? "primary" : "secondary" } : null);
  const saveKeep = (k: KeepRecord | null) => {
    keep = k;
    if (deps.native) deps.post(k ? { type: "outsource", op: "keep", record: k } : { type: "outsource", op: "forget" });
    else if (k) local.set(K_PHONE_KEEP, JSON.stringify(k)); else local.del(K_PHONE_KEEP);
    emit();
  };
  const seen = (): Seen => keep?.seen ?? {};

  /** This computer's name and keys. Made once; never remade by an update. */
  async function ensureKeys(role: BridgeRole, name: string): Promise<Keys> {
    const have = keys();
    if (have && keep) { if (keep.role !== role || (name && keep.name !== name)) saveKeep({ ...keep, role, name: name || keep.name }); return have; }
    const k = await makeKeys();
    saveKeep({ device: k.device, name: name || mac?.name || (deps.phone ? "Phone" : "This computer"), role, pub: k.pub, encPub: k.encPub, priv: k.priv });
    return k;
  }
  const myName = () => keep?.name || mac?.name || (deps.phone ? "Phone" : "This computer");

  async function publishDev(role: BridgeRole | "phone") {
    if (!keep) return;
    const d: DevDoc = { t: "dev", device: keep.device, name: keep.name, role, pub: keep.pub, encPub: keep.encPub, at: deps.now() };
    await store.put("sdev", d, `sdev-${keep.device}`);
  }

  // ---------- pairing ----------
  /** On the OTHER computer: shows a one time code (10 minutes). Returns it. */
  async function startPairing(name?: string): Promise<string> {
    if (!deps.native) throw new Error("Only PS on a Mac can be the other computer.");
    const k = await ensureKeys("other", name ?? "");
    const code = makeCode();
    offer = { code, at: deps.now() };
    const doc: OfferDoc = { t: "offer", device: k.device, name: myName(), pub: k.pub, encPub: k.encPub, proof: await pairCode(code, "offer", k.device, k.pub, k.encPub), at: deps.now() };
    await publishDev("other");
    await store.put("spair", doc, `spair-offer-${k.device}`);
    store.poke("msg");
    setNote("");
    return code;
  }
  function stopPairing() {
    if (!offer || !keep) return;
    offer = null;
    void store.remove(`spair-offer-${keep.device}`).catch(() => {});
    emit();
  }
  /** On the MAIN computer (or the phone): types the code shown on the other computer. */
  async function enterCode(code: string, asPhone = false, name?: string): Promise<{ ok: boolean; why: string }> {
    if (!codeOk(code)) return { ok: false, why: "The code is 8 digits." };
    if (asPhone && !deps.phone) return { ok: false, why: "Pair the phone from PS on the phone." };
    if (!asPhone && !deps.native) return { ok: false, why: "Pair from PS on your main Mac." };
    const now = deps.now();
    const offers = store.docs<OfferDoc>("spair").map((d) => d.data).filter((o) => o && o.t === "offer" && now - o.at <= PAIR_CODE_MS && o.at - now < 60_000 && o.device !== keep?.device);
    if (!offers.length) return { ok: false, why: "No computer is showing a code right now. Open this tab on the other computer and choose Show a code." };
    let match: OfferDoc | null = null;
    for (const o of offers) if (typeof o.proof === "string" && (await pairCode(code, "offer", o.device, o.pub, o.encPub)) === o.proof) { match = o; break; }
    if (!match) return { ok: false, why: "That code does not match. Check the digits on the other computer." };
    const k = await ensureKeys(asPhone ? "none" : "main", name ?? "");
    const proof = await pairCode(code, "answer", match.device, k.device, k.pub, k.encPub);
    const ans: AnswerDoc = { t: "answer", offer: match.device, device: k.device, name: myName(), pub: k.pub, encPub: k.encPub, proof, kind: asPhone ? "phone" : "main", at: now };
    await store.put("spair", ans, `spair-answer-${match.device}-${k.device}`);
    await publishDev(asPhone ? "phone" : "main");
    const check = await pairCheck(k.pub, match.pub);
    saveKeep({ ...keep!, role: asPhone ? "none" : "main", peer: { device: match.device, name: match.name, pub: match.pub, encPub: match.encPub, pairedAt: now, check } });
    store.poke("msg");
    setNote(asPhone ? `This phone can now restart ${match.name}.` : `Paired with ${match.name}.`);
    return { ok: true, why: "" };
  }
  /** OTHER computer: looks for an answer to its code. The first right answer wins; the code then stops working. */
  async function checkAnswers() {
    if (!keep || keep.role !== "other" || !offer) return;
    const now = deps.now();
    if (now - offer.at > PAIR_CODE_MS) { stopPairing(); return; }
    for (const d of store.docs<AnswerDoc>("spair")) {
      const a = d.data;
      if (!a || a.t !== "answer" || a.offer !== keep.device || processed.has(d.id) || a.at < offer.at - 60_000) continue;
      processed.add(d.id);
      const want = await pairCode(offer.code, "answer", keep.device, a.device, a.pub, a.encPub);
      if (a.proof !== want) continue;                                  // a wrong code: ignored, the code stays
      const p = { device: a.device, name: String(a.name ?? "").slice(0, 60) || "Main computer", pub: a.pub, encPub: a.encPub, pairedAt: now };
      if (a.kind === "phone") {
        saveKeep({ ...keep, phones: [...(keep.phones ?? []).filter((x) => x.device !== a.device), p].slice(-4) });
        setNote(`${p.name} can now restart this computer.`);
      } else {
        saveKeep({ ...keep, seen: {}, peer: { ...p, check: await pairCheck(keep.pub, a.pub) } });
        setNote(`Paired with ${p.name}.`);
      }
      offer = null;
      await store.remove(`spair-offer-${keep.device}`).catch(() => {});
      await store.remove(d.id).catch(() => {});
      emit();
      void heartbeat(true);
      return;
    }
  }
  async function unpair() {
    if (keep) {
      for (const id of [`spair-offer-${keep.device}`, `sdev-${keep.device}`, `sstat-${keep.device}`]) await store.remove(id).catch(() => {});
      for (const d of store.docs<AnswerDoc>("spair")) if (d.data?.device === keep.device || d.data?.offer === keep.device) await store.remove(d.id).catch(() => {});
    }
    offer = null; peerStat = { at: 0, st: null };
    if (keep) saveKeep({ ...keep, role: "none", peer: undefined, phones: [], seen: {} });
    setNote("Unpaired. This computer keeps its own keys, so pairing again is quick.");
  }

  // ---------- main computer: send a job, read results ----------
  const sentIds = () => new Set(j<string[]>(local.get(K_MY_JOBS), []));
  async function sendJob(args: JobArgs, opts: { now?: number } = {}): Promise<{ ok: boolean; id: string; why: string }> {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "main") return { ok: false, id: "", why: "Pair your other computer first." };
    const waiting = view().jobs.filter((x) => x.mine && (jobRunning(x.state) || x.state === "sent")).length;
    if (waiting >= OJOB_MAX_RUNNING + SENT_WAIT) return { ok: false, id: "", why: "Too many jobs are waiting. Let some finish first." };
    const a: JobArgs = { returns: { bundle: true, report: true, screenshots: false }, minutes: OJOB_MINUTES, tool: "claude", ...args };
    let made;
    try { made = await makeJob(k, p, a, { now: opts.now ?? deps.now() }); } catch (e) { return { ok: false, id: "", why: e instanceof Error ? `Not sent: ${e.message}.` : "That job was refused." }; }
    const doc: JobDoc = { id: made.body.id, to: p.device, from: k.device, at: made.body.at, exp: made.body.exp, env: made.env, title: outsourceTitle(a.title) };
    await store.put("sojob", doc, `sojob-${made.body.id}`);
    local.set(K_MY_JOBS, JSON.stringify([...sentIds(), made.body.id].slice(-200)));
    store.poke("job");
    emit();
    return { ok: true, id: made.body.id, why: "" };
  }
  async function cancelJob(id: string): Promise<{ ok: boolean; why: string }> {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "main") return { ok: false, why: "Pair your other computer first." };
    if (!sentIds().has(id)) return { ok: false, why: "No such job." };
    const now = deps.now();
    const body: JobBody = { v: 1, t: "job", id: b64url(randomBytes(12)), from: k.device, to: p.device, at: now, exp: now + 10 * 60_000, type: "cancel", args: { job: id } as unknown as JobArgs };
    const env = await signBody(k, body, p.encPub);
    await store.put("sojob", { id: body.id, to: p.device, from: k.device, at: now, exp: body.exp, env, title: "cancel" } satisfies JobDoc, `sojob-${body.id}`);
    store.poke("job");
    return { ok: true, why: "" };
  }
  /** Main computer or a paired phone: a signed restart for the other computer, good for two minutes. */
  async function restartOther(kind: "restart" | "shutdown" = "restart"): Promise<{ ok: boolean; why: string }> {
    const k = keys(), p = peer();
    if (!k || !p || !(keep?.role === "main" || (deps.phone && keep?.role === "none"))) return { ok: false, why: "Pair your other computer first." };
    const made = await makeCmd(k, { ...p, role: "secondary" }, kind, { now: deps.now() });
    await store.put("scmd", { id: made.body.id, to: p.device, from: k.device, at: made.body.at, exp: made.body.exp, env: made.env } satisfies CmdDoc, `scmd-${made.body.id}`);
    store.poke("cmd");
    setNote(kind === "restart" ? `Restart sent to ${p.name}. It shows a 10 second Cancel first when someone is using it.` : `Shut down sent to ${p.name}.`);
    return { ok: true, why: "" };
  }

  /** MAIN: results that came back. A finished job with a bundle is put together, checked against its fingerprint and handed to the Mac. */
  async function readResults() {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "main") return;
    const mine = sentIds();
    for (const d of store.docs<ResDoc>("sores")) {
      const r = d.data;
      if (!r || r.to !== k.device || !mine.has(r.job) || landed.has(r.job)) continue;
      const have = store.docs<ChunkDoc>("sfile").filter((c) => c.data?.job === r.job && c.data.to === k.device);
      const key = `${d.id}:${r.env?.sig}:${have.length}`;
      if (processed.has(key)) continue;
      const acc = await acceptResult(r.env, { keys: k, peer: p, seen: {}, now: deps.now() }, (id) => id === r.job && mine.has(id));
      if (!acc.ok) { processed.add(key); continue; }
      const b = acc.body;
      decoded.set(`${d.id}:${r.env?.sig}`, b);
      const bu = b.state === "done" ? b.result?.bundle : undefined;
      if (!bu) { processed.add(key); setLanded(b.job, ""); deps.post({ type: "outsource", op: "land", id: b.job, report: b.summary ?? "", shots: b.result?.shots }); continue; }
      if (have.length < bu.n) continue;                      // wait for the rest: the next vault change brings it back here
      processed.add(key);
      if (!(bu.size > 0 && bu.size <= BUNDLE_MAX) || bu.n > 400) { setNote("A result bundle was refused: it is too big."); continue; }
      const parts: Uint8Array[] = new Array(bu.n);
      let bad = "";
      for (const c of have) {
        const o = await openEnv<FileBodyLite>(k, c.data.env, { ...p, role: "secondary" });
        if (!o.ok) { bad = o.why; break; }
        if (o.body.t !== "file" || o.body.job !== b.job || o.body.n !== c.data.i || !(c.data.i >= 0 && c.data.i < bu.n)) { bad = "a piece belongs somewhere else"; break; }
        parts[c.data.i] = unb64(o.body.chunk);
      }
      let all: Uint8Array | null = null;
      if (!bad) {
        if (parts.some((x) => !x)) bad = "a piece is missing";
        else {
          all = new Uint8Array(parts.reduce((n, x) => n + x.length, 0)); let off = 0;
          for (const x of parts) { all.set(x, off); off += x.length; }
          if (all.length !== bu.size || await sha256hex(all) !== bu.sha256) bad = "the bundle does not match its fingerprint";
        }
      }
      if (bad || !all) { setNote(`A result bundle was refused: ${bad}.`); continue; }
      deps.post({ type: "outsource", op: "land", id: b.job, report: b.summary ?? "", bundle: bu, shots: b.result?.shots });
      for (let i = 0; i < parts.length; i++) deps.post({ type: "outsource", op: "chunk", id: b.job, i, b64: b64(parts[i]) });
    }
  }
  function setLanded(id: string, path: string) {
    landed.set(id, { path });
    local.set(K_LANDED, JSON.stringify(Object.fromEntries([...landed].slice(-200))));
  }

  // ---------- other computer: take jobs and commands ----------
  async function readJobs() {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "other") return;
    const now = deps.now();
    for (const d of store.docs<JobDoc>("sojob")) {
      const jd = d.data;
      if (!jd || jd.to !== k.device || processed.has(d.id) || seen()[jd.id] !== undefined) continue;
      processed.add(d.id);
      const acc = await acceptJob(jd.env, { keys: k, peer: p, seen: seen(), now });
      if (!acc.ok) {
        // Tell the main computer why, but only for a job that came from it and never for one taken already.
        if (jd.from === p.device && !/replay/.test(acc.why)) await writeStatus({ job: jd.id, state: "refused", reason: acc.why, tail: "" });
        continue;
      }
      if (acc.body.id !== jd.id) continue;                      // the outside says one job, the sealed inside another: ignored
      saveKeep({ ...keep!, seen: acc.seen });
      const b = acc.body;
      if (b.type === "cancel") { const target = (b.args as unknown as { job?: unknown }).job; if (typeof target === "string") deps.post({ type: "outsource", op: "cancel", id: target }); continue; }
      const running = [...live.values()].filter((x) => jobRunning(x.state)).length;
      const plain: PlainJob = {
        id: b.id, title: b.args.title, repo: b.args.repo, base: b.args.base, prompt: b.args.prompt,
        returns: { bundle: b.args.returns?.bundle !== false, report: b.args.returns?.report !== false, screenshots: !!b.args.returns?.screenshots },
        minutes: b.args.minutes ?? OJOB_MINUTES, tool: b.args.tool ?? "claude", createdAt: b.at, expiresAt: b.exp,
      };
      const st: JobState = running >= OJOB_MAX_RUNNING ? "queued" : "accepted";
      live.set(b.id, { id: b.id, title: outsourceTitle(b.args.title), at: b.at, state: st, mine: false });
      await writeStatus({ job: b.id, state: st, tail: "" });
      deps.post({ type: "outsource", op: "run", job: plain });
    }
    emit();
  }
  async function readCmds() {
    const k = keys();
    if (!k || keep?.role !== "other") return;
    const trusted: Peer[] = [peer(), ...(keep.phones ?? []).map((x) => ({ ...x, role: "primary" as const }))].filter((x): x is Peer => !!x);
    for (const d of store.docs<CmdDoc>("scmd")) {
      const c = d.data;
      if (!c || c.to !== k.device || processed.has(d.id)) continue;
      processed.add(d.id);
      const from = trusted.find((t) => t.device === c.from);
      if (!from) continue;
      const acc = await acceptCmd(c.env, { keys: k, peer: { ...from, role: "primary" }, seen: seen(), now: deps.now() });
      if (!acc.ok) continue;
      saveKeep({ ...keep!, seen: acc.seen });
      void store.remove(d.id).catch(() => {});
      const a = acc.body.action;
      if (a === "restart" || a === "shutdown") deps.post({ type: "outsource", op: "restart", kind: a, id: acc.body.id, at: acc.body.at, from: from.name ?? "your main computer" });
    }
  }
  async function writeStatus(s: { job: string; state: JobState; reason?: string; tail: string; step?: string; startedAt?: number; endedAt?: number; exit?: number; summary?: string; result?: JobStatusBody["result"] }) {
    const k = keys(), p = peer();
    if (!k || !p) return;
    const env = await makeStatus(k, { ...p, role: "primary" }, s as never);
    const fin = FINAL.includes(s.state);
    const doc: ResDoc = { job: s.job, to: p.device, from: k.device, at: deps.now(), env, final: fin };
    await store.put(fin ? "sores" : "sjobst", doc, `${fin ? "sores" : "sjobst"}-${s.job}`);
    if (fin) await store.remove(`sjobst-${s.job}`).catch(() => {});   // the progress record is not needed once the result is there
    store.poke("job");
  }

  /** A message from this Mac (secondbridge MacToPage). */
  async function onMac(m: MacToPage) {
    if (m.type !== "outsource" || !deps.native) return;
    if (m.op === "state") {
      mac = m;
      ready = true;
      if (m.keep && m.keep.priv) keep = m.keep;                 // the Mac's Keychain copy is the truth on a Mac
      else if (m.keep && !m.keep.priv && m.keep.peer) { keep = { ...m.keep, peer: undefined, role: "none" }; setNote("This Mac could not read its saved pairing without asking for your password. Pair again once, it then stays."); }
      status = { awake: m.awake, locked: m.locked, busy: false, queue: 0, app: m.app, model: m.model, chip: m.chip, tools: m.cli, helper: m.helper };
      emit(); void heartbeat(false);
    } else if (m.op === "power") { if (status) status = { ...status, awake: m.awake, locked: m.locked }; emit(); void heartbeat(false); }
    else if (m.op === "progress") {
      const row = live.get(m.id); if (!row) return;
      live.set(m.id, { ...row, state: m.state, step: m.step, tail: m.tail ? tail(m.tail, 600) : row.tail });
      const now = deps.now();
      if (m.state !== "running" || now - lastRunWrite > RUN_WRITE_MS || row.state !== "running") { lastRunWrite = now; await writeStatus({ job: m.id, state: m.state as JobState, step: m.step, tail: tail(m.tail ?? "", 600), startedAt: m.startedAt }); }
      emit(); void heartbeat(false);
    } else if (m.op === "done") {
      const row = live.get(m.id) ?? { id: m.id, title: "", at: deps.now(), mine: false };
      live.set(m.id, { ...row, state: m.state, endedAt: deps.now() });
      const sec = looksSecret(m.report);
      const report = sec ? JSON.stringify({ state: m.state, note: "The report was left out: it looked like it held a secret." }) : tail(m.report, 40_000);
      const bu = m.state === "done" && m.bundle && m.bundle.size > 0 && m.bundle.size <= BUNDLE_MAX && !fileRefusal(m.bundle.name, m.bundle.size) ? m.bundle : undefined;
      pendingBundle.set(m.id, { n: bu?.n ?? 0, sha: bu?.sha256 ?? "", size: bu?.size ?? 0, name: bu?.name ?? "", got: new Map(), report, state: m.state, exit: m.exit, shots: m.shots?.slice(0, 4) });
      if (!bu) await finishResult(m.id);
      emit(); void heartbeat(false);
    } else if (m.op === "chunk") {
      const pb = pendingBundle.get(m.id); if (!pb || !(m.i >= 0 && m.i < pb.n)) return;
      pb.got.set(m.i, m.b64);
      if (pb.got.size >= pb.n) await finishResult(m.id);
    } else if (m.op === "landed") {
      setLanded(m.id, m.path);
      if (m.path) await tidyJob(m.id);
      emit();
    }
    else if (m.op === "cli") await onCli(m.req, m.cmd);
  }
  async function finishResult(id: string) {
    const pb = pendingBundle.get(id), k = keys(), p = peer();
    if (!pb || !k || !p) return;
    pendingBundle.delete(id);
    for (let i = 0; i < pb.n; i++) {
      const piece = pb.got.get(i); if (piece === undefined) return;   // never a half bundle
      const body = { v: 1, t: "file", id: `${id}-${i}`, from: k.device, to: p.device, at: deps.now(), name: pb.name, size: pb.size, sha256: pb.sha, mime: "application/x-git-bundle", purpose: "result", job: id, chunk: piece, n: i };
      await store.put("sfile", { job: id, i, to: p.device, env: await signBody(k, body as never, p.encPub) } satisfies ChunkDoc, `sfile-${id}-${i}`);
    }
    await writeStatus({
      job: id, state: pb.state, tail: "", summary: pb.report, exit: pb.exit, endedAt: deps.now(),
      result: pb.n ? { bundle: { name: pb.name, sha256: pb.sha, size: pb.size, n: pb.n }, shots: pb.shots } : { shots: pb.shots },
    });
  }

  // ---------- keeping the vault small ----------
  /** MAIN, once a result landed: the pieces and the job record go (the small result record stays for the list). */
  async function tidyJob(id: string) {
    for (const c of store.docs<ChunkDoc>("sfile")) if (c.data?.job === id) await store.remove(c.id).catch(() => {});
    await store.remove(`sojob-${id}`).catch(() => {});
  }
  /** Old records go: finished results after 30 days, expired jobs, commands and codes. At most once an hour, only on a change. */
  async function tidy() {
    const now = deps.now();
    if (now - lastTidy < TIDY_MS || !keep) return;
    lastTidy = now;
    const old = (at: unknown, ms: number) => typeof at !== "number" || now - at > ms;
    if (keep.role === "main") {
      for (const d of store.docs<ResDoc>("sores")) if (d.data?.to === keep.device && old(d.data.at, JOB_KEEP_MS)) await store.remove(d.id).catch(() => {});
      for (const d of store.docs<JobDoc>("sojob")) if (d.data?.from === keep.device && (typeof d.data.exp !== "number" || d.data.exp < now - 3600_000)) await store.remove(d.id).catch(() => {});
      for (const d of store.docs<CmdDoc>("scmd")) if (d.data?.from === keep.device && old(d.data.exp, 0)) await store.remove(d.id).catch(() => {});
    }
    for (const d of store.docs<OfferDoc>("spair")) if (old(d.data?.at, PAIR_CODE_MS + 3600_000)) await store.remove(d.id).catch(() => {});
  }

  // ---------- the other computer's "awake and ready" ----------
  async function heartbeat(force = false) {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "other" || !status || !deps.native) return;
    const now = deps.now();
    const running = [...live.values()].filter((x) => jobRunning(x.state));
    const key = JSON.stringify([status.awake, status.locked, status.helper, status.tools, running.length, running.filter((x) => x.state === "queued").length]);
    if (!force && key === lastStatKey && now - lastHeartbeat < KEEPALIVE_MS) return;   // change only, plus a "still here" every 10 minutes
    lastHeartbeat = now; lastStatKey = key;
    const body = { v: 1, t: "stat", id: `stat-${k.device}`, from: k.device, to: p.device, at: now, cpu: 0, battery: status.battery ?? 1, charging: !!status.charging, power: status.charging === false ? "battery" : "ac", busy: running.length > 0, queue: running.filter((x) => x.state === "queued").length, have: status.tools, app: status.app, machine: { awake: status.awake, locked: status.locked, helper: status.helper } } as StatBody;
    const env = await signBody(k, body, p.encPub);
    await store.put("sstat", { device: k.device, to: p.device, at: now, env } satisfies StatDoc, `sstat-${k.device}`);
    store.poke("stat");
  }
  async function readStat() {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "main") return;
    for (const d of store.docs<StatDoc>("sstat")) {
      const s = d.data;
      if (!s || s.to !== k.device || s.device !== p.device || s.at <= peerStat.at) continue;
      const o = await openEnv<StatBody>(k, s.env, { ...p, role: "secondary" });
      if (o.ok && o.body.t === "stat" && o.body.at <= deps.now() + 5 * 60_000) { peerStat = { at: o.body.at, st: o.body }; emit(); }
    }
  }
  async function decodeAll() {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "main") return;
    const mine = sentIds();
    for (const kind of ["sjobst", "sores"] as const) for (const d of store.docs<ResDoc>(kind)) {
      const r = d.data, key = `${d.id}:${r?.env?.sig}`;
      if (!r || decoded.has(key) || !mine.has(r.job)) continue;
      const acc = await acceptResult(r.env, { keys: k, peer: p, seen: {}, now: deps.now() }, (id) => id === r.job);
      if (acc.ok) decoded.set(key, acc.body);
    }
  }
  /** Called on every vault change (the vault only fires when a record changed). */
  async function onVault() {
    if (!keep) return;
    for (const f of [checkAnswers, readJobs, readCmds, decodeAll, readResults, readStat, tidy]) {
      try { await f(); } catch { /* a bad record never stops the next step */ }
    }
    emit();
  }
  /** Every minute while the page is open: only looks whether a "still here" is due (no network unless it is) and lets a code run out. */
  const tick = async () => { if (offer && deps.now() - offer.at > PAIR_CODE_MS) stopPairing(); await heartbeat(false); };

  // ---------- the person's AI, through the command line (main computer) ----------
  async function onCli(req: string, c: CliRequest) {
    const answer = (ok: boolean, text: string, id?: string) => deps.post({ type: "outsource", op: "cli-answer", req, ok, text, id });
    try {
      const v = view();
      if (!v.canSend && c.cmd !== "status") return answer(false, "No other computer is paired. Pair it in PS Settings, Outsource work to your other computer.");
      if (c.cmd === "status") answer(true, v.paired && v.role === "main" ? `${v.peerName}: ${v.online ? (v.status?.locked ? "awake, screen locked, ready" : "awake and ready") : "not heard from lately (PS must be open on it)"}${v.status?.tools?.length ? `\ntools: ${v.status.tools.join(", ")}` : ""}` : "No other computer is paired.");
      else if (c.cmd === "send") { const r = await sendJob({ title: c.title, repo: c.repo, base: c.base, prompt: c.prompt, minutes: c.minutes, tool: c.tool, returns: { bundle: c.bundle !== false, report: true, screenshots: !!c.screenshots } }); answer(r.ok, r.ok ? `Sent. Job ${r.id}` : r.why, r.id || undefined); }
      else if (c.cmd === "list") answer(true, v.jobs.slice(0, 20).map((x) => `${x.id} ${x.state} ${x.title}`).join("\n") || "No jobs yet.");
      else if (c.cmd === "result") {
        const x = v.jobs.find((y) => y.id === c.id);
        if (!x) return answer(false, "No such job.", c.id);
        const lines = [`State: ${x.state}`, x.reason ? `Reason: ${x.reason}` : "", x.path ? `Folder: ${x.path}` : "", x.path && x.bundle ? `Bundle: ${x.path}/${x.bundle.name}` : "", x.report ? `Report:\n${x.report}` : ""];
        answer(true, lines.filter(Boolean).join("\n"), c.id);
      }
      else if (c.cmd === "cancel") { const r = await cancelJob(c.id); answer(r.ok, r.ok ? "Cancel sent." : r.why, c.id); }
      else answer(false, "Unknown request.");
    } catch (e) { answer(false, e instanceof Error ? e.message : "That did not work."); }
  }

  // ---------- the view ----------
  function view(): View {
    const now = deps.now();
    const role: BridgeRole = keep?.role ?? "none";
    const p = peer();
    const rows = new Map<string, JobRowView>();
    if (role === "main" && keys()) {
      const mine = sentIds();
      for (const d of store.docs<JobDoc>("sojob")) {
        const x = d.data; if (!x || x.title === "cancel" || !mine.has(x.id)) continue;
        rows.set(x.id, { id: x.id, title: x.title, at: x.at, state: now > x.exp ? "timeout" : "sent", reason: now > x.exp ? "Nobody picked it up in time." : undefined, mine: true });
      }
      for (const kind of ["sjobst", "sores"] as const) for (const d of store.docs<ResDoc>(kind)) {
        const r = d.data; if (!r) continue;
        const b = decoded.get(`${d.id}:${r.env?.sig}`); if (!b) continue;
        const row = rows.get(r.job) ?? { id: r.job, title: "Job", at: b.startedAt ?? r.at, state: "sent" as const, mine: true };
        if (kind === "sjobst" && rows.get(r.job) && FINAL.includes(rows.get(r.job)!.state as JobState) && rows.get(r.job)!.state !== "timeout") continue;
        rows.set(r.job, { ...row, state: b.state, step: b.step, tail: b.tail, reason: b.reason, report: b.summary ?? row.report, endedAt: b.endedAt, bundle: b.result?.bundle ? { name: b.result.bundle.name, size: b.result.bundle.size } : row.bundle });
      }
      for (const [id, l] of landed) { const r = rows.get(id); if (r && l.path) r.path = l.path; }
    } else if (role === "other") for (const [id, r] of live) rows.set(id, r);
    const st = peerStat.st;
    return {
      role, phone: !!deps.phone, paired: !!p, device: keep?.device ?? "", name: myName(), peerName: p?.name ?? "", check: keep?.peer?.check ?? "",
      code: offer && now - offer.at < PAIR_CODE_MS ? offer.code : "", codeExpires: offer ? offer.at + PAIR_CODE_MS : 0,
      online: role === "main" || role === "none" ? !!p && isOnline(st ?? undefined, now) && st?.machine?.awake !== false : !!status?.awake, seenAt: peerStat.at,
      status: role !== "other" && st ? { awake: !!st.machine?.awake, locked: !!st.machine?.locked, busy: st.busy, queue: st.queue, app: st.app ?? "", model: "", chip: "", tools: st.have ?? [], helper: st.machine?.helper ?? "missing" } : status,
      jobs: [...rows.values()].filter((x) => now - x.at < JOB_KEEP_MS).sort((a, b) => b.at - a.at), note, canSend: role === "main" && !!p,
      folder: mac?.folder ?? "", phones: keep?.phones?.length ?? 0, ready,
    };
  }

  return {
    view, subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    startPairing, stopPairing, enterCode, unpair, sendJob, cancelJob, restartOther, onMac, onVault, tick, ensureKeys,
    hello() { if (deps.native) deps.post({ type: "outsource", op: "hello", v: BRIDGE_VERSION }); },
    /** Phone: types the code shown on the other computer, to be allowed to restart it. */
    enterCodeAsPhone: (code: string, name?: string) => enterCode(code, true, name),
    clearNote: () => setNote(""),
    _debug: { keys, peer, keep: () => keep },
  };
}
export type Engine = ReturnType<typeof createEngine>;
export { remember };
