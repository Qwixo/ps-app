// Minecraft mode, the offline translator (the developer, 4 Nov 2026): "offline access to Georgian and Russian translations...
// and when I say Georgian, I also mean this English Georgian looking language, where it's Georgian but written in
// English." English, Russian, Georgian and Latin Georgian, any to any, with no internet once the model is on the Mac:
// the model is downloaded once and run by PS (ps-mac Sources/Minecraft.swift, PSTranslate), Latin Georgian is read
// here (core/kalatin.ts) with word lists that ship inside PS, screenshots are read by Apple Vision on the Mac.
// Mounted by the Minecraft mode window (views/Minecraft.tsx). Its own classes all start with mcw.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { psPost } from "../../ps";
import { sfx } from "../../ui/sfx";
import { buildLetterModel, detectLang, protectForModel, georgianToLatin, LANG_NAMES, parseWordList, piecesToGeorgian, readText, type Lang, type Lexicons, type Piece } from "../../core/kalatin";
import { addHistory, cleanHistory, defaultTo, FROM_CHOICES, packLine, packPercent, plan, swapped, TO_CHOICES, type HistItem, type Pack } from "../../core/mcmode";
import "./translator.css";

// ---------- one small store: the model, the word lists, answers from PS ----------
type State = { pack: Pack | null; lex: "none" | "loading" | "ready" | "missing" };
let st: State = { pack: null, lex: "none" };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
const useMc = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);
/** The window opened: ask PS how the model is, and load the word lists once (after the window has grown). */
export function translatorShown() {
  post({ op: "status" });
  post({ op: "warm" });   // PS gets Apple Vision ready once per launch, so a pasted screenshot is read at once
  if (st.lex === "none") window.setTimeout(() => { if (st.lex === "none") { set({ lex: "loading" }); post({ op: "lexicon" }); } }, 520);
}
/** While a download runs PS reports progress itself; this slow poll covers a missed answer. */
export function translatorPoll() { const p = st.pack?.state; if (p === "downloading" || p === "checking") post({ op: "status" }); }

let lexicons: Lexicons | null = null;
const waiting = new Map<string, (m: Record<string, unknown>) => void>();
const post = (o: object) => psPost({ type: "mc", ...o });

async function gunzipB64(b64: string): Promise<string> {
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const s = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(s).text();
}
const idle = () => new Promise<void>((r) => setTimeout(r, 0));
async function takeLexicon(m: Record<string, unknown>) {
  if (m.ok !== true || typeof m.ka !== "string" || typeof m.en !== "string") { set({ lex: "missing" }); return; }
  try {
    const kaText = await gunzipB64(m.ka); await idle();
    const ka = parseWordList(kaText); await idle();
    const en = parseWordList(await gunzipB64(m.en)); await idle();
    const lm = buildLetterModel(ka);
    lexicons = { ka, en, lm };
    set({ lex: "ready" });
  } catch { set({ lex: "missing" }); }
}

/** Answers from PS (Sources/Minecraft.swift). */
function onPs(m: Record<string, unknown>) {
  if (m.ev === "status") {
    set({ pack: { state: (m.state as Pack["state"]) || "none", got: Number(m.got) || 0, total: Number(m.total) || 0, error: typeof m.error === "string" ? m.error : undefined,
      helper: m.helper === true, engine: String(m.engine || "off"), pack: typeof m.pack === "string" ? m.pack : undefined } });
  } else if (m.ev === "lexicon") void takeLexicon(m);
  else if ((m.ev === "translated" || m.ev === "ocr") && typeof m.id === "string") { const f = waiting.get(m.id); waiting.delete(m.id); f?.(m); }
}
if (typeof window !== "undefined") (window as Window & { __psMc?: (m: Record<string, unknown>) => void }).__psMc = onPs;

let seq = 0;
function ask(o: Record<string, unknown>): { id: string; done: Promise<Record<string, unknown>> } {
  const id = `mc${Date.now().toString(36)}${(seq++).toString(36)}`;
  const done = new Promise<Record<string, unknown>>((r) => waiting.set(id, r));
  post({ ...o, id });
  return { id, done };
}

// ---------- local history (this Mac only) ----------
const HKEY = "ps.mc.history";
function loadHist(): HistItem[] { try { return cleanHistory(JSON.parse(localStorage.getItem(HKEY) || "[]")); } catch { return []; } }
function saveHist(h: HistItem[]) { try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch { /* private storage off: history only lives until the page reloads */ } }

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const t = document.createElement("textarea");
  t.value = text; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select();
  const ok = document.execCommand("copy"); t.remove(); return ok;
}

