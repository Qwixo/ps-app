// Settings > Outsource work to your other computer (PS 1.65, the developer's idea: send heavy AI work from the main computer to
// the other one, so the main one stays cool and fast). Thin: every rule is in core/second.ts and core/outsource.ts, the wiring in
// src/outsourcerun.ts. What it shows: the switch, pairing (show a code on the other computer, type it on the main one, or on the
// phone to restart the other computer), whether the other computer is awake and ready, a restart button, running and finished
// jobs with their report and where the bundle landed, and Copy for AI (how the person's AI sends a job). Nothing here sends a job
// by itself and nothing merges: a result is a git bundle in a folder for the person, or their AI, to review.
// Esc closes Settings as always; every confirm here is a second click on the same button and goes back after 5 seconds.
import { useEffect, useRef, useState } from "react";
import { sfx } from "../ui/sfx";
import { fmtSize, seenText, STATE_WORD, jobRunning } from "../core/second";
import { setOutsourceOn, useOutsource, outsourceFeature } from "../outsourcerun";
import type { JobRowView, View } from "../core/outsource";
import "./outsource.css";

export const OUTSOURCE_WORDS = {
  intro: "Send heavy AI work, like code changes, builds and tests, from your main computer to your other one, so the main one stays cool and fast. The other computer works in its own copy, never pushes or sends anything, and hands back a git bundle and a short report. You decide what to keep.",
  on: "On", off: "Off",
  open: "PS must be open on the other computer for it to take jobs. Jobs wait up to a day.",
};

function useSure(): [string, (k: string) => boolean] {
  const [sure, setSure] = useState("");
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(""), 5000); return () => clearTimeout(t); }, [sure]);
  return [sure, (k: string) => { if (sure === k) { setSure(""); return true; } setSure(k); return false; }];
}

function statusPill(v: View): { t: string; c: string } {
  if (!v.paired) return { t: "Not paired", c: "" };
  if (v.role === "other") return { t: "Ready for jobs", c: "good" };
  if (!v.seenAt) return { t: "Waiting to hear from it", c: "" };
  if (!v.online) return { t: "Not heard from lately", c: "warn" };
  if (v.status?.busy) return { t: "Awake, working", c: "good" };
  return { t: "Awake and ready", c: "good" };
}

