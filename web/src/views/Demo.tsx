// Public demo of the client view at /client/demo. Fictional data only, built in memory.
// No vault, no network: ticks and approvals live in local React state and reset on demand.
import { useMemo, useState } from "react";
import type { Approval, CTask, Doc, Kind, Project, Stage, Update, WsMeta } from "../core/model";
import { STAGE_TEMPLATES } from "../core/model";
import type { ClientView, ProjectView } from "../core/select";
import { ClientPortal, type PortalHandlers } from "./ClientPortal";
import { Icon, Logo, addDays, todayISO, toast } from "../ui/kit";
import "./portal.css";

const WS = "demo-ws";
const NOW = () => new Date().toISOString();

function mkDoc<T>(id: string, kind: Kind, data: T): Doc<T> {
  return { id, ws: WS, kind, data, author: "demo", updatedAt: NOW() };
}

// Dates are relative to today so the demo always looks current.
function buildBase() {
  const t = todayISO();
  const d = (n: number) => addDays(t, n);

  // ---- project 1: Shopify redesign, waiting on the client at "Your pick" ----
  // Finished stages carry the day they finished. Later stages have no dates on purpose:
  // the page works them out from the start date and the agreed launch ("about" dates).
  const plan: Record<string, Partial<Stage>> = {
    kickoff: { doneAt: d(-17) },
    research: { doneAt: d(-9) },
    directions: { doneAt: d(-2) },
    pick: { start: d(-1), due: d(2) },
  };
  const exp = d(2);
  const stages1: Stage[] = STAGE_TEMPLATES.shopify_redesign.map((s) => ({
    ...s, ...plan[s.key],
    previews: s.key === "pick" ? [
      { id: "pv-a", label: "Direction A", url: "https://example.com/preview-a", note: "Gallery first: big lookbook imagery up top", addedAt: d(-2), expiresAt: exp },
      { id: "pv-b", label: "Direction B", url: "https://example.com/preview-b", note: "Story first: the mulberry silk origin story", addedAt: d(-2), expiresAt: exp },
      { id: "pv-c", label: "Direction C", url: "https://example.com/preview-c", note: "New arrivals first: shoppable from the first scroll", addedAt: d(-2), expiresAt: exp },
    ] : [],
  }));
  const ladder = [
    { label: "Starting price", price: "$1,250 / month" },
    { label: "1.5%+ conversion, 2 months in a row", price: "$1,500 / month" },
    { label: "2%+ conversion, 2 months in a row", price: "$1,750 / month" },
  ];
  const p1: Project = {
    title: "Store redesign",
    type: "shopify_redesign",
    pipeline: "client_review",
    stages: stages1,
    current: 3,
    nowLine: "Your three design directions are ready. Open each preview on your phone and laptop, then tell us which one feels most like Northwind Silk. Mixing parts of two is completely fine.",
    nowWindow: null,
    status: "on_track",
    startDate: d(-17),
    promisedDelivery: d(23),
    originalDelivery: d(23),
    deliveryChanges: [],
    proposal: {
      scope: [
        "Your homepage, redesigned for conversion",
        "Collection and product pages to match",
        "3 design directions with live preview links, then one refined design",
        "Built on a copy of your theme, so your store never goes offline",
        "Phone and desktop testing, homepage to checkout",
        "Set up so you can edit every section yourself",
      ],
      timelineText: "About three and a half weeks from kickoff to launch, as long as decisions come back within two working days.",
      price: 2500, currency: "USD", sentAt: d(-20), signedAt: d(-18), status: "accepted", url: null,
      splitText: "50% to start, 50% once it is live",
      afterLaunch: "30 days of free fixes, then optional CRO from $1,250 a month",
    },
    payments: [
      { id: "pay-1", label: "First 50% to start", amount: 1250, currency: "USD", status: "paid", paidAt: d(-18), due: d(-18) },
      { id: "pay-2", label: "Final 50% at launch", amount: 1250, currency: "USD", status: "upcoming", due: d(23) },
    ],
    liveUrls: [],
    croLadder: ladder,
    clientVisible: true,
  };

  // ---- project 2: CRO on a second store, a test is running ----
  const plan2: Record<string, Partial<Stage>> = {
    onboard: { doneAt: d(-40) },
    baseline: { doneAt: d(-30) },
    research: { doneAt: d(-21) },
  };
  const p2: Project = {
    title: "CRO for Northwind Home",
    type: "cro_retainer",
    pipeline: "cro",
    stages: STAGE_TEMPLATES.cro_retainer.map((s) => ({ ...s, ...plan2[s.key], previews: [] })),
    current: 3,
    nowLine: "Test 2 is running. Half your visitors see the current product page, half see a version with the reviews moved above the price. Once enough people have seen both, the one that sold more stays.",
    nowWindow: null,
    status: "on_track",
    startDate: d(-41),
    promisedDelivery: d(12),
    originalDelivery: d(12),
    deliveryChanges: [],
    proposal: {
      scope: [
        "One A/B test running at all times on your real visitors",
        "Research into where visitors drop off and why",
        "The winning version stays live on your store",
        "A short monthly note: what won, what lost, what is next",
      ],
      timelineText: "Month to month. Start or stop whenever you like.",
      price: 1250, currency: "USD", sentAt: d(-44), signedAt: d(-41), status: "accepted",
    },
    payments: [
      { id: "pay-4", label: "Month 1", amount: 1250, currency: "USD", status: "paid", paidAt: d(-41) },
      { id: "pay-5", label: "Month 2", amount: 1250, currency: "USD", status: "paid", paidAt: d(-11) },
      { id: "pay-6", label: "Month 3", amount: 1250, currency: "USD", status: "upcoming", due: d(19) },
    ],
    liveUrls: [],
    croLadder: ladder,
    clientVisible: true,
  };

  // ---- project 3: Amazon A+ content, the developer is designing ----
  const plan3: Record<string, Partial<Stage>> = {
    brief: { start: d(-10), due: d(-9), doneAt: d(-9) },
    research: { start: d(-8), due: d(-4), doneAt: d(-4) },
    design: { start: d(-3), due: d(4) },
    review: { start: d(5), due: d(6) },
    upload: { start: d(7), due: d(7) },
    amazon: { start: d(8), due: d(14) },
    live: { start: d(15), due: d(15) },
  };
  const p3: Project = {
    title: "Amazon A+ content",
    type: "amazon_a_plus",
    pipeline: "in_build",
    stages: STAGE_TEMPLATES.amazon_a_plus.map((s) => ({ ...s, ...plan3[s.key], previews: [] })),
    current: 2,
    nowLine: "Designing the A+ modules for your 4 best sellers: comparison chart, care guide and the mulberry silk grade explainer.",
    nowWindow: null,
    status: "on_track",
    startDate: d(-10),
    promisedDelivery: d(15),
    originalDelivery: d(15),
    deliveryChanges: [],
    proposal: {
      scope: ["A+ content for 4 hero listings", "Comparison chart across the range", "Upload and Amazon approval handled for you"],
      timelineText: "Around two weeks, plus Amazon's own review (usually 1 to 7 days).",
      price: 900, currency: "USD", signedAt: d(-11), status: "accepted",
    },
    payments: [{ id: "pay-3", label: "Paid in full", amount: 900, currency: "USD", status: "paid", paidAt: d(-11) }],
    liveUrls: [],
    clientVisible: true,
  };

  const proj1 = mkDoc<Project>("demo-p1", "project", p1);
  const proj2 = mkDoc<Project>("demo-p2", "project", p2);
  const proj3 = mkDoc<Project>("demo-p3", "project", p3);

  const tasks1 = [
    mkDoc<CTask>("t1", "ctask", { projectId: proj1.id, title: "Send your logo files and any brand fonts", detail: "Reply to the weekly email with the files, or share a Google Drive folder.", due: d(1), order: 1 }),
    mkDoc<CTask>("t2", "ctask", { projectId: proj1.id, title: "Add the developer as a staff member in Shopify", detail: "1. In Shopify, open Settings\n2. Go to Users and permissions\n3. Click Add staff and enter the email from the developer's welcome note\n4. Tick Themes, Online Store and Products, then send the invite", due: d(3), order: 2 }),
    mkDoc<CTask>("t3", "ctask", { projectId: proj1.id, title: "Pay the first 50% to start", detail: null, due: d(-18), order: 0 }),
  ];
  const tasks2 = [
    mkDoc<CTask>("t5", "ctask", { projectId: proj2.id, title: "Tell the developer about any sale coming up", detail: "A big sale skews a test, so the developer pauses it for those days.", due: d(6), order: 0 }),
  ];
  const tasks3 = [
    mkDoc<CTask>("t4", "ctask", { projectId: proj3.id, title: "Share Seller Central access", detail: "Brand Registry user permissions.", due: d(-8), order: 0 }),
  ];
  const doneTicks: Record<string, { done: boolean; at: string }> = {
    t3: { done: true, at: new Date(Date.now() - 18 * 864e5).toISOString() },
    t4: { done: true, at: new Date(Date.now() - 9 * 864e5).toISOString() },
  };

  const updates1 = [
    mkDoc<Update>("u2", "update", { projectId: proj1.id, date: d(-1), title: "Week 2: your three directions are ready", status: "on_track",
      bullets: ["Research wrapped: 5 competitor stores and 1,200 reviews read", "Directions A, B and C are live as preview links", "Next: your pick, then we refine it together"],
      body: "Biggest finding: shoppers mention the fabric weight in almost every 5 star review, so all three directions put it front and centre." }),
    mkDoc<Update>("u1", "update", { projectId: proj1.id, date: d(-8), title: "Week 1: research under way", status: "on_track",
      bullets: ["Kickoff call done, goals agreed", "Store audit started: 3 quick wins found already", "Next week: finish research, start the design directions"], body: null }),
  ];
  const updates2 = [
    mkDoc<Update>("u4", "update", { projectId: proj2.id, date: d(-4), title: "Test 1 result: the shorter checkout note won", status: "on_track",
      bullets: ["Version B is now live for everyone", "Test 2 started: reviews above the price on product pages", "Full numbers are in your monthly note"], body: null }),
  ];
  const updates3 = [
    mkDoc<Update>("u3", "update", { projectId: proj3.id, date: d(-3), title: "Research done, design started", status: "on_track",
      bullets: ["Checked 6 competitor A+ pages in the silk pillowcase category", "Picked the 4 listings with the most traffic to start"], body: null }),
  ];

  const meta = mkDoc<WsMeta>("demo-meta", "wsmeta", { clientName: "Northwind Silk", greetingName: "Anna" });
  return { proj1, proj2, proj3, tasks1, tasks2, tasks3, updates1, updates2, updates3, meta, doneTicks };
}

