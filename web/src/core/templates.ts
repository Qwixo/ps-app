// Email templates. They build a subject and body from ONE client's own project data.
// Rules: short, warm, plain, signed "Owner". No em or en dashes. Never mention any
// other client. Nothing here sends anything: the Emails view only offers copy and
// mailto after the developer approves the exact words.
import type { ClientRec } from "./model";
import { currentStage } from "./model";
import type { ProjectView } from "./select";
import { daysFromToday, money, parseISODate, todayISO } from "../ui/kit";

export const PORTAL_URL = "https://cincee.com/client";

export type TemplateKey =
  | "welcome" | "kickoff" | "weekly" | "design_ready" | "preview_ready" | "launch"
  | "checkin_7" | "review_30" | "cro_report" | "invoice" | "follow_up";

export const TEMPLATES: { key: TemplateKey; label: string; hint: string }[] = [
  { key: "welcome", label: "Welcome", hint: "Right after they sign" },
  { key: "kickoff", label: "Kickoff recap", hint: "After the kickoff call" },
  { key: "weekly", label: "Friday update", hint: "Status, done, next, needed from them" },
  { key: "design_ready", label: "Design ready for review", hint: "Directions or designs to look at" },
  { key: "preview_ready", label: "Preview ready", hint: "A new preview link" },
  { key: "launch", label: "Launch day", hint: "The day it goes live" },
  { key: "checkin_7", label: "Day 7 check-in", hint: "One week after launch" },
  { key: "review_30", label: "Day 30 review", hint: "One month after launch" },
  { key: "cro_report", label: "CRO monthly report", hint: "Tested, won, next" },
  { key: "invoice", label: "Invoice reminder", hint: "Gentle payment nudge" },
  { key: "follow_up", label: "Gentle follow up", hint: "When waiting on them" },
];
export const templateLabel = (k: string) => TEMPLATES.find((t) => t.key === k)?.label ?? "Email";

export interface TemplateCtx {
  client: ClientRec;
  pv?: ProjectView | null;
  sign?: string;                 // the owner's first name (Settings); the developer's emails keep "Owner"
}

