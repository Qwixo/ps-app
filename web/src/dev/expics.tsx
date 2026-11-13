// DEV ONLY (/client/dev-expics): every exercise picture at once, to check poses and colours in each look.
// Query: ?k=0.5 (a frame mid rep) &style=volt|chalk|pulse &theme=light|dark &mode=still|play|start|end &size=120 &q=curl &names=a,b (free text names)
import { useMemo } from "react";
import { LIBRARY } from "../fitness/library";
import { ExPic, PicArt } from "../fitness/ExPic";
import { picFor } from "../fitness/pics";
import "../fitness/fitness.css";

export default function ExPicsDev() {
  const q = new URLSearchParams(location.search);
  const style = q.get("style") ?? "volt";
  const theme = q.get("theme") ?? (style === "chalk" ? "light" : "dark");
  const mode = (q.get("mode") ?? "still") as "still" | "play" | "start" | "end";
  const size = Number(q.get("size") ?? 120);
  const k = q.get("k") == null ? undefined : Number(q.get("k"));
  const f = (q.get("q") ?? "").toLowerCase();
  const names = (q.get("names") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = useMemo(() => LIBRARY.filter((x) => !f || x.name.toLowerCase().includes(f) || x.id.includes(f)), [f]);
  return (
    <div className="fit" data-fit-style={style} data-fit-theme={theme} style={{ minHeight: "100vh", padding: 12, boxSizing: "border-box" }}>
      {names.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 16 }}>
          {names.map((n) => {
            const p = picFor(null, n);
            return (
              <div key={n} style={{ width: size + 40, fontSize: 11 }}>
                <ExPic name={n} size={size} />
                <div><b>{n}</b></div><div style={{ opacity: .7 }}>{p ? `${p.how}: ${p.exercise.name}` : "placeholder"}</div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${size + 8}px, 1fr))`, gap: 8 }}>
        {list.map((x) => (
          <div key={x.id} style={{ fontSize: 10, lineHeight: 1.2 }}>
            <div className="xp-thumb" style={{ width: size, height: size * 0.9 }}><PicArt pic={picFor(x.id, x.name)} mode={mode} at={k} /></div>
            <div style={{ marginTop: 2 }}>{x.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
