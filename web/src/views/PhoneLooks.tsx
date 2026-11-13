// Saved looks and Reset for a phone (V1.56), the same on the phone's own Edit mode (gos/PhoneEditMode.tsx) and on the
// Mac's phone canvas (views/PhoneEditor.tsx). The developer, 13 Nov 2026: "save different appearance profiles ... of the GOS or
// iOS version ... so you can go back to it any point, you can rename the appearances as well" and "a reset to default
// button ... so if you fuck anything up you can reverse it".
// - Looks: every saved look with a small picture of its pages (its backgrounds, its panels, where its navbar sits). A tap
//   switches to it (the setup before is kept as "Before switching", and Undo puts it back). The pencil renames, the x
//   deletes (Undo brings it back). Save this look names the setup now; a name you already use asks "Replace it?".
// - Reset to default asks "Are you sure?", keeps the setup as "Before reset" and offers Undo.
// The looks live in the shared store (core/looksprofiles.ts, settings.looksSaved), kind "gos" or "ios"; only this
// phone kind's list is ever written (core/phonelooks.ts looksToSave).
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVault } from "../ui/kit";
import { settingsData } from "../core/select";
import { saveSettings } from "../core/actions";
import { vaultStore } from "../core/vault";
import { PS, psPost } from "../ps";
import { cellBox, rowsUsed, type PhoneKind, type PhoneLayout } from "../core/phonelayout";
import {
  canSaveMore, deleteLook, lookNamed, nextLookName, onlyKind, renameLook, replaceLook, restoreLook, saveLook,
  LOOK_NAME_MAX, LOOKS_MAX, type LooksStore, type Removed,
} from "../core/looksprofiles";
import { currentLookId, looksToSave, phoneLooks, phoneSnapshot, resetPhone, switchPhoneLook, undoTo, type PhoneLook } from "../core/phonelooks";
import type { EditSound } from "../core/editsounds";
import { bgCss, pageName } from "./PhoneEditor";
import { sfx } from "../ui/sfx";
import "./phonelooks.css";

const at = () => new Date().toISOString();

/** The Mac canvas's sounds for looks: the list's own click and drop, until the shared Edit sounds (core/editsounds.ts)
 *  reach ui/sfx.ts with the edit-nav work; then this plays those (sfx.ts editSfx) by the same names. */
export const macLookSound = (n: EditSound) => { if (n === "edit-reset" || n === "edit-page-remove") sfx.drop(); else sfx.click(); };

/** The phone looks in the vault now (any kind; read fresh, never from a render that may be old). */
const storeNow = (): LooksStore => {
  const s = vaultStore.get();
  return s.status === "unlocked" ? settingsData(s).looksSaved ?? {} : {};
};
/** Write this phone kind's looks. PS on a Mac holds no keys in the Tab list: there it goes to the main page as a
 *  settings patch (ps.ts cleanLooks merges only the kinds it names); everywhere else straight into the settings. */
export function savePhoneLooks(next: LooksStore, kind: PhoneKind): Promise<unknown> {
  if (PS) { psPost({ type: "looks", patch: { looksSaved: onlyKind(next, kind) } }); return Promise.resolve(); }
  return saveSettings({ looksSaved: looksToSave(storeNow(), next, kind) });
}

/** A short soft blur through the whole phone while a look goes on (the tiles glide to their new places). */
export function flashSwap() {
  const h = document.documentElement;
  h.classList.remove("lk-swap"); void h.offsetWidth; h.classList.add("lk-swap");
  window.setTimeout(() => h.classList.remove("lk-swap"), 750);
}

type Toast = { text: string; undo: (() => void) | null; key: number };
export type LooksProps = {
  layout: PhoneLayout; red: boolean;
  /** Put a layout on (saved at once). */
  apply: (l: PhoneLayout) => void;
  sound: (n: EditSound) => void;
  /** The button's own look: "phone" (a big pill for a thumb) or "mac" (the editor's top bar). */
  variant: "phone" | "mac";
  /** Where the panel opens: a sheet from the bottom (phone) or a card under the button (mac). */
  onOpen?: (open: boolean) => void;
};

