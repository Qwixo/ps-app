// The CRO picture: Version A vs Version B, half the visitors see each, the winner stays.
// Plus the CRO price ladder as a dark premium card. Generic drawings only, no real numbers.
import "../portal.css";

function MiniStore({ variant }: { variant: "a" | "b" }) {
  return (
    <div className={`ab-store ab-${variant}`} aria-hidden="true">
      <div className="ab-nav"><i /><span /><span /><span /></div>
      {variant === "b" && <div className="ab-stars">★★★★★ <span /></div>}
      <div className="ab-hero"><span /><span /><b /></div>
      <div className="ab-row"><i /><i /><i /></div>
    </div>
  );
}

/** Version A and Version B side by side, a 50/50 split bar and the winner that stays. */
export function ABTest({ a = "Your current page", b = "A new idea to test", compact, onDark }: { a?: string; b?: string; compact?: boolean; onDark?: boolean }) {
  return (
    <figure className={"ab" + (compact ? " compact" : "") + (onDark ? " on-dark" : "")} aria-label="How a test works: half your visitors see version A, half see version B, and the version that sells more stays.">
      <div className="ab-split">
        <div className="ab-bar" aria-hidden="true"><span>A 50%</span><span>B 50%</span></div>
        <figcaption className="ab-cap">Half your visitors see each version</figcaption>
      </div>
      <svg className="ab-fork" viewBox="0 0 200 26" preserveAspectRatio="none" aria-hidden="true">
        <path d="M100 0 V8 C100 16 50 12 50 26 M100 8 C100 16 150 12 150 26" />
      </svg>
      <div className="ab-cards">
        <div className="ab-card">
          <div className="ab-head"><b>A</b><span>{a}</span></div>
          <MiniStore variant="a" />
          <div className="ab-meter" aria-hidden="true"><i /></div>
        </div>
        <div className="ab-card win">
          <span className="ab-crown"><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" fill="currentColor" /></svg> Winner stays</span>
          <div className="ab-head"><b>B</b><span>{b}</span></div>
          <MiniStore variant="b" />
          <div className="ab-meter" aria-hidden="true"><i /></div>
        </div>
      </div>
      {!compact && <p className="ab-foot">Once enough people have seen both, the version that sold more stays, and we test the next idea. You get a short note every month.</p>}
    </figure>
  );
}

/** The CRO ladder as a dark card: the price only steps up when conversion does. */
export function CroLadder({ ladder, afterLaunch, title = "More sales from the visitors you already have.", showAB }: {
  ladder: { label: string; price: string }[]; afterLaunch?: string | null; title?: string; showAB?: boolean;
}) {
  if (!ladder.length) return null;
  return (
    <section className={"cp-dark cp-ladder-card" + (showAB ? " with-ab" : "")} aria-label="CRO plan">
      <div className="cp-ladder-main">
      <div className="cp-eyebrow light">Ongoing CRO</div>
      <h3 className="cp-ladder-title">{title}</h3>
      {afterLaunch && <p className="cp-ladder-sub">{afterLaunch}</p>}
      <ol className="cp-steps-ladder">
        {ladder.map((r, k) => (
          <li key={k} style={{ ["--lv" as string]: String((k + 1) / ladder.length) }}>
            <span className="lv" aria-hidden="true"><i /></span>
            <span className="lb">{r.label}</span>
            <b className="num">{r.price}</b>
          </li>
        ))}
      </ol>
      <p className="xs cp-ladder-note">The price only steps up when your conversion rate does.</p>
      </div>
      {showAB && <div className="cp-ladder-ab"><ABTest compact onDark /></div>}
    </section>
  );
}
