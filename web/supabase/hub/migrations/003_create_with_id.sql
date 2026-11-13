-- G Squad hub: the creator's device picks the squad id, so the squad's name can be sealed with the id in its aad
-- (sqAad.meta) before the squad exists. A taken id fails (primary key), nothing else changes.
drop function if exists public.squad_create(text, text, text);
create or replace function public.squad_create(p_id uuid, p_sign_pub text, p_box_pub text, p_meta_ct text)
returns jsonb language plpgsql set search_path = '' as $$
declare m uuid;
begin
  insert into public.squads (id, meta_ct, meta_gen) values (p_id, p_meta_ct, 1);
  insert into public.squad_members (squad_id, sign_pub, box_pub) values (p_id, p_sign_pub, p_box_pub) returning id into m;
  update public.squads set created_by = m where id = p_id;
  return jsonb_build_object('squad', p_id, 'member', m, 'gen', 1);
end $$;
revoke all on function public.squad_create(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.squad_create(uuid, text, text, text) to service_role;
