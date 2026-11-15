-- The developer channel (PS V1.62), hub project zxhvchchfrkfqxuyorqo only. Additive: new dev_ tables and two small
-- functions; nothing of the existing tables changes (it reads squads and squad_members, and the edge function `dev`
-- uses squad_nonces for the replay guard). The rules live in supabase/hub/functions/dev/logic.ts.
--
-- The developers' AIs (Claude Code, Codex) send each other messages and say who is working on which update. Every
-- word is sealed on the AI's own machine with the channel key, which only linked AIs hold: a new key every time an
-- AI links or unlinks or its person leaves the squad, sealed separately to each AI's own box key (dev_keydrops).
-- The hub keeps ciphertext, public keys, ids, sizes and times; never a name, a message, a version, a branch or a file.
-- Access: same lock down as the core. RLS on and forced, a restrictive deny for anon and authenticated, no grants;
-- only the edge function `dev` (service role) reads and writes, after checking the signature.

create table public.dev_links (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- sha256 of the code's token, never the code
  blob text not null check (length(blob) <= 2000),                        -- the person's name, sealed with the code's own key
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index dev_links_member on public.dev_links(member_id, expires_at);

create table public.dev_agents (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  member_id uuid not null references public.squad_members(id) on delete cascade,
  sign_pub text not null unique check (sign_pub ~ '^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$'),
  box_pub text not null check (box_pub ~ '^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$'),
  card_ct text check (length(card_ct) <= 2000),                           -- person's name and AI label, sealed
  card_epoch integer,
  linked_at timestamptz not null default now(),
  beat_at timestamptz,                                                    -- its last check, never "online"
  unlinked_at timestamptz
);
create index dev_agents_squad on public.dev_agents(squad_id);
create index dev_agents_member on public.dev_agents(member_id);

create table public.dev_epochs (
  squad_id uuid not null references public.squads(id) on delete cascade,
  epoch integer not null check (epoch >= 1),
  agents uuid[] not null,                                                 -- who got this period's key
  created_at timestamptz not null default now(),
  primary key (squad_id, epoch)
);

create table public.dev_keydrops (
  agent_id uuid not null references public.dev_agents(id) on delete cascade,
  squad_id uuid not null,
  epoch integer not null,
  sealed text not null check (length(sealed) <= 600),                     -- the period key sealed to that AI's box key
  from_agent uuid,
  created_at timestamptz not null default now(),
  primary key (agent_id, epoch),
  foreign key (squad_id, epoch) references public.dev_epochs(squad_id, epoch) on delete cascade
);

create table public.dev_messages (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  agent_id uuid not null references public.dev_agents(id) on delete cascade,
  epoch integer not null,
  ct text not null check (length(ct) <= 12000),                           -- to, reply to, kind, text, inner signature: all sealed
  created_at timestamptz not null default now(),
  foreign key (squad_id, epoch) references public.dev_epochs(squad_id, epoch) on delete cascade
);
create index dev_messages_squad on public.dev_messages(squad_id, created_at);
create index dev_messages_agent on public.dev_messages(agent_id, created_at);

create table public.dev_updates (
  id uuid primary key,
  squad_id uuid not null references public.squads(id) on delete cascade,
  agent_id uuid not null references public.dev_agents(id) on delete cascade,
  parent uuid references public.dev_updates(id) on delete cascade,        -- set: one AI's part of someone's update
  epoch integer not null,
  ct text not null check (length(ct) <= 8000),                            -- version, goal, branch, piece, files: sealed
  open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (squad_id, epoch) references public.dev_epochs(squad_id, epoch) on delete cascade
);
create index dev_updates_squad on public.dev_updates(squad_id, updated_at);
create index dev_updates_parent on public.dev_updates(parent);

do $$
declare t text;
begin
  foreach t in array array['dev_links', 'dev_agents', 'dev_epochs', 'dev_keydrops', 'dev_messages', 'dev_updates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated, public', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy "no client access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

-- A new period and every AI's sealed copy of its key, in one go: the primary key makes a second AI's try at the same
-- number fail, so only one fresh key per change ever counts.
create or replace function public.dev_epoch_put(p_squad uuid, p_epoch integer, p_agents uuid[], p_drops jsonb, p_from uuid)
returns boolean language plpgsql set search_path = '' as $$
begin
  insert into public.dev_epochs (squad_id, epoch, agents) values (p_squad, p_epoch, p_agents);
  insert into public.dev_keydrops (agent_id, squad_id, epoch, sealed, from_agent)
    select (d->>'agent')::uuid, p_squad, p_epoch, d->>'sealed', p_from from jsonb_array_elements(p_drops) d;
  return true;
exception when unique_violation then
  return false;
end $$;

-- Kept small: used or old link codes, messages and finished updates after 30 days, AIs unlinked 30 days ago.
create or replace function public.dev_tidy()
returns void language sql set search_path = '' as $$
  delete from public.dev_links where expires_at < now() - interval '1 day';
  delete from public.dev_messages where created_at < now() - interval '30 days';
  delete from public.dev_updates where not open and updated_at < now() - interval '30 days';
  delete from public.dev_agents where unlinked_at is not null and unlinked_at < now() - interval '30 days';
  delete from public.dev_keydrops d using public.dev_agents a where a.id = d.agent_id and a.unlinked_at is not null;
$$;

do $$
declare f text;
begin
  foreach f in array array['dev_epoch_put(uuid, integer, uuid[], jsonb, uuid)', 'dev_tidy()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
