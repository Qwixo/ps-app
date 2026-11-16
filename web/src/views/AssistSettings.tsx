// The Settings assistant's own rows in Settings (PS 1.65): the two switches, the AI choice with ready status, Test and key entry, and the
// list of feature requests. Rules in core/assist.ts, state in src/assist.ts. A key typed here goes to the Mac's Keychain at once (assist:key:set)
// and the box is cleared: the page never keeps it, never shows it again.
import { useEffect, useRef, useState } from "react";
import { useVault } from "../ui/kit";
import { sfx } from "../ui/sfx";
import { settingsData } from "../core/select";
import { saveSettings } from "../core/actions";
import { ASSIST_WORDS as W, PICKS, PICK_NAME, assistPrefs, type AiPick } from "../core/assist";
import { canUndo, squadListText, type FrEntry, type SquadRow } from "../core/featreq";
import { groupById, type GroupId } from "../core/settingsindex";
import { toast } from "../ui/kit";
import { askStatus, removeKey, requestList, setKey, setProvider, testProvider, undoRequest, useAssist } from "../assist";
import { Choice } from "./TaskMap";
import { SetRow } from "./SettingsScreen";
import type { RowProps } from "./SettingsScreen";
import "./assist.css";

function Seg({ on, set, label, ready = true }: { on: boolean; set: (v: boolean) => void; label: string; ready?: boolean }) {
  return (
    <div className={`tm-ed-seg${ready ? "" : " gs-notyet"}`} role="radiogroup" aria-label={label}>
      <Choice selected={ready && on} onPick={() => { if (ready) { sfx.hover(); set(true); } }}>On</Choice>
      <Choice selected={ready && !on} onPick={() => { if (ready) { sfx.hover(); set(false); } }}>Off</Choice>
    </div>
  );
}
const save = (patch: { on?: boolean; pop?: boolean }, cur: unknown) => void saveSettings({ assistant: { ...(cur && typeof cur === "object" ? cur : {}), ...patch } }).catch(() => {});

export function AssistOnRow({ e }: RowProps) {
  const v = useVault(), cur = settingsData(v).assistant;
  return <SetRow e={e} right={<Seg label={e.name} on={assistPrefs(cur).on} ready={v.status === "unlocked"} set={(on) => save({ on }, cur)} />} />;
}
export function AssistPopRow({ e }: RowProps) {
  const v = useVault(), cur = settingsData(v).assistant;
  return <SetRow e={e} right={<Seg label={e.name} on={assistPrefs(cur).pop} ready={v.status === "unlocked"} set={(pop) => save({ pop }, cur)} />} />;
}

function Provider({ pick }: { pick: AiPick }) {
  const a = useAssist();
  const prov = a.status?.providers[pick], chosen = (a.status?.pick ?? "apple") === pick;
  const box = useRef<HTMLInputElement>(null);
  const keyable = pick !== "apple";
  const how = prov?.how;
  return (
    <div className={`as-prov${chosen ? " on" : ""}`}>
      <div className="as-prov-h">
        <b>{PICK_NAME[pick]}</b>
        <span className={`as-pill${prov?.ready ? " ok" : ""}`}>{prov?.ready ? W.ready : W.notReady}</span>
        <button type="button" className="as-sec" onClick={() => { sfx.click(); testProvider(pick); }}>{W.test}</button>
        <div className="tm-ed-seg" role="radiogroup" aria-label={`Use ${PICK_NAME[pick]}`}>
          <Choice selected={chosen} onPick={() => { sfx.hover(); setProvider(pick, how === "key" ? "key" : keyable ? "cli" : undefined); }}>Use</Choice>
        </div>
      </div>
      {a.status?.tested?.pick === pick && <p className={`as-note${a.status.tested.ok ? " ok" : ""}`}>{a.status.tested.line}</p>}
      {prov?.ready && keyable && how && <p className="as-note">{how === "key" ? W.usesKey : pick === "claude" ? W.usesClaudeCli : W.usesCodexCli}</p>}
      {pick === "apple" && prov && !prov.ready && <p className="as-note">{prov.why ? prov.why : W.appleOff}</p>}
      {keyable && prov?.why && !prov.ready && <p className="as-note">{prov.why}</p>}
      {keyable && <p className="as-note">{W.sendsTo[pick as "claude" | "chatgpt"]}</p>}
      {keyable && (
        <div className="as-key">
          <input ref={box} className="as-in" type="password" autoComplete="off" spellCheck={false} placeholder={W.keyHint} aria-label={`${PICK_NAME[pick]} key`} defaultValue="" />
          <button type="button" className="as-go" onClick={() => {
            const el = box.current; const k = el?.value.trim() ?? "";
            if (!el || !k) return;
            setKey(pick as "claude" | "chatgpt", k);
            el.value = "";   // never kept in the page
          }}>{W.setKey}</button>
          <button type="button" className="as-sec quiet" onClick={() => { removeKey(pick as "claude" | "chatgpt"); if (box.current) box.current.value = ""; }}>{W.remove}</button>
        </div>
      )}
    </div>
  );
}
export function AssistAiRow({ e }: RowProps) {
  useEffect(() => { askStatus(); }, []);
  return <SetRow e={e} body={<div className="as-ai">{PICKS.map((p) => <Provider key={p} pick={p} />)}</div>} open plain />;
}

