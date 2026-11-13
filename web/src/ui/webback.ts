// The browser's Back button on the website's To-do page (V1.44): it steps back out of a window, the way Esc does,
// before it ever leaves the page. Opening a window (Settings, G Squad, Fitness, Add task, Dimension X, Sleep...) adds
// one history entry with the same address; Back takes it off and the page's Esc (ui/escape.ts psEscape) closes the
// top window. A window closed some other way (Esc, its x, a click outside) takes its entry off again quietly, so the
// next Back is a real Back. Plans are core/webtodo.ts backPlan. Only while the To-do page shows (views/WebTodo.tsx).
import { backPlan } from "../core/webtodo";
import { isLayer } from "../core/escape";
import { psEscape } from "./escape";

const MARK = "psLayer";
/** Windows open now: the layers on document.body (windows open over the page) and dialogs inside the list. */
export function openLayers(): number {
  let n = 0;
  for (const el of document.body.children) {
    if (!(el instanceof HTMLElement) || el.id === "root" || !el.getClientRects().length) continue;
    if (el.matches(".toasts, .toast, .hc-card, [aria-hidden='true']")) continue;
    if (isLayer(typeof el.className === "string" ? el.className : "", el.getAttribute("role"))) n++;
  }
  for (const el of document.querySelectorAll<HTMLElement>(".tm-web [role='dialog'], .tm-web [aria-modal='true']")) if (el.getClientRects().length) n++;
  return n;
}

export function startWebBack(): () => void {
  let pushed = 0;        // our entries on top of the page's own
  let ignore = 0;        // popstate events we caused ourselves (taking entries off)
  let raf = 0;
  const settle = () => {
    raf = 0;
    const plan = backPlan(openLayers(), pushed);
    if (!plan) return;
    if ("push" in plan) {
      for (let i = 0; i < plan.push; i++) history.pushState({ ...(history.state || {}), [MARK]: ++pushed }, "", location.href);
    } else {
      pushed -= plan.pop;
      ignore++;
      history.go(-plan.pop);
    }
  };
  const later = () => { if (!raf) raf = requestAnimationFrame(settle); };
  const mo = new MutationObserver(later);
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["role", "aria-modal", "class"] });
  const pop = () => {
    if (ignore) { ignore--; return; }
    if (pushed <= 0) return;           // a real Back: the page's own history
    pushed--;
    void psEscape().then((closed) => {
      if (!closed) pushed = Math.min(pushed, openLayers());   // nothing would close: never trap Back
      later();
    });
  };
  // A link to another page of the website (the nav): the windows go with it; leave our entries where they are.
  const hash = () => { pushed = 0; ignore = 0; };
  window.addEventListener("popstate", pop);
  window.addEventListener("hashchange", hash);
  later();
  return () => {
    mo.disconnect();
    cancelAnimationFrame(raf);
    window.removeEventListener("popstate", pop);
    window.removeEventListener("hashchange", hash);
  };
}
