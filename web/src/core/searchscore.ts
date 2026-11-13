// The settings search's word matching (shared by Settings, core/settingsindex.ts, and Sleep mode's own settings,
// core/sleepsettings.ts). Pure.
const STOP = new Set(["the", "a", "an", "my", "to", "of", "and", "in", "for", "is", "it", "how", "do", "i", "me", "settings", "setting"]);
/** Lower case, letters and digits only, one space between words. */
export const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9/.]+/g, " ").replace(/\s+/g, " ").trim();
/** A plain stem, so "sounds", "colours" and "resetting" find "sound", "colour" and "reset". */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("es") && !w.endsWith("ses")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
export const tokensOf = (q: string) => norm(q).split(" ").filter((t) => t && !STOP.has(t));
/** How well one typed word matches one field: a word in it that starts with the typed word (or its stem). */
function wordHit(t: string, field: string): number {
  if (!field) return 0;
  const words = field.split(" ");
  const st = stem(t);
  let best = 0;
  for (const w of words) {
    if (w === t || stem(w) === st) best = Math.max(best, 1);
    else if (w.startsWith(t) || (st.length >= 3 && w.startsWith(st))) best = Math.max(best, 0.8);
    else if (t.length >= 4 && w.includes(t)) best = Math.max(best, 0.5);
  }
  return best;
}
/** One setting's score for the typed words (all must match somewhere), 0 when it does not match. Fields are already
 *  normalised (norm). */
export function scoreOne(toks: string[], whole: string, f: { name: string; line: string; words: string[]; group: string }): number {
  let score = 0;
  for (const t of toks) {
    const s = Math.max(wordHit(t, f.name) * 3, Math.max(0, ...f.words.map((w) => wordHit(t, w))) * 2.2, wordHit(t, f.line) * 1, wordHit(t, f.group) * 0.6);
    if (s === 0) return 0;
    score += s;
  }
  if (f.name === whole) score += 4;
  else if (f.name.startsWith(whole)) score += 2;
  else if (f.words.includes(whole)) score += 1.5;
  return score;
}