/** The Looks button, its panel, the Reset question and the Undo toast. */
export function PhoneLooks({ layout, red, apply, sound, variant, onOpen }: LooksProps) {
  const s = useVault();
  const store = s.status === "unlocked" ? settingsData(s).looksSaved ?? {} : {};
  const kind = layout.phone;
  const looks = useMemo(() => phoneLooks(store, kind), [store, kind]);
  const cur = useMemo(() => currentLookId(store, layout, red), [store, layout, red]);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);       // "Are you sure?" for Reset
  const [naming, setNaming] = useState<string | null>(null);   // Save this look: the name being typed
  const [renaming, setRenaming] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const live = useRef(layout);
  live.current = layout;
  useEffect(() => { onOpen?.(open || asking); }, [open, asking]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 10_000); return () => window.clearTimeout(t); }, [toast]);
  useEffect(() => { if (!open) { setNaming(null); setRenaming(null); } }, [open]);
  // Esc (and the phone's back) closes the innermost first: the question, the name box, the panel.
  useEffect(() => {
    if (!open && !asking) return;
    const f = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if ((e.target as Element | null)?.closest?.(".lk-name")) return;   // the name box closes itself
      e.preventDefault(); e.stopImmediatePropagation();
      if (asking) setAsking(false); else setOpen(false);
    };
    // The editors' own Esc and back run first; with this panel open they send "lk-close" here instead of leaving.
    const close = () => { if (asking) setAsking(false); else setOpen(false); };
    window.addEventListener("keydown", f, true);
    window.addEventListener("gos-back", f, true);
    window.addEventListener("lk-close", close);
    return () => { window.removeEventListener("keydown", f, true); window.removeEventListener("gos-back", f, true); window.removeEventListener("lk-close", close); };
  }, [open, asking]);

  const say = (text: string, undo: (() => void) | null) => setToast({ text, undo, key: Date.now() });
  const backTo = (backup: string) => () => {
    const l = undoTo(storeNow(), kind, backup, red, at());
    if (!l) return;
    sound("edit-switch"); flashSwap(); apply(l); setToast(null);
  };
  const switchTo = (id: string, name: string) => {
    const r = switchPhoneLook(storeNow(), live.current, id, red, at());
    if (!r) return;
    sound("edit-switch"); flashSwap();
    void savePhoneLooks(r.store, kind);
    apply(r.layout);
    setOpen(false);
    say(`Now showing ${name}`, backTo(r.backup));
  };
  const reset = () => {
    const r = resetPhone(storeNow(), live.current, red, at());
    sound("edit-reset"); flashSwap();
    void savePhoneLooks(r.store, kind);
    apply(r.layout);
    setAsking(false); setOpen(false);
    say("Back to the default layout", backTo(r.backup));
  };
  const saveAs = (name: string, over: string | null) => {
    const data = phoneSnapshot(live.current, red);
    const st = storeNow();
    const next = over ? replaceLook(st, kind, over, data, at(), name) : saveLook(st, kind, data, { name, now: at() }).store;
    sound("edit-save");
    void savePhoneLooks(next, kind);
    setNaming(null);
    say(over ? `${name} saved again` : `Saved as ${name}`, null);
  };
  const remove = (id: string) => {
    const r = deleteLook(storeNow(), kind, id);
    if (!r.removed) return;
    const gone: Removed = r.removed;
    sound("edit-page-remove");
    void savePhoneLooks(r.store, kind);
    say(`${gone.look.name} deleted`, () => { void savePhoneLooks(restoreLook(storeNow(), gone), kind); sound("edit-save"); setToast(null); });
  };
  const rename = (id: string, name: string) => { setRenaming(null); void savePhoneLooks(renameLook(storeNow(), kind, id, name), kind); };

  const clash = naming !== null ? lookNamed(store, kind, naming) : null;
  const panel = open && (
    <div className={`lk-panel ${variant}`} role="dialog" aria-label="Saved looks" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="lk-head">
        <b>Looks</b>
        <span>{looks.filter((x) => !x.auto).length} of {LOOKS_MAX}</span>
        <button type="button" className="lk-x" onClick={() => setOpen(false)} aria-label="Close">{"×"}</button>
      </div>
      {naming === null ? (
        <button type="button" className="lk-save" disabled={!canSaveMore(store, kind)} onClick={() => setNaming(nextLookName(store, kind))}>
          <svg {...sv} width={18} height={18}><path d="M12 5v14M5 12h14" /></svg>
          {canSaveMore(store, kind) ? "Save this look" : `${LOOKS_MAX} looks saved: delete one to save another`}
        </button>
      ) : (
        <form className="lk-saving" onSubmit={(e) => { e.preventDefault(); if (naming.trim()) saveAs(naming, clash?.id ?? null); }}>
          <input className="lk-name" autoFocus value={naming} maxLength={LOOK_NAME_MAX} onChange={(e) => setNaming(e.target.value)} aria-label="Name of the look"
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setNaming(null); } }} />
          <button type="submit" className={`lk-go${clash ? " warn" : ""}`} disabled={!naming.trim()}>{clash ? `Replace ${clash.name}?` : "Save"}</button>
          <button type="button" className="lk-cancel" onClick={() => setNaming(null)}>Cancel</button>
        </form>
      )}
      <div className="lk-list">
        {looks.map((x, i) => (
          <div key={x.id} className={`lk-row${x.id === cur ? " cur" : ""}${x.auto ? " auto" : ""}`} style={{ ["--i" as string]: i }}>
            <button type="button" className="lk-pick" onClick={() => { if (x.id !== cur) switchTo(x.id, x.name); }} aria-label={`Switch to ${x.name}`} disabled={renaming === x.id}>
              <LookPicture look={x.data} />
              <span className="lk-what">
                {renaming === x.id ? null : <b>{x.name}</b>}
                <em>{x.id === cur ? "Showing now" : x.auto ? "Saved by itself" : whenText(x.at)}</em>
              </span>
            </button>
            {renaming === x.id && (
              <input className="lk-name lk-rename" autoFocus defaultValue={x.name} maxLength={LOOK_NAME_MAX} aria-label={`New name for ${x.name}`}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }}
                onBlur={(e) => rename(x.id, e.target.value)} />
            )}
            <button type="button" className="lk-icon" onClick={() => setRenaming(x.id)} aria-label={`Rename ${x.name}`}>
              <svg {...sv} width={17} height={17}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
            </button>
            <button type="button" className="lk-icon del" onClick={() => remove(x.id)} aria-label={`Delete ${x.name}`}>
              <svg {...sv} width={17} height={17}><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        ))}
        {!looks.length && <p className="lk-empty">No looks saved yet. Save this look keeps this whole phone setup, so you can come back to it any time.</p>}
      </div>
      <button type="button" className="lk-reset" onClick={() => setAsking(true)}>
        <svg {...sv} width={17} height={17}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
        Reset to default
      </button>
    </div>
  );
  const ask = asking && (
    <div className="lk-ask-wrap" onMouseDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="lk-ask-dim" onClick={() => setAsking(false)} aria-hidden="true" />
      <div className="lk-ask" role="alertdialog" aria-label="Reset to default">
        <b>Are you sure?</b>
        <p>Every page, panel and the navbar go back to how PS starts. This setup is kept as Before reset, so you can come back to it.</p>
        <div>
          <button type="button" className="lk-cancel" onClick={() => setAsking(false)}>Cancel</button>
          <button type="button" className="lk-go warn" onClick={reset} autoFocus>Reset</button>
        </div>
      </div>
    </div>
  );
  return (
    <>
      <button type="button" className={`lk-btn ${variant}${open ? " on" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg {...sv} width={18} height={18}><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><path d="M17.5 14v7M14 17.5h7" /></svg>
        Looks
      </button>
      {createPortal(<>{panel}{ask}{toast && (
        <div key={toast.key} className={`lk-toast ${variant}`} role="status">
          <span>{toast.text}</span>
          {toast.undo && <button type="button" onClick={toast.undo}>Undo</button>}
        </div>
      )}</>, document.body)}
    </>
  );
}

function whenText(iso: string): string {
  const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return "";
  if (m < 2) return "Saved just now";
  if (m < 60) return `Saved ${Math.round(m)} minutes ago`;
  if (m < 60 * 24) return "Saved today";
  const d = Math.round(m / 1440);
  return d === 1 ? "Saved yesterday" : `Saved ${d} days ago`;
}

/** A small picture of a look: each page in order with its background, its panels as blocks (the list as lines) and
 *  the navbar where it sits. Cheap to draw: no real panels. */
export function LookPicture({ look }: { look: PhoneLook }) {
  const W = 412, H = 880;
  return (
    <span className="lk-pic" aria-hidden="true">
      {look.pages.slice(0, 5).map((p) => {
        const nav = look.nav;
        const navW = nav.align === "full" ? 88 : 46;
        const navL = nav.align === "left" ? 6 : nav.align === "right" ? 100 - 6 - navW : (100 - navW) / 2;
        return (
          <span key={p.id} className="lk-pg" style={{ background: bgCss(p.bg ?? look.bg ?? null) }} title={pageName(p)}>
            {p.kind === "panels" && (p.tiles ?? []).slice(0, 12).map((t) => {
              const b = cellBox(t, W);
              const top = (nav.edge === "top" ? 150 : 90) + b.top;
              if (top > H - 120) return null;
              return <i key={t.id} style={{ left: `${(b.left / W) * 100}%`, top: `${(top / H) * 100}%`, width: `${(b.width / W) * 100}%`, height: `${(b.height / H) * 100}%` }} />;
            })}
            {p.kind === "list" && [0, 1, 2, 3, 4].map((k) => <u key={k} style={{ top: `${(nav.edge === "top" ? 24 : 16) + k * 9}%` }} />)}
            {(p.kind === "plan" || p.kind === "inbox") && <i className="lk-pane" style={{ top: nav.edge === "top" ? "22%" : "12%" }} />}
            {p.kind === "panels" && !rowsUsed(p.tiles ?? []) && <s />}
            <b className="lk-nav" style={{ left: `${navL}%`, width: `${navW}%`, [nav.edge === "top" ? "top" : "bottom"]: nav.edge === "top" ? "6%" : "3%" }} />
          </span>
        );
      })}
    </span>
  );
}
const sv = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
