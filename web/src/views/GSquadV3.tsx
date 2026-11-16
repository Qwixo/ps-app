// G Squad v3 (PS 1.65, feature "gsquad-v3"): the parts of the Signal style look that are small components. The
// conversation list rows, Read more, the picture settings. The rules are in core/gsmsg.ts, gsconv.ts, gsavatar.ts.
// The data (convs, activeConv, newDm, openConv, setAvatar) belongs to the other branch (jan/gsquad-dm); until it is merged
// the list is built from today's one squad chat (core/gsconv.ts convsFor), so everything works with one conversation.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { feature } from "../core/features";
import { readMoreCut, moreShown, READ_MORE } from "../core/gsmsg";
import { activeOf, convsFor, previewLine, SQUAD_ID, type Conv } from "../core/gsconv";
import { AVATAR_PX, fitPicture, squareCrop, squareOut } from "../core/gsavatar";
import { THE_SQUAD } from "../squad/single";
import { useChat, chatOp } from "../squad/chatmirror";
import type { DmOp } from "../squad/dmview";
import type { SquadView } from "../squad/view";
import { listTime, unreadText } from "../squad/chatgroups";
import { sfx } from "../ui/sfx";
import { Avatar } from "./SquadAvatar";

export const V3_FEATURE = "gsquad-v3";
/** True when the Signal style window (look, motion, conversation list) is on in this build for this person. */
export const v3On = (): boolean => { try { return feature(V3_FEATURE); } catch { return false; } };

// ---------- the ops the data side answers (squad/dmview.ts DmOp, all run by the chat engine, so they go through chatOp) ----------
export type V3Op = DmOp;
export function v3Op(o: V3Op) { chatOp(o); }
export const openConv = (id: string) => v3Op({ op: "openConv", id });

/** The list of conversations and the open one. The view (squad/chatview.ts convs, activeConv, dm) is the truth: the open one is
 *  whatever the view says, so the screen never shows a chat the engine is not on. While the hub has no `dm` function the list
 *  is the squad chat alone and `dm` is false (the screen then shows no DM or group button). */
export function useConvs(v: SquadView): { list: Conv[]; active: string; cur: Conv; dm: boolean } {
  const chat = useChat();
  const newest = chat.lines.at(-1);
  const squadName = v.name || THE_SQUAD;
  const list = useMemo(() => convsFor({ convs: chat.convs }, {
    name: squadName, memberIds: v.members.map((m) => m.id), unread: chat.unread,
    ...(newest ? { last: { text: newest.t, at: newest.at, from: newest.mine ? v.meName : newest.name } } : {}),
  }).map((c) => (c.id === SQUAD_ID ? { ...c, title: squadName } : c)), [chat.convs, squadName, v.members, v.meName, chat.unread, newest?.id, newest?.t]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = activeOf(list, chat.activeConv);
  return { list, active, cur: list.find((c) => c.id === active) ?? list[0], dm: chat.dm === true };
}

// ---------- pictures ----------
const GroupIcon = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="9" r="3" /><path d="M3.5 19c.5-3 2.6-4.6 5.5-4.6s5 1.6 5.5 4.6" /><circle cx="17" cy="9.8" r="2.3" /><path d="M16.5 14.6c2.2 0 3.7 1.3 4.2 3.8" />
  </svg>
);
/** A conversation's picture: a member's for a direct message, a plain group icon for the squad and group chats. */
export function ConvAvatar({ c, v, size }: { c: Conv; v: SquadView; size: number }) {
  const m = c.kind === "dm" ? v.members.find((x) => x.id === (c.avatar || c.memberIds.find((i) => i !== v.me))) : null;
  if (m) return <Avatar id={m.id} name={m.name} size={size} />;
  return <span className="gsa gsa-group" style={{ width: size, height: size }} aria-hidden="true"><GroupIcon size={Math.round(size * 0.52)} /></span>;
}

