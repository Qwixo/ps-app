// The website's own pages, loaded when they are opened (V1.44). Someone landing from the QR code needs the lock screen
// and their To-do list (the Tab list in web form) first; Clients, Pipeline, Emails, the client portal and the rest come
// in their own files, fetched in the background a few seconds after the list shows (prefetchPages), so a later click
// is instant and the service worker keeps them for offline. The Mac app and the phone app build everything into one
// file as before (vite.config.ts inlineDynamicImports for those modes), so nothing changes there.
import { lazy } from "react";

const load = {
  today: () => import("./views/Today"),
  clients: () => import("./views/Clients"),
  client: () => import("./views/ClientDetail"),
  proposals: () => import("./views/Proposals"),
  meetings: () => import("./views/Meetings"),
  emails: () => import("./views/Emails"),
  demo: () => import("./views/Demo"),
  portal: () => import("./views/ClientPortal"),
  join: () => import("./views/Join"),
  joinOwner: () => import("./views/JoinOwner"),
  gsquadLink: () => import("./views/GSquadLink"),
  campaigns: () => import("./views/CampaignsPage"),
  fitness: () => import("./fitness/FitnessPage"),
};

export const TodayView = lazy(() => load.today().then((m) => ({ default: m.TodayView })));
export const ClientsView = lazy(() => load.clients().then((m) => ({ default: m.ClientsView })));
export const ClientDetailView = lazy(() => load.client().then((m) => ({ default: m.ClientDetailView })));
export const ProposalsView = lazy(() => load.proposals().then((m) => ({ default: m.ProposalsView })));
export const MeetingsView = lazy(() => load.meetings().then((m) => ({ default: m.MeetingsView })));
export const EmailsView = lazy(() => load.emails().then((m) => ({ default: m.EmailsView })));
export const DemoPage = lazy(() => load.demo().then((m) => ({ default: m.DemoPage })));
export const ClientPortal = lazy(() => load.portal().then((m) => ({ default: m.ClientPortal })));
export const JoinScreen = lazy(() => load.join().then((m) => ({ default: m.JoinScreen })));
export const JoinOwnerScreen = lazy(() => load.joinOwner().then((m) => ({ default: m.JoinOwnerScreen })));
export const GSquadLink = lazy(() => load.gsquadLink().then((m) => ({ default: m.GSquadLink })));
export const CampaignsPageView = lazy(() => load.campaigns().then((m) => ({ default: m.CampaignsPageView })));
export const CampaignsNotForYou = lazy(() => load.campaigns().then((m) => ({ default: m.CampaignsNotForYou })));
export const FitnessPage = lazy(() => load.fitness().then((m) => ({ default: m.FitnessPage })));
export const FitnessTestView = lazy(() => load.fitness().then((m) => ({ default: m.FitnessTestView })));

type Conn = { saveData?: boolean; effectiveType?: string };
let prefetched = false;
/** The owner's pages, fetched once when the browser is idle. Not with Data Saver on or on a 2G connection. */
export function prefetchPages() {
  if (prefetched || typeof window === "undefined") return;
  const c = (navigator as Navigator & { connection?: Conn }).connection;
  if (c?.saveData || /2g/.test(c?.effectiveType || "")) return;
  prefetched = true;
  const go = () => { for (const k of ["today", "clients", "client", "proposals", "emails", "fitness", "meetings"] as const) void load[k]().catch(() => { prefetched = false; }); };
  const w = window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number };
  window.setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 4000 }) : go()), 3500);
}