const STATE_WORD: Record<FrEntry["state"], string> = { held: "Sending in a moment", sent: "Sent", waiting: "Waiting for the squad update", undone: "Taken back", kept: "Saved on this device" };
// The squad's list lives only in this page's memory: read on a click, then only what changed since. Nothing polls.
let squadList: SquadRow[] = [], squadSince: string | null = null;
export function AssistRequestsRow({ e }: RowProps) {
  useAssist();
  const [squad, setSquad] = useState<"closed" | "loading" | "open" | "missing" | "nosquad" | "error">("closed");
  const [rows, setRows] = useState<SquadRow[]>(squadList);
  const list = requestList().filter((x) => x.state !== "undone").slice(-8).reverse();
  const label = (part: string) => groupById(part as GroupId).label;
  const load = async () => {
    setSquad("loading");
    try {
      const [{ squadRecNow }, { pullRequests }] = await Promise.all([import("../squad/engine"), import("../squad/featreqhub")]);
      const rec = squadRecNow();
      if (!rec) { setSquad("nosquad"); return; }
      const r = await pullRequests(rec, squadList, squadSince);
      if (r === "missing") { setSquad("missing"); return; }
      squadList = r.list; squadSince = r.since; setRows(r.list); setSquad("open");
    } catch { setSquad("error"); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(squadListText(rows, label)); toast(W.frCopied); } catch { toast(W.frCopyFail); } };
  return (
    <SetRow e={e} body={
      <div className="as-reqs">
        {list.length ? (
          <ul className="as-req">
            {list.map((x) => (
              <li key={x.req.id}><span>{x.req.text}</span>
                {canUndo(x) ? <button type="button" className="as-sec quiet" onClick={() => void undoRequest(x.req.id)}>{W.frUndo}</button> : <em className="as-note">{STATE_WORD[x.state]}</em>}
              </li>
            ))}
          </ul>
        ) : <p className="as-note">{W.frRowLine}</p>}
        <div className="as-acts">
          <button type="button" className="as-sec" disabled={squad === "loading"} onClick={() => { sfx.click(); void load(); }}>{squad === "open" ? W.frRefresh : W.frSquad}</button>
          {squad === "open" && rows.length > 0 && <button type="button" className="as-sec quiet" onClick={() => void copy()}>{W.frCopy}</button>}
        </div>
        {squad === "missing" && <p className="as-note">{W.frSquadMissing}</p>}
        {squad === "nosquad" && <p className="as-note">{W.frNoSquad}</p>}
        {squad === "error" && <p className="as-note">{W.frSquadError}</p>}
        {squad === "open" && (rows.length ? (
          <ul className="as-req squad">
            {rows.slice(0, 40).map((r) => <li key={r.id}><span>{r.text}</span><em className="as-note">{r.part ? label(r.part) : W.title}{r.mine ? `, ${W.frYours}` : ""}</em></li>)}
          </ul>
        ) : <p className="as-note">{W.frSquadEmpty}</p>)}
      </div>
    } open plain />
  );
}