const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(iso?: string | null) {
  if (!iso) return "";
  const d = parseISODate(iso);
  return `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
}
function shortDate(iso?: string | null) {
  if (!iso) return "";
  const d = parseISODate(iso);
  return `${WD[d.getDay()].slice(0, 3)} ${d.getDate()} ${MO[d.getMonth()].slice(0, 3)}`;
}

/** Replaces long dashes with plain punctuation so nothing slips through from data. */
export function clean(text: string) {
  return text.replace(/\s*[\u2013\u2014]\s*/g, " - ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function firstName(c: ClientRec) {
  return (c.greetingName || c.contactName?.split(" ")[0] || "there").trim();
}

function latestPreview(pv?: ProjectView | null) {
  if (!pv) return null;
  const all = pv.p.stages.flatMap((s) => s.previews || []);
  return all.sort((a, b) => (b.addedAt || "").localeCompare(a.addedAt || ""))[0] ?? null;
}

function openTasks(pv?: ProjectView | null) {
  if (!pv) return [];
  return pv.tasks.filter((t) => !t.done).map((t) => t.doc.data);
}
function taskLines(pv?: ProjectView | null) {
  return openTasks(pv).slice(0, 6).map((t) => `- ${t.title}${t.due ? ` (by ${shortDate(t.due)})` : ""}`);
}

const STATUS_WORDS: Record<string, string> = {
  on_track: "On track",
  at_risk: "A little behind, but moving",
  action_needed: "Waiting on a couple of things from you",
};

export function buildEmail(key: TemplateKey, ctx: TemplateCtx): { subject: string; body: string } {
  const { client, pv } = ctx;
  const hi = `Hi ${firstName(client)},`;
  const project = pv?.p.title || "your project";
  const p = pv?.p;
  const st = p ? currentStage(p) : null;
  const next = p ? p.stages[p.current + 1] ?? null : null;
  const preview = latestPreview(pv);
  const tasks = taskLines(pv);
  const sign = ctx.sign?.trim() || "Owner";
  const L: string[] = [];
  let subject = "";

  switch (key) {
    case "welcome": {
      subject = `Welcome to Cincee, ${firstName(client)}`;
      L.push(hi, "",
        `Thank you for choosing Cincee. I am really happy to be working on ${project} with you.`, "",
        "Everything lives on your project page: what stage we are at, what I need from you, and every preview link as it comes in.", "",
        `Your page: ${PORTAL_URL}`);
      if (p?.promisedDelivery) L.push("", `We are aiming to have everything finished by ${longDate(p.promisedDelivery)}.`);
      if (tasks.length) L.push("", "To get started, I just need:", ...tasks);
      L.push("", "Any questions at all, just reply to this email.", "", sign);
      break;
    }
    case "kickoff": {
      subject = `Our kickoff call: a quick recap`;
      L.push(hi, "", "Thanks for the call today. Here is a quick recap so we are on the same page.");
      const scope = (p?.proposal.scope || []).filter(Boolean).slice(0, 8);
      if (scope.length) L.push("", "What we agreed:", ...scope.map((s) => `- ${s}`));
      const when = p?.proposal.timelineText || (p?.promisedDelivery ? `Finished by ${longDate(p.promisedDelivery)}` : "");
      if (when) L.push("", `Timeline: ${when}`);
      L.push("", "What I need from you:", ...(tasks.length ? tasks : ["- Nothing yet, I will let you know"]));
      if (next) L.push("", `Next from me: ${next.name}. ${next.info || ""}`.trim());
      L.push("", `You can follow every step here: ${PORTAL_URL}`, "", sign);
      break;
    }
    case "weekly": {
      subject = `Your Friday update: ${project}`;
      L.push(hi, "", `Here is where ${project} is this week.`, "");
      const stageTxt = p && st ? ` (stage ${Math.min(p.current + 1, p.stages.length)} of ${p.stages.length}: ${st.name})` : "";
      L.push(`Status: ${STATUS_WORDS[p?.status || "on_track"] || "On track"}${stageTxt}`);
      const u = pv?.updates[0];
      const recent = u && daysFromToday(u.data.date) >= -7 ? u.data.bullets.filter(Boolean) : [];
      L.push("", "Done this week:", ...(recent.length ? recent.map((b) => `- ${b}`) : ["- [what got done]"]));
      L.push("", "Next:");
      if (st) L.push(`- ${st.name}${st.info ? `: ${st.info}` : ""}`);
      if (next) L.push(`- Then ${next.name}`);
      if (!st && !next) L.push("- [what is next]");
      L.push("", "Needed from you:", ...(tasks.length ? tasks : ["- Nothing right now, you are all clear"]));
      L.push("", `Everything is on your project page: ${PORTAL_URL}`, "", "Have a lovely weekend,", sign);
      break;
    }
    case "design_ready": {
      subject = `Your designs are ready to review`;
      L.push(hi, "", `Good news, the designs for ${project} are ready for you to look at.`);
      if (preview) L.push("", `You can open them here: ${preview.url}`);
      L.push("", `They are also on your project page with everything else: ${PORTAL_URL}`, "",
        "Take your time with them. When you have a favourite, or want to mix parts of two, pick it on the page or just reply here.", "", sign);
      break;
    }
    case "preview_ready": {
      subject = `A new preview is ready`;
      L.push(hi, "", `A new preview of ${project} is ready for you:`, preview ? preview.url : "[preview link]", "");
      if (preview?.expiresAt || p?.type === "shopify_redesign") {
        L.push("Shopify preview links stop working after about 2 days, so if it does not open, tell me and I will send a fresh one.", "");
      }
      L.push("Any notes at all, reply here or add them on your project page.", PORTAL_URL, "", sign);
      break;
    }
    case "launch": {
      subject = `${project} is live`;
      const live = p?.liveUrls?.[0];
      L.push(hi, "", `It is live! ${project} is now switched on${live ? `: ${live}` : "."}`, "",
        "Your old theme is saved, so we can roll back in one click if we ever need to.", "",
        "Over the next few days I will keep a close eye on everything: checkout, apps, phone and desktop. If you or a customer spots anything odd, tell me straight away.", "",
        "Thank you for trusting me with this.", "", sign);
      break;
    }
    case "checkin_7": {
      subject = `One week in: how is it going?`;
      L.push(hi, "", `It has been a week since ${project} went live, so I wanted to check in.`, "",
        "How is it feeling? Any customer feedback, anything that looks off, or anything you would like changed?", "",
        "Just reply here, even a one line answer helps.", "", sign);
      break;
    }
    case "review_30": {
      subject = `30 days live: a quick review`;
      L.push(hi, "", `${project} has now been live for a month. I would love to go through how it is doing with you: conversion, order value, and what customers are doing on the site.`, "",
        "Would a 20 minute call next week work? Reply with a day and time that suits you.", "", sign);
      break;
    }
    case "cro_report": {
      const m = MO[parseISODate(todayISO()).getMonth()];
      subject = `Your CRO report for ${m}`;
      const u = pv?.updates[0];
      const bullets = u ? u.data.bullets.filter(Boolean) : [];
      L.push(hi, "", `Here is your report for ${m}.`, "",
        "What we tested:", ...(bullets.length ? bullets.map((b) => `- ${b}`) : ["- [test]"]), "",
        "What won:", "- [result]", "",
        "What we ship next:", "- [next test]", "",
        `Full details are on your page: ${PORTAL_URL}`, "", sign);
      break;
    }
    case "invoice": {
      const pay = (p?.payments || []).filter((x) => x.status !== "paid")
        .sort((a, b) => (a.status === "owed" ? -1 : 0) - (b.status === "owed" ? -1 : 0) || (a.due || "9").localeCompare(b.due || "9"))[0];
      const label = pay?.label || "next invoice";
      subject = `Invoice reminder: ${label}`;
      const amount = pay ? ` (${money(pay.amount, pay.currency)})` : "";
      const when = pay?.due ? (daysFromToday(pay.due) < 0 ? `was due on ${longDate(pay.due)}` : `is due on ${longDate(pay.due)}`) : "is now due";
      L.push(hi, "", `Just a gentle reminder that the ${label.toLowerCase()} for ${project}${amount} ${when}.`, "",
        "If it is already on its way, thank you, and please ignore this.", "", sign);
      break;
    }
    case "follow_up": {
      subject = `Quick nudge on ${project}`;
      const open = openTasks(pv);
      L.push(hi, "");
      if (open.length === 1) L.push(`Just a gentle nudge on one thing: ${open[0].title.charAt(0).toLowerCase() + open[0].title.slice(1)}.`);
      else if (open.length > 1) L.push("Just a gentle nudge on a couple of things I need from you:", ...taskLines(pv));
      else L.push("Just a gentle nudge on [what you need from them].");
      L.push("", `Once that is in, I can carry on${st ? ` with ${st.name.toLowerCase()}` : ""}.`, "",
        "No rush if you are busy, and tell me if anything is unclear.", "", sign);
      break;
    }
  }
  return { subject: clean(subject), body: clean(L.join("\n")) };
}

/** True if the text contains a long dash (the app warns before approval). */
export function hasLongDash(text: string) {
  return /[\u2013\u2014]/.test(text);
}
