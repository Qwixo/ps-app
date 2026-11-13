// Documents attached to a project (the real proposal PDF, the signed agreement).
// Decrypted only in this browser, shown in a viewer, never stored unencrypted.
import { useEffect, useState } from "react";
import type { Doc, ProjectDoc } from "../core/model";
import { attachDoc, removeDoc } from "../core/actions";
import { getBlob } from "../core/vault";
import { Icon, Modal, fmtDateTime, toast, useVault } from "../ui/kit";

export function projectDocs(all: Map<string, Doc>, projectId: string): Doc<ProjectDoc>[] {
  return [...all.values()].filter((d) => d.kind === "doc" && (d.data as ProjectDoc).projectId === projectId)
    .sort((a, b) => ((a.data as ProjectDoc).docKind === "agreement" ? -1 : 0) - ((b.data as ProjectDoc).docKind === "agreement" ? -1 : 0)) as Doc<ProjectDoc>[];
}

function useObjectUrl(d: Doc<ProjectDoc> | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!d) return;
    let u: string | null = null;
    let live = true;
    setUrl(null); setErr("");
    getBlob(d.data.blobId, d.ws).then((bytes) => {
      if (!live) return;
      u = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: d.data.mime || "application/pdf" }));
      setUrl(u);
    }).catch((e) => live && setErr(String((e as Error).message || e)));
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [d?.id]);
  return { url, err };
}

export function DocViewer({ d, onClose }: { d: Doc<ProjectDoc>; onClose: () => void }) {
  const { url, err } = useObjectUrl(d);
  return (
    <Modal title={d.data.label || d.data.name} onClose={onClose} wide>
      {err ? <p className="err">{err}</p> : !url ? (
        <div className="empty"><span className="dot-live" style={{ display: "inline-block", marginRight: 10 }} />Decrypting the document...</div>
      ) : (
        <div className="stack">
          <iframe title={d.data.label || d.data.name} src={url} style={{ width: "100%", height: "72dvh", border: "1px solid var(--line)", borderRadius: 12, background: "#fff" }} />
          <div className="row wrap-ok">
            <a className="btn ghost sm" href={url} target="_blank" rel="noopener noreferrer"><Icon name="eye" size={15} /> Open full screen</a>
            <a className="btn quiet sm" href={url} download={d.data.name}>Download</a>
            <span className="hint">Decrypted on this device only.</span>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** List of a project's documents. owner=true adds "Attach PDF" and remove. */
export function ProjectDocs({ projectId, owner, compact }: { projectId: string; owner?: boolean; compact?: boolean }) {
  const s = useVault();
  const list = projectDocs(s.docs, projectId);
  const [open, setOpen] = useState<Doc<ProjectDoc> | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) { toast("That file is over 12 MB. Export a smaller PDF."); return; }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const isAgreement = /agree|sign/i.test(f.name);
      await attachDoc(projectId, { bytes, name: f.name, mime: f.type || "application/pdf" }, isAgreement ? "Signed agreement" : "Proposal", isAgreement ? "agreement" : "proposal");
      toast("Attached and encrypted");
    } catch (e) {
      toast(String((e as Error).message || e), undefined, 8000);
    } finally { setBusy(false); }
  }

  if (!list.length && !owner) return null;
  return (
    <div className="stack tight">
      {list.map((d) => (
        <div key={d.id} className="row between wrap-ok" style={{ padding: compact ? "8px 10px" : "12px 14px", border: "1px solid var(--line)", borderRadius: 12, background: "var(--raise)" }}>
          <div className="row" style={{ minWidth: 0 }}>
            <span style={{ width: 34, height: 40, borderRadius: 6, background: "linear-gradient(135deg, var(--pink), var(--pink-d))", color: "#fff", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 800, flex: "none" }}>PDF</span>
            <div className="stack" style={{ gap: 0, minWidth: 0 }}>
              <b className="trunc">{d.data.label}</b>
              <span className="xs muted trunc">{d.data.name} · {(d.data.size / 1048576).toFixed(1)} MB{owner ? ` · added ${fmtDateTime(d.data.addedAt)}` : ""}</span>
            </div>
          </div>
          <div className="row">
            <button className="btn primary sm" onClick={() => setOpen(d)}><Icon name="eye" size={15} /> View</button>
            {owner && <button className="btn quiet icon sm" aria-label="Remove document" onClick={() => { if (confirm("Remove this document? The encrypted copy is deleted.")) void removeDoc(d.id); }}><Icon name="trash" size={15} /></button>}
          </div>
        </div>
      ))}
      {owner && (
        <label className="btn ghost sm" style={{ justifySelf: "start", cursor: busy ? "wait" : "pointer" }}>
          <Icon name="plus" size={15} /> {busy ? "Encrypting..." : "Attach proposal or agreement PDF"}
          <input type="file" accept="application/pdf" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      )}
      {open && <DocViewer d={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
