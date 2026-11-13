-- G Squad hub: say the deny-all out loud. No client role (anon, authenticated) may read or write any squad table;
-- only the edge function `squad` (service role, which bypasses RLS) does, after checking the signature.
do $$
declare t text;
begin
  foreach t in array array['squads', 'squad_members', 'squad_invites', 'squad_keydrops', 'squad_tasks', 'squad_handoffs', 'squad_nonces'] loop
    execute format('create policy "no client access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;
