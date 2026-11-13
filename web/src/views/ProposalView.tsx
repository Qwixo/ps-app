// "What we agreed": the proposal, designed like the developer's proposal PDFs, right on the client page.
// Built only from project.proposal, the stages and the payments. The real PDF (if attached)
// opens through ProjectDocs, decrypted on the device.
import { useId, useState } from "react";
import type { ProjectView } from "../core/select";
import type { Project } from "../core/model";
import { priceUnitOf, stageState } from "../core/model";
import { Icon, fmtDate, money, useVault } from "../ui/kit";
import { ProjectDocs, projectDocs } from "./ProjectDocs";
import { Art, artFor, type ArtName } from "./illus/StageArt";
import { ABTest, CroLadder } from "./illus/ABTest";
import "./portal.css";

type SState = "done" | "now" | "waiting" | "upcoming";
interface StepDef { title: string; text: string; art: ArtName; keys: string[]; tag?: string; pre?: boolean; post?: boolean }

// Cincee's eight steps for a Shopify redesign (same as cincee.com and the proposal PDF).
const SHOPIFY_STEPS: StepDef[] = [
  { title: "Your free redesign", text: "A live, clickable redesign of your homepage, built in your brand. Where all of this started.", art: "notif", keys: [], pre: true },
  { title: "A call to talk it through", text: "We go through it together. You tell me what you love, what you would change and what your customers keep asking for.", art: "call", keys: ["kickoff"] },
  { title: "I study your store and your competitors", text: "What is working on your store and on the brands you compete with. The best ideas come in, only where they fit your brand. Then you get 5 to 10 designs to compare.", art: "research", keys: ["research", "directions"], tag: "5 to 10 designs" },
  { title: "You approve the design", text: "We refine it together until you are happy with every section, using preview links on your phone or computer. Nothing goes near your live store until you approve it.", art: "pick", keys: ["pick", "refine"] },
  { title: "I copy your theme", text: "I duplicate your Shopify theme and build the new design into the copy. Your customers keep shopping the whole time and every app stays exactly as it is.", art: "build", keys: ["build"], tag: "Your store never goes down" },
  { title: "Tested and built for you to edit", text: "Every page tested on phone and desktop, homepage to checkout. Set up so you can change words, photos and sections yourself in Shopify's theme editor.", art: "test", keys: ["test"] },
  { title: "It goes live", text: "Your new store goes live. Your old theme stays saved in Shopify, so switching back takes one click.", art: "live", keys: ["live"] },
  { title: "Then we start growing it", text: "Launch is when the real testing starts. With ongoing CRO, I test new versions of your pages on real visitors and keep whatever sells more.", art: "ab", keys: [], tag: "Optional", post: true },
];

function stepStates(pv: ProjectView, steps: StepDef[]): SState[] {
  const p = pv.p;
  const n = p.stages.length;
  const allDone = n > 0 && p.current >= n;
  const stIdx = (i: number): SState => {
    const s = stageState(p, i);
    if (s === "waiting" && pv.approvals.some((a) => a.data.stageKey === p.stages[i].key)) return "now";
    return s;
  };
  return steps.map((s) => {
    if (s.pre) return "done";
    if (s.post) return allDone ? "now" : "upcoming";
    const idx = s.keys.map((k) => p.stages.findIndex((x) => x.key === k)).filter((i) => i >= 0);
    if (!idx.length) return "upcoming";
    if (idx.every((i) => i < p.current)) return "done";
    const cur = idx.find((i) => i === p.current);
    if (cur !== undefined) return stIdx(cur);
    if (idx.some((i) => i < p.current)) return "now";
    return "upcoming";
  });
}

const isCro = (p: Project) => p.type === "cro_retainer";
const TAG: Record<SState, string> = { done: "Done", now: "Happening now", waiting: "Waiting on you", upcoming: "" };

