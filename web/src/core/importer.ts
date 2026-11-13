// Client importer. Reads the plaintext import file (schema: private/IMPORT-SCHEMA.md)
// entirely in the browser and writes it into the vault through the normal actions,
// so every record is encrypted before it leaves this device. The file itself is never
// uploaded. Owner-private facts (notes, next steps, waiting on, history, free text
// status) only go into owner-private docs, never into shared project docs.
import type { CTask, Payment, Pipeline, Project, ProjectType, Proposal } from "./model";
import { PIPELINE, PROJECT_TYPES, stagesFor, uid } from "./model";
import { addClient, addClientTask, addProject, tickTask, updatePrivate } from "./actions";
import { docs, put } from "./vault";
import { todayISO } from "../ui/kit";

// ---------- file shape ----------
export interface ImportPayment { label?: string; amount?: number | null; currency?: string | null; due?: string | null; status?: string | null; paidAt?: string | null }
export interface ImportTask { title?: string; due?: string | null; done?: boolean }
export interface ImportProject {
  ref?: string;
  title?: string;
  type?: string;
  pipeline?: string;
  currentStage?: string | null;
  waitingOn?: "me" | "client" | null;
  waitingWhat?: string | null;
  nextStep?: string | null;
  nextStepDue?: string | null;
  startDate?: string | null;
  promisedDelivery?: string | null;
  promisedTimelineText?: string | null;
  proposal?: {
    url?: string | null; sentAt?: string | null; signedAt?: string | null; price?: number | null; currency?: string | null;
    scope?: string[] | null; status?: string | null;
    links?: { label?: string | null; url?: string | null; kind?: string | null; date?: string | null }[] | null;
    splitText?: string | null; afterLaunch?: string | null;
  } | null;
  payments?: ImportPayment[] | null;
  nextInvoiceDate?: string | null;
  liveUrls?: string[] | null;
  clientTasks?: ImportTask[] | null;
  history?: { date?: string; text?: string }[] | null;
}
export interface ImportClient {
  ref?: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  greetingName?: string | null;
  notes?: string | null;
  sources?: string[];
  projects: ImportProject[];
}
export interface ImportFile { generatedAt?: string; clients: ImportClient[]; openQuestions?: string[] }

// ---------- helpers ----------
const ISO = /^\d{4}-\d{2}-\d{2}/;
const date = (v: unknown): string | null => (typeof v === "string" && ISO.test(v) ? v.slice(0, 10) : null);
const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s*[\u2013\u2014]\s*/g, " - ").trim();
  return t || null;
};
const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() && isFinite(+v) ? +v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : []);
const norm = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

const TYPE_KEYS = new Set(PROJECT_TYPES.map((t) => t.key));
const PIPE_KEYS = new Set(PIPELINE.map((p) => p.key));
const PROPOSAL_STATUS = new Set(["draft", "sent", "accepted", "superseded", "declined"]);
const PAY_STATUS = new Set(["paid", "owed", "upcoming"]);

/** Parses and validates the file text. Throws a plain English error when it is not usable. */
export function parseImportFile(text: string): ImportFile {
  let raw: any;
  try { raw = JSON.parse(text); } catch { throw new Error("This file is not valid JSON."); }
  if (!raw || !Array.isArray(raw.clients)) throw new Error("This file has no \"clients\" list, so it is not an import file.");
  const clients: ImportClient[] = [];
  raw.clients.forEach((c: any, i: number) => {
    const name = str(c?.name);
    if (!name) throw new Error(`Client number ${i + 1} has no name.`);
    clients.push({ ...c, name, projects: Array.isArray(c.projects) ? c.projects : [] });
  });
  return { generatedAt: str(raw.generatedAt) ?? undefined, clients, openQuestions: strs(raw.openQuestions) };
}

export interface PlanClient {
  name: string;
  contactName: string | null;
  skip: boolean;
  projects: { title: string; type: string; pipeline: string; tasks: number; payments: number }[];
}
export interface ImportPlan {
  clients: PlanClient[];
  toImport: number;
  skipped: number;
  projects: number;
  tasks: number;
  payments: number;
  openQuestions: string[];
}

export function existingClientNames(): Set<string> {
  return new Set(docs<{ name: string }>("client").map((c) => norm(c.data.name || "")));
}

/** What will happen, before anything is written. */
export function planImport(file: ImportFile, existing = existingClientNames()): ImportPlan {
  const seen = new Set(existing);
  const clients: PlanClient[] = file.clients.map((c) => {
    const k = norm(c.name);
    const skip = seen.has(k);
    seen.add(k);
    return {
      name: c.name,
      contactName: str(c.contactName),
      skip,
      projects: c.projects.map((p) => ({
        title: str(p.title) || "Untitled project",
        type: typeLabelSafe(p.type),
        pipeline: PIPELINE.find((x) => x.key === p.pipeline)?.label || "Lead",
        tasks: Array.isArray(p.clientTasks) ? p.clientTasks.length : 0,
        payments: Array.isArray(p.payments) ? p.payments.length : 0,
      })),
    };
  });
  const live = clients.filter((c) => !c.skip);
  return {
    clients,
    toImport: live.length,
    skipped: clients.length - live.length,
    projects: live.reduce((n, c) => n + c.projects.length, 0),
    tasks: live.reduce((n, c) => n + c.projects.reduce((m, p) => m + p.tasks, 0), 0),
    payments: live.reduce((n, c) => n + c.projects.reduce((m, p) => m + p.payments, 0), 0),
    openQuestions: file.openQuestions || [],
  };
}
function typeLabelSafe(t?: string) {
  return PROJECT_TYPES.find((x) => x.key === t)?.label || "Custom project";
}

