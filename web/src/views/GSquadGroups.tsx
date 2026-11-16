// G Squad v3 (PS 1.65, feature "gsquad-v3"): group chats. A card to make a new group (name, pick two or more people) and a card
// for the open group (who is in it, add, remove, leave). Only shown while the hub has direct messages (ChatView.dm). The rules
// and the checks are the data side's (squad/dmview.ts, squad/dmflows.ts): this only sends newGroup, groupAdd, groupRemove and
// leaveConv and shows the note the engine answers with (chat error). Esc closes a card (squad/back.ts).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useBack } from "../squad/back";
import type { SquadView } from "../squad/view";
import { sfx } from "../ui/sfx";
import type { Conv } from "../core/gsconv";
import { GROUP_MIN_OTHERS, GROUP_MAX_OTHERS, groupTitleOk } from "../core/gsgroup";
import { Avatar } from "./SquadAvatar";
import { v3Op } from "./GSquadV3";
import "./gsgroups.css";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function Card({ title, sub, narrow, onClose, children }: { title: string; sub?: string; narrow: boolean; onClose: () => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useBack(true, () => closeRef.current());
  useEffect(() => {
    const el = box.current;
    if (el && !reduced() && typeof el.animate === "function") el.animate([{ opacity: 0, transform: narrow ? "translateY(24px)" : "translateY(-8px) scale(.96)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: "cubic-bezier(.22, 1.1, .36, 1)" });
    const down = (e: PointerEvent) => { const t = e.target as Element | null; if (!box.current?.contains(t) && !t?.closest?.("[data-gsg-open]")) closeRef.current(); };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={box} className={`gsm gsg${narrow ? " narrow" : ""}`} role="dialog" aria-label={title}>
      <div className="gsm-head">
        <span className="gsm-t">{title}{sub && <em>{sub}</em>}</span>
        <button type="button" className="gsm-x" onClick={() => { sfx.click(); onClose(); }} aria-label="Close" title="Close (Esc)">×</button>
      </div>
      {children}
    </div>
  );
}

/** Make a group: a name and two or more people from the squad. */
export function NewGroupCard({ v, narrow, onClose, onMade }: { v: SquadView; narrow: boolean; onClose: () => void; onMade: () => void }) {
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const others = v.members.filter((m) => !m.me);
  const ok = groupTitleOk(title) && picked.length >= GROUP_MIN_OTHERS && picked.length <= GROUP_MAX_OTHERS;
  const toggle = (id: string) => { sfx.hover(); setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]); };
  const make = () => { if (!ok) return; sfx.drop(); v3Op({ op: "newGroup", title: title.trim(), memberIds: picked }); onMade(); };
  return (
    <Card title="New group" sub={picked.length ? `${picked.length} picked` : `Pick ${GROUP_MIN_OTHERS} or more people`} narrow={narrow} onClose={onClose}>
      <div className="gsg-name"><input value={title} maxLength={40} placeholder="Group name" aria-label="Group name" autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") make(); }} /></div>
      <ul className="gsm-list">
        {others.map((m) => (
          <li key={m.id}>
            <button type="button" role="checkbox" aria-checked={picked.includes(m.id)} className={`gsm-row gsg-pick${picked.includes(m.id) ? " on" : ""}`} onClick={() => toggle(m.id)}>
              <span className="gsm-av"><Avatar id={m.id} name={m.name} size={36} /></span>
              <span className="gsm-m"><b>{m.name}</b></span>
              <i className="gsg-tick" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className="gsg-foot"><button type="button" className="gs-mini go" disabled={!ok} onClick={make}>Create group</button></div>
    </Card>
  );
}

/** The open group: who is in it, add someone, remove someone, leave. */
export function GroupCard({ v, c, narrow, onClose }: { v: SquadView; c: Conv; narrow: boolean; onClose: () => void }) {
  const inIds = new Set(c.memberIds);
  const inside = v.members.filter((m) => inIds.has(m.id));
  const outside = v.members.filter((m) => !inIds.has(m.id));
  return (
    <Card title={c.title} sub={`${inside.length} in this group`} narrow={narrow} onClose={onClose}>
      <ul className="gsm-list">
        {inside.map((m) => (
          <li key={m.id} className="gsm-row">
            <span className="gsm-av"><Avatar id={m.id} name={m.name} size={36} /></span>
            <span className="gsm-m"><b>{m.me ? `${m.name} (you)` : m.name}</b></span>
            {!m.me && <button type="button" className="gsm-msg" onClick={() => { sfx.click(); v3Op({ op: "groupRemove", id: c.id, memberId: m.id }); }} aria-label={`Remove ${m.name}`}>Remove</button>}
          </li>
        ))}
        {outside.length > 0 && <li className="gsg-h" aria-hidden="true">Add people</li>}
        {outside.map((m) => (
          <li key={m.id} className="gsm-row">
            <span className="gsm-av"><Avatar id={m.id} name={m.name} size={36} /></span>
            <span className="gsm-m"><b>{m.name}</b></span>
            <button type="button" className="gsm-msg" onClick={() => { sfx.click(); v3Op({ op: "groupAdd", id: c.id, memberIds: [m.id] }); }} aria-label={`Add ${m.name}`}>Add</button>
          </li>
        ))}
      </ul>
      <div className="gsg-foot"><button type="button" className="gs-mini bad" onClick={() => { sfx.click(); v3Op({ op: "leaveConv", id: c.id }); onClose(); }}>Leave group</button></div>
    </Card>
  );
}