export function ProposalView({ pv }: { pv: ProjectView }) {
  const p = pv.p;
  const pr = p.proposal || { scope: [] };
  const s = useVault();
  const hasDocs = projectDocs(s.docs, pv.doc.id).length > 0;
  const links = (pr.links || []).filter((l) => l.kind !== "superseded");
  const ladder = p.croLadder || [];
  const scope = pr.scope || [];
  const showSteps = p.type === "shopify_redesign" || p.stages.length > 0;
  const hasContent = scope.length > 0 || !!pr.timelineText || pr.price != null || !!pr.url || links.length > 0 || ladder.length > 0 || hasDocs || !!pr.afterLaunch;
  const [open, setOpen] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(min-width: 760px)").matches);
  const bodyId = useId();
  if (!hasContent && p.type !== "shopify_redesign" && p.type !== "cro_retainer") return null;

  const steps: StepDef[] = p.type === "shopify_redesign"
    ? SHOPIFY_STEPS
    : p.stages.map((st) => ({ title: st.name, text: st.info || "", art: artFor(p.type, st.key), keys: [st.key] }));
  const states = stepStates(pv, steps);
  const reached = states.filter((x) => x !== "upcoming").length;
  const fill = steps.length > 1 ? Math.max(0, Math.min(100, ((reached - 0.5) / steps.length) * 100)) : 0;

  const signed = pr.signedAt || (pr.status === "accepted" ? pr.sentAt : null);
  const heading = signed || pr.status === "accepted" ? "What we agreed" : "Your proposal";
  const per = isCro(p) ? "per month" : "one time";
  const tiles: { big: string; small: string }[] = [];
  if (pr.price != null) tiles.push({ big: money(pr.price, pr.currency || "USD"), small: priceUnitOf(p) === "month" ? "Per month" : priceUnitOf(p) === "video" ? "Per video" : pr.splitText ? "One time, split in two" : "One time" });
  if (p.promisedDelivery && !isCro(p)) tiles.push({ big: fmtDate(p.promisedDelivery), small: "Planned launch" });
  if (signed) tiles.push({ big: fmtDate(signed), small: "Signed" });
  else if (pr.sentAt) tiles.push({ big: fmtDate(pr.sentAt), small: "Sent to you" });
  if (p.type === "shopify_redesign") tiles.push({ big: "5 to 10", small: "Designs to choose from" });

  return (
    <section className="pp" aria-labelledby={`${bodyId}-h`}>
      <div className="pp-cover cp-dark">
        <div className="pp-cover-text">
          <div className="cp-eyebrow light">Your proposal</div>
          <h2 className="pp-h" id={`${bodyId}-h`}>{heading}</h2>
          <p className="pp-lede">
            {p.title}
            {signed ? <>, signed <span className="num">{fmtDate(signed)}</span>.</> : pr.sentAt ? <>, sent <span className="num">{fmtDate(pr.sentAt)}</span>.</> : "."}
            {" "}Everything below comes straight from it.
          </p>
          <div className="pp-promises">
            <span><Icon name="check" size={14} /> Nothing goes live without your approval</span>
            {p.type === "shopify_redesign" && <span><Icon name="check" size={14} /> Your store never goes offline</span>}
            {pr.afterLaunch && <span><Icon name="check" size={14} /> {shortAfter(pr.afterLaunch)}</span>}
          </div>
        </div>
        <div className="pp-cover-art" aria-hidden="true">
          {isCro(p) ? <ABTest compact onDark /> : <Art name={p.type === "shopify_redesign" ? "directions" : artFor(p.type, p.stages[0]?.key || "work")} />}
        </div>
      </div>

      {tiles.length > 0 && (
        <div className="pp-tiles">
          {tiles.map((t) => <div key={t.small}><b className="num">{t.big}</b><span>{t.small}</span></div>)}
        </div>
      )}

      <button className="pp-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((o) => !o)}>
        <span>{open ? "Hide the full proposal" : "Show the full proposal"}</span>
        <span className="pp-chev" aria-hidden="true"><Icon name="down" size={16} /></span>
      </button>

      <div id={bodyId} className="pp-body" hidden={!open}>
        {isCro(p) && (
          <div className="pp-sec">
            <div className="cp-eyebrow">How testing works</div>
            <h3 className="pp-h3">Version A against Version B, on your real visitors.</h3>
            <ABTest />
          </div>
        )}

        {scope.length > 0 && (
          <div className="pp-sec">
            <div className="cp-eyebrow">What is included</div>
            <ul className="pp-scope">
              {scope.map((x, k) => <li key={k}><span className="pp-ck" aria-hidden="true"><Icon name="check" size={13} /></span><span>{x}</span></li>)}
            </ul>
          </div>
        )}

        {showSteps && steps.length > 0 && (
          <div className="pp-sec">
            <div className="cp-eyebrow">How it works</div>
            <h3 className="pp-h3">{p.type === "shopify_redesign" ? "Here is exactly what happens." : "The plan, step by step."}</h3>
            <p className="muted small">{p.type === "shopify_redesign" ? "Nothing touches your live store until you say yes." : "You can see where we are on every step."}</p>
            <ol className="pp-steps" style={{ ["--fill" as string]: `${fill}%` }}>
              {steps.map((st, i) => {
                const ss = states[i];
                const tag = TAG[ss] || st.tag;
                return (
                  <li key={st.title} className={`pp-step ${ss}${i % 2 ? " rev" : ""}`}>
                    <div className="pp-copy">
                      <h4>{st.title}</h4>
                      {st.text && <p>{st.text}</p>}
                      {tag && <span className={`pp-tag ${ss}`}>{ss === "now" && <span className="dot-live" />}{tag}</span>}
                    </div>
                    <span className="pp-num num">
                      <span aria-hidden="true">{ss === "done" ? <Icon name="check" size={18} /> : String(i + 1).padStart(2, "0")}</span>
                      <span className="cp-sr">Step {i + 1}{TAG[ss] ? `, ${TAG[ss]}` : ""}</span>
                    </span>
                    <div className="pp-vis"><Art name={st.art} /></div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {(pr.timelineText || p.promisedDelivery) && (
          <div className="pp-sec">
            <div className="cp-eyebrow">Timeline</div>
            <div className="pp-time">
              <span className="pp-pill num">{p.promisedDelivery && !isCro(p) ? `Launch ${fmtDate(p.promisedDelivery)}` : "Timeline"}</span>
              <p>{pr.timelineText || "Dates for each stage are on the tracker above."}</p>
            </div>
          </div>
        )}

        {pr.price != null && (
          <div className="pp-sec">
            <div className="cp-eyebrow">Price</div>
            <div className="pp-price cp-dark">
              <div className="pp-price-l">
                <b className="num">{money(pr.price, pr.currency || "USD")}</b>
                <span>{pr.currency || "USD"} {priceUnitOf(p) === "month" ? "per month" : priceUnitOf(p) === "video" ? "per video" : "total, " + per}.{pr.splitText ? ` ${pr.splitText}.` : ""}</span>
              </div>
              {p.payments.length > 0 && (
                <ul className="pp-price-r">
                  {p.payments.map((x) => (
                    <li key={x.id}>
                      <span className="row between"><b className="num">{x.amount != null ? money(x.amount, x.currency) : "Not set"}</b>{x.status === "paid" && <span className="pp-paid"><Icon name="check" size={12} /> Paid</span>}</span>
                      <span className="num">{x.label}{x.status !== "paid" && x.due ? `, due ${fmtDate(x.due)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {(pr.afterLaunch || ladder.length > 0) && (
          <div className="pp-sec">
            <div className="cp-eyebrow">{isCro(p) ? "Your plan" : "After launch"}</div>
            {!isCro(p) && <h3 className="pp-h3">Then we keep it selling.</h3>}
            {pr.afterLaunch && !ladder.length && <div className="pp-time"><span className="pp-pill">After launch</span><p>{pr.afterLaunch}</p></div>}
            {ladder.length > 0 && <CroLadder ladder={ladder} afterLaunch={pr.afterLaunch} showAB={!isCro(p)} />}
          </div>
        )}

        {(hasDocs || pr.url || links.length > 0) && (
          <div className="pp-sec">
            <div className="cp-eyebrow">The documents</div>
            <ProjectDocs projectId={pv.doc.id} />
            {(pr.url || links.length > 0) && (
              <div className="row wrap-ok">
                {pr.url && !links.some((l) => l.url === pr.url) && (
                  <a className="btn ghost sm" href={pr.url} target="_blank" rel="noopener noreferrer"><Icon name="proposals" size={15} /> Open the full proposal</a>
                )}
                {links.map((l) => (
                  <a key={l.url} className="btn ghost sm" href={l.url} target="_blank" rel="noopener noreferrer"><Icon name="proposals" size={15} /> {l.label}</a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// "30 days free fixes, then CRO $1,500 a month" -> "30 days free fixes"
function shortAfter(t: string) {
  const first = t.split(/[,.;]/)[0].trim();
  return first.length > 3 && first.length <= 42 ? first : "Support after launch";
}
