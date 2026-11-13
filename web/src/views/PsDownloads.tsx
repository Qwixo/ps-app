// PS download buttons on the website (Settings), for account holders only: the developer and the people he
// invited ("red" and "owner"), never a client. Reads the release file ps-dist writes at every
// release (/client/ps/release.json) and shows nothing until it exists. Not in PS itself.
import { useEffect, useState } from "react";
import { accountKind } from "../core/account";
import { Icon, useVault } from "../ui/kit";

interface Build { url: string; size?: number }
interface Release { name?: string; version?: string; keyword?: string; mac?: Build; gos?: Build }

const NATIVE = import.meta.env.MODE === "ps" || import.meta.env.MODE === "gos";
const SITE = "https://cincee.com"; // install help pages live on the main site

export function PsDownloads() {
  const kind = accountKind(useVault());
  const show = !NATIVE && (kind === "red" || kind === "owner");
  const [rel, setRel] = useState<Release | null>(null);
  useEffect(() => {
    if (!show) return;
    let stop = false;
    fetch(`${import.meta.env.BASE_URL}ps/release.json`, { cache: "no-store", credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Release | null) => { if (!stop && j && (j.mac?.url || j.gos?.url)) setRel(j); })
      .catch(() => { /* no release yet: show nothing */ });
    return () => { stop = true; };
  }, [show]);
  if (!show || !rel) return null;
  const name = rel.name || (rel.version ? `V${rel.version}` : "");
  const mb = (b?: number) => (b ? ` · ${Math.round(b / 1048576)} MB` : "");
  return (
    <section className="panel stack" aria-labelledby="psdl-h">
      <h2 className="h2" id="psdl-h">PS app on your devices</h2>
      <p className="small muted">Your list on your Mac and your phone, with the same account and the same end to end encryption.</p>
      <div className="row wrap-ok">
        {rel.mac?.url && <a className="btn primary" href={new URL(rel.mac.url, SITE).href} download><Icon name="down" /> Download for Mac{mb(rel.mac.size)}</a>}
        {rel.gos?.url && <a className="btn ghost" href={new URL(rel.gos.url, SITE).href} download><Icon name="down" /> Download for GrapheneOS{mb(rel.gos.size)}</a>}
      </div>
      <p className="small muted">
        {name && <>{name}{rel.keyword ? ` · ${rel.keyword}` : ""}. </>}
        Install help: <a href={`${SITE}/ps-app-mac/`} target="_blank" rel="noopener noreferrer">Mac</a>, <a href={`${SITE}/ps-app-gos/`} target="_blank" rel="noopener noreferrer">GrapheneOS</a>.
      </p>
    </section>
  );
}
