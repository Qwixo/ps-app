// PS Fitness personal bests (V1.43): every exercise you have done with its heaviest set, and the strongest set by
// estimated max under it. A tap opens that exercise's progress line in History; Back returns here. Read only.
import { useMemo } from "react";
import { fmtKg } from "../core/fitness";
import { todayISO } from "../ui/kit";
import { libById } from "./lib";
import { ExPic } from "./ExPic";
import { Info } from "./Info";
import { fmtDayShort, plural } from "./hist-logic";
import { agoWord, bestLine, personalBests } from "./nav-logic";
import type { FitView } from "./store";
import { NavIcons } from "./Nav";
import "./nav.css";

const setWhen = (w: string) => `Set ${w === "Today" || w === "Yesterday" ? w.toLowerCase() : w.endsWith("ago") ? w : `on ${w}`}`;

export function Bests({ v, onOpen }: { v: FitView; onOpen: (key: string) => void }) {
  const list = useMemo(() => personalBests(v.workouts), [v.workouts]);
  const today = todayISO();
  const Trophy = NavIcons.bests;
  if (!list.length) {
    return (
      <div className="fn-list">
        <div className="fn-empty">
          <span className="fn-empty-i" aria-hidden="true"><Trophy size={40} /></span>
          <h2>No bests yet</h2>
          <p>Tick a set with a weight in the gym and your best for that exercise shows up here.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="fn-list">
      <p className="fn-lead">Your heaviest set for each exercise. Tap one to see its progress.<Info k="pb" /><Info k="e1rm" /></p>
      <ul className="fn-rowsx">
        {list.map((b, i) => {
          const side = libById(b.exId)?.perSide;
          const strong = b.e1Kg !== b.kg || b.e1Reps !== b.reps;
          return (
            <li key={b.key} style={{ animationDelay: `${Math.min(i, 10) * 25}ms` }}>
              <button type="button" className="fn-bx" onClick={() => onOpen(b.key)} aria-label={`${b.name}: best ${bestLine(b, side)}. Open its progress`}>
                <ExPic exId={b.exId} name={b.name} size={52} card={false} className="fn-bx-pic" />
                <span className="fn-bx-t">
                  <span className="fn-bx-n">{b.name}</span>
                  <span className="fn-bx-s">
                    {[strong ? `Strongest ${fmtKg(b.e1Kg)} kg x ${b.e1Reps}` : "", setWhen(agoWord(b.date, today, fmtDayShort)), plural(b.sessions, "session")].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="fn-bx-v f-num">{fmtKg(b.kg)}<small>kg x {b.reps}</small></span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
