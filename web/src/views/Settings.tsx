import { useEffect, useMemo, useState, type FormEvent } from "react";
import "./extra.css";
import { GmailSettings } from "./Replies";
import type { ClientRec, Settings } from "../core/model";
import { settingsData } from "../core/select";
import { saveSettings } from "../core/actions";
import { accessLog, agentWorkspaceCount, changePassphrase, createAgentInvites, docs, lock, revokeAgent, signOutAndForget, sync } from "../core/vault";
import { KDF_ITERS, passphraseScore, suggestPassphrase } from "../core/crypto";
import { parseImportFile, planImport, runImport, type ImportFile, type ImportPlan, type ImportProgress, type ImportResult } from "../core/importer";
import { Field, Icon, Modal, confirmAsk, copyText, fmtDateTime, toast, todayISO, useVault } from "../ui/kit";
import { primeSfx, setSfxVolume, sfx } from "../ui/sfx";
import { TM_SOUND_DEFAULT } from "./TaskMap";
import { DAY_ENDS_DEFAULT } from "../core/daylog";
import { InviteOwners } from "./InviteOwners";
import { AutoResetSetting } from "./AutoReset";
import { isRedAccount } from "../core/account";
import { PsDownloads } from "./PsDownloads";

export function SettingsView() {
  // Gmail and Claude access are the developer's own; Invite someone hides itself on every other account.
  const red = isRedAccount(useVault());
  return (
    <div className="stack loose">
      <div className="x-head">
        <span className="label">Settings</span>
        <h1 className="h1">Security and settings</h1>
        <p>How your vault is protected, who has signed in, and your preferences.</p>
      </div>
      <SecurityPanel />
      <div className="grid2">
        <Preferences />
        <PassphrasePanel />
      </div>
      {red && <GmailSettings />}
      {red && <ClaudeAccess />}
      <InviteOwners />
      <SignInLog />
      <ImportPanel />
      <div className="grid2">
        <ExportPanel />
        <InstallPanel />
      </div>
      <PsDownloads />
      <DevicePanel />
    </div>
  );
}

// ---------- security summary + status ----------
function SecurityPanel() {
  const s = useVault();
  const points = [
    "Everything is locked with AES-256-GCM inside your browser before it goes anywhere.",
    "Your passphrase never leaves this device. It is stretched with PBKDF2 " + KDF_ITERS.toLocaleString() + " rounds, so guessing it is very slow.",
    "Each client has their own key. A client can only ever open their own workspace.",
    "The server only stores scrambled data. Without your passphrase it is unreadable, even to the host.",
    "Client data is sandboxed twice: database rules keep each client to their own rows, and separate keys mean even a rule mistake would only show scrambled data.",
  ];
  return (
    <section className="panel stack" aria-labelledby="sec-h">
      <div className="row">
        <span className="x-rule" style={{ padding: 0, border: 0, background: "none" }}><span className="x-ico"><Icon name="shield" size={20} /></span></span>
        <h2 className="h2" id="sec-h">How your vault is protected</h2>
      </div>
      <ul className="x-checks">
        {points.map((p) => <li key={p}><Icon name="check" /><span>{p}</span></li>)}
      </ul>
      <hr className="divider" />
      <div className="stats">
        <div className="stat"><span className="label">Offline copy</span><b style={{ fontSize: 17 }}>{s.lastSync || s.docs.size ? "On this device" : "Not yet"}</b><span className="small muted">Encrypted, opens without internet</span></div>
        <div className="stat"><span className="label">Last sync</span><b className="num" style={{ fontSize: 17 }}>{s.lastSync ? fmtDateTime(s.lastSync) : "Never"}</b><span className="small muted">{s.online ? "Online" : "Offline right now"}</span></div>
        <div className={`stat${s.pendingCount ? " alert" : ""}`}><span className="label">Pending changes</span><b className="num">{s.pendingCount}</b><span className="small muted">{s.pendingCount ? "Will sync when online" : "All saved"}</span></div>
        <div className="stat"><span className="label">Records</span><b className="num">{s.docs.size}</b><span className="small muted">Decrypted in memory only</span></div>
      </div>
      {s.syncError && <div className="banner"><Icon name="wifi" /> {s.syncError}</div>}
      <div className="row wrap-ok">
        <button className="btn ghost" onClick={() => void sync()} disabled={s.syncing}><Icon name="sync" /> {s.syncing ? "Syncing" : "Sync now"}</button>
        <button className="btn ghost" onClick={lock}><Icon name="lock" /> Lock now</button>
      </div>
    </section>
  );
}

