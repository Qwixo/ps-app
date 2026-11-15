// The phone's update card (Settings, About and updates), the parts that are plain rules (PS 1.60, phone fixes).
// The release notes arrive as one string, one point per line. They used to be glued behind the size ("12 MB · a · b"),
// which ran every point together in a thin column. The card now shows them as a list, one point per line, full width,
// with the size on its own line and the button underneath. The words themselves are never changed or joined.
//
// Run: node --experimental-strip-types tests/updatecard.test.ts

/** One point per line: split on new lines, drop a leading bullet or dash, drop empties, no long dashes. */
export function noteLines(notes: unknown): string[] {
  if (typeof notes !== "string") return [];
  return notes.split(/\r?\n/)
    .map((n) => n.replace(/^\s*(?:[-*\u2022]\s+)/, "").trim())
    .filter((n) => n && !/[\u2013\u2014<>]/.test(n));
}

/** "12 MB" for a size in bytes; "" for none. Under 10 MB one decimal. */
export function sizeText(bytes?: number): string {
  return bytes && bytes > 0 ? `${(bytes / 1048576).toFixed(bytes > 10 * 1048576 ? 0 : 1)} MB` : "";
}

export type CardShape = { notes: string[]; size: string; wide: boolean };

/** What the card lays out for an update that waits. `blocks` is how many versions the update spans: with several, the
 *  grouped list (NoteGroups) shows the notes, so the card's own list stays empty. The button is always full width. */
export function cardShape(state: string, notes: unknown, size: number | undefined, blocks: number): CardShape {
  const avail = state === "available";
  return { notes: avail && blocks <= 1 ? noteLines(notes) : [], size: avail ? sizeText(size) : "", wide: avail || state === "ready" };
}
