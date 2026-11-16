// Outsource work to your other computer: the page's engine (PS 1.65). It joins the rules in core/second.ts to the person's own vault
// and to the Mac (core/secondbridge.ts). Everything it touches comes in through `Deps`, so tests/outsource.test.ts runs a fake
// second computer with no vault, no Mac and no network. The screen is views/OutsourceSettings.tsx and stays thin.
//
// Rules this file keeps:
//  - Change only sync: it writes a record only when something changed (a status heartbeat goes out every 2 minutes while PS is open
//    on the other computer, and only then). Nothing polls while PS is closed: there is no timer without an open page.
//  - The other computer runs a job only after acceptJob (signed by the paired main computer, sealed for it, not expired, not seen
//    before, no secret). Anything else becomes a refusal the main computer can read.
//  - The main computer accepts a result only from the paired other computer and only for a job it sent.
//  - Nothing here is tied to an app version: the pairing is a pair of public keys plus a device id.
import type { Doc, Kind } from "./model";
import type { KeepRecord, MacToPage, OtherStatus, PageToMac, PlainJob, BridgeRole, CliRequest } from "./secondbridge";
import { BRIDGE_CHUNK, BRIDGE_VERSION } from "./secondbridge";
import { b64, unb64, b64url, randomBytes, sha256hex } from "./crypto";
import {
  acceptCmd, acceptJob, acceptResult, cleanCode, codeOk, fileRefusal, FILE_MAX, isOnline, jobRunning, JOB_KEEP_MS, makeCmd, makeCode, makeJob, makeKeys, makeStatus,
  openEnv, PAIR_CODE_MS, pairCode, prune, remember, signBody, TAIL_FINAL, tail, looksSecret, outsourceTitle, OJOB_MAX_RUNNING, OJOB_MINUTES,
  type CmdBody, type Env, type JobArgs, type JobBody, type JobState, type JobStatusBody, type Keys, type Peer, type Seen, type StatBody,
} from "./second";