// ---------- mapping ----------
interface Mapped { type: ProjectType; title: string; patch: Partial<Project>; statusNote: string | null; fileNote: string | null }

const isHttp = (v: unknown): v is string => typeof v === "string" && /^https?:\/\/\S+$/i.test(v.trim());
const LINK_KINDS = new Set(["live", "pdf", "superseded", "other"]);
type PLink = NonNullable<Proposal["links"]>[number];

// When the import gives free text instead of a stage key, place the tracker from the pipeline.
function stageFromPipeline(pipeline: Pipeline, type: ProjectType, stages: { key: string; gate?: unknown; clientAction?: string | null }[]): number {
  const at = (k: string) => { const i = stages.findIndex((s) => s.key === k); return i >= 0 ? i : null; };
  switch (pipeline) {
    case "in_build": return at("build") ?? at("design") ?? at("edit") ?? at("work") ?? Math.floor(stages.length / 2);
    case "client_review": {
      const i = stages.findIndex((s) => s.gate === "design" || s.gate === "review");
      return i >= 0 ? i : Math.floor(stages.length * 0.6);
    }
    case "live": return stages.length;
    case "cro": return type === "cro_retainer" ? (at("testing") ?? 0) : stages.length;
    case "finished": return stages.length;
    default: return 0;
  }
}

export function mapProject(p: ImportProject): Mapped {
  const type: ProjectType = TYPE_KEYS.has(p.type as ProjectType) ? (p.type as ProjectType) : "custom";
  const pipeline: Pipeline = PIPE_KEYS.has(p.pipeline as Pipeline) ? (p.pipeline as Pipeline) : "lead";
  const stages = stagesFor(type);
  const stageText = str(p.currentStage);
  const alias: Record<string, string> = { launch: "test", directions: "directions", pick: "pick" };
  const key = stageText ? (alias[stageText.toLowerCase()] ?? stageText.toLowerCase()) : "";
  const idx = key ? stages.findIndex((s) => s.key === key || s.name.toLowerCase() === key) : -1;
  let current = idx >= 0 ? idx : stageFromPipeline(pipeline, type, stages);
  if (pipeline === "finished") current = stages.length;
  // Free text status (not a stage key) is owner language: it goes to private history only.
  const statusNote = stageText && idx < 0 ? stageText : null;

  const pr = p.proposal || {};
  const currency = str(pr.currency) || "USD";
  // Only real web links go into the (shared) project. Local or Drive paths stay private.
  const rawUrl = str(pr.url);
  const notes: string[] = [];
  if (rawUrl && !isHttp(rawUrl)) notes.push(`Proposal file: ${rawUrl}`);
  let links: PLink[] = (Array.isArray(pr.links) ? pr.links : [])
    .map((l): PLink | null => {
      const url = str(l?.url);
      if (!url) return null;
      if (!isHttp(url)) { notes.push(`Proposal file${l?.label ? ` (${str(l.label)})` : ""}: ${url}`); return null; }
      const kind = LINK_KINDS.has(l?.kind as string) ? (l!.kind as PLink["kind"]) : "other";
      return { label: str(l?.label) || (kind === "pdf" ? "PDF" : "Proposal"), url: url.trim(), kind, date: date(l?.date) };
    })
    .filter((x): x is PLink => !!x);
  if (!links.length && rawUrl && isHttp(rawUrl)) links = [{ label: "Proposal", url: rawUrl.trim(), kind: "live", date: date(pr.sentAt) }];
  const liveLink = links.find((l) => l.kind === "live")?.url;
  const proposal: Proposal = {
    url: liveLink || (rawUrl && isHttp(rawUrl) ? rawUrl.trim() : null),
    links,
    splitText: str(pr.splitText),
    afterLaunch: str(pr.afterLaunch),
    sentAt: date(pr.sentAt),
    signedAt: date(pr.signedAt),
    price: num(pr.price),
    currency,
    scope: strs(pr.scope),
    timelineText: str(p.promisedTimelineText),
    status: PROPOSAL_STATUS.has(pr.status as string) ? (pr.status as Proposal["status"]) : null,
  };
  const payments: Payment[] = (Array.isArray(p.payments) ? p.payments : [])
    .map((x): Payment | null => {
      const amount = num(x?.amount);
      if (amount == null) { notes.push(`Payment without an amount, not imported: ${str(x?.label) || "unnamed"}${x?.status ? ` (${x.status})` : ""}`); return null; }
      const status = PAY_STATUS.has(x.status as string) ? (x.status as Payment["status"]) : "upcoming";
      return {
        id: uid(),
        label: str(x.label) || "Payment",
        amount,
        currency: str(x.currency) || currency,
        due: date(x.due),
        status,
        paidAt: status === "paid" ? date(x.paidAt) : null,
      };
    })
    .filter((x): x is Payment => !!x);

  const promised = date(p.promisedDelivery);
  const patch: Partial<Project> = {
    pipeline,
    stages,
    current,
    startDate: date(p.startDate),
    promisedDelivery: promised,
    originalDelivery: promised,
    deliveryChanges: [],
    proposal,
    payments,
    liveUrls: strs(p.liveUrls),
    clientVisible: pipeline !== "lead" && pipeline !== "proposal_sent",
    status: "on_track",
  };
  return { type, title: str(p.title) || typeLabelSafe(type), patch, statusNote, fileNote: notes.length ? notes.join("\n") : null };
}