// ---------- preferences ----------
function Preferences() {
  const s = useVault();
  const st = settingsData(s);
  const [name, setName] = useState(st.ownerName);
  useEffect(() => setName(st.ownerName), [st.ownerName]);
  async function save(patch: Partial<Settings>, msg = "Saved") {
    try { await saveSettings(patch); toast(msg); } catch (e) { toast(String((e as Error).message || e)); }
  }
  const LOCKS: [number, string][] = [[5, "5 min"], [15, "15 min"], [30, "30 min"], [60, "1 hour"], [0, "Never"]];
  return (
    <section className="panel stack" aria-labelledby="pref-h">
      <h2 className="h2" id="pref-h">Preferences</h2>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }} id="al-l">Auto lock after</span>
        <div className="x-segs" role="radiogroup" aria-labelledby="al-l">
          {LOCKS.map(([v, l]) => <button key={v} className="chip" role="radio" aria-checked={st.autoLockMin === v} aria-pressed={st.autoLockMin === v} onClick={() => void save({ autoLockMin: v })}>{l}</button>)}
        </div>
        {st.autoLockMin === 0 && <small className="hint" style={{ color: "var(--warn)" }}>Never locking is only safe on a device nobody else can touch.</small>}
      </div>
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }} id="th-l">Theme</span>
        <div className="tabs" role="radiogroup" aria-labelledby="th-l" style={{ justifySelf: "start" }}>
          {(["system", "light", "dark"] as const).map((t) => <button key={t} className="tab" role="radio" aria-checked={st.theme === t} aria-selected={st.theme === t} onClick={() => void save({ theme: t })}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
      </div>
      <Field label="Your birthday" hint="Gives your personal year, month and day on the Today screen. Stays encrypted in your vault.">
        <input className="input" type="date" value={st.birthday || ""} onChange={(e) => void save({ birthday: e.target.value || null }, "Birthday saved")} style={{ maxWidth: 220 }} />
      </Field>
      <Field label="Your display name" hint="Used in greetings around the app.">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== st.ownerName && void save({ ownerName: name.trim() })} />
      </Field>
      <SoundSetting />
      <div className="stack tight">
        <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }}>Daily to-do reset</span>
        <AutoResetSetting className="" st={st} save={(p) => void save(p, "Saved")} />
      </div>
      <Field label="Your work day ends at" hint="Reset saves everything you ticked to the day you worked. Pressing it before this time counts for the day before, so a 10am Reset after a night shift saves to yesterday.">
        <select className="select" style={{ maxWidth: 220 }} value={st.dayEndsHour ?? DAY_ENDS_DEFAULT}
          onChange={(e) => void save({ dayEndsHour: Number(e.target.value) }, "Saved")}>
          <option value={0}>Midnight (no night shifts)</option>
          {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>{new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" })}</option>
          ))}
        </select>
      </Field>
    </section>
  );
}

