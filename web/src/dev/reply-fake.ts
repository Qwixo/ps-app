// The dev server's /dev-reply-window: the reply panel with a FICTIONAL email (no real person or address).
// ?lead an Instantly reply, ?off not connected, ?pill the pill with Undo, ?setup the panel with no email.
export function loadReplyFake() {
  const w = window as unknown as { __psReply?: { open(o: unknown): void; status(s: unknown): void; queue(q: unknown): void } };
  const q = new URLSearchParams(location.search);
  w.__psReply?.status({ gmail: [{ account: "studio@example.com", connected: !q.has("off") }], instantly: { saved: false }, waiting: 0 });
  const prefs = {
    sig: "Sam\nExample Studio\nexample.com", sigs: {}, send: { random: q.has("random"), min: 2, max: 15 },
    clients: [{ id: "c-north", name: "Northwind" }, { id: "c-acme", name: "Acme Co" }], accounts: ["studio@example.com", "hello@example.com"],
    responses: [
      { id: "starter-on-it", name: "On it", text: "Hi {first name},\n\nPerfect, I'm on it, I'll get back to you shortly.\n\nThanks" },
      { id: "r2", name: "Call", text: "Hi {first name}, happy to talk it through. Does a call tomorrow work for {company}?" },
      { id: "r3", name: "Homepage next steps", text: "Hi {first name}, the homepage draft is moving along, next version tomorrow.", clients: ["c-north"] },
      { id: "r4", name: "Invoice", text: "Hi {first name}, the invoice is attached.", clients: ["c-acme"] },
    ],
  };
  const ctx = q.has("setup") ? null : {
    cardId: "m:fake", via: q.has("lead") ? "instantly" : "gmail", account: "studio@example.com", to: "jane@northwind.example", toName: "Jane Doe",
    first: "Jane", name: "Jane Doe", company: "Northwind", subject: "Homepage draft", threadId: "t1", emailId: q.has("lead") ? "e1" : null, clientIds: ["c-north"],
    quote: { at: new Date(Date.now() - 600_000).toISOString(), who: "Jane Doe <jane@northwind.example>", text: "Hi Sam,\n\nLoved the draft. Could we move the reviews higher up the page, and make the hero picture a bit warmer?\n\nThanks,\nJane" },
  };
  w.__psReply?.open({ ctx, prefs });
  if (q.has("pill")) w.__psReply?.queue([{ id: "j1", cardId: "m:fake", via: "gmail", account: "studio@example.com", to: "jane@northwind.example", toName: "Jane Doe", subject: "Re: Homepage draft", sendAt: Date.now() + 8000, state: "queued", undo: true }]);
}