export function OutsourceSettings() {
  const { view: v, engine, on } = useOutsource();
  const [sure, ask] = useSure();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [, setNow] = useState(0);
  useEffect(() => { if (!v.code) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [v.code]);   // the code's countdown, only while one shows

  if (!outsourceFeature()) return <p className="os-soft">This is switched off in this build: Settings, G Squad, From the squad.</p>;
  if (!v.ready) return <p className="os-soft">Loading...</p>;
  const pill = statusPill(v);
  const act = async (f: () => Promise<{ ok: boolean; why: string } | unknown>) => {
    setBusy(true); setErr("");
    try { const r = await f() as { ok?: boolean; why?: string } | undefined; if (r && r.ok === false) setErr(r.why ?? ""); } catch (e) { setErr(e instanceof Error ? e.message : "That did not work."); }
    setBusy(false);
  };
  const where = v.phone ? "phone" : v.role;

  return (
    <div className="os-wrap">
      <p className="os-intro">{OUTSOURCE_WORDS.intro}</p>
      <div className="os-top">
        <button type="button" role="switch" aria-checked={on} className={`os-sw big${on ? " on" : ""}`} onClick={() => { sfx.click(); void setOutsourceOn(!on); }}>
          <i aria-hidden="true" /><span>{on ? OUTSOURCE_WORDS.on : OUTSOURCE_WORDS.off}</span>
        </button>
        {on ? <span className={`os-pill ${pill.c}`} role="status">{pill.t}</span> : null}
      </div>
      {!on ? <p className="os-soft">Off: no jobs go out or come in, and the other computer stays paired for later.</p> : <>
        {where === "none" && !v.phone && !v.paired ? <Pairing v={v} busy={busy} onMain={(code) => act(() => engine.enterCode(code))} onOther={() => act(() => engine.startPairing())} onStop={() => engine.stopPairing()} /> : null}
        {v.phone && !v.paired ? <PhonePair busy={busy} onCode={(code) => act(() => engine.enterCodeAsPhone(code))} /> : null}
        {v.paired ? <Paired v={v} sure={sure} ask={ask} busy={busy} onRestart={() => act(() => engine.restartOther("restart"))} onUnpair={() => act(() => engine.unpair())} /> : null}
        {err ? <p className="os-bad" role="alert">{err}</p> : v.note ? <p className="os-note-line" role="status">{v.note}</p> : null}
        {v.role === "main" && v.paired ? <Jobs v={v} sure={sure} ask={ask} onCancel={(id) => void act(() => engine.cancelJob(id))} /> : null}
        {v.role === "other" && v.paired ? <OtherJobs v={v} /> : null}
        {v.role === "main" && v.paired ? <CopyForAi folder={v.folder} /> : null}
        <p className="os-note" role="note">{OUTSOURCE_WORDS.open}</p>
      </>}
    </div>
  );
}

/** Not paired yet, on a Mac: which one is this? */
function Pairing({ v, busy, onMain, onOther, onStop }: { v: View; busy: boolean; onMain: (code: string) => void; onOther: () => void; onStop: () => void }) {
  const [pick, setPick] = useState<"" | "main" | "other">(v.code ? "other" : "");
  if (v.code) {
    const left = Math.max(0, Math.round((v.codeExpires - Date.now()) / 1000));
    return (
      <section className="os-card os-codecard" aria-label="Pairing code">
        <h4>Type this code on your main computer</h4>
        <div className="os-code" aria-live="polite">{v.code}</div>
        <p className="os-soft">In PS on your main computer: Settings, Outsource work to your other computer, This is my main computer. Works for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} more.</p>
        <div className="os-row"><button type="button" className="btn quiet sm" onClick={() => { sfx.click(); onStop(); setPick(""); }}>Stop</button></div>
      </section>
    );
  }
  return (
    <section className="os-card" aria-label="Pair your other computer">
      <h4>Pair your other computer</h4>
      <p className="os-soft">Do this once. The two computers stay paired through updates and restarts.</p>
      <div className="os-pick" role="radiogroup" aria-label="Which computer is this?">
        <button type="button" role="radio" aria-checked={pick === "main"} className={`os-choice${pick === "main" ? " on" : ""}`} onClick={() => { sfx.hover(); setPick("main"); }}>
          <b>This is my main computer</b><em>It sends work. Type the code the other computer shows.</em>
        </button>
        <button type="button" role="radio" aria-checked={pick === "other"} className={`os-choice${pick === "other" ? " on" : ""}`} onClick={() => { sfx.hover(); setPick("other"); }}>
          <b>This is my other computer</b><em>It does the work. It shows a code for your main computer.</em>
        </button>
      </div>
      {pick === "main" ? <CodeBox busy={busy} label="Pair" onCode={onMain} /> : null}
      {pick === "other" ? <div className="os-row"><button type="button" className="btn sm" disabled={busy} onClick={() => { sfx.click(); onOther(); }}>Show a code</button></div> : null}
    </section>
  );
}

function PhonePair({ busy, onCode }: { busy: boolean; onCode: (code: string) => void }) {
  return (
    <section className="os-card" aria-label="Pair this phone">
      <h4>Restart your other computer from this phone</h4>
      <p className="os-soft">On the other computer, open this tab and choose Show a code (in Pair your other computer, This is my other computer). Then type it here.</p>
      <CodeBox busy={busy} label="Pair this phone" onCode={onCode} />
    </section>
  );
}

function CodeBox({ busy, label, onCode }: { busy: boolean; label: string; onCode: (code: string) => void }) {
  const [code, setCode] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const digits = code.replace(/\D/g, "").slice(0, 8);
  const shown = digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits;
  return (
    <form className="os-row" onSubmit={(e) => { e.preventDefault(); if (digits.length === 8) { sfx.click(); onCode(digits); } }}>
      <input ref={ref} className="os-codein" inputMode="numeric" autoComplete="one-time-code" placeholder="1234-5678" aria-label="Pairing code" value={shown} onChange={(e) => setCode(e.target.value)} />
      <button type="submit" className="btn sm" disabled={busy || digits.length !== 8}>{busy ? "Pairing..." : label}</button>
    </form>
  );
}