type Base = ReturnType<typeof buildBase>;

function buildView(b: Base, ticks: Record<string, { done: boolean; at: string }>, approvals: Doc<Approval>[]): ClientView {
  const pv = (doc: Doc<Project>, tasks: Doc<CTask>[], updates: Doc<Update>[]): ProjectView => ({
    doc, p: doc.data, ws: WS,
    tasks: tasks.map((t) => {
      const k = ticks[t.id];
      return { doc: t, done: !!k?.done, doneAt: k?.done ? k.at : null };
    }),
    approvals: approvals.filter((a) => a.data.projectId === doc.id),
    updates,
  });
  return {
    client: null, ws: WS, meta: b.meta, name: "Northwind Silk",
    projects: [pv(b.proj1, b.tasks1, b.updates1), pv(b.proj2, b.tasks2, b.updates2), pv(b.proj3, b.tasks3, b.updates3)],
  };
}

export function DemoPage() {
  const [base, setBase] = useState(buildBase);
  const [ticks, setTicks] = useState(base.doneTicks);
  const [approvals, setApprovals] = useState<Doc<Approval>[]>([]);
  const [round, setRound] = useState(0);

  const view = useMemo(() => buildView(base, ticks, approvals), [base, ticks, approvals]);

  const handlers: PortalHandlers = useMemo(() => ({
    onTick: (taskId, _ws, done) => {
      setTicks((m) => ({ ...m, [taskId]: { done, at: NOW() } }));
      if (done) toast("Ticked off. The developer sees this straight away.");
    },
    onApprove: (projectId, ws, stageKey, gate, note) => {
      const at = NOW();
      setApprovals((l) => [{ id: `appr-${at}`, ws, kind: "approval", author: "demo", updatedAt: at,
        data: { projectId, stageKey, gate, at, by: "Anna", note: note || null } }, ...l]);
      toast("Approved and date stamped.");
    },
  }), []);

  const reset = () => {
    const b = buildBase();
    setBase(b);
    setTicks(b.doneTicks);
    setApprovals([]);
    setRound((r) => r + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
    toast("Demo reset");
  };

  return (
    <>
      <header className="top demo-bar">
        <div className="wrap">
          <span className="brand"><Logo /> Cincee</span>
          <span className="demo-chip"><span className="long">Demo with example data</span><span className="short">Demo</span></span>
          <span className="spacer" />
          <button className="btn quiet sm" onClick={reset} aria-label="Reset demo"><Icon name="reset" size={16} /><span className="reset-l">Reset demo</span></button>
          <a className="btn ghost sm" href={import.meta.env.BASE_URL}>Sign in</a>
        </div>
      </header>
      <main className="page wrap" style={{ paddingBottom: 60 }}>
        <div className="stack loose">
          <div className="banner pinkish demo-intro">
            <span className="row"><Icon name="eye" /> This is what a Cincee client sees. Everything is clickable: tick a to-do, open a stage, approve a direction, open the proposal.</span>
          </div>
          <ClientPortal key={round} view={view} handlers={handlers} viewerName="Anna" />
        </div>
      </main>
    </>
  );
}
