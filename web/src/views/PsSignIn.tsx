// PS Mac app only (V1.26, the developer 1 Nov 2026: "make that screen look cleaner, it just looks like a cropped in
// version of the old retired screen"): the Sign in window's own page. No card inside the window, no
// scrollbar: the page tells PS how tall it is and the window takes that height. The website keeps its
// lock screen (Lock.tsx) with setup, the client invite and the demo.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { psPost, rememberChoice, setRememberChoice } from "../ps";
import icon from "../assets/ps-icon.png";
import "./pssignin.css";
import { appName } from "../core/appname";

export function PsSignInShell({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    document.documentElement.classList.add("ps-si-on");
    return () => document.documentElement.classList.remove("ps-si-on");
  }, []);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = 0;
    const send = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0 && h !== last) { last = h; psPost({ type: "signin:size", h }); }
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="ps-si-page">
      <div className="ps-si" ref={box}>
        <header className="ps-si-head">
          <img className="ps-si-icon" src={icon} alt="" width={84} height={84} draggable={false} />
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Remember me, with what it means in one short line. */
export function PsSignInRemember() {
  const [on, setOn] = useState(rememberChoice());
  return (
    <label className="ps-si-remember">
      <input type="checkbox" checked={on} onChange={(e) => { setOn(e.target.checked); setRememberChoice(e.target.checked); }} />
      <span><b>Remember me on this Mac</b><small>{appName()} stays signed in. Touch ID opens it after you lock it.</small></span>
    </label>
  );
}
