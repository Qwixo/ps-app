#!/bin/zsh
# G Squad invite only: checks the hub's join rules in a REAL Postgres, in a throwaway local container. Never touches
# the live hub. Uses the Supabase Postgres image already pulled for local Supabase (no download if it is there).
#   scripts/gsquad-invite-check.sh            build, seed, migrate, check, remove the container
#   KEEP=1 scripts/gsquad-invite-check.sh     leave the container running afterwards (name gsq-invite-check)
set -euo pipefail
cd "$(dirname "$0")/.."
IMG=${IMG:-public.ecr.aws/supabase/postgres:17.11.0.006}
NAME=gsq-invite-check
M=supabase/hub/migrations
psql() { docker exec -i $NAME psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

docker rm -f $NAME >/dev/null 2>&1 || true
docker run -d --name $NAME -e POSTGRES_PASSWORD=check $IMG >/dev/null
for i in {1..60}; do docker exec $NAME pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done
sleep 3
# The live hub's order (list_migrations, 13 Nov 2026).
for f in 001_gsquad_core 002_explicit_deny 003_create_with_id 004_board_core gym_001_boards chat_001_chat \
         chat_002_status_first_period dir_001_directory dir_002_rename sb_001_sounds auto_001_one_squad auto_002_never_stuck; do
  psql < $M/$f.sql >/dev/null
done
# A state like the live one: 3 people in, every one holding the key and with a card, the developer the admin.
psql >/dev/null <<'SQL'
create or replace function pg_temp.pub(s text) returns text language sql as $$
  select replace(encode(sha256(convert_to(s, 'UTF8')) || sha256(convert_to(s || '!', 'UTF8')), 'base64'), E'\n', '');
$$;
create or replace function pg_temp.who(s text) returns text language sql as $$ select encode(sha256(convert_to('who:' || s, 'UTF8')), 'hex'); $$;
do $$
declare sid uuid := auto_squad(); n text;
begin
  update squads set meta_ct = 'bWV0YQ==', meta_gen = gen where id = sid;
  foreach n in array array['red', 'amy', 'ben'] loop
    insert into squad_members (squad_id, sign_pub, box_pub, who, has_key, card_ct, card_gen, last_beat)
      values (sid, pg_temp.pub(n), pg_temp.pub(n || 'box'), pg_temp.who(n), true, 'Y2FyZA==', (select gen from squads where id = sid), now());
    insert into squad_keydrops (member_id, gen, squad_id, sealed)
      select id, (select gen from squads where id = sid), sid, 'ZHJvcA==' from squad_members where who = pg_temp.who(n);
  end loop;
  update squads set created_by = (select id from squad_members where who = pg_temp.who('red')) where id = sid;
  update dir_config set admin_who = pg_temp.who('red') where id;
end $$;
SQL
psql < $M/invite_001_invite_only.sql 2>&1 | grep -v NOTICE || true
psql -t < scripts/gsquad-invite-check.sql 2>&1 | sed -e 's/^psql:<stdin>:[0-9]*: //' -e 's/^NOTICE:  //' | grep -v '^ *$'
[[ -n "${KEEP:-}" ]] || docker rm -f $NAME >/dev/null
