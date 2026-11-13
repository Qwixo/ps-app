// Small stage illustrations for the client page. Inline SVG drawn only with the design
// tokens (classes in portal.css), so they follow light and dark mode and any card that
// re-scopes the tokens. Motion is CSS only and switches off with prefers-reduced-motion.
import type { CSSProperties, ReactNode } from "react";
import type { ProjectType } from "../../core/model";
import "../portal.css";

export type ArtName =
  | "notif" | "call" | "research" | "directions" | "pick" | "refine" | "build" | "test" | "live"
  | "onboard" | "baseline" | "funnel" | "ab" | "report"
  | "brief" | "modules" | "review" | "upload" | "amazon" | "listing" | "structure"
  | "edit" | "final" | "work" | "done";

// ---------- primitives ----------
const d = (n: number) => ({ animationDelay: `${n}s` });

function Browser({ x, y, w, h, hl, children }: { x: number; y: number; w: number; h: number; hl?: boolean; children?: ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={7} className={hl ? "card hl" : "card"} />
      <circle cx={x + 7} cy={y + 6} r={1.7} className="ln2" />
      <circle cx={x + 12.5} cy={y + 6} r={1.7} className="ln2" />
      <circle cx={x + 18} cy={y + 6} r={1.7} className="ln2" />
      <rect x={x + 26} y={y + 3.6} width={Math.max(10, w * 0.42)} height={4.8} rx={2.4} className="sf" />
      <rect x={x} y={y + 11} width={w} height={0.8} className="ln" />
      {children}
    </g>
  );
}
function Lines({ x, y, w, n = 2, gap = 6, h = 3.2 }: { x: number; y: number; w: number; n?: number; gap?: number; h?: number }) {
  return <>{Array.from({ length: n }, (_, i) => <rect key={i} x={x} y={y + i * gap} width={i === n - 1 && n > 1 ? w * 0.62 : w} height={h} rx={h / 2} className="ln" />)}</>;
}
function Tick({ cx, cy, r = 7, good, cls = "", style }: { cx: number; cy: number; r?: number; good?: boolean; cls?: string; style?: CSSProperties }) {
  const s = r / 7;
  return (
    <g className={cls} style={style}>
      <circle cx={cx} cy={cy} r={r} className={good ? "gd" : "pk"} />
      <path d={`M${cx - 3.2 * s} ${cy + 0.2 * s} l${2.2 * s} ${2.2 * s} l${4.4 * s} ${-4.6 * s}`} className="st-on" style={{ strokeWidth: 1.9 * s }} />
    </g>
  );
}
function Chip({ x, y, w, text, cls = "card", tcls = "", h = 15 }: { x: number; y: number; w: number; text: string; cls?: string; tcls?: string; h?: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={h / 2} className={cls} />
      <text x={x + w / 2} y={y + h / 2 + 2.6} fontSize={7.2} textAnchor="middle" className={tcls}>{text}</text>
    </g>
  );
}
function Hero({ x, y, w, h, o = 1 }: { x: number; y: number; w: number; h: number; o?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={4} className="hero" style={{ opacity: o }} />;
}
function Person({ cx, cy, cls }: { cx: number; cy: number; cls: string }) {
  return (
    <g className={cls}>
      <circle cx={cx} cy={cy - 6} r={7} />
      <path d={`M${cx - 14} ${cy + 16} a14 12 0 0 1 28 0 z`} />
    </g>
  );
}

// ---------- the drawings (viewBox 240 x 150) ----------
const ARTS: Record<ArtName, () => ReactNode> = {
  notif: () => (
    <g>
      <g className="a-float">
        <rect x={78} y={10} width={84} height={136} rx={14} className="card" />
        <rect x={104} y={15} width={32} height={6} rx={3} className="ink" />
        <Hero x={86} y={58} w={68} h={30} o={0.55} />
        <Lines x={86} y={96} w={60} n={3} />
        <rect x={86} y={118} width={40} height={9} rx={4.5} className="ink" />
      </g>
      <g className="a-drop">
        <rect x={58} y={26} width={124} height={30} rx={9} className="card shadow" />
        <rect x={64} y={32} width={18} height={18} rx={5} className="pk" />
        <text x={73} y={44} fontSize={9} textAnchor="middle" className="tw">C</text>
        <text x={88} y={38} fontSize={6.2} className="mutT">CINCEE</text>
        <text x={88} y={48} fontSize={7.4}>Your free redesign is ready</text>
      </g>
    </g>
  ),
  call: () => (
    <g>
      <Browser x={22} y={20} w={196} h={112}>
        <rect x={30} y={38} width={88} height={68} rx={6} className="sf" />
        <Person cx={74} cy={72} cls="ln2" />
        <text x={36} y={101} fontSize={7} className="mutT">You</text>
        <rect x={122} y={38} width={88} height={68} rx={6} className="pk" style={{ opacity: 0.88 }} />
        <Person cx={166} cy={72} cls="onpk" />
        <text x={128} y={101} fontSize={7} className="tw">Owner</text>
        <circle cx={106} cy={119} r={4.5} className="ln2" />
        <circle cx={120} cy={119} r={4.5} className="ln2" />
        <circle cx={134} cy={119} r={4.5} className="bd" />
      </Browser>
      <g className="a-pop" style={d(0)}>
        <rect x={6} y={6} width={104} height={20} rx={10} className="card shadow" />
        <text x={58} y={19} fontSize={7.4} textAnchor="middle">"Can best sellers sit higher?"</text>
      </g>
      <g className="a-pop" style={d(1.2)}>
        <rect x={150} y={124} width={84} height={20} rx={10} className="pk" />
        <text x={192} y={137} fontSize={7.4} textAnchor="middle" className="tw">Yes, easily</text>
      </g>
    </g>
  ),
  research: () => (
    <g>
      <Browser x={12} y={18} w={132} h={114}>
        <text x={20} y={40} fontSize={7.6}>Your store</text>
        {[0, 1, 2].map((c) => [0, 1].map((r) => (
          <g key={`${c}${r}`}>
            <rect x={20 + c * 40} y={47 + r * 40} width={34} height={24} rx={4} className={(c + r) % 2 ? "sf" : "ln"} />
            <rect x={20 + c * 40} y={74 + r * 40} width={26} height={3} rx={1.5} className="ln" />
          </g>
        )))}
      </Browser>
      <g className="a-tab" style={d(0.2)}>
        <rect x={152} y={24} width={78} height={44} rx={7} className="card" />
        <text x={160} y={37} fontSize={7}>Competitor A</text>
        <circle cx={162} cy={48} r={2.5} className="pk" />
        <rect x={168} y={46.5} width={52} height={3.2} rx={1.6} className="ln" />
        <rect x={160} y={56} width={44} height={3.2} rx={1.6} className="ln" />
      </g>
      <g className="a-tab" style={d(0.6)}>
        <rect x={152} y={76} width={78} height={44} rx={7} className="card" />
        <text x={160} y={89} fontSize={7}>Competitor B</text>
        <circle cx={162} cy={100} r={2.5} className="pk" />
        <rect x={168} y={98.5} width={46} height={3.2} rx={1.6} className="ln" />
        <rect x={160} y={108} width={52} height={3.2} rx={1.6} className="ln" />
      </g>
      <g className="a-scan">
        <circle cx={58} cy={70} r={17} className="glass" />
        <circle cx={58} cy={70} r={17} className="st-pk" style={{ strokeWidth: 4 }} />
        <path d="M70 82 l13 13" className="st-pk" style={{ strokeWidth: 6 }} />
      </g>
      <Chip x={152} y={128} w={78} text="Keep what fits" cls="sf" tcls="pkT" />
    </g>
  ),
  directions: () => (
    <g>
      {[[-1, "A", 0.35], [1, "C", 0.75], [0, "B", 0.55]].map(([k, l, o]) => {
        const kk = k as number;
        return (
          <g key={l as string} transform={`translate(${120 + kk * 58} ${78 + Math.abs(kk) * 6}) rotate(${kk * 9})`}>
            <g className="a-float" style={d(Math.abs(kk) * 0.7 + (kk > 0 ? 0.4 : 0))}>
              <Browser x={-46} y={-38} w={92} h={74} hl={kk === 0}>
                <Hero x={-40} y={-21} w={80} h={kk === 0 ? 28 : 22} o={o as number} />
                <Lines x={-40} y={kk === 0 ? 12 : 6} w={60} n={2} />
                <rect x={-40} y={kk === 0 ? 24 : 20} width={26} height={7} rx={3.5} className="ink" />
              </Browser>
              <circle cx={kk > 0 ? 40 : -40} cy={-44} r={8} className={kk === 0 ? "pk" : "ink"} />
              <text x={kk > 0 ? 40 : -40} y={-41.2} fontSize={8} textAnchor="middle" className={kk === 0 ? "tw" : "inv"}>{l as string}</text>
            </g>
          </g>
        );
      })}
    </g>
  ),
  pick: () => (
    <g>
      {[0, 1, 2].map((i) => {
        const hl = i === 1;
        const x = 14 + i * 76;
        return (
          <g key={i} className={hl ? "a-lift" : ""} style={{ opacity: hl ? 1 : 0.5 }}>
            <Browser x={x} y={hl ? 30 : 40} w={60} h={hl ? 66 : 56} hl={hl}>
              <Hero x={x + 5} y={(hl ? 30 : 40) + 16} w={50} h={hl ? 22 : 18} o={0.3 + i * 0.25} />
              <Lines x={x + 5} y={(hl ? 30 : 40) + (hl ? 44 : 40)} w={40} n={2} gap={5} h={2.8} />
            </Browser>
          </g>
        );
      })}
      <Tick cx={150} cy={30} r={9} good cls="a-stamp" />
      <g className="a-pop" style={d(0.4)}>
        <rect x={84} y={112} width={72} height={18} rx={9} className="pk" />
        <text x={120} y={123.6} fontSize={7.6} textAnchor="middle" className="tw">Your pick</text>
      </g>
    </g>
  ),
  refine: () => (
    <g>
      <Browser x={12} y={14} w={140} h={104}>
        <Hero x={20} y={32} w={124} h={36} o={0.6} />
        <rect x={20} y={74} width={38} height={22} rx={4} className="sf" />
        <rect x={63} y={74} width={38} height={22} rx={4} className="ln" />
        <rect x={106} y={74} width={38} height={22} rx={4} className="sf" />
        <Lines x={20} y={102} w={90} n={2} gap={6} h={3} />
      </Browser>
      <rect x={160} y={20} width={70} height={84} rx={8} className="card" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <text x={168} y={36 + i * 24} fontSize={6.4} className="mutT">{["Spacing", "Type size", "Colour"][i]}</text>
          <rect x={168} y={41 + i * 24} width={54} height={3.4} rx={1.7} className="ln" />
          <rect x={168} y={41 + i * 24} width={30} height={3.4} rx={1.7} className="pk a-fill" style={d(i * 0.7)} />
          <circle cx={198} cy={42.7 + i * 24} r={4.6} className="card knob a-knob" style={d(i * 0.7)} />
        </g>
      ))}
      <g className="a-pop" style={d(0.3)}>
        <rect x={52} y={126} width={112} height={18} rx={9} className="sf" />
        <path d="M66 135 a3 3 0 0 1 3-3 h3 M74 135 a3 3 0 0 1 -3 3 h-3" className="st-pk" style={{ strokeWidth: 1.6 }} />
        <text x={116} y={137.6} fontSize={7.4} textAnchor="middle" className="pkT">Preview link, fresh</text>
      </g>
    </g>
  ),
  build: () => (
    <g>
      <rect x={18} y={8} width={204} height={110} rx={10} className="card" />
      <text x={28} y={23} fontSize={7.6}>Themes</text>
      <g>
        <rect x={28} y={29} width={184} height={28} rx={6} className="soft2" />
        <rect x={33} y={34} width={24} height={18} rx={3} className="ln2" />
        <text x={63} y={41.5} fontSize={7}>Current theme</text>
        <text x={63} y={50.5} fontSize={6} className="mutT">Customers shopping as normal</text>
        <rect x={180} y={37} width={26} height={12} rx={6} className="gdb" />
        <text x={193} y={45.4} fontSize={6.4} textAnchor="middle" className="gdT">Live</text>
      </g>
      <path d="M120 60 v8 m-4 -4 l4 4 4 -4" className="st-pk" style={{ strokeWidth: 1.8 }} />
      <text x={130} y={67} fontSize={6.2} className="pkT">Duplicate</text>
      <g className="a-copy">
        <rect x={28} y={73} width={184} height={28} rx={6} className="card hl" />
        <rect x={33} y={78} width={24} height={18} rx={3} className="hero" />
        <text x={63} y={85.5} fontSize={7}>Your new design</text>
        <text x={63} y={94.5} fontSize={6} className="mutT">Copy, being built</text>
        <rect x={180} y={81} width={26} height={12} rx={6} className="sf" />
        <text x={193} y={89.4} fontSize={6.4} textAnchor="middle" className="pkT">Draft</text>
      </g>
      <g className="a-pop" style={d(0.6)}>
        <rect x={56} y={124} width={128} height={20} rx={10} className="ink" />
        <path d="M71 129 l5 2 v4 c0 3 -2.5 5 -5 6 c-2.5 -1 -5 -3 -5 -6 v-4 z" className="gd" />
        <text x={126} y={137.4} fontSize={7.4} textAnchor="middle" className="inv">Live store untouched</text>
      </g>
    </g>
  ),
  test: () => (
    <g>
      <Browser x={14} y={8} w={142} h={90}>
        <Hero x={22} y={26} w={126} h={30} o={0.55} />
        <rect x={22} y={62} width={38} height={18} rx={3} className="sf" />
        <rect x={66} y={62} width={38} height={18} rx={3} className="ln" />
        <rect x={110} y={62} width={38} height={18} rx={3} className="sf" />
      </Browser>
      <rect x={164} y={14} width={52} height={92} rx={10} className="card" />
      <rect x={180} y={18} width={20} height={4} rx={2} className="ink" />
      <Hero x={170} y={30} w={40} h={24} o={0.55} />
      <Lines x={170} y={60} w={34} n={3} gap={6} h={3} />
      <rect x={170} y={84} width={40} height={10} rx={5} className="ink" />
      <Tick cx={150} cy={14} r={8} good cls="a-stamp" />
      <Tick cx={212} cy={20} r={8} good cls="a-stamp" style={d(0.3)} />
      <rect x={34} y={121} width={172} height={2.4} rx={1.2} className="ln" />
      {["Home", "Product", "Cart", "Checkout"].map((t, i) => (
        <g key={t}>
          <circle cx={34 + i * 57.3} cy={122} r={7} className="card" />
          <Tick cx={34 + i * 57.3} cy={122} r={7} good cls="a-seq" style={d(i * 0.45)} />
          <text x={34 + i * 57.3} y={141} fontSize={7} textAnchor="middle">{t}</text>
        </g>
      ))}
    </g>
  ),
  live: () => (
    <g>
      <Browser x={22} y={36} w={150} h={98}>
        <Hero x={30} y={54} w={134} h={36} o={0.7} />
        <rect x={30} y={96} width={40} height={24} rx={4} className="sf" />
        <rect x={77} y={96} width={40} height={24} rx={4} className="ln" />
        <rect x={124} y={96} width={40} height={24} rx={4} className="sf" />
      </Browser>
      <g className="a-drop">
        <rect x={10} y={8} width={124} height={22} rx={11} className="ink" />
        <circle cx={23} cy={19} r={3.6} className="gd a-blink" />
        <text x={76} y={21.8} fontSize={7.6} textAnchor="middle" className="inv">Your new store is live</text>
      </g>
      <g className="a-rocket">
        <path d="M200 30 c10 8 12 26 6 42 h-12 c-6 -16 -4 -34 6 -42 z" className="card" />
        <circle cx={200} cy={50} r={4.2} className="pk" />
        <path d="M194 62 l-8 10 l9 -2 z M206 62 l8 10 l-9 -2 z" className="pk" />
        <path d="M196 74 h8 l-4 12 z" className="wn a-flame" />
      </g>
      <g className="a-pop" style={d(0.8)}>
        <rect x={130} y={118} width={100} height={22} rx={11} className="card shadow" />
        <Tick cx={142} cy={129} r={6} good />
        <text x={186} y={131.6} fontSize={7.2} textAnchor="middle">Old theme saved</text>
      </g>
      <circle cx={226} cy={22} r={2.4} className="pk a-spark" />
      <circle cx={176} cy={18} r={1.8} className="wn a-spark" style={d(0.6)} />
      <circle cx={228} cy={92} r={2} className="gd a-spark" style={d(1.1)} />
    </g>
  ),
  onboard: () => (
    <g>
      <rect x={34} y={12} width={172} height={124} rx={12} className="card" />
      <text x={46} y={30} fontSize={8}>Setting up</text>
      {["Store access", "Analytics connected", "Goals agreed"].map((t, i) => (
        <g key={t}>
          <rect x={46} y={40 + i * 30} width={148} height={24} rx={7} className="soft2" />
          <text x={56} y={55 + i * 30} fontSize={7.4}>{t}</text>
          <rect x={164} y={46 + i * 30} width={22} height={12} rx={6} className="ln2" />
          <circle cx={170} cy={52 + i * 30} r={4.4} className="knobW" />
          <g className="a-toggle" style={d(i * 0.6)}>
            <rect x={164} y={46 + i * 30} width={22} height={12} rx={6} className="pk" />
            <circle cx={180} cy={52 + i * 30} r={4.4} className="knobW" />
          </g>
        </g>
      ))}
    </g>
  ),
  baseline: () => (
    <g>
      <rect x={12} y={10} width={216} height={128} rx={12} className="card" />
      <text x={24} y={28} fontSize={7.6}>Conversion today</text>
      {[0, 1, 2, 3].map((i) => <rect key={i} x={24} y={44 + i * 22} width={192} height={0.8} className="ln" />)}
      <path d="M24 86 h192" className="st-dash" />
      <path d="M24 104 C44 96 54 108 72 94 S100 70 118 84 S150 92 164 74 S196 62 214 56" className="st-pk a-draw" style={{ strokeWidth: 2.8 }} />
      <circle cx={214} cy={56} r={4.5} className="pk a-blink" />
      <rect x={140} y={18} width={76} height={16} rx={8} className="sf" />
      <text x={178} y={28.6} fontSize={6.8} textAnchor="middle" className="pkT">Baseline set</text>
      {["Wk 1", "Wk 2", "Wk 3", "Wk 4"].map((t, i) => <text key={t} x={30 + i * 58} y={130} fontSize={6.2} className="mutT">{t}</text>)}
    </g>
  ),
  funnel: () => (
    <g>
      {[["Visit", 196], ["Product", 150], ["Cart", 92], ["Checkout", 56]].map(([t, w], i) => (
        <g key={t as string}>
          <rect x={120 - (w as number) / 2} y={14 + i * 30} width={w as number} height={22} rx={6} className={i === 2 ? "pk a-grow c" : "sf a-grow c"} style={{ ...d(i * 0.25), opacity: i === 2 ? 0.92 : 1 }} />
          <text x={120} y={28.4 + i * 30} fontSize={7.6} textAnchor="middle" className={i === 2 ? "tw" : ""}>{t as string}</text>
        </g>
      ))}
      <g className="a-pop" style={d(1)}>
        <path d="M168 75 l12 -6" className="st-pk" style={{ strokeWidth: 1.6 }} />
        <rect x={176} y={58} width={58} height={18} rx={9} className="ink" />
        <text x={205} y={69.6} fontSize={6.8} textAnchor="middle" className="inv">Most leave here</text>
      </g>
    </g>
  ),
  ab: () => (
    <g>
      <rect x={60} y={8} width={120} height={8} rx={4} className="ln" />
      <rect x={60} y={8} width={60} height={8} rx={4} className="ink" style={{ opacity: 0.55 }} />
      <rect x={120} y={8} width={60} height={8} rx={4} className="pk" />
      <text x={120} y={30} fontSize={6.8} textAnchor="middle" className="mutT">Half your visitors see each</text>
      <path d="M120 34 v6 M120 40 C120 48 66 44 66 52 M120 40 C120 48 174 44 174 52" className="st-flow" />
      {[0, 1].map((i) => {
        const x = 20 + i * 108;
        const win = i === 1;
        return (
          <g key={i}>
            <rect x={x} y={56} width={92} height={80} rx={8} className={win ? "card hl" : "card"} />
            <text x={x + 9} y={70} fontSize={8}>{win ? "B" : "A"}</text>
            {win && <><text x={x + 22} y={70} fontSize={6} className="pkT">★★★★★</text></>}
            <Hero x={x + 8} y={76} w={76} h={22} o={win ? 0.75 : 0.35} />
            <rect x={x + 8} y={104} width={win ? 50 : 34} height={8} rx={4} className={win ? "pk" : "ink"} />
            <rect x={x + 8} y={120} width={76} height={4} rx={2} className="ln" />
            <rect x={x + 8} y={120} width={win ? 64 : 34} height={4} rx={2} className={win ? "pk a-grow" : "ln2 a-grow"} style={d(0.3)} />
          </g>
        );
      })}
      <g className="a-crown">
        <rect x={180} y={48} width={46} height={16} rx={8} className="win" />
        <text x={203} y={58.6} fontSize={6.8} textAnchor="middle" className="tw">Winner</text>
      </g>
    </g>
  ),
  report: () => (
    <g>
      <g className="a-float">
        <g transform="rotate(-3 120 75)">
          <rect x={40} y={10} width={160} height={128} rx={10} className="card shadow" />
          <circle cx={120} cy={12} r={4.5} className="pk" />
          <text x={52} y={34} fontSize={8.4}>Monthly note</text>
          <rect x={52} y={42} width={60} height={3} rx={1.5} className="ln" />
          <rect x={52} y={54} width={34} height={13} rx={6.5} className="gdb" />
          <text x={69} y={62.8} fontSize={6.6} textAnchor="middle" className="gdT">Won</text>
          <rect x={92} y={58.5} width={94} height={3.4} rx={1.7} className="ln" />
          <rect x={52} y={73} width={34} height={13} rx={6.5} className="ln" />
          <text x={69} y={81.8} fontSize={6.6} textAnchor="middle" className="mutT">Lost</text>
          <rect x={92} y={77.5} width={70} height={3.4} rx={1.7} className="ln" />
          <rect x={52} y={92} width={34} height={13} rx={6.5} className="sf" />
          <text x={69} y={100.8} fontSize={6.6} textAnchor="middle" className="pkT">Next</text>
          <rect x={92} y={96.5} width={84} height={3.4} rx={1.7} className="ln" />
          {[10, 16, 13, 22, 28].map((h, i) => <rect key={i} x={140 + i * 9} y={130 - h} width={6} height={h} rx={2} className={i === 4 ? "pk a-grow-y" : "sf a-grow-y"} style={d(i * 0.15)} />)}
        </g>
      </g>
    </g>
  ),
  brief: () => (
    <g>
      <rect x={58} y={14} width={124} height={128} rx={10} className="card" />
      <rect x={96} y={8} width={48} height={14} rx={5} className="ink" />
      {["Products", "Claims", "Brand assets", "Photos"].map((t, i) => (
        <g key={t}>
          <circle cx={78} cy={44 + i * 24} r={7} className="card" />
          <Tick cx={78} cy={44 + i * 24} r={7} cls="a-seq" style={d(i * 0.45)} />
          <text x={92} y={47 + i * 24} fontSize={7.6}>{t}</text>
          <rect x={92} y={51 + i * 24} width={70 - i * 8} height={2.6} rx={1.3} className="ln" />
        </g>
      ))}
    </g>
  ),
  modules: () => (
    <g>
      <g className="a-in" style={d(0)}>
        <rect x={22} y={8} width={196} height={34} rx={6} className="hero" />
        <rect x={32} y={18} width={70} height={5} rx={2.5} className="onpk" />
        <rect x={32} y={28} width={46} height={4} rx={2} className="onpk" style={{ opacity: 0.7 }} />
      </g>
      <g className="a-in" style={d(0.35)}>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x={22 + i * 67} y={48} width={62} height={34} rx={5} className={i === 1 ? "sf" : "card"} />
            <rect x={28 + i * 67} y={86} width={44} height={3} rx={1.5} className="ln" />
          </g>
        ))}
      </g>
      <g className="a-in" style={d(0.7)}>
        <rect x={22} y={98} width={196} height={44} rx={6} className="card" />
        {[0, 1, 2, 3].map((c) => (
          <g key={c}>
            <rect x={60 + c * 40} y={104} width={26} height={8} rx={2} className={c === 0 ? "pk" : "ln"} />
            {[0, 1].map((r) => <Tick key={r} cx={73 + c * 40} cy={122 + r * 11} r={3.6} good={c === 0} />)}
          </g>
        ))}
        <rect x={28} y={120} width={22} height={3} rx={1.5} className="ln" />
        <rect x={28} y={131} width={22} height={3} rx={1.5} className="ln" />
      </g>
    </g>
  ),
  review: () => (
    <g>
      <rect x={44} y={10} width={152} height={130} rx={10} className="card" />
      <Hero x={56} y={22} w={128} h={40} o={0.55} />
      <rect x={56} y={68} width={40} height={30} rx={4} className="sf" />
      <rect x={100} y={68} width={40} height={30} rx={4} className="ln" />
      <rect x={144} y={68} width={40} height={30} rx={4} className="sf" />
      <Lines x={56} y={106} w={110} n={3} gap={7} />
      {[[62, 30], [178, 72], [92, 112]].map(([x, y], i) => (
        <g key={i} className="a-pop" style={d(i * 0.4)}>
          <circle cx={x} cy={y} r={7} className="gd" />
          <text x={x} y={y + 2.6} fontSize={7.4} textAnchor="middle" className="tw">{i + 1}</text>
        </g>
      ))}
      <g className="a-stamp" style={d(1.3)}>
        <g transform="rotate(-8 186 22)">
          <rect x={150} y={10} width={74} height={22} rx={11} className="pk" />
          <path d="M162 21 l3 3 l6 -6" className="st-on" style={{ strokeWidth: 2 }} />
          <text x={196} y={24} fontSize={7.6} textAnchor="middle" className="tw">Approved</text>
        </g>
      </g>
    </g>
  ),
  upload: () => (
    <g>
      <rect x={30} y={60} width={180} height={78} rx={12} className="card" />
      <text x={44} y={80} fontSize={7.6}>Seller Central</text>
      <rect x={44} y={90} width={152} height={8} rx={4} className="ln" />
      <rect x={44} y={90} width={152} height={8} rx={4} className="pk a-load" />
      <text x={44} y={114} fontSize={6.8} className="mutT">A+ modules uploading</text>
      <rect x={44} y={120} width={90} height={3} rx={1.5} className="ln" />
      <g className="a-up">
        <path d="M96 46 a18 18 0 0 1 4 -35 a22 22 0 0 1 42 6 a15 15 0 0 1 2 29 z" className="sf" />
        <path d="M120 44 v-24 m-8 8 l8 -8 8 8" className="st-pk" style={{ strokeWidth: 3 }} />
      </g>
    </g>
  ),
  amazon: () => (
    <g>
      <circle cx={120} cy={66} r={46} className="sf" />
      <circle cx={120} cy={66} r={46} className="st-dashring a-spin" />
      <circle cx={120} cy={66} r={30} className="card" />
      <path d="M120 66 v-16" className="st-ink a-hand" />
      <path d="M120 66 h11" className="st-ink" />
      <circle cx={120} cy={66} r={2.6} className="ink" />
      <Tick cx={150} cy={36} r={10} good cls="a-stamp" style={d(0.8)} />
      <rect x={66} y={122} width={108} height={20} rx={10} className="ink" />
      <text x={120} y={134.6} fontSize={7.4} textAnchor="middle" className="inv">Amazon is reviewing</text>
    </g>
  ),
  listing: () => (
    <g>
      <rect x={12} y={10} width={216} height={130} rx={12} className="card" />
      <rect x={22} y={20} width={70} height={70} rx={8} className="sf" />
      <rect x={42} y={34} width={30} height={42} rx={6} className="hero" />
      <rect x={100} y={24} width={110} height={5} rx={2.5} className="ink" />
      <rect x={100} y={34} width={80} height={4} rx={2} className="ln" />
      <text x={100} y={52} fontSize={9} className="pkT">★★★★★</text>
      <rect x={100} y={60} width={44} height={10} rx={5} className="ink" />
      <g className="a-pop" style={d(0.5)}>
        <rect x={100} y={76} width={82} height={16} rx={8} className="gdb" />
        <text x={141} y={86.6} fontSize={7} textAnchor="middle" className="gdT">A+ content live</text>
      </g>
      <Hero x={22} y={100} w={196} h={30} o={0.55} />
      <rect x={32} y={110} width={60} height={4} rx={2} className="onpk" />
    </g>
  ),
  structure: () => (
    <g>
      <rect x={90} y={10} width={60} height={22} rx={7} className="pk" />
      <text x={120} y={24} fontSize={7.6} textAnchor="middle" className="tw">Home</text>
      <path d="M120 32 v12 M48 44 h144 M48 44 v12 M120 44 v12 M192 44 v12" className="st-line a-draw" />
      {["Best sellers", "Sets", "Gifts"].map((t, i) => (
        <g key={t} className="a-pop" style={d(0.3 + i * 0.25)}>
          <rect x={14 + i * 72} y={56} width={68} height={22} rx={7} className="card" />
          <text x={48 + i * 72} y={70} fontSize={7} textAnchor="middle">{t}</text>
          <rect x={24 + i * 72} y={88} width={48} height={30} rx={5} className="sf" />
          <rect x={24 + i * 72} y={124} width={36} height={3} rx={1.5} className="ln" />
        </g>
      ))}
    </g>
  ),
  edit: () => (
    <g>
      <rect x={40} y={8} width={160} height={84} rx={10} className="ink" />
      <circle cx={120} cy={50} r={16} className="pk" />
      <path d="M115 41 l14 9 l-14 9 z" className="knobW" />
      <rect x={14} y={104} width={212} height={36} rx={8} className="card" />
      {[[20, 46, "sf"], [70, 64, "hero"], [138, 30, "sf"], [172, 48, "ln2"]].map(([x, w, c], i) => (
        <rect key={i} x={x as number} y={112} width={w as number} height={20} rx={4} className={c as string} />
      ))}
      <g className="a-play">
        <rect x={60} y={98} width={2.4} height={46} rx={1.2} className="pk" />
        <circle cx={61.2} cy={98} r={3.8} className="pk" />
      </g>
    </g>
  ),
  final: () => (
    <g>
      <rect x={30} y={12} width={180} height={104} rx={12} className="ink" />
      <circle cx={120} cy={64} r={22} className="pk" />
      <path d="M113 52 l19 12 l-19 12 z" className="knobW" />
      <Tick cx={196} cy={20} r={11} good cls="a-stamp" />
      <g className="a-pop" style={d(0.5)}>
        <rect x={70} y={124} width={100} height={20} rx={10} className="sf" />
        <text x={120} y={136.6} fontSize={7.4} textAnchor="middle" className="pkT">Final delivered</text>
      </g>
    </g>
  ),
  work: () => (
    <g>
      <Browser x={18} y={12} w={204} h={124}>
        {[0, 1, 2, 3, 4].map((i) => (
          <rect key={i} x={30} y={36 + i * 18} width={[150, 120, 170, 96, 136][i]} height={8} rx={4} className={i === 2 ? "pk a-grow" : "sf a-grow"} style={d(i * 0.3)} />
        ))}
      </Browser>
    </g>
  ),
  done: () => (
    <g>
      <g className="a-float">
        <path d="M70 58 l50 -22 l50 22 v52 l-50 22 l-50 -22 z" className="sf" />
        <path d="M70 58 l50 22 l50 -22 M120 80 v52" className="st-line" />
        <path d="M95 47 l50 22" className="st-pk" style={{ strokeWidth: 3 }} />
      </g>
      <Tick cx={170} cy={40} r={13} good cls="a-stamp" />
      <circle cx={50} cy={36} r={2.6} className="pk a-spark" />
      <circle cx={196} cy={100} r={2.2} className="wn a-spark" style={d(0.5)} />
      <circle cx={60} cy={118} r={2} className="gd a-spark" style={d(1)} />
    </g>
  ),
};

