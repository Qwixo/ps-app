// "Copy for your AI" (core/mailaiprompt.ts): one button that puts the whole Gmail connect prompt on the clipboard. Used in
// Settings, Client emails and in the email panel when Gmail is not connected yet.
import { useEffect, useState } from "react";
import { AI_COPY_WORDS, mailAiPrompt } from "../core/mailaiprompt";
import { validRef } from "../core/mailsetup";
import { activeProject } from "../core/project";
import { toast } from "../ui/kit";

/** The person's own project ref, or null when PS does not know it yet. */
export const ownRef = (): string | null => { const r = activeProject()?.ref ?? null; return validRef(r) ? r : null; };

export function useCopyForAi() {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = window.setTimeout(() => setCopied(false), 6000); return () => clearTimeout(t); }, [copied]);
  const copy = () => {
    const text = mailAiPrompt(ownRef());
    const fail = () => toast(AI_COPY_WORDS.failed);
    try { navigator.clipboard.writeText(text).then(() => setCopied(true), fail); } catch { fail(); }
  };
  return { copied, copy };
}

export function CopyForAiButton({ className = "btn", onCopied }: { className?: string; onCopied?: () => void }) {
  const { copied, copy } = useCopyForAi();
  return (
    <>
      <button type="button" className={className} onClick={() => { copy(); onCopied?.(); }}>{AI_COPY_WORDS.button}</button>
      {copied && <span className="small muted ce-copied" role="status">{AI_COPY_WORDS.done}</span>}
    </>
  );
}