// ---------- one row of the conversation list ----------
export function ConvRow({ c, v, on, onPick }: { c: Conv; v: SquadView; on: boolean; onPick: () => void }) {
  const nameOf = (id: string) => v.members.find((m) => m.id === id || m.name === id)?.name ?? id;
  const line = previewLine(c, v.meName, nameOf);
  return (
    <li>
      <button type="button" role="tab" aria-selected={on} className={`gsw-row gsw-conv${on ? " on" : ""}${c.unread > 0 ? " unread" : ""}`} onClick={onPick}>
        <span className="gsw-conv-av"><ConvAvatar c={c} v={v} size={48} /></span>
        <span className="gsw-row-m">
          <span className="gsw-row-t"><b>{c.title}</b>{c.last?.at && <time className="num">{listTime(c.last.at)}</time>}</span>
          <span className="gsw-row-s"><span>{line || (c.kind === "squad" ? "Say hi to the squad" : "No messages yet")}</span>
            {c.unread > 0 && <i className="gsw-count num" aria-label={`${c.unread} new`}>{unreadText(c.unread)}</i>}</span>
        </span>
      </button>
    </li>
  );
}

// ---------- Read more ----------
/** The words of a message; a long one is cut by characters and ends with a bold "Read more" in the same colour. */
export function MsgText({ t, children }: { t: string; children?: ReactNode }) {
  const [shown, setShown] = useState<number>(READ_MORE.show);
  const c = readMoreCut(t, shown);
  return (
    <span className="gc-text selectable">
      {c.text}
      {c.cut && <>{"... "}<button type="button" className="gc-more" onClick={() => { sfx.hover(); setShown(moreShown(shown)); }}>Read more</button></>}
      {children}
    </span>
  );
}

// ---------- Change picture (Squad settings, Your name) ----------
const encodeOn = (img: CanvasImageSource, crop: { x: number; y: number; side: number }) => (px: number, q: number): Promise<string> => new Promise((done) => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const g = cv.getContext("2d");
  if (!g) { done(""); return; }
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, px, px);
  g.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, px, px);
  cv.toBlob((b) => {
    if (!b) { done(""); return; }
    const r = new FileReader(); r.onload = () => done(String(r.result)); r.onerror = () => done(""); r.readAsDataURL(b);
  }, "image/jpeg", q);
});
export function PictureEdit({ v }: { v: SquadView }) {
  const chat = useChat();
  const chatErr = chat.error && /picture/i.test(chat.error) ? chat.error : null;   // the data side says why a picture was refused ("That picture is too big or not a jpeg or webp.")
  const me = v.members.find((m) => m.me);
  const pic = chat.members?.find((m) => m.me)?.pic ?? (me as { pic?: string } | undefined)?.pic;
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setNote("Making the picture small...");
    try {
      const bmp = await createImageBitmap(f);
      const crop = squareCrop(bmp.width, bmp.height);
      const url = await fitPicture(squareOut(crop.side), encodeOn(bmp, crop));
      if (!url) { setNote("That picture could not be made small enough. Try another one."); return; }
      sfx.drop(); v3Op({ op: "setAvatar", dataUrl: url }); setNote("Done. The squad sees your new picture in a moment.");
    } catch { setNote("That file is not a picture PS can read."); }
    if (file.current) file.current.value = "";
  };
  return (
    <div className="gss-card gs-pic">
      <span className="gs-h">Your picture</span>
      <div className="gs-pic-row">
        <Avatar id={me?.id ?? ""} name={me?.name ?? v.meName} size={64} pic={pic} />
        <div className="gs-pic-b">
          <button type="button" className="gs-mini go" onClick={() => { sfx.click(); file.current?.click(); }}>Change picture</button>
          {pic && <button type="button" className="gs-mini" onClick={() => { sfx.click(); v3Op({ op: "clearAvatar" }); setNote("Picture removed."); }}>Remove picture</button>}
        </div>
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      <p className="gs-note" role="status">{chatErr && note !== "Picture removed." ? chatErr : note ?? `The picture is made square, ${AVATAR_PX} pixels and small before it is sent. Only the squad sees it.`}</p>
    </div>
  );
}
