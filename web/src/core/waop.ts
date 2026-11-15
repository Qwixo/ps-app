// What the Tab list (a window with no session) hands to the main PS window for WhatsApp, checked field by field (it crosses
// from another page). Only the person's own click in the panel produces one: Send after its Undo, a template, or Done.
export type WaOp = { op: "send"; chatId: string; text: string } | { op: "template"; chatId: string; name: string; language: string } | { op: "done"; chatId: string };
const ID = /^[\w-]{8,40}$/;
export function cleanWaOp(v: unknown): WaOp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.chatId !== "string" || !ID.test(o.chatId)) return null;
  if (o.op === "done") return { op: "done", chatId: o.chatId };
  if (o.op === "send") return typeof o.text === "string" && o.text.trim() && o.text.length <= 4096 ? { op: "send", chatId: o.chatId, text: o.text } : null;
  if (o.op === "template") return typeof o.name === "string" && o.name && o.name.length <= 512 && typeof o.language === "string" && o.language && o.language.length <= 20 ? { op: "template", chatId: o.chatId, name: o.name, language: o.language } : null;
  return null;
}
