// PS Fitness, the trainer's sheet both ways. IMPORT: the developer copies the cells of "Current split" (DAY 1 down to
// the last exercise, Exercise to RIR) and pastes them here, or picks a .csv or .tsv; he sees what was
// understood, fixes names and saves it as the active program. EXPORT: a logged week in the trainer's own
// layout, to copy into Google Sheets or download as CSV. PS never sends anything: the developer pastes it himself.
import { useMemo, useRef, useState } from "react";
import { rirLabel, targetLine, type FitProgram } from "../core/fitness";
import { exportWeek, importSheet, searchLib } from "./lib";
import { addProgram, type FitView } from "./store";
import { csvName, importName, planWarnings, rowKind, sameName, weekList, weightLine } from "./plan-logic";
import { todayISO } from "../ui/kit";
import { haptic } from "../gos/bridge";

// ---------- import ----------
export function ImportBody({ v, onSaved, onFlush }: { v: FitView; onSaved: (id: string) => void; onFlush?: () => void }) {
  const [text, setText] = useState("");
  const [name, setName] = useState(() => importName(v.program ? v.next?.week ?? null : null, todayISO()));
  const [names, setNames] = useState<Record<string, string>>({});     // "day.exercise" -> the name the developer typed
  const [titles, setTitles] = useState<Record<number, string>>({});
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => (text.trim() ? importSheet(text, name) : null), [text]);   // name is applied at save
  const warnings = useMemo(() => (parsed ? [...planWarnings(parsed.program), ...parsed.warnings] : []), [parsed]);
  const exCount = parsed?.program.days.reduce((k, d) => k + d.exercises.length, 0) ?? 0;

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setErr("");
    if (f.size > 2_000_000) { setErr("That file is too big for a week of exercises. Pick the sheet's .csv or .tsv."); return; }
    try { setText(await f.text()); setNames({}); setTitles({}); haptic("tick"); }
    catch { setErr("I could not read that file. Try copy and paste instead."); }
  };
  const save = async () => {
    if (!parsed || !exCount || busy) return;
    setBusy(true);
    onFlush?.();
    const program: Omit<FitProgram, "createdAt" | "updatedAt"> = {
      ...parsed.program,
      name: name.trim() || importName(null, todayISO()),
      // The trainer's plan for the week the developer is on now (Week 2 after a full week 1), not back to Week 1.
      startWeek: v.program && replace ? v.next?.week ?? 1 : 1,
      days: parsed.program.days.map((d, di) => ({
        ...d,
        title: titles[di]?.trim() || d.title || null,
        exercises: d.exercises.map((e, ei) => {
          const typed = names[`${di}.${ei}`]?.trim();
          if (!typed || typed === e.name) return e;
          // A new name: keep the library link only when it is still that exercise (or now names another one).
          const hit = searchLib(typed, 50).find((x) => sameName(x.name, typed));
          return hit
            ? { ...e, name: hit.name, exId: hit.id, kind: hit.kind, perSide: e.perSide || hit.perSide, step: hit.step }
            : { ...e, name: typed, exId: null };
        }),
      })),
    };
    try {
      const id = await addProgram(program, { activate: true, archiveOld: !!v.program && replace });
      haptic("press");
      onSaved(id);
    } catch {
      setErr("Saving did not work. Your paste is still here: try again.");
      haptic("reject");
    } finally { setBusy(false); }
  };

  return (
    <div className="fp-imp">
      <ol className="fp-steps">
        <li><b>1</b><span>Open your trainer's sheet.</span></li>
        <li><b>2</b><span>Select the cells from <em>DAY 1</em> down to the last exercise (columns Exercise to RIR) and copy.</span></li>
        <li><b>3</b><span>Paste here.</span></li>
      </ol>
      <textarea
        className="fp-paste" value={text} spellCheck={false} autoCapitalize="off" autoCorrect="off"
        placeholder="Paste the cells here" aria-label="Paste the trainer's sheet here"
        onChange={(e) => { setText(e.target.value); setErr(""); }}
      />
      <div className="fp-row">
        <button type="button" className="fp-btn" onClick={() => file.current?.click()}>Choose a file</button>
        {text && <button type="button" className="fp-btn fp-quiet" onClick={() => { setText(""); setNames({}); setTitles({}); }}>Clear</button>}
        <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" hidden
          onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {err && <p className="fp-err" role="alert">{err}</p>}

      {parsed && (
        <section className="fp-prev" aria-label="What I understood">
          <h3 className="fp-h3">What I understood</h3>
          <p className="fp-sub">{parsed.program.days.length} {parsed.program.days.length === 1 ? "day" : "days"}, {exCount} {exCount === 1 ? "exercise" : "exercises"}. Tap a name to fix it.</p>
          {warnings.length > 0 && (
            <ul className="fp-warn">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          )}
          {parsed.program.days.map((d, di) => (
            <div key={d.id} className="fp-prev-day">
              <div className="fp-prev-dh">
                <span className="fp-prev-dn">{d.name}</span>
                <input className="fp-in fp-in-s" value={titles[di] ?? ""} placeholder="Title, eg Push" aria-label={`${d.name} title`}
                  onChange={(e) => setTitles((x) => ({ ...x, [di]: e.target.value }))} />
              </div>
              {d.exercises.map((e, ei) => {
                const k = `${di}.${ei}`;
                return (
                  <div key={e.id} className="fp-prev-ex">
                    <input className="fp-in fp-prev-name" value={names[k] ?? e.name} aria-label={`Exercise ${ei + 1} name`}
                      onChange={(x) => setNames((m) => ({ ...m, [k]: x.target.value }))} />
                    <div className="fp-prev-facts">
                      <span className="f-num">{targetLine(e.sets) || "No reps"}</span>
                      <span>{weightLine(e) || "No weight"}</span>
                      {e.rir != null && <span>RIR {rirLabel(e.rir)}</span>}
                      <span className="fp-tag">{e.exId ? "In the library" : "Your own"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <label className="fp-field">
            <span className="fp-label">Program name</span>
            <input className="fp-in" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
          </label>
          {v.program && (
            <label className="fp-check">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              <span><b>Replace my current program</b><small>"{v.program.data.name}" is kept, tucked away under old programs.</small></span>
            </label>
          )}
          <button type="button" className="fp-btn fp-primary fp-wide" disabled={!exCount || busy} onClick={() => void save()}>
            {busy ? "Saving" : "Save this program"}
          </button>
        </section>
      )}
    </div>
  );
}

// ---------- export ----------
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    // Older WebViews: select a hidden text box and copy that.
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.className = "fp-hidden-copy";
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

export function ExportBody({ v }: { v: FitView }) {
  const weeks = useMemo(() => {
    const all = weekList(v.workouts);
    const act = v.program?.id ?? null;
    // The active program's weeks first (newest first), then older programs' weeks.
    return [...all.filter((w) => w.programId === act), ...all.filter((w) => w.programId !== act)];
  }, [v.workouts, v.program?.id]);
  const [pick, setPick] = useState(0);
  const [msg, setMsg] = useState("");
  const sel = weeks[Math.min(pick, weeks.length - 1)] ?? null;
  const out = useMemo(() => (sel ? exportWeek(v.workouts, sel.programId, sel.week) : null), [sel, v.workouts]);
  const progName = (id: string | null) => v.programs.find((p) => p.id === id)?.data.name ?? "Free workouts";

  if (!sel || !out) {
    return (
      <div className="fp-exp">
        <p className="fp-empty-line">No workouts logged yet. After your first one, the week shows up here, ready for your trainer.</p>
      </div>
    );
  }
  const copy = async () => {
    const ok = await copyText(out.tsv);
    haptic(ok ? "press" : "reject");
    setMsg(ok ? "Copied. In your sheet, click the top left cell and paste." : "Copy did not work here. Use Download CSV instead.");
  };
  const download = () => {
    const blob = new Blob([out.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = csvName(sel.week);
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    haptic("press");
    setMsg(`Saved as ${csvName(sel.week)}.`);
  };

  return (
    <div className="fp-exp">
      <div className="fp-weeks" role="radiogroup" aria-label="Which week">
        {weeks.map((w, i) => (
          <button key={`${w.programId}|${w.week}`} type="button" role="radio" aria-checked={w === sel}
            className={`fp-week${w === sel ? " on" : ""}`} onClick={() => { setPick(i); setMsg(""); haptic("tick"); }}>
            <span className="f-num">Week {w.week}</span>
            <small>{progName(w.programId)} · {w.days} {w.days === 1 ? "day" : "days"}</small>
          </button>
        ))}
      </div>
      <div className="fp-grid-wrap">
        <table className="fp-grid">
          <tbody>
            {out.rows.map((r, i) => {
              const k = rowKind(r);
              if (k === "gap") return <tr key={i} className="fp-gr-gap"><td colSpan={4} /></tr>;
              if (k === "day") return <tr key={i} className="fp-gr-day"><th colSpan={4} scope="colgroup">{r[0]}</th></tr>;
              if (k === "head") return <tr key={i} className="fp-gr-head">{r.map((c, j) => <th key={j} scope="col">{c}</th>)}</tr>;
              return <tr key={i} className="fp-gr-ex">{r.map((c, j) => <td key={j} className={j ? "f-num" : ""}>{c}</td>)}</tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="fp-row fp-row-2">
        <button type="button" className="fp-btn fp-primary" onClick={() => void copy()}>Copy for Google Sheets</button>
        <button type="button" className="fp-btn" onClick={download}>Download CSV</button>
      </div>
      {msg && <p className="fp-ok" role="status">{msg}</p>}
      <p className="fp-note">Paste it into your own sheet and send it yourself. PS app never sends anything.</p>
    </div>
  );
}
