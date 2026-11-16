// G Squad (V1.43): a person's picture. Their own photo when they set one (PS 1.65: members[].pic, a small picture the squad
// sent), else their letters in a circle. Letters: the colour follows the person (the same on every Mac in the squad,
// squad/window.ts toneOf); in the Signal style window (feature "gsquad-v3") the circles are a calm grey blue instead of a
// rainbow (core/gsavatar.ts neutralTone). Used by the G Squad window, its chat and Members.
import { initials, toneOf } from "../squad/window";
import { squadNow } from "../squad/mirror";
import { chatNow } from "../squad/chatmirror";
import { isPictureUrl, NEUTRAL_TONES, neutralTone } from "../core/gsavatar";
import "./squadavatar.css";

// Pictures come with the chat's members (squad/chatview.ts members[].pic, only while the chat is open), so the last ones seen are
// kept: the conversation list still shows them while another section is open.
const seen = new Map<string, string>();
const okPic = (p: unknown): p is string => isPictureUrl(p) || (typeof p === "string" && p.startsWith("blob:"));
const picOf = (id: string): string | undefined => {
  try {
    const c = chatNow();
    if (c.members && c.members.length) { for (const m of c.members) { if (okPic(m.pic)) seen.set(m.id, m.pic); else seen.delete(m.id); } }
    const own = (squadNow().members.find((m) => m.id === id) as { pic?: unknown } | undefined)?.pic;
    return okPic(own) ? own : seen.get(id);
  } catch { return undefined; }
};

export function Avatar({ id, name, size = 34, working, pic }: { id: string; name: string; size?: number; working?: boolean; pic?: string }) {
  const url = pic ?? picOf(id);
  const t = NEUTRAL_TONES[neutralTone(id || name)];
  return (
    <span className={`gsa t${toneOf(id || name)} nt${url ? " pic" : ""}${working ? " on" : ""}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ["--nbg" as string]: t.bg, ["--nfg" as string]: t.fg }} aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} /> : initials(name)}
    </span>
  );
}