// ---------- icons: original pixel art (drawn for PS, not taken from any game) ----------
// One letter a pixel: D outline (follows the text colour), L light stone, S stone, W wood, B dark wood.
const PICKAXE = [
  "................",
  "....DDDDD.......",
  "..DDLLLLLDD.....",
  ".DLLSSSSSLLD....",
  ".DSSDDDDDSSLD...",
  ".DSD.....DDSLD..",
  "..D.....WB.DSLD.",
  ".......WB...DSD.",
  "......WB....DSLD",
  ".....WB......DSD",
  "....WB.......DSD",
  "...WB.........D.",
  "..WB............",
  ".WB.............",
  ".B..............",
  "................",
];
const PAL: Record<string, string> = { D: "currentColor", L: "#D9E6F2", S: "#8EA0B4", W: "#B07A3E", B: "#6A4219" };
function Pixels({ art, size = 18, title }: { art: string[]; size?: number; title?: string }) {
  const rects = useMemo(() => {
    const out: { x: number; y: number; w: number; c: string }[] = [];
    art.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        if (ch === ".") { x++; continue; }
        let w = 1;
        while (row[x + w] === ch) w++;
        out.push({ x, y, w, c: PAL[ch] || "currentColor" });
        x += w;
      }
    });
    return out;
  }, [art]);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      {rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={r.c} />)}
    </svg>
  );
}
export const PickaxeIcon = (p: { size?: number }) => <Pixels art={PICKAXE} {...p} />;

// ---------- the model card ----------
function ModelCard({ pack }: { pack: Pack | null }) {
  const [sure, setSure] = useState(false);
  if (!pack) return <div className="mcw-card mcw-model"><p className="mcw-muted">Asking PS app about the translator...</p></div>;
  if (!pack.helper) return <div className="mcw-card mcw-model"><p className="mcw-warn">This PS app build has no translator inside. Latin Georgian to Georgian still works.</p></div>;
  const busy = pack.state === "downloading" || pack.state === "checking";
  if (pack.state === "ready") {
    return (
      <div className="mcw-model-ready">
        <span className="mcw-dot" aria-hidden="true" />
        <span>Offline translator ready: {pack.pack || "NLLB-200"}. {packLine(pack)}</span>
        {sure
          ? <span className="mcw-sure">Remove it from this Mac?<button type="button" className="mcw-link mcw-bad" onClick={() => { setSure(false); post({ op: "remove" }); }}>Remove</button>
              <button type="button" className="mcw-link" onClick={() => setSure(false)}>Keep</button></span>
          : <button type="button" className="mcw-link" onClick={() => setSure(true)}>Remove</button>}
      </div>
    );
  }
  return (
    <div className="mcw-card mcw-model">
      <div className="mcw-model-top">
        <div>
          <h3>Offline translator</h3>
          <p className="mcw-muted">English, Russian and Georgian, both ways, on this Mac. {pack.pack || "Meta's NLLB-200 1.3B"}: a single download, then no internet needed.</p>
        </div>
        {pack.state === "downloading"
          ? <button type="button" className="mcm-btn" onClick={() => post({ op: "pause" })}>Pause</button>
          : <button type="button" className="mcm-btn mcm-btn--green" disabled={busy} onClick={() => { sfx.click(); post({ op: "download" }); }}>
              {pack.state === "paused" || pack.state === "error" ? "Download (carry on)" : "Download"}</button>}
      </div>
      {(busy || pack.state === "paused") && <div className="mcw-bar" aria-hidden="true"><i style={{ width: `${packPercent(pack)}%` }} className={pack.state === "checking" ? "mcw-check" : ""} /></div>}
      <p className={pack.state === "error" ? "mcw-warn" : "mcw-muted"} role="status">{packLine(pack)}</p>
    </div>
  );
}