function Paired({ v, sure, ask, busy, onRestart, onUnpair }: { v: View; sure: string; ask: (k: string) => boolean; busy: boolean; onRestart: () => void; onUnpair: () => void }) {
  const st = v.status;
  const facts: string[] = [];
  if (v.role !== "other" && st) {
    if (st.locked) facts.push("screen locked");
    if (st.tools.length) facts.push(`has ${st.tools.filter((t) => t !== "git").join(" and ") || "git only"}`);
    if (st.helper !== "approved") facts.push("restart helper not set up there");
  }
  const title = v.role === "other" ? `This is the other computer for ${v.peerName}` : v.phone ? `This phone can restart ${v.peerName}` : `Paired with ${v.peerName}`;
  return (
    <section className="os-card" aria-label="Paired">
      <div className="os-head">
        <span className={`os-dot${v.online ? " on" : ""}`} aria-hidden="true" />
        <h4>{title}</h4>
      </div>
      {v.role !== "other" ? <p className="os-soft">{v.seenAt ? `Heard from ${seenText(v.seenAt)}` : "Not heard from yet"}{facts.length ? `, ${facts.join(", ")}` : ""}.</p> : <p className="os-soft">Jobs from {v.peerName} run here one at a time.{v.phones ? ` ${v.phones === 1 ? "One phone" : `${v.phones} phones`} can restart this computer.` : ""}</p>}
      {v.check ? <p className="os-soft">Check words: <span className="os-check">{v.check}</span>. Both computers show the same four words.</p> : null}
      <div className="os-row">
        {v.role !== "other" ? <button type="button" className={`btn quiet sm${sure === "restart" ? " danger" : ""}`} disabled={busy} onClick={() => { sfx.click(); if (ask("restart")) onRestart(); }}>{sure === "restart" ? `Sure? Restart ${v.peerName}` : `Restart ${v.peerName}`}</button> : null}
        <button type="button" className={`btn quiet sm${sure === "unpair" ? " danger" : ""}`} disabled={busy} onClick={() => { sfx.click(); if (ask("unpair")) onUnpair(); }}>{sure === "unpair" ? "Sure? Unpair" : "Unpair"}</button>
      </div>
    </section>
  );
}

const pillOf = (s: JobRowView["state"]) => (s === "done" ? "good" : s === "failed" || s === "refused" || s === "timeout" ? "bad" : s === "cancelled" ? "" : "live");

function Jobs({ v, sure, ask, onCancel }: { v: View; sure: string; ask: (k: string) => boolean; onCancel: (id: string) => void }) {
  const [open, setOpen] = useState("");
  const running = v.jobs.filter((x) => jobRunning(x.state) || x.state === "sent");
  const done = v.jobs.filter((x) => !(jobRunning(x.state) || x.state === "sent"));
  const row = (x: JobRowView) => (
    <li key={x.id} className={`os-job${open === x.id ? " open" : ""}`}>
      <button type="button" className="os-jobhead" aria-expanded={open === x.id} onClick={() => { sfx.hover(); setOpen(open === x.id ? "" : x.id); }}>
        <span className="os-jobt">{x.title}</span>
        <span className={`os-pill sm ${pillOf(x.state)}`}>{STATE_WORD[x.state]}</span>
        <span className="os-when">{seenText(x.endedAt ?? x.at)}</span>
      </button>
      {x.step && jobRunning(x.state) ? <p className="os-step">{x.step}</p> : null}
      {open === x.id ? <div className="os-jobbody">
        {x.reason ? <p className="os-soft">{x.reason}</p> : null}
        {x.path ? <p className="os-soft">Landed in <code className="os-path">{x.path}</code>{x.bundle ? ` (${x.bundle.name}, ${fmtSize(x.bundle.size)})` : ""}. Nothing is merged.</p> : x.bundle ? <p className="os-soft">Bundle on its way ({fmtSize(x.bundle.size)}).</p> : null}
        <Report text={x.report ?? x.tail ?? ""} />
        <div className="os-row">
          {x.path ? <button type="button" className="btn quiet sm" onClick={() => { sfx.click(); void navigator.clipboard?.writeText(x.bundle ? `git fetch "${x.path}/${x.bundle.name}" "outsource/${x.id}:review/${x.id}"` : x.path ?? "").catch(() => {}); }}>{x.bundle ? "Copy the fetch line" : "Copy the folder"}</button> : null}
          {jobRunning(x.state) || x.state === "sent" ? <button type="button" className={`btn quiet sm${sure === x.id ? " danger" : ""}`} onClick={() => { sfx.click(); if (ask(x.id)) onCancel(x.id); }}>{sure === x.id ? "Sure? Cancel the job" : "Cancel"}</button> : null}
        </div>
      </div> : null}
    </li>
  );
  return (
    <section className="os-card" aria-label="Jobs">
      <h4>Jobs</h4>
      {!v.jobs.length ? <p className="os-soft">No jobs yet. Your AI sends them: Copy for AI below tells it how.</p> : null}
      {running.length ? <><span className="os-group">Running</span><ul className="os-jobs">{running.map(row)}</ul></> : null}
      {done.length ? <><span className="os-group">Finished</span><ul className="os-jobs">{done.slice(0, 12).map(row)}</ul></> : null}
    </section>
  );
}

