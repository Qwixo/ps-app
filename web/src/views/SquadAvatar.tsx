// G Squad (V1.43): a person's picture, their initials in a coloured circle. The colour follows the person (the same
// on every Mac in the squad, squad/window.ts toneOf) and comes from the current look, light or dark. Used by the
// G Squad window, its chat and Members.
import { initials, toneOf } from "../squad/window";
import "./squadavatar.css";

export function Avatar({ id, name, size = 34, working }: { id: string; name: string; size?: number; working?: boolean }) {
  return (
    <span className={`gsa t${toneOf(id || name)}${working ? " on" : ""}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
