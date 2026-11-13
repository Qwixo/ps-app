// PS Fitness exercises (V1.43): the 153 exercise library with its pictures, in one place to browse. Search by name,
// filter by body part, tap a row for the big card (the rep playing, the muscles it works, the one line form tip).
// Read only: adding an exercise still happens in the gym (Add) or in a program, as before.
import { useMemo, useRef, useState } from "react";
import { haptic } from "../gos/bridge";
import { LIBRARY, MUSCLE_LABEL, searchExercises } from "./library";
import type { Exercise, Muscle } from "./types";
import { PicCard } from "./ExPic";
import { ExPic } from "./ExPic";
import { picFor } from "./pics";
import "./nav.css";

const GROUPS: { k: string; t: string; m: Muscle[] }[] = [
  { k: "all", t: "All", m: [] },
  { k: "chest", t: "Chest", m: ["chest"] },
  { k: "back", t: "Back", m: ["lats", "upper_back", "traps", "lower_back"] },
  { k: "shoulders", t: "Shoulders", m: ["front_delts", "side_delts", "rear_delts"] },
  { k: "arms", t: "Arms", m: ["biceps", "triceps", "forearms"] },
  { k: "legs", t: "Legs", m: ["quads", "hamstrings", "glutes", "calves", "adductors", "abductors"] },
  { k: "core", t: "Core", m: ["abs", "obliques"] },
];

export function Exercises({ desk }: { desk?: boolean }) {
  const [q, setQ] = useState("");
  const [g, setG] = useState("all");
  const [open, setOpen] = useState<{ ex: Exercise; el: HTMLElement } | null>(null);
  const list = useMemo(() => {
    const group = GROUPS.find((x) => x.k === g)?.m ?? [];
    const base = q.trim() ? searchExercises(q, 200) : [...LIBRARY].sort((a, b) => a.name.localeCompare(b.name));
    return group.length ? base.filter((e) => group.includes(e.muscles[0])) : base;
  }, [q, g]);
  const anchor = useRef<HTMLElement | null>(null);
  return (
    <div className="fn-list fn-ex">
      <div className="fn-ex-top">
        <input className="fn-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search exercises" aria-label="Search exercises" enterKeyHint="search" autoFocus={desk} />
        <div className="fn-chips" role="radiogroup" aria-label="Body part">
          {GROUPS.map((x) => (
            <button key={x.k} type="button" role="radio" aria-checked={g === x.k} className={g === x.k ? "on" : ""} onClick={() => { haptic("tick"); setG(x.k); }}>{x.t}</button>
          ))}
        </div>
      </div>
      <p className="fn-lead">{list.length} {list.length === 1 ? "exercise" : "exercises"}. Tap one to see it done.</p>
      {!list.length && <p className="fn-lead">Nothing called "{q.trim()}" here yet.</p>}
      <ul className={`fn-rowsx${desk ? " grid" : ""}`}>
        {list.map((e) => (
          <li key={e.id}>
            <button type="button" className="fn-bx" onClick={(ev) => { haptic("press"); anchor.current = ev.currentTarget; setOpen({ ex: e, el: ev.currentTarget }); }}
              aria-label={`${e.name}. Works ${e.muscles.map((m) => MUSCLE_LABEL[m]).join(", ")}. Tap to see it done`}>
              <ExPic exId={e.id} name={e.name} size={60} card={false} className="fn-bx-pic" />
              <span className="fn-bx-t">
                <span className="fn-bx-n">{e.name}</span>
                <span className="fn-bx-s">{e.muscles.slice(0, 3).map((m) => MUSCLE_LABEL[m]).join(", ")}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && <PicCard pic={picFor(open.ex.id, open.ex.name)} name={open.ex.name} anchor={open.el} onClose={() => setOpen(null)} />}
    </div>
  );
}