// ---------- which drawing for which stage ----------
const BY_TYPE: Partial<Record<ProjectType, Record<string, ArtName>>> = {
  shopify_redesign: { kickoff: "call", research: "research", directions: "directions", pick: "pick", refine: "refine", build: "build", test: "test", live: "live" },
  cro_retainer: { onboard: "onboard", baseline: "baseline", research: "funnel", testing: "ab", report: "report" },
  amazon_a_plus: { brief: "brief", research: "research", design: "modules", review: "review", upload: "upload", amazon: "amazon", live: "listing" },
  amazon_brand_store: { brief: "brief", structure: "structure", design: "modules", review: "review", build: "modules", amazon: "amazon", live: "listing" },
  video: { brief: "brief", edit: "edit", review: "review", final: "final" },
  custom: { kickoff: "call", work: "work", review: "review", done: "done" },
};
const GENERIC: Record<string, ArtName> = {
  kickoff: "call", research: "research", directions: "directions", pick: "pick", refine: "refine", build: "build",
  test: "test", live: "live", onboard: "onboard", baseline: "baseline", testing: "ab", report: "report", brief: "brief",
  design: "modules", review: "review", upload: "upload", amazon: "amazon", structure: "structure", edit: "edit",
  final: "final", work: "work", done: "done",
};
export function artFor(type: ProjectType, key: string): ArtName {
  return BY_TYPE[type]?.[key] ?? GENERIC[key] ?? "work";
}

/** One illustration by name. Decorative: hidden from screen readers. */
export function Art({ name, className = "" }: { name: ArtName; className?: string }) {
  const draw = ARTS[name] ?? ARTS.work;
  return (
    <svg className={`ia ${className}`} viewBox="0 0 240 150" role="presentation" aria-hidden="true" focusable="false">
      {draw()}
    </svg>
  );
}

/** The illustration for a stage of a project. */
export function StageArt({ type, stageKey, className }: { type: ProjectType; stageKey: string; className?: string }) {
  return <Art name={artFor(type, stageKey)} className={className} />;
}