// Tab list hover and click sounds. Also shown in PS > Settings.
export function SoundSetting() {
  const st = settingsData(useVault());
  const saved = st.tmSound ?? TM_SOUND_DEFAULT;
  const [v, setV] = useState(saved);
  useEffect(() => { setV(saved); }, [saved]);
  const commit = (n: number) => { setSfxVolume(n); if (n !== saved) void saveSettings({ tmSound: n }); };
  return (
    <div className="stack tight">
      <span className="small" style={{ fontWeight: 600, color: "var(--ink-2)" }} id="snd-l">Task list sounds</span>
      <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
        <input type="range" min={0} max={100} step={5} value={v} aria-labelledby="snd-l" style={{ width: 220, accentColor: "var(--pink)" }}
          onChange={(e) => setV(Number(e.target.value))}
          onPointerUp={(e) => commit(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => commit(Number((e.target as HTMLInputElement).value))} />
        <span className="num small" style={{ minWidth: 44, fontWeight: 700 }}>{v === 0 ? "Off" : `${v}%`}</span>
        <button type="button" className="btn quiet sm" onClick={() => { primeSfx(); setSfxVolume(v); sfx.test(); }} disabled={v === 0}>Test</button>
      </div>
      <small className="hint">The small clicks when you hover and click tasks in the Tab list. 0 turns them off.</small>
    </div>
  );
}

// ---------- Claude access: client workspaces only ----------
// Claude (on this Mac) gets its own account in each client workspace, like a second you for
// client dashboards. It can never open your own vault: your to-do list, notes, pipeline, money,
// emails and settings stay yours only. Its key lives only in this Mac's Keychain.
function ClaudeAccess() {
  const st = settingsData(useVault());
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const pending = st.agentInvites || [];
  useEffect(() => {
    if (!st.agentId) { setCount(null); return; }
    void agentWorkspaceCount(st.agentId).then(setCount).catch(() => setCount(null));
  }, [st.agentId, pending.length]);

  async function give() {
    setBusy(true);
    try {
      const invites = await createAgentInvites(st.agentId || null);
      if (!invites.length) { toast("Claude already has every client workspace."); return; }
      await saveSettings({ agentInvites: [...pending, ...invites.map((i) => i.id)] });
      // Workspace ids only, never client names. Claude picks the file up and moves it to the Trash.
      const blob = new Blob([JSON.stringify({ v: 1, kind: "cincee-agent-invites", invites })], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "claude-vault-access.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Saved claude-vault-access.json (${invites.length} client${invites.length === 1 ? "" : "s"}). Tell Claude it is in Downloads.`, undefined, 12000);
    } catch (e) { toast(String((e as Error).message || e)); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!(await confirmAsk("Take Claude out of every client workspace now?"))) return;
    setBusy(true);
    try {
      await revokeAgent(st.agentId || null, pending);
      await saveSettings({ agentId: null, agentInvites: [], agentSince: null });
      toast("Claude's access is revoked.");
    } catch (e) { toast(String((e as Error).message || e)); }
    finally { setBusy(false); }
  }

  const active = !!st.agentId;
  return (
    <section className="panel stack" aria-labelledby="ai-h">
      <div className="row between wrap-ok">
        <h2 className="h2" id="ai-h">Claude access</h2>
        <span className={`pill ${active ? "good" : pending.length ? "warn" : ""}`}>
          {active ? `On since ${fmtDateTime(st.agentSince || "")}` : pending.length ? "Waiting for Claude to finish" : "Off"}
        </span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        Lets Claude, on this Mac, open and update your <b>client workspaces</b> the way you do: tasks, stages, previews, payments and files.
        It can <b>never</b> open your own vault: your to-do list, notes, pipeline, money, emails and settings stay yours only.
        Clients keep their own passwords as before.
      </p>
      <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
        <li>Claude's key is kept only in this Mac's Keychain, never in a file, the website or a chat.</li>
        <li>Every Claude sign-in shows in the Sign-in log below, and Claude keeps a log of each change on this Mac.</li>
        <li>Revoke takes Claude out of every client workspace at once. Anything it already copied stays readable to it, so for a full lock-out after revoking, ask for the client keys to be changed.</li>
      </ul>
      {active && count != null && <p className="small" style={{ margin: 0 }}>Claude can open <b>{count}</b> client workspace{count === 1 ? "" : "s"}.</p>}
      {pending.length > 0 && <p className="small" style={{ margin: 0 }}>Claude has {pending.length} invite{pending.length === 1 ? "" : "s"} to use. This updates by itself once it has.</p>}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn primary" disabled={busy} onClick={() => void give()}>
          {active ? "Add new clients for Claude" : "Give Claude access to client workspaces"}
        </button>
        {(active || pending.length > 0) && <button className="btn danger" disabled={busy} onClick={() => void revoke()}>Revoke Claude's access</button>}
      </div>
    </section>
  );
}

// ---------- change passphrase ----------
function PassphrasePanel() {
  const s = useVault();
  const [oldP, setOld] = useState("");
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [show, setShow] = useState(false);
  const [suggested, setSuggested] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const sc = passphraseScore(p1);
  const pct = Math.min(100, Math.round((sc.bits / 90) * 100));

  function suggest() {
    const v = suggestPassphrase();
    setSuggested(v); setP1(v); setP2(v); setShow(true);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    if (!sc.ok) { setErr("Pick a stronger passphrase. It is the only thing protecting the vault."); return; }
    if (p1 !== p2) { setErr("The two new passphrases do not match."); return; }
    if (p1 === oldP) { setErr("The new passphrase is the same as the current one."); return; }
    setBusy(true);
    try {
      await changePassphrase(oldP, p1);
      setOld(""); setP1(""); setP2(""); setSuggested("");
      toast("Passphrase changed. Use the new one next time you unlock.");
    } catch (e2) { setErr(String((e2 as Error).message || e2)); }
    finally { setBusy(false); }
  }
  const type = show ? "text" : "password";
  return (
    <section className="panel" aria-labelledby="pp-h">
      <form className="stack" onSubmit={submit}>
        <div className="row between">
          <h2 className="h2" id="pp-h">Change passphrase</h2>
          <button type="button" className="btn quiet sm" onClick={() => setShow((v) => !v)} aria-pressed={show}><Icon name="eye" size={15} /> {show ? "Hide" : "Show"}</button>
        </div>
        <p className="small muted">Your data is re-locked with the new passphrase on this device. Your recovery key keeps working.</p>
        <Field label="Current passphrase"><input className="input" type={type} value={oldP} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" required /></Field>
        <Field label="New passphrase">
          <input className="input" type={type} value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" required />
        </Field>
        <div className="stack tight">
          <div className={`progress${sc.ok ? "" : " amber"}`}><i style={{ width: `${p1 ? pct : 0}%` }} /></div>
          <small className="hint">{sc.hint}</small>
        </div>
        <Field label="Type the new passphrase again"><input className="input" type={type} value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" required /></Field>
        {p2 && p1 !== p2 && <span className="err">They do not match yet.</span>}
        <div className="row wrap-ok">
          <button type="button" className="btn quiet sm" onClick={suggest}><Icon name="bolt" size={15} /> Suggest a strong one</button>
        </div>
        {suggested && (
          <div className="stack tight">
            <div className="x-suggest">{suggested}</div>
            <div className="row wrap-ok"><button type="button" className="btn quiet sm" onClick={() => void copyText(suggested)}>Copy</button><span className="small muted">Write it down somewhere safe before you save.</span></div>
          </div>
        )}
        {err && <span className="err" role="alert">{err}</span>}
        <button className="btn primary" type="submit" disabled={busy || !s.online || !oldP || !p1 || !p2}>{busy ? "Changing..." : "Change passphrase"}</button>
        {!s.online && <small className="hint">Connect to the internet to change your passphrase.</small>}
      </form>
    </section>
  );
}

// ---------- sign-in log ----------
interface LogRow { user_id: string | null; created_at: string; user_agent: string | null }

/** The device a sign in came from. Since V1.57 the server keeps only a rough name ("Mac", "iPhone" ...,
 *  030_no_ip.sql) and no IP address; older rows had the full User-Agent, read the same way as before. */
const DEVICE_NAMES = new Set(["Mac", "iPhone", "iPad", "Android", "Windows", "Chromebook", "Linux", "Other"]);
export function simpleDevice(ua?: string | null) {
  if (!ua) return "Unknown device";
  if (DEVICE_NAMES.has(ua)) return ua === "Other" ? "Other device" : ua;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "Chromebook" : /Linux/.test(ua) ? "Linux" : "Unknown system";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /node|curl|python|Deno|axios/i.test(ua) ? "Script" : "Browser";
  return `${br} on ${os}`;
}

function SignInLog() {
  const s = useVault();
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [members, setMembers] = useState<{ user_id: string; workspace_id: string }[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true); setErr("");
    try {
      const r = await accessLog();
      setRows(r.log as LogRow[]);
      setMembers(r.members as { user_id: string; workspace_id: string }[]);
    } catch (e) { setErr(s.online ? String((e as Error).message || e) : "You are offline. The sign-in log needs the internet."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clientByWs = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of docs<ClientRec>("client")) if (c.data.ws) m.set(c.data.ws, c.data.name);
    return m;
  }, [s]);
  function who(uid: string | null): { label: string; known: boolean; you: boolean } {
    if (uid && uid === s.userId) return { label: "You", known: true, you: true };
    if (uid && uid === settingsData(s).agentId) return { label: "Claude (client workspaces only)", known: true, you: false };
    if (uid) {
      const names = members.filter((m) => m.user_id === uid).map((m) => clientByWs.get(m.workspace_id)).filter((x): x is string => !!x);
      if (names.length) return { label: [...new Set(names)].join(", "), known: true, you: false };
    }
    return { label: "Unknown", known: false, you: false };
  }
  const unknown = (rows || []).filter((r) => !who(r.user_id).known);

  return (
    <section className="panel stack" aria-labelledby="log-h">
      <div className="row between wrap-ok">
        <h2 className="h2" id="log-h">Sign-in log</h2>
        <button className="btn ghost sm" onClick={() => void load()} disabled={loading}><Icon name="sync" size={15} /> {loading ? "Loading" : "Refresh"}</button>
      </div>
      <p className="small muted">Every sign-in to the vault, newest first. Your NDAs ask you to spot and report any breach quickly, and this is where you would see one first.</p>
      {unknown.length > 0 && (
        <div className="banner" role="alert" style={{ background: "var(--bad-bg)", color: "var(--bad)" }}>
          <Icon name="shield" /> {unknown.length} sign-in{unknown.length > 1 ? "s" : ""} not from you or a known client. If you do not recognise {unknown.length > 1 ? "them" : "it"}, change your passphrase now, revoke client access, and follow your NDA breach steps.
        </div>
      )}
      {err && <div className="banner">{err}</div>}
      {rows && rows.length === 0 && <div className="empty">No sign-ins recorded yet.</div>}
      {rows && rows.length > 0 && (
        <table className="x-table">
          <thead><tr><th>When</th><th>Who</th><th>Device</th></tr></thead>
          <tbody>
            {rows.slice(0, 60).map((r, i) => {
              const w = who(r.user_id);
              return (
                <tr key={i} className={w.known ? undefined : "warn"}>
                  <td data-l="When" className="num">{fmtDateTime(r.created_at)}</td>
                  <td data-l="Who">{w.you ? <span className="pill good">You</span> : w.known ? <span className="pill plain">{w.label}</span> : <span className="pill bad">Unknown</span>}</td>
                  <td data-l="Device">{simpleDevice(r.user_agent)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------- import ----------
function ImportPanel() {
  const s = useVault();
  const [file, setFile] = useState<ImportFile | null>(null);
  const [fileName, setFileName] = useState("");
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [err, setErr] = useState("");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const running = !!progress && !result;

  async function pick(f?: File | null) {
    setErr(""); setResult(null); setProgress(null); setPlan(null); setFile(null);
    if (!f) return;
    setFileName(f.name);
    try {
      const parsed = parseImportFile(await f.text()); // read locally, never uploaded
      setFile(parsed);
      setPlan(planImport(parsed));
    } catch (e) { setErr(String((e as Error).message || e)); }
  }
  async function start() {
    if (!file || !plan) return;
    if (!s.online) { setErr("Connect to the internet first. Each new client needs its own key from the server."); return; }
    if (!confirmAsk(`Import ${plan.toImport} client${plan.toImport === 1 ? "" : "s"} and ${plan.projects} project${plan.projects === 1 ? "" : "s"} into the vault?`)) return;
    setErr("");
    setProgress({ done: 0, total: plan.clients.length, label: "Starting" });
    try {
      const r = await runImport(file, setProgress);
      setResult(r);
      setFile(null);
    } catch (e) { setErr(String((e as Error).message || e)); setProgress(null); }
  }
  function reset() { setFile(null); setPlan(null); setResult(null); setProgress(null); setFileName(""); setErr(""); }

  return (
    <section className="panel stack" aria-labelledby="imp-h">
      <div className="stack tight">
        <h2 className="h2" id="imp-h">Import clients from a file</h2>
        <p className="small muted">Pick a .json import file. It is read here in your browser and never uploaded. Each record is encrypted before it leaves this device. Clients whose name is already in the vault are skipped.</p>
      </div>

      {!plan && !result && (
        <label className="x-file">
          <input type="file" accept=".json,application/json" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
          <Icon name="up" size={22} />
          <b>Choose an import file</b>
          <span className="small muted">.json only</span>
        </label>
      )}
      {err && <div className="banner" role="alert">{err}</div>}

      {plan && !result && (
        <div className="stack">
          <div className="row between wrap-ok">
            <span className="small muted trunc">{fileName}</span>
            {!running && <button className="btn quiet sm" onClick={reset}>Choose another file</button>}
          </div>
          <div className="stats">
            <div className="stat"><span className="label">New clients</span><b className="num">{plan.toImport}</b></div>
            <div className="stat"><span className="label">Projects</span><b className="num">{plan.projects}</b></div>
            <div className="stat"><span className="label">Client tasks</span><b className="num">{plan.tasks}</b></div>
            <div className="stat"><span className="label">Skipped</span><b className="num">{plan.skipped}</b><span className="small muted">Already in the vault</span></div>
          </div>
          <ul className="list">
            {plan.clients.map((c, i) => (
              <li key={i} style={{ alignItems: "flex-start", opacity: c.skip ? 0.6 : 1 }}>
                <div className="stack tight" style={{ flex: 1, gap: 4 }}>
                  <div className="row between wrap-ok"><b style={{ overflowWrap: "anywhere" }}>{c.name}</b>{c.skip ? <span className="pill ink">Skipped, already exists</span> : <span className="pill good">New</span>}</div>
                  {c.contactName && <span className="small muted">{c.contactName}</span>}
                  {c.projects.length > 0 && (
                    <div className="row wrap-ok" style={{ gap: 6 }}>
                      {c.projects.map((p, j) => <span key={j} className="chip" style={{ fontWeight: 550 }}>{p.title} <span className="muted xs">{p.pipeline}</span></span>)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {plan.openQuestions.length > 0 && (
            <details className="stack tight">
              <summary className="small" style={{ cursor: "pointer", fontWeight: 650 }}>{plan.openQuestions.length} open question{plan.openQuestions.length > 1 ? "s" : ""} in this file</summary>
              <ul className="small muted" style={{ margin: "8px 0 0", paddingLeft: 18 }}>{plan.openQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </details>
          )}
          {progress ? (
            <div className="stack tight" aria-live="polite">
              <div className="progress"><i style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
              <span className="small muted">{progress.done} of {progress.total}: {progress.label}</span>
            </div>
          ) : (
            <button className="btn primary" onClick={() => void start()} disabled={!plan.toImport || !s.online}>
              <Icon name="lock" /> Encrypt and import {plan.toImport} client{plan.toImport === 1 ? "" : "s"}
            </button>
          )}
          {!s.online && <small className="hint">Connect to the internet to import.</small>}
        </div>
      )}

      {result && (
        <div className="stack">
          <div className="banner pinkish" style={{ alignItems: "flex-start" }}>
            <Icon name="check" />
            <span>Imported {result.clients} client{result.clients === 1 ? "" : "s"}, {result.projects} project{result.projects === 1 ? "" : "s"} and {result.tasks} client task{result.tasks === 1 ? "" : "s"}.{result.skipped.length ? ` Skipped ${result.skipped.length} that already existed.` : ""}</span>
          </div>
          {result.failed.length > 0 && (
            <div className="banner" role="alert" style={{ background: "var(--bad-bg)", color: "var(--bad)", alignItems: "flex-start" }}>
              <span>Could not import: {result.failed.map((f) => `${f.name} (${f.error})`).join("; ")}. Run the import again to retry; finished clients will be skipped.</span>
            </div>
          )}
          <div className="x-rule">
            <span className="x-ico"><Icon name="trash" size={20} /></span>
            <b>Delete the import file from your computer now. Your data is safely encrypted in the vault.</b>
          </div>
          <button className="btn ghost" onClick={reset} style={{ justifySelf: "start" }}>Done</button>
        </div>
      )}
    </section>
  );
}

// ---------- export ----------
function ExportPanel() {
  const s = useVault();
  const [ask, setAsk] = useState(false);
  function download() {
    const all = [...s.docs.values()].map((d) => ({ id: d.id, ws: d.ws, kind: d.kind, data: d.data, updatedAt: d.updatedAt }));
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), note: "NOT ENCRYPTED. Keep this file safe and delete it when done.", documents: all }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cincee-vault-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setAsk(false);
    toast("Backup downloaded. It is not encrypted.");
  }
  return (
    <section className="panel stack" aria-labelledby="exp-h">
      <h2 className="h2" id="exp-h">Export everything</h2>
      <p className="small muted">An owner backup of every record, decrypted, as one JSON file. It is made here on this device.</p>
      <button className="btn ghost" onClick={() => setAsk(true)} style={{ justifySelf: "start" }}><Icon name="down" /> Download backup</button>
      {ask && (
        <Modal title="This file is NOT encrypted" onClose={() => setAsk(false)} footer={<>
          <button className="btn quiet" onClick={() => setAsk(false)}>Cancel</button>
          <button className="btn danger" onClick={download}>I understand, download</button>
        </>}>
          <p>Anyone who opens this file can read every client record, note and email draft in it. Store it somewhere private, never email it, and delete it when you no longer need it. Your NDAs still apply to it.</p>
          <p className="small muted">{s.docs.size} records will be included.</p>
        </Modal>
      )}
    </section>
  );
}

// ---------- install ----------
function InstallPanel() {
  return (
    <section className="panel stack" aria-labelledby="ins-h">
      <h2 className="h2" id="ins-h">Install as an app</h2>
      <ul className="x-checks">
        <li><Icon name="check" /><span><b>Mac:</b> in Chrome or Safari, use <b>Add to Dock</b> (Safari: File menu; Chrome: the install icon in the address bar).</span></li>
        <li><Icon name="check" /><span><b>iPhone:</b> in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.</span></li>
        <li><Icon name="check" /><span><b>Android:</b> in Chrome, open the menu and tap <b>Install app</b>.</span></li>
      </ul>
      <p className="small muted">Works offline after your first sign in. Changes made offline sync when you are back online.</p>
    </section>
  );
}

// ---------- this device ----------
function DevicePanel() {
  const [busy, setBusy] = useState(false);
  async function forget() {
    if (!confirmAsk("Sign out and remove the offline copy from this device? Anything not yet synced will be lost. You can sign in again any time with your passphrase.")) return;
    setBusy(true);
    try { await signOutAndForget(); } catch (e) { toast(String((e as Error).message || e)); setBusy(false); }
  }
  return (
    <section className="panel stack" aria-labelledby="dev-h">
      <h2 className="h2" id="dev-h">This device</h2>
      <p className="small muted">Lock keeps the encrypted copy here so you can unlock quickly. Signing out removes it completely, which is right for a shared or borrowed device.</p>
      <div className="row wrap-ok">
        <button className="btn ghost" onClick={lock}><Icon name="lock" /> Lock now</button>
        <button className="btn danger" onClick={() => void forget()} disabled={busy}><Icon name="trash" /> Sign out and remove the offline copy from this device</button>
      </div>
    </section>
  );
}
