// Settings, Sentry mode, Auto approve (the developer's friend, 12 Nov 2026). Three switches: in AI mode (Sentry mode), in Sleep
// mode, and always. PS 1.65: AI mode and Sleep mode are on until chosen (once the notice was shown on that Mac), Always is off. PS on the Mac does the work (ps-mac Sources/AutoApprove.swift) and sends
// its state in psSettings.autoApprove; rules and words in core/autoapprove.ts. Click only, like every setting.
import { psPost } from "../ps";
import { sfx } from "../ui/sfx";
import { Choice } from "./TaskMap";
import { APPROVE_ROWS, approveLogLine, approveNow, approveTime, cleanApprove, type ApproveKey } from "../core/autoapprove";
import "./autoapprove.css";

export function AutoApproveSettings({ state }: { state: unknown }) {
  const s = cleanApprove(state);
  if (!s) return <p className="gs-set-note">Checking this Mac…</p>;
  const set = (key: ApproveKey, on: boolean) => { sfx.hover(); psPost({ type: "autoApprove:set", key, on }); };
  const log = s.log ?? [];
  return (
    <div className="aa">
      {APPROVE_ROWS.map((r) => (
        <div key={r.key} className="aa-row">
          <div className="aa-text">
            <span className="aa-name">{r.name}</span>
            <span className="aa-line">{r.line}</span>
          </div>
          <div className="tm-ed-seg" role="radiogroup" aria-label={r.name}>
            <Choice selected={s[r.key]} onPick={() => set(r.key, true)}>On</Choice>
            <Choice selected={!s[r.key]} onPick={() => set(r.key, false)}>Off</Choice>
          </div>
        </div>
      ))}
      <span className={`aa-now${s.on ? " on" : ""}`} role="status">{approveNow(s)}</span>
      {(s.ai || s.sleep || s.always) && (
        <div className="aa-text">
          {s.hooks?.claude && <span className="aa-line">Claude Code: {s.hooks.claude}</span>}
          {s.hooks?.codex && <span className="aa-line">Codex: {s.hooks.codex}</span>}
          {s.keys && <span className="aa-line">{s.keys}</span>}
        </div>
      )}
      <div className="aa-head">
        <span className="aa-name">What it approved</span>
        {log.length > 0 && <button type="button" className="gs-open" onClick={() => { sfx.click(); psPost({ type: "autoApprove:clearLog" }); }}>Clear</button>}
      </div>
      {log.length === 0 ? <p className="gs-set-note">Nothing yet.</p> : (
        <ul className="aa-log">
          {log.map((l, i) => (
            <li key={`${l.at}-${i}`} className={l.how === "waiting" || l.how === "stuck" ? "aa-wait" : ""}>
              <time>{approveTime(l.at)}</time><span>{approveLogLine(l)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="gs-set-note">Questions from the AI always wait for you. The log keeps the command or file only, with passwords and keys taken out, and stays on this Mac.</p>
    </div>
  );
}