// ---------- the translator ----------
export function Translator() {
  const s = useMc();
  const [text, setText] = useState("");
  const [from, setFrom] = useState<Lang | "auto">("auto");
  const [to, setTo] = useState<Lang>("en");
  const [toTouched, setToTouched] = useState(false);
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [out, setOut] = useState("");
  const [outLang, setOutLang] = useState<Lang>("en");
  const [busy, setBusy] = useState<{ id: string; since: number } | null>(null);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState("");
  const [hist, setHist] = useState<HistItem[]>(loadHist);
  const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [, tick] = useState(0);
  const lex = s.lex === "ready" ? lexicons : null;

  const detected: Lang = useMemo(() => (text.trim() ? detectLang(text, lex) : "en"), [text, lex]);
  const src: Lang = from === "auto" ? detected : from;
  useEffect(() => { if (!toTouched && from === "auto") setTo(defaultTo(detected)); }, [detected, from, toTouched]);
  const pieces: Piece[][] | null = useMemo(() => (src === "kl" && lex && text.trim() ? readText(text, lex) : null), [src, lex, text]);
  // The developer's corrections, by line and word position.
  const picked = useMemo(() => {
    if (!pieces) return null;
    return pieces.map((ps, li) => ps.map((p, pi) => (p.kind === "ka" && picks[`${li}:${pi}`] !== undefined ? { ...p, pick: picks[`${li}:${pi}`] } : p)));
  }, [pieces, picks]);
  const georgian = picked ? piecesToGeorgian(picked) : "";
  useEffect(() => { setPicks({}); }, [text]);
  useEffect(() => { if (!busy) return; const t = window.setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(t); }, [busy]);

  const run = async (override?: string) => {
    const input = (override ?? text).trim();
    if (!input || busy) return;
    const p = plan(src, to);
    let body = input;
    if (p.readLatin) {
      if (!lex) { setNote("The Latin Georgian word lists are still loading."); return; }
      body = override ? piecesToGeorgian(readText(input, lex)) : georgian;
    }
    setNote("");
    let result = body;
    if (p.model) {
      if (s.pack?.state !== "ready") { setNote("Download the offline translator first (above). Latin Georgian to Georgian works without it."); return; }
      // Lari amounts and carrier names reach the model as "lari" and names (core/kalatin.ts protectForModel).
      const r = ask({ op: "translate", src: p.model.src, tgt: p.model.tgt, text: p.model.src === "kat_Geor" ? protectForModel(body) : body });
      setBusy({ id: r.id, since: Date.now() });
      const m = await r.done;
      setBusy(null);
      if (m.ok !== true) { if (!m.cancelled) setNote(String(m.error || "That did not translate.")); return; }
      result = String(m.text || "");
    }
    if (p.toLatin) result = georgianToLatin(result);
    setOut(result); setOutLang(to);
    const h = addHistory(hist, { at: Date.now(), from: src, to, src: input, out: result });
    setHist(h); saveHist(h);
  };
  const cancel = () => { if (busy) post({ op: "cancel", id: busy.id }); };
  const swap = () => {
    const sw = swapped(src, to);
    setFrom(sw.from); setTo(sw.to); setToTouched(true);
    if (out) { setText(out); setOut(""); }
  };
  const doCopy = async (what: string, key: string) => { if (await copy(what)) { setCopied(key); window.setTimeout(() => setCopied(""), 1300); } };

  // A pasted or dropped screenshot: Apple Vision reads it on this Mac, then it is translated.
  const readImage = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 25_000_000) { setNote("That picture is too big (over 25 MB)."); return; }
    const fr = new FileReader();
    fr.onload = async () => {
      setNote("Reading the picture...");
      const r = ask({ op: "ocr", image: String(fr.result || "") });
      const m = await r.done;
      if (m.ok !== true || !String(m.text || "").trim()) { setNote(String(m.error || "No text found in that picture.")); return; }
      const t = String(m.text);
      setText(t); setNote("");
      window.setTimeout(() => void run(t), 0);
    };
    fr.readAsDataURL(file);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const f = [...e.clipboardData.items].find((i) => i.kind === "file" && i.type.startsWith("image/"))?.getAsFile();
    if (f) { e.preventDefault(); readImage(f); }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
    if (f) readImage(f);
    else { const t = e.dataTransfer.getData("text/plain"); if (t) setText(t); }
  };

  const secs = busy ? Math.floor((Date.now() - busy.since) / 1000) : 0;
  const latinOut = outLang === "ka" && out ? georgianToLatin(out) : "";
  return (
    <div className="mcw-tr">
      <ModelCard pack={s.pack} />
      <div className="mcw-langs">
        <label className="mcw-sel"><span>From</span>
          <select className="mcm-input" value={from} onChange={(e) => setFrom(e.target.value as Lang | "auto")}>
            {FROM_CHOICES.map((l) => <option key={l} value={l}>{l === "auto" ? `Detect${text.trim() ? `: ${LANG_NAMES[detected]}` : ""}` : LANG_NAMES[l]}</option>)}
          </select>
        </label>
        <button type="button" className="mcm-btn mcm-btn--icon mcw-swap" onClick={swap} aria-label="Swap languages" title="Swap languages">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7h13l-4-4M17 17H4l4 4" /></svg>
        </button>
        <label className="mcw-sel"><span>To</span>
          <select className="mcm-input" value={to} onChange={(e) => { setTo(e.target.value as Lang); setToTouched(true); }}>
            {TO_CHOICES.map((l) => <option key={l} value={l}>{LANG_NAMES[l]}</option>)}
          </select>
        </label>
      </div>
      <div className={`mcw-in${drag ? " mcw-drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste} spellCheck={false}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(); } }}
          placeholder="Type or paste text, or paste or drop a screenshot (Cmd+Enter translates)" aria-label="Text to translate" />
        {text && <button type="button" className="mcm-btn mcm-btn--icon mcw-clear" onClick={() => { setText(""); setOut(""); setNote(""); }} aria-label="Clear" title="Clear">×</button>}
      </div>
      {src === "kl" && (
        <div className="mcw-card mcw-read">
          <div className="mcw-read-h"><span>Read as Georgian</span><span className="mcw-muted">click a word to pick another spelling</span></div>
          {!picked ? <p className="mcw-muted">{s.lex === "missing" ? "The word lists are missing from this build." : "Loading the Georgian word lists..."}</p> : (
            <p className="mcw-geo" lang="ka">
              {picked.map((ps, li) => (
                <span key={li} className="mcw-line">{ps.map((p, pi) => p.kind === "ka" && p.readings?.length
                  ? <button key={pi} type="button" className={`mcw-w${p.readings[p.pick ?? 0]?.known ? "" : " mcw-guess"}`} title={`${p.text}${p.readings[p.pick ?? 0]?.known ? "" : " (not in the word list: a guess)"}`}
                      onClick={(e) => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMenu({ key: `${li}:${pi}`, x: b.left, y: b.bottom }); }}>
                      {p.readings[p.pick ?? 0]?.geo}</button>
                  : <span key={pi} className={p.kind === "en" ? "mcw-en" : undefined}>{p.text}</span>)}{"\n"}</span>
              ))}
            </p>
          )}
          {menu && picked && (() => {
            const [li, pi] = menu.key.split(":").map(Number);
            const p = picked[li]?.[pi];
            if (!p?.readings) return null;
            return (
              <div className="mcw-menu" style={{ left: menu.x, top: menu.y + 4 }} onMouseLeave={() => setMenu(null)} role="menu">
                <div className="mcw-menu-h">{p.text}</div>
                {p.readings.map((r, i) => (
                  <button key={r.geo} type="button" role="menuitem" className={i === (p.pick ?? 0) ? "on" : ""} onClick={() => { setPicks((x) => ({ ...x, [menu.key]: i })); setMenu(null); }}>
                    <span lang="ka">{r.geo}</span>{r.known ? <i>in the word list</i> : <i>guess</i>}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      )}
      <div className="mcw-actions">
        {busy
          ? <button type="button" className="mcm-btn" onClick={cancel}>Cancel ({secs} s)</button>
          : <button type="button" className="mcm-btn mcm-btn--green" onClick={() => void run()} disabled={!text.trim()}>Translate</button>}
        {busy && <span className="mcw-spin" aria-hidden="true"><PickaxeIcon size={18} /></span>}
        {note && <span className="mcw-note" role="status">{note}</span>}
      </div>
      {out && (
        <div className="mcw-card mcw-out">
          <div className="mcw-out-h"><span>{LANG_NAMES[outLang]}</span>
            <button type="button" className="mcm-btn mcw-copy" onClick={() => void doCopy(out, "out")}>{copied === "out" ? "Copied" : "Copy"}</button></div>
          <p className="mcw-out-t" lang={outLang === "ka" ? "ka" : outLang === "ru" ? "ru" : "en"}>{out}</p>
          {latinOut && (
            <div className="mcw-out-lat">
              <span className="mcw-muted">In Latin letters</span>
              <p>{latinOut}</p>
              <button type="button" className="mcm-btn mcw-copy" onClick={() => void doCopy(latinOut, "lat")}>{copied === "lat" ? "Copied" : "Copy"}</button>
            </div>
          )}
        </div>
      )}
      {hist.length > 0 && (
        <details className="mcw-hist">
          <summary>History <span className="mcw-muted">({hist.length}, on this Mac only)</span></summary>
          <ul>
            {hist.map((h) => (
              <li key={h.at}>
                <button type="button" onClick={() => { setFrom(h.from); setTo(h.to); setToTouched(true); setText(h.src); setOut(h.out); setOutLang(h.to); }}>
                  <b>{LANG_NAMES[h.from]} to {LANG_NAMES[h.to]}</b><span>{h.src.slice(0, 90)}</span><span className="mcw-muted">{h.out.slice(0, 90)}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="mcw-link" onClick={() => { setHist([]); saveHist([]); }}>Clear history</button>
        </details>
      )}
    </div>
  );
}
