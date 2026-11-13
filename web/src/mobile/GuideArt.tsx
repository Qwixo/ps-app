// The Add to Home Screen guide's little animated pictures (src/mobile/Install.tsx). Four scenes of the iPhone: the
// Share button, the Add to Home Screen row, the Add button, and the new icon on the Home Screen. Each is a small SVG
// with a finger tap that loops (CSS only, mobile.css "psm-art"). Drawn, not photographed: nothing to download, and they
// stand still for people who have turned motion off.
import type { ReactNode } from "react";

const Frame = ({ children, label }: { children: ReactNode; label: string }) => (
  <svg className="psm-art" viewBox="0 0 120 84" role="img" aria-label={label}>
    <rect x="1" y="1" width="118" height="82" rx="14" className="a-screen" />
    {children}
  </svg>
);
const Tap = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}><circle className="a-ring" r="9" /><circle className="a-dot" r="3.4" /></g>
);
const ShareGlyph = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`} className="a-glyph"><path d="M0 -6.5V3M-3.6 -3L0 -6.5 3.6 -3" /><path d="M-4.5 -0.5H-5.6a1.4 1.4 0 0 0-1.4 1.4v6.2a1.4 1.4 0 0 0 1.4 1.4h11.2a1.4 1.4 0 0 0 1.4-1.4V0.9a1.4 1.4 0 0 0-1.4-1.4H4.5" /></g>
);

/** 1: Safari's bottom bar with the Share button (the three dots sit at the right, for when Share is not in sight). */
export function ArtShare() {
  return (
    <Frame label="Safari's bottom bar with the Share button lit up">
      <rect x="10" y="12" width="100" height="6" rx="3" className="a-line" /><rect x="10" y="24" width="70" height="6" rx="3" className="a-line" /><rect x="10" y="36" width="84" height="6" rx="3" className="a-line" />
      <rect x="8" y="55" width="104" height="22" rx="11" className="a-bar" />
      <g className="a-btn a-pulse"><circle cx="60" cy="66" r="9" className="a-hi" /><ShareGlyph x={60} y={65} /></g>
      <g className="a-glyph a-dots"><circle cx="97" cy="66" r="1.5" /><circle cx="103" cy="66" r="1.5" /><circle cx="91" cy="66" r="1.5" /></g>
      <Tap x={60} y={66} />
    </Frame>
  );
}
/** 2: the Share sheet sliding up, the Add to Home Screen row lit. */
export function ArtAddRow() {
  return (
    <Frame label="The Share sheet with the Add to Home Screen row lit up">
      <g className="a-sheet">
        <rect x="8" y="18" width="104" height="60" rx="12" className="a-card" />
        <rect x="50" y="23" width="20" height="3" rx="1.5" className="a-line" />
        <rect x="16" y="33" width="88" height="11" rx="5" className="a-row" />
        <g className="a-pulse"><rect x="16" y="48" width="88" height="12" rx="5" className="a-row a-hi" /></g>
        <rect x="16" y="64" width="88" height="11" rx="5" className="a-row" />
        <g className="a-glyph"><rect x="21" y="50.5" width="7" height="7" rx="2" /><path d="M24.5 52.5v3M23 54h3" /></g>
        <rect x="34" y="52.2" width="44" height="3.6" rx="1.8" className="a-text" />
      </g>
      <Tap x={90} y={54} />
    </Frame>
  );
}
/** 3: the Add dialog with the app's icon and its Add button lit. */
export function ArtAddButton() {
  return (
    <Frame label="The Add to Home Screen box with the Add button lit up">
      <rect x="8" y="10" width="104" height="64" rx="12" className="a-card" />
      <rect x="14" y="16" width="22" height="3.6" rx="1.8" className="a-line" />
      <g className="a-pulse"><rect x="82" y="13" width="26" height="12" rx="6" className="a-hi" /></g>
      <rect x="89" y="17.4" width="12" height="3.4" rx="1.7" className="a-text" />
      <rect x="16" y="34" width="26" height="26" rx="7" className="a-app" />
      <path d="M34.1 43A6.6 6.6 0 1 0 35.6 47.3H30.4" className="a-g" />
      <rect x="49" y="39" width="42" height="4" rx="2" className="a-text" /><rect x="49" y="48" width="30" height="3" rx="1.5" className="a-line" />
      <Tap x={95} y={19} />
    </Frame>
  );
}
/** 4: the Home Screen, the new icon popping in. */
export function ArtOpen() {
  const cells = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <Frame label="The Home Screen with the new app icon on it">
      {cells.map((i) => (i === 5 ? null : <rect key={i} x={12 + (i % 4) * 26} y={10 + Math.floor(i / 4) * 30} width="20" height="20" rx="6" className="a-ico" />))}
      <g className="a-new"><rect x={12 + 26} y={10 + 30} width="20" height="20" rx="6" className="a-app" /><path d="M51.85 47A5 5 0 1 0 53 50.2H49" className="a-g" /></g>
      <rect x="8" y="68" width="104" height="10" rx="5" className="a-bar" />
      <g className="a-spark"><path d="M82 26l1.2 3 3 1.2-3 1.2L82 34.4l-1.2-3-3-1.2 3-1.2z" /></g>
    </Frame>
  );
}
