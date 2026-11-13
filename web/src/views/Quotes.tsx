// To-do > quotes: the developer's own quotes, pinned at the top of the page until he changes them.
import { useEffect, useRef, useState } from "react";
import type { Doc, Quote } from "../core/model";
import { quotes } from "../core/select";
import { addQuote, deleteQuote, updateQuote } from "../core/actions";
import { Icon, toast, useVault } from "../ui/kit";
import "./quotes.css";

export function QuotesCard() {
  const s = useVault();
  const list = quotes(s);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");

  async function save() {
    if (!text.trim()) { setAdding(false); return; }
    try { await addQuote(text, author); setText(""); setAuthor(""); setAdding(false); }
    catch (e) { toast(String((e as Error).message || e)); }
  }

  if (!list.length && !adding) {
    return (
      <button type="button" className="qt-empty" onClick={() => setAdding(true)}>
        <span className="qt-mark" aria-hidden="true">&ldquo;</span>
        <span className="small muted">Add a quote to keep at the top of your list</span>
      </button>
    );
  }

  return (
    <section className="qt-wrap" aria-label="Your quotes">
      {list.map((d) => <QuoteItem key={d.id} d={d} />)}
      {adding ? (
        <div className="qt-item editing">
          <textarea className="qt-text" autoFocus rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type the quote" aria-label="Quote" />
          <input className="qt-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Who said it (optional)" aria-label="Who said it"
            onKeyDown={(e) => { if (e.key === "Enter") void save(); }} />
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn primary sm" onClick={() => void save()}>Save quote</button>
            <button type="button" className="btn quiet sm" onClick={() => { setAdding(false); setText(""); setAuthor(""); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn quiet sm qt-add" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add quote</button>
      )}
    </section>
  );
}

function QuoteItem({ d }: { d: Doc<Quote> }) {
  const [text, setText] = useState(d.data.text);
  const [author, setAuthor] = useState(d.data.author || "");
  const box = useRef<HTMLDivElement>(null);
  const editing = () => !!box.current?.contains(document.activeElement);
  useEffect(() => { if (!editing()) { setText(d.data.text); setAuthor(d.data.author || ""); } }, [d.data.text, d.data.author]);
  const save = () => {
    if (!text.trim()) { setText(d.data.text); return; }
    if (text !== d.data.text || author !== (d.data.author || "")) void updateQuote(d.id, { text: text.trim(), author: author.trim() || null });
  };
  return (
    <div className="qt-item" ref={box}>
      <span className="qt-mark" aria-hidden="true">&ldquo;</span>
      <textarea className="qt-text" rows={1} value={text} onChange={(e) => setText(e.target.value)} onBlur={save} aria-label="Quote" />
      <div className="qt-foot">
        <input className="qt-author" value={author} onChange={(e) => setAuthor(e.target.value)} onBlur={save} placeholder="Add who said it" aria-label="Who said it" />
        <button type="button" className="btn quiet icon sm qt-del" aria-label="Remove this quote"
          onClick={() => { if (window.confirm("Remove this quote?")) void deleteQuote(d.id); }}><Icon name="trash" size={14} /></button>
      </div>
    </div>
  );
}
