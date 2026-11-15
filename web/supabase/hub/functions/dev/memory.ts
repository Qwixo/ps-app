// The developer channel's store in memory: the FAKE hub of the unit tests (tests/devchannel.test.ts). Never deployed
// (the hub function is index.ts + logic.ts only); the same rules as the dev_ tables.
import type { AgentRow, DropRow, EpochRow, LinkRow, MemberRow, MessageRow, Store, UpdateRow } from "./logic.ts";

export function memoryStore(): Store & { _: Record<string, unknown> } {
  const members = new Map<string, MemberRow>(), nonces = new Set<string>(), links = new Map<string, LinkRow>();
  const agents = new Map<string, AgentRow>(), epochs: EpochRow[] = [], drops: DropRow[] = [];
  const messages = new Map<string, MessageRow>(), updates = new Map<string, UpdateRow>();
  const copy = <T,>(v: T): T => (v ? JSON.parse(JSON.stringify(v)) : v);
  return {
    _: { members, nonces, links, agents, epochs, drops, messages, updates },
    async member(id) { return copy(members.get(id) ?? null); },
    async members(squad) { return [...members.values()].filter((m) => m.squad_id === squad).map(copy); },
    async nonce(key, n) { const k = `${key}:${n}`; if (nonces.has(k)) return false; nonces.add(k); return true; },
    async linkInsert(row) { links.set(row.id, copy(row)); },
    async linksOpen(member, now) { return [...links.values()].filter((l) => l.member_id === member && !l.used_at && l.expires_at > now).length; },
    async linkTake(hash, now) {
      const l = [...links.values()].find((x) => x.token_hash === hash && !x.used_at && x.expires_at > now);
      if (!l) return null;
      l.used_at = now;
      return copy(l);
    },
    async agentInsert(row) { if ([...agents.values()].some((a) => a.sign_pub === row.sign_pub)) return false; agents.set(row.id, copy(row)); return true; },
    async agent(id) { return copy(agents.get(id) ?? null); },
    async agents(squad) { return [...agents.values()].filter((a) => a.squad_id === squad).map(copy); },
    async agentPatch(id, patch) { const a = agents.get(id); if (a) Object.assign(a, patch); },
    async epochLatest(squad) { return copy(epochs.filter((e) => e.squad_id === squad).sort((a, b) => b.epoch - a.epoch)[0] ?? null); },
    async epochInsert(row, d) {
      if (epochs.some((e) => e.squad_id === row.squad_id && e.epoch === row.epoch)) return false;
      epochs.push(copy(row)); drops.push(...d.map(copy));
      return true;
    },
    async drops(agent) { return drops.filter((d) => d.agent_id === agent).map(copy); },
    async messageInsert(row) { if (messages.has(row.id)) return false; messages.set(row.id, copy(row)); return true; },
    async messagesSent(agent, after) { return [...messages.values()].filter((m) => m.agent_id === agent && m.created_at > after).length; },
    async messages(squad, eps, since, limit) {
      const all = [...messages.values()].filter((m) => m.squad_id === squad && eps.includes(m.epoch) && (!since || m.created_at > since));
      return all.sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(-limit).map(copy);
    },
    async update(id) { return copy(updates.get(id) ?? null); },
    async updatePut(row) { updates.set(row.id, copy(row)); },
    async updates(squad, eps, since) {
      return [...updates.values()].filter((u) => u.squad_id === squad && eps.includes(u.epoch) && (since ? u.updated_at > since : u.open))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map(copy);
    },
    async tidy() { /* nothing to keep small in a test */ },
  };
}
