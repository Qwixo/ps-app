// G Squad (V1.40): does a task name one of your clients? Matching runs only on your own device, against the
// client names in your own vault; the names are never sent anywhere. A task that names a client goes to the squad
// with a neutral title ("Client task") unless you chose to show the name; your own screen keeps the real title.
// When nobody has answered "Anonymise this task?" yet, the squad copy is anonymised (it fails closed, client NDAs).
import type { ClientRec, Todo } from "./model.ts";

export const NEUTRAL_TITLE = "Client task";

/** Lower case, accents off, anything that is not a letter or digit becomes a space. */
export function foldWords(s: string): string {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

// Words that say what kind of business it is, never which one ("Studio", "Ltd"): alone they never count as a match.
const GENERIC = new Set(("ltd llc inc co corp company limited gmbh plc sa srl studio studios center centre science natural " +
  "organics organic cosmetics beauty shop store group agency media digital the and of for club labs lab design designs " +
  "brand brands boutique collective sheet metal powder coatings coating services service solutions online official " +
  "mood up new world home health care skin hair body fashion clothing apparel jewelry jewellery").split(" "));

export interface ClientTerm { client: string; term: string }

/** Every phrase that points at a client: the whole name, its distinctive words (4+ letters, not generic), the
 *  contact's and greeting names, and anything in brackets. Shortest terms last so a full name wins. */
export function clientTerms(clients: Pick<ClientRec, "name" | "contactName" | "greetingName" | "archived">[]): ClientTerm[] {
  const out: ClientTerm[] = [];
  const seen = new Set<string>();
  const add = (client: string, raw: string | null | undefined, minWord = 4) => {
    const f = foldWords(raw || "");
    if (!f) return;
    const push = (t: string) => { const k = `${client}\u0000${t}`; if (!seen.has(k)) { seen.add(k); out.push({ client, term: t }); } };
    if (f.length >= 3 && !GENERIC.has(f)) push(f);
    for (const w of f.split(" ")) if (w.length >= minWord && !GENERIC.has(w) && !/^\d+$/.test(w)) push(w);
  };
  for (const c of clients) {
    if (!c || typeof c.name !== "string") continue;
    const name = c.name.trim();
    add(name, name);
    for (const m of name.matchAll(/\(([^)]+)\)/g)) add(name, m[1]);
    add(name, c.contactName, 3);
    add(name, c.greetingName, 3);
  }
  return out.sort((a, b) => b.term.length - a.term.length);
}

/** The client a title names (whole words only), or null. */
export function namedClient(title: string, terms: ClientTerm[]): string | null {
  const f = ` ${foldWords(title)} `;
  if (f.trim() === "") return null;
  for (const t of terms) if (f.includes(` ${t.term} `)) return t.client;
  return null;
}

/** True when this task names a client: by its words, or because it is linked to a client. */
export function namesClient(t: Pick<Todo, "title" | "clientId" | "notes">, terms: ClientTerm[]): boolean {
  if (t.clientId) return true;
  return namedClient(t.title, terms) !== null;
}

/** What the squad sees as the title, and whether that is the neutral one. */
export function squadTitle(t: Pick<Todo, "title" | "clientId" | "notes" | "sqAnon">, terms: ClientTerm[]): { title: string; anon: boolean } {
  if (namesClient(t, terms) && t.sqAnon !== false) return { title: NEUTRAL_TITLE, anon: true };
  if (t.sqAnon === true) return { title: NEUTRAL_TITLE, anon: true };
  return { title: String(t.title || "").trim().slice(0, 300), anon: false };
}

/** The Add task box asks "Anonymise this task?" only while it is unanswered and the task names a client. */
export function shouldAsk(t: Pick<Todo, "title" | "clientId" | "notes" | "sqAnon">, terms: ClientTerm[]): boolean {
  return t.sqAnon === undefined || t.sqAnon === null ? namesClient(t, terms) : false;
}