export const FEATURE_ID = "second-computer";
export type Store = {
  docs<T = unknown>(kind: Kind): Doc<T>[];
  put(kind: Kind, data: unknown, id: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  /** Tells the other computer to look now (the owner's private channel, no data in it). */
  poke(k: "job" | "stat" | "cmd" | "msg" | "file"): void;
};
export type Local = { get(k: string): string | null; set(k: string, v: string): void; del(k: string): void };
export type Deps = { store: Store; post(m: PageToMac): void; local: Local; now(): number; native: boolean };

export const OFFER_KEY = "ps-os-offer";    // the code shown on this computer (never in the vault)
const K_KEEP = "ps-os-keep", K_SEEN = "ps-os-seen", K_PHONES = "ps-os-phones", K_MY_JOBS = "ps-os-myjobs";
const HEARTBEAT_MS = 2 * 60_000;
const RUN_WRITE_MS = 20_000;

export type JobRowView = {
  id: string; title: string; at: number; state: JobState | "sent" | "refused" | "landed"; step?: string; tail?: string; reason?: string;
  report?: string; bundle?: { name: string; size: number }; path?: string; chunks?: { have: number; of: number }; mine: boolean;
};
export type View = {
  role: BridgeRole;
  paired: boolean;
  device: string;
  name: string;
  peerName: string;
  /** Pairing in progress on this computer. */
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
};

type DevDoc = { t: "dev"; device: string; name: string; role: BridgeRole | "phone"; pub: string; encPub: string; at: number };
type OfferDoc = { t: "offer"; device: string; name: string; pub: string; encPub: string; proof: string; at: number };
type AnswerDoc = { t: "answer"; offer: string; device: string; name: string; pub: string; encPub: string; proof: string; kind: "main" | "phone"; at: number };
type JobDoc = { id: string; to: string; from: string; at: number; exp: number; env: Env; title: string };
type ResDoc = { job: string; to: string; from: string; at: number; env: Env; chunks: number };
type ChunkDoc = { job: string; i: number; to: string; env: Env };
type CmdDoc = { id: string; to: string; from: string; at: number; exp: number; env: Env };
type StatDoc = { device: string; to: string; at: number; env: Env };

const j = <T,>(s: string | null, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };

export function createEngine(deps: Deps) {
  const { store, local } = deps;
  let keep: KeepRecord | null = j<KeepRecord | null>(local.get(K_KEEP), null);
  let mac: Extract<MacToPage, { op: "state" }> | null = null;
  let offer: { code: string; at: number } | null = null;
  let note = "";
  let status: OtherStatus | null = null;
  let peerStat: { at: number; st: StatBody | null } = { at: 0, st: null };
  const subs = new Set<() => void>();
  let lastRunWrite = 0, lastHeartbeat = 0, lastStatKey = "";
  const processed = new Set<string>();                  // docs already handled this session (the saved replay list is the real guard)
  const landed = new Map<string, { path: string }>(Object.entries(j<Record<string, { path: string }>>(local.get("ps-os-landed"), {})));
  const chunkSent = new Map<string, number>();
  const live = new Map<string, JobRowView>();          // the other computer: jobs running now
  let phonesTrusted: Peer[] = j<Peer[]>(local.get(K_PHONES), []);

  const emit = () => subs.forEach((f) => f());
  const setNote = (s: string) => { note = s; emit(); };
  const keys = (): Keys | null => (keep && keep.priv ? { device: keep.device, pub: keep.pub, encPub: keep.encPub, priv: keep.priv } : null);
  const peer = (): Peer | null => (keep?.peer ? { device: keep.peer.device, name: keep.peer.name, pub: keep.peer.pub, encPub: keep.peer.encPub, role: keep.role === "other" ? "primary" : "secondary" } : null);
  const saveKeep = (k: KeepRecord | null) => {
    keep = k;
    if (k) { local.set(K_KEEP, JSON.stringify(k)); deps.post({ type: "outsource", op: "keep", record: k }); } else { local.del(K_KEEP); deps.post({ type: "outsource", op: "forget" }); }
    emit();
  };
  const seen = (): Seen => j<Seen>(local.get(K_SEEN), {});
  const saveSeen = (s: Seen) => local.set(K_SEEN, JSON.stringify(s));

  /** This computer's name and keys. Made once; never remade by an update. */
  async function ensureKeys(role: BridgeRole, name: string): Promise<Keys> {
    const have = keys();
    if (have && keep) { if (keep.role !== role || (name && keep.name !== name)) saveKeep({ ...keep, role, name: name || keep.name }); return have; }
    const k = await makeKeys();
    saveKeep({ device: k.device, name: name || mac?.name || "This computer", role, pub: k.pub, encPub: k.encPub, priv: k.priv });
    return k;
  }
  const myName = () => keep?.name || mac?.name || "This computer";

  async function publishDev(role: BridgeRole | "phone") {
    if (!keep) return;
    const d: DevDoc = { t: "dev", device: keep.device, name: keep.name, role, pub: keep.pub, encPub: keep.encPub, at: deps.now() };
    await store.put("sdev", d, `sdev-${keep.device}`);
  }

  // ---------- pairing ----------
  /** On the OTHER computer: shows a one time code. Returns it. */
  async function startPairing(name?: string): Promise<string> {
    const k = await ensureKeys("other", name ?? "");
    const code = makeCode();
    offer = { code, at: deps.now() };
    const doc: OfferDoc = { t: "offer", device: k.device, name: myName(), pub: k.pub, encPub: k.encPub, proof: await pairCode(code, k.device, k.pub), at: deps.now() };
    await publishDev("other");
    await store.put("spair", doc, `spair-offer-${k.device}`);
    store.poke("msg");
    setNote("Type this code on your main computer. It works for 10 minutes.");
    return code;
  }
  /** On the MAIN computer (or the phone): types the code shown on the other computer. */
  async function enterCode(code: string, asPhone = false, name?: string): Promise<{ ok: boolean; why: string }> {
    if (!codeOk(code)) return { ok: false, why: "The code is 8 digits." };
    const now = deps.now();
    const k = await ensureKeys(asPhone ? "none" : "main", name ?? "");
    let match: OfferDoc | null = null;
    for (const d of store.docs<OfferDoc>("spair")) {
      const o = d.data;
      if (!o || o.t !== "offer" || now - o.at > PAIR_CODE_MS || now - o.at < -60_000) continue;
      if (o.device === k.device) continue;
      if (typeof o.proof === "string" && (await pairCode(code, o.device, o.pub)) === o.proof) { match = o; break; }
    }
    if (!match) return { ok: false, why: "No computer is showing that code. Check the digits, and that the other computer shows one." };
    const proof = await pairCode(code, "answer", match.device, k.device, k.pub);
    const ans: AnswerDoc = { t: "answer", offer: match.device, device: k.device, name: myName(), pub: k.pub, encPub: k.encPub, proof, kind: asPhone ? "phone" : "main", at: now };
    await store.put("spair", ans, `spair-answer-${match.device}-${k.device}`);
    await publishDev(asPhone ? "phone" : "main");
    if (!asPhone) saveKeep({ ...keep!, role: "main", peer: { device: match.device, name: match.name, pub: match.pub, encPub: match.encPub, pairedAt: now } });
    else saveKeep({ ...keep!, role: "none", peer: { device: match.device, name: match.name, pub: match.pub, encPub: match.encPub, pairedAt: now } });
    store.poke("msg");
    setNote(`Paired with ${match.name}.`);
    return { ok: true, why: "" };
  }
  /** OTHER computer: looks for an answer to its code. */
  async function checkAnswers() {
    if (!keep || keep.role !== "other" || !offer) return;
    const now = deps.now();
    if (now - offer.at > PAIR_CODE_MS) { offer = null; emit(); return; }
    for (const d of store.docs<AnswerDoc>("spair")) {
      const a = d.data;
      if (!a || a.t !== "answer" || a.offer !== keep.device || processed.has(d.id)) continue;
      const want = await pairCode(offer.code, "answer", keep.device, a.device, a.pub);
      if (a.proof !== want) continue;                                  // someone guessed: ignore it, the code stays
      processed.add(d.id);
      const p: Peer = { device: a.device, name: a.name, pub: a.pub, encPub: a.encPub, role: "primary" };
      if (a.kind === "phone") { phonesTrusted = [...phonesTrusted.filter((x) => x.device !== a.device), p]; local.set(K_PHONES, JSON.stringify(phonesTrusted)); setNote(`${a.name} can now restart this computer.`); }
      else saveKeep({ ...keep, peer: { device: a.device, name: a.name, pub: a.pub, encPub: a.encPub, pairedAt: now } });
      offer = null;
      await store.remove(`spair-offer-${keep.device}`).catch(() => {});
      await store.remove(d.id).catch(() => {});
      if (a.kind !== "phone") setNote(`Paired with ${a.name}.`);
      emit();
      void heartbeat(true);
      return;
    }
  }
  async function unpair() {
    if (keep) {
      const own = [`spair-offer-${keep.device}`, `sdev-${keep.device}`, `sstat-${keep.device}`];
      for (const id of own) await store.remove(id).catch(() => {});
      if (keep.peer) for (const d of store.docs<AnswerDoc>("spair")) if (d.data?.device === keep.device || d.data?.offer === keep.device) await store.remove(d.id).catch(() => {});
    }
    offer = null; peerStat = { at: 0, st: null };
    local.del(K_SEEN); local.del(K_PHONES); phonesTrusted = [];
    if (keep) saveKeep({ ...keep, role: "none", peer: undefined });
    deps.post({ type: "outsource", op: "forget" });
    setNote("Unpaired. This computer keeps its own keys, so pairing again is quick.");
  }

  // ---------- main computer: send a job, read results ----------
  const sentIds = () => new Set(j<string[]>(local.get(K_MY_JOBS), []));
  async function sendJob(args: JobArgs, opts: { now?: number } = {}): Promise<{ ok: boolean; id: string; why: string }> {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "main") return { ok: false, id: "", why: "Pair your other computer first." };
    const running = view().jobs.filter((x) => x.mine && jobRunning(x.state) || x.state === "sent").length;
    if (running >= OJOB_MAX_RUNNING + 4) return { ok: false, id: "", why: "Too many jobs are waiting. Let some finish first." };
    const a: JobArgs = { returns: { bundle: true, report: true, screenshots: false }, minutes: OJOB_MINUTES, tool: "claude", ...args };
    let made;
    try { made = await makeJob(k, p, a, { now: opts.now ?? deps.now() }); } catch (e) { return { ok: false, id: "", why: e instanceof Error ? e.message : "That job was refused." }; }
    const doc: JobDoc = { id: made.body.id, to: p.device, from: k.device, at: made.body.at, exp: made.body.exp, env: made.env, title: outsourceTitle(a.title) };
    await store.put("sojob", doc, `sojob-${made.body.id}`);
    local.set(K_MY_JOBS, JSON.stringify([...sentIds(), made.body.id].slice(-200)));
    store.poke("job");
    emit();
    return { ok: true, id: made.body.id, why: "" };
  }
  async function cancelJob(id: string) {
    const k = keys(), p = peer();
    if (!k || !p) return;
    const now = deps.now();
    const body: JobBody = { v: 1, t: "job", id: b64url(randomBytes(12)), from: k.device, to: p.device, at: now, exp: now + 10 * 60_000, type: "cancel", args: { job: id } as unknown as JobArgs };
    const env = await signBody(k, body, p.encPub);
    await store.put("sojob", { id: body.id, to: p.device, from: k.device, at: now, exp: body.exp, env, title: "cancel" } satisfies JobDoc, `sojob-${body.id}`);
    store.poke("job");
  }
  async function restartOther(kind: "restart" | "shutdown" = "restart"): Promise<{ ok: boolean; why: string }> {
    const k = keys(), p = peer();
    if (!k || !p) return { ok: false, why: "Pair your other computer first." };
    const made = await makeCmd(k, p, kind);
    await store.put("scmd", { id: made.body.id, to: p.device, from: k.device, at: made.body.at, exp: made.body.exp, env: made.env } satisfies CmdDoc, `scmd-${made.body.id}`);
    store.poke("cmd");
    setNote(kind === "restart" ? "Restart sent. It comes back only after you log in at it." : "Shut down sent.");
    return { ok: true, why: "" };
  }

  /** MAIN: one result doc arrived. Opens it, checks it, and (for a finished job with a bundle) collects the pieces. */
  async function readResults() {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "main") return;
    const mine = sentIds();
    for (const d of store.docs<ResDoc>("sores")) {
      const r = d.data;
      if (!r || r.to !== k.device) continue;
      const key = `${d.id}:${r.at}:${r.chunks}:${store.docs<ChunkDoc>("sfile").filter((c) => c.data?.job === r.job).length}`;
      if (processed.has(key)) continue;
      const acc = await acceptResult(r.env, { keys: k, peer: p, seen: {}, now: deps.now() }, (id) => mine.has(id));
      if (!acc.ok) { processed.add(key); continue; }
      const b = acc.body;
      if (b.state === "done" && b.result?.bundle) {
        const bu = b.result.bundle;
        if (landed.has(b.job)) { processed.add(key); continue; }
        const have = store.docs<ChunkDoc>("sfile").filter((c) => c.data?.job === b.job && c.data.to === k.device);
        if (have.length < bu.n) continue;                      // wait for the rest, the next change brings it back here
        if (bu.size > FILE_MAX) { processed.add(key); continue; }
        const parts: Uint8Array[] = new Array(bu.n);
        let bad = "";
        for (const c of have) {
          const o = await openEnv<{ v: number; t: "file"; id: string; from: string; to: string; at: number; chunk: string; n: number }>(k, c.data.env, p);
          if (!o.ok || o.body.n !== c.data.i) { bad = o.ok ? "a piece is out of order" : o.why; break; }
          parts[c.data.i] = unb64(o.body.chunk);
        }
        if (!bad) {
          const all = new Uint8Array(parts.reduce((n, x) => n + (x?.length ?? 0), 0)); let off = 0;
          for (const x of parts) { if (!x) { bad = "a piece is missing"; break; } all.set(x, off); off += x.length; }
          if (!bad && await sha256hex(all) !== bu.sha256) bad = "the bundle does not match its fingerprint";
        }
        if (bad) { processed.add(key); setNote(`A result bundle was refused: ${bad}.`); continue; }
        processed.add(key);
        deps.post({ type: "outsource", op: "land", id: b.job, report: b.summary ?? "", bundle: bu, shots: b.result?.shots });
        for (let i = 0; i < parts.length; i++) deps.post({ type: "outsource", op: "chunk", id: b.job, i, b64: b64(parts[i]) });
        chunkSent.set(b.job, parts.length);
      } else {
        processed.add(key);
        if (b.state === "done") deps.post({ type: "outsource", op: "land", id: b.job, report: b.summary ?? "" });
      }
    }
    emit();
  }

  // ---------- other computer: take jobs and commands ----------
  async function readJobs() {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "other") return;
    const now = deps.now();
    for (const d of store.docs<JobDoc>("sojob")) {
      const jd = d.data;
      if (!jd || jd.to !== k.device || processed.has(d.id)) continue;
      processed.add(d.id);
      const acc = await acceptJob(jd.env, { keys: k, peer: p, seen: seen(), now });
      if (!acc.ok) {
        // Not ours to run. Tell the main computer why, unless it is not even from our main computer.
        if (jd.from === p.device) await writeStatus({ job: jd.id, state: "refused", reason: acc.why, tail: "" });
        continue;
      }
      saveSeen(acc.seen);
      const b = acc.body;
      if (b.type === "cancel") { deps.post({ type: "outsource", op: "cancel", id: (b.args as unknown as { job: string }).job }); continue; }
      const running = [...live.values()].filter((x) => jobRunning(x.state)).length;
      const plain: PlainJob = {
        id: b.id, title: b.args.title, repo: b.args.repo, base: b.args.base, prompt: b.args.prompt,
        returns: { bundle: b.args.returns?.bundle !== false, report: b.args.returns?.report !== false, screenshots: !!b.args.returns?.screenshots },
        minutes: b.args.minutes ?? OJOB_MINUTES, tool: b.args.tool ?? "claude", createdAt: b.at, expiresAt: b.exp,
      };
      live.set(b.id, { id: b.id, title: b.args.title, at: b.at, state: running >= OJOB_MAX_RUNNING ? "queued" : "accepted", mine: false });
      await writeStatus({ job: b.id, state: running >= OJOB_MAX_RUNNING ? "queued" : "accepted", tail: "" });
      deps.post({ type: "outsource", op: "run", job: plain });
    }
    emit();
  }
  async function readCmds() {
    const k = keys();
    if (!k || keep?.role !== "other") return;
    const trusted = [peer(), ...phonesTrusted].filter((x): x is Peer => !!x);
    for (const d of store.docs<CmdDoc>("scmd")) {
      const c = d.data;
      if (!c || c.to !== k.device || processed.has(d.id)) continue;
      processed.add(d.id);
      const from = trusted.find((t) => t.device === c.from);
      if (!from) continue;
      const acc = await acceptCmd(c.env, { keys: k, peer: { ...from, role: "primary" }, seen: seen(), now: deps.now() });
      if (!acc.ok) continue;
      saveSeen(acc.seen);
      if (acc.body.action === "restart" || acc.body.action === "shutdown") deps.post({ type: "outsource", op: "restart", kind: acc.body.action });
    }
  }
  async function writeStatus(s: { job: string; state: JobState; reason?: string; tail: string; step?: string; startedAt?: number; endedAt?: number; exit?: number; summary?: string; result?: JobStatusBody["result"] }) {
    const k = keys(), p = peer();
    if (!k || !p) return;
    const env = await makeStatus(k, p, s as never);
    const doc: ResDoc = { job: s.job, to: p.device, from: k.device, at: deps.now(), env, chunks: 0 };
    await store.put(s.state === "running" || s.state === "accepted" || s.state === "queued" ? "sjobst" : "sores", doc, `${s.state === "running" || s.state === "accepted" || s.state === "queued" ? "sjobst" : "sores"}-${s.job}`);
    store.poke("job");
  }
  /** OTHER: the Mac told us about a job. */
  async function onMac(m: MacToPage) {
    if (m.type !== "outsource") return;
    if (m.op === "state") {
      mac = m;
      if (m.keep && (!keep || m.keep.device !== keep.device || (m.keep.peer && !keep.peer))) { keep = m.keep; local.set(K_KEEP, JSON.stringify(keep)); }
      status = { awake: m.awake, locked: m.locked, busy: false, queue: 0, app: m.app, model: m.model, chip: m.chip, tools: m.cli, helper: m.helper };
      emit(); void heartbeat(true);
    } else if (m.op === "power") { if (status) status = { ...status, awake: m.awake, locked: m.locked }; emit(); void heartbeat(true); }
    else if (m.op === "progress") {
      const row = live.get(m.id); if (!row) return;
      live.set(m.id, { ...row, state: m.state, step: m.step, tail: m.tail ? tail(m.tail, 600) : row.tail });
      const now = deps.now();
      if (m.state !== "running" || now - lastRunWrite > RUN_WRITE_MS) { lastRunWrite = now; await writeStatus({ job: m.id, state: m.state as JobState, step: m.step, tail: tail(m.tail ?? "", 600), startedAt: m.startedAt }); }
      emit();
    } else if (m.op === "done") {
      live.set(m.id, { ...(live.get(m.id) ?? { id: m.id, title: "", at: deps.now(), mine: false }), state: m.state });
      const sec = looksSecret(m.report);
      const report = sec ? "The report was left out: it looked like it held a secret." : tail(m.report, TAIL_FINAL);
      const bu = m.bundle && m.bundle.size <= FILE_MAX && !fileRefusal(m.bundle.name, m.bundle.size) ? m.bundle : undefined;
      pendingBundle.set(m.id, { n: bu?.n ?? 0, sha: bu?.sha256 ?? "", size: bu?.size ?? 0, name: bu?.name ?? "", got: new Map(), report, state: m.state, exit: m.exit, shots: m.shots });
      if (!bu) await finishResult(m.id);
      emit();
    } else if (m.op === "chunk") {
      const pb = pendingBundle.get(m.id); if (!pb) return;
      pb.got.set(m.i, m.b64);
      if (pb.got.size >= pb.n) await finishResult(m.id);
    } else if (m.op === "landed") { landed.set(m.id, { path: m.path }); local.set("ps-os-landed", JSON.stringify(Object.fromEntries(landed))); emit(); }
    else if (m.op === "cli") await onCli(m.req, m.cmd);
  }
  const pendingBundle = new Map<string, { n: number; sha: string; size: number; name: string; got: Map<number, string>; report: string; state: JobState; exit?: number; shots?: string[] }>();
  async function finishResult(id: string) {
    const pb = pendingBundle.get(id), k = keys(), p = peer();
    if (!pb || !k || !p) return;
    pendingBundle.delete(id);
    let n = 0;
    for (let i = 0; i < pb.n; i++) {
      const b64s = pb.got.get(i); if (b64s === undefined) continue;
      const env = await signBody(k, { v: 1, t: "file", id: `${id}-${i}`, from: k.device, to: p.device, at: deps.now(), name: pb.name, size: pb.size, sha256: pb.sha, mime: "application/x-git-bundle", purpose: "result", job: id, chunk: b64s, n: i } as never, p.encPub);
      await store.put("sfile", { job: id, i, to: p.device, env } satisfies ChunkDoc, `sfile-${id}-${i}`);
      n++;
    }
    await writeStatus({
      job: id, state: pb.state, tail: "", summary: pb.report, exit: pb.exit, endedAt: deps.now(),
      result: pb.n ? { bundle: { name: pb.name, sha256: pb.sha, size: pb.size, n: pb.n }, shots: pb.shots } : { shots: pb.shots },
    });
    void n;
  }

  // ---------- both: status heartbeat, reading the vault ----------
  async function heartbeat(force = false) {
    const k = keys(), p = peer();
    if (!k || !p || keep?.role !== "other" || !status || !deps.native) return;
    const now = deps.now();
    const key = JSON.stringify([status.awake, status.locked, status.helper, [...live.values()].filter((x) => jobRunning(x.state)).length]);
    if (!force && key === lastStatKey && now - lastHeartbeat < HEARTBEAT_MS) return;
    lastHeartbeat = now; lastStatKey = key;
    const busy = [...live.values()].some((x) => jobRunning(x.state));
    const body = { v: 1, t: "stat", id: `stat-${k.device}`, from: k.device, to: p.device, at: now, cpu: 0, battery: status.battery ?? 1, charging: !!status.charging, power: status.charging === false ? "battery" : "ac", busy, queue: [...live.values()].filter((x) => x.state === "queued").length, have: status.tools, app: status.app, machine: { awake: status.awake, locked: status.locked, helper: status.helper } } as StatBody;
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
  /** Called on every vault change (the vault only fires when a record changed). */
  async function onVault() {
    if (!keep) return;
    try { await checkAnswers(); await readJobs(); await readCmds(); await readResults(); await readStat(); } catch { /* a bad record never stops the next one */ }
    emit();
  }
  /** Every 2 minutes while the page is open on the other computer. */
  const tick = () => heartbeat(false);

  // ---------- the person's AI, through the command line ----------
  async function onCli(req: string, c: CliRequest) {
    const answer = (ok: boolean, text: string, id?: string) => deps.post({ type: "outsource", op: "cli-answer", req, ok, text, id });
    try {
      if (c.cmd === "status") { const v = view(); answer(true, v.paired ? `${v.peerName}: ${v.online ? "awake and ready" : "not heard from lately"}` : "No other computer is paired."); }
      else if (c.cmd === "send") { const r = await sendJob({ title: c.title, repo: c.repo, base: c.base, prompt: c.prompt, minutes: c.minutes, tool: c.tool, returns: { bundle: c.bundle !== false, report: true, screenshots: !!c.screenshots } }); answer(r.ok, r.ok ? `Sent. Job ${r.id}` : r.why, r.id); }
      else if (c.cmd === "list") answer(true, view().jobs.slice(0, 20).map((x) => `${x.id} ${x.state} ${x.title}`).join("\n") || "No jobs yet.");
      else if (c.cmd === "result") { const x = view().jobs.find((y) => y.id === c.id); answer(!!x, x ? `${x.state}${x.path ? `\nbundle: ${x.path}` : ""}\n${x.report ?? ""}` : "No such job.", c.id); }
      else if (c.cmd === "cancel") { await cancelJob(c.id); answer(true, "Cancel sent.", c.id); }
      else if (c.cmd === "restart") { const r = await restartOther("restart"); answer(r.ok, r.ok ? "Restart sent." : r.why); }
    } catch (e) { answer(false, e instanceof Error ? e.message : "That did not work."); }
  }

  // ---------- the view ----------
  function view(): View {
    const now = deps.now();
    const role: BridgeRole = keep?.role ?? "none";
    const p = peer();
    const mine = sentIds();
    const rows = new Map<string, JobRowView>();
    if (role === "main" && keys()) {
      for (const d of store.docs<JobDoc>("sojob")) {
        const x = d.data; if (!x || x.title === "cancel" || !mine.has(x.id)) continue;
        rows.set(x.id, { id: x.id, title: x.title, at: x.at, state: now > x.exp ? "timeout" : "sent", mine: true });
      }
      for (const kind of ["sjobst", "sores"] as const) for (const d of store.docs<ResDoc>(kind)) {
        const r = d.data; if (!r || !rows.has(r.job)) continue;
        const cached = decoded.get(`${d.id}:${r.at}`); if (!cached) { void decodeOne(`${d.id}:${r.at}`, r); continue; }
        const row = rows.get(r.job)!;
        rows.set(r.job, { ...row, state: cached.state, step: cached.step, tail: cached.tail, reason: cached.reason, report: cached.summary, bundle: cached.result?.bundle ? { name: cached.result.bundle.name, size: cached.result.bundle.size } : row.bundle, path: landed.get(r.job)?.path ?? row.path });
      }
      for (const [id, l] of landed) { const r = rows.get(id); if (r) r.path = l.path; }
    } else if (role === "other") for (const [id, r] of live) rows.set(id, r);
    const st = peerStat.st;
    return {
      role, paired: !!p, device: keep?.device ?? "", name: myName(), peerName: p?.name ?? "",
      code: offer && now - offer.at < PAIR_CODE_MS ? offer.code : "", codeExpires: offer ? offer.at + PAIR_CODE_MS : 0,
      online: role === "main" ? isOnline(st ?? undefined, now) : !!status?.awake, seenAt: peerStat.at,
      status: role === "main" && st ? { awake: !!st.machine?.awake, locked: !!st.machine?.locked, busy: st.busy, queue: st.queue, app: st.app ?? "", model: "", chip: "", tools: st.have, helper: st.machine?.helper ?? "missing" } : status,
      jobs: prune([...rows.values()], now, JOB_KEEP_MS).sort((a, b) => b.at - a.at), note, canSend: role === "main" && !!p,
      folder: mac?.folder ?? "", phones: phonesTrusted.length,
    };
  }
  const decoded = new Map<string, JobStatusBody>();
  async function decodeOne(key: string, r: ResDoc) {
    const k = keys(), p = peer(); if (!k || !p) return;
    const acc = await acceptResult(r.env, { keys: k, peer: p, seen: {}, now: deps.now() }, (id) => sentIds().has(id));
    if (acc.ok) { decoded.set(key, acc.body); emit(); }
  }

  return {
    view, subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
    startPairing, enterCode, unpair, sendJob, cancelJob, restartOther, onMac, onVault, tick, ensureKeys,
    hello() { deps.post({ type: "outsource", op: "hello", v: BRIDGE_VERSION }); },
    setStatus(s: OtherStatus) { status = s; emit(); void heartbeat(true); },
    /** Phone: types the code to be allowed to restart the other computer. */
    enterCodeAsPhone: (code: string, name?: string) => enterCode(code, true, name),
    /** Phone: sends the restart from here (the phone has its own keys and the other computer trusts it after pairing). */
    phonePeer: () => peer(),
    _debug: { keys, peer },
  };
}
export type Engine = ReturnType<typeof createEngine>;
export { cleanCode, BRIDGE_CHUNK, remember, unb64, b64 };