/** The report the other computer wrote (JSON from the Mac runner), in plain lines. */
function Report({ text }: { text: string }) {
  if (!text) return null;
  let r: { summary?: string; files?: string[]; commits?: number; note?: string; seconds?: number; branch?: string } | null = null;
  try { const o = JSON.parse(text); if (o && typeof o === "object") r = o; } catch { /* plain text */ }
  if (!r) return <pre className="os-log">{text}</pre>;
  return (
    <div className="os-report">
      <p className="os-soft">{[r.commits !== undefined ? `${r.commits} ${r.commits === 1 ? "commit" : "commits"}` : "", r.seconds ? `${Math.max(1, Math.round(r.seconds / 60))} min` : "", r.note ?? ""].filter(Boolean).join(", ")}</p>
      {r.files?.length ? <pre className="os-log">{r.files.join("\n")}</pre> : null}
      {r.summary ? <pre className="os-log">{r.summary}</pre> : null}
    </div>
  );
}

function OtherJobs({ v }: { v: View }) {
  if (!v.jobs.length) return <section className="os-card" aria-label="Jobs here"><h4>Jobs here</h4><p className="os-soft">Nothing yet. Keep PS open and this computer awake.</p></section>;
  return (
    <section className="os-card" aria-label="Jobs here">
      <h4>Jobs here</h4>
      <ul className="os-jobs">{v.jobs.slice(0, 8).map((x: JobRowView) => (
        <li key={x.id} className="os-job"><div className="os-jobhead static"><span className="os-jobt">{x.title || "Job"}</span><span className={`os-pill sm ${pillOf(x.state)}`}>{STATE_WORD[x.state]}</span><span className="os-when">{seenText(x.endedAt ?? x.at)}</span></div>
          {x.step && jobRunning(x.state) ? <p className="os-step">{x.step}</p> : null}</li>
      ))}</ul>
    </section>
  );
}

export function aiGuide(cli: string): string {
  return [
    "I can send heavy work to my other computer through PS. Use this command:",
    `  "${cli}" status`,
    `  "${cli}" send --title "Short title" --repo <git link or a folder name the other computer has> --base <commit> --prompt-file <file with the instructions> [--tool claude|codex] [--minutes 30] [--screenshots]`,
    `  "${cli}" list`,
    `  "${cli}" result <job id>`,
    `  "${cli}" cancel <job id>`,
    "Push the base commit first, so the other computer can fetch it. It works in its own copy on a fresh branch and never pushes, deploys or sends anything.",
    "A finished job comes back as a git bundle and a short report. Fetch it into a review branch with the line `result` prints, review it, and ask me before anything is merged.",
    "Never put passwords, keys or tokens in a job: PS refuses them.",
  ].join("\n");
}

function CopyForAi({ folder }: { folder: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 2200); return () => clearTimeout(t); }, [done]);
  const cli = (folder || "~/Library/Application Support/PS/outsource") + "/bin/ps-outsource";
  return (
    <button type="button" className={`os-copy${done ? " done" : ""}`} onClick={() => { sfx.click(); void navigator.clipboard?.writeText(aiGuide(cli)).then(() => setDone(true)).catch(() => {}); }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {done ? <path d="M5 12l5 5L20 7" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>}
      </svg>
      <span><b>{done ? "Copied. Paste it into your AI" : "Copy for AI"}</b><em>How your AI on this computer sends a job and fetches the result.</em></span>
    </button>
  );
}