// ---------- run ----------
export interface ImportProgress { done: number; total: number; label: string }
export interface ImportResult { clients: number; projects: number; tasks: number; skipped: string[]; failed: { name: string; error: string }[] }

export async function runImport(file: ImportFile, onProgress?: (p: ImportProgress) => void): Promise<ImportResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Connect to the internet first. Each new client needs its own key from the server.");
  const plan = planImport(file);
  const total = plan.clients.length;
  const res: ImportResult = { clients: 0, projects: 0, tasks: 0, skipped: [], failed: [] };
  const seen = existingClientNames();
  let done = 0;
  const tick = (label: string) => onProgress?.({ done, total, label });

  for (const c of file.clients) {
    const key = norm(c.name);
    if (seen.has(key)) { res.skipped.push(c.name); done++; tick(`Skipped ${c.name} (already in the vault)`); continue; }
    seen.add(key);
    tick(`Adding ${c.name}`);
    try {
      const clientId = await addClient({
        name: c.name,
        contactName: str(c.contactName) || undefined,
        email: str(c.email) || undefined,
        greetingName: str(c.greetingName) || undefined,
        notes: str(c.notes) || undefined,
        timezone: str((c as { timezone?: unknown }).timezone) || undefined,
      });
      const ws = docs<{ ws: string }>("client").find((d) => d.id === clientId)?.data.ws;
      if (!ws) throw new Error("The new client has no workspace.");
      res.clients++;

      for (let i = 0; i < c.projects.length; i++) {
        const ip = c.projects[i];
        const m = mapProject(ip);
        tick(`${c.name}: ${m.title}`);
        const projectId = await addProject(ws, m.type, m.title, m.patch);
        res.projects++;

        const imported = (Array.isArray(ip.history) ? ip.history : [])
          .map((h) => ({ date: date(h?.date) || todayISO(), text: str(h?.text) || "" }))
          .filter((h) => h.text)
          .sort((a, b) => b.date.localeCompare(a.date));
        const history = [
          { date: todayISO(), text: "Imported into the vault" },
          ...(m.statusNote ? [{ date: todayISO(), text: `Status at import: ${m.statusNote}` }] : []),
          ...(m.fileNote ? [{ date: todayISO(), text: m.fileNote }] : []),
          ...imported,
        ];
        const waitingOn = ip.waitingOn === "me" || ip.waitingOn === "client" ? ip.waitingOn : null;
        await updatePrivate(projectId, {
          nextStep: str(ip.nextStep),
          nextDue: date(ip.nextStepDue),
          waitingOn,
          waitingWhat: str(ip.waitingWhat),
          waitingSince: waitingOn ? todayISO() : null,
          nextInvoiceDate: date(ip.nextInvoiceDate),
          notes: [i === 0 ? str(c.notes) : null, m.fileNote].filter(Boolean).join("\n\n") || null,
          history,
        });

        const tasks = Array.isArray(ip.clientTasks) ? ip.clientTasks : [];
        if (m.patch.clientVisible === false) {
          // Hidden project: its client tasks must not go under the client's key yet.
          const lines = tasks.map((t) => str(t?.title)).filter(Boolean);
          if (lines.length) await updatePrivate(projectId, {}, `Client tasks to add when shown: ${lines.join("; ")}`);
          continue;
        }
        for (let t = 0; t < tasks.length; t++) {
          const title = str(tasks[t]?.title);
          if (!title) continue;
          const due = date(tasks[t].due);
          if (tasks[t].done) {
            // Needs the task id to tick it, so create it directly.
            const taskId = await put<CTask>("ctask", { projectId, title, detail: null, due, order: t }, { ws });
            await tickTask(taskId, ws, true, "Owner");
          } else {
            await addClientTask(projectId, ws, { title, due });
          }
          res.tasks++;
        }
      }
    } catch (e) {
      res.failed.push({ name: c.name, error: String((e as Error)?.message || e) });
    }
    done++;
    tick(`Finished ${c.name}`);
  }
  return res;
}
