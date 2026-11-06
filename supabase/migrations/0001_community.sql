-- WanderTales Guild — Phase 4: community residents
-- Voluntary registration only. No scraping; Instagram ownership is confirmed by a one-time
-- code the follower sends to @wandertales.guild, which the Guild Master checks before approving.
-- All writes go through SECURITY DEFINER functions that validate input; tables are locked by RLS.

-- ---------- tables ----------

create table public.towns (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'WanderTales Town',
  created_at timestamptz not null default now()
);
insert into public.towns (id, name) values ('00000000-0000-0000-0000-000000000001', 'WanderTales Town');

-- one row per signed-in account; role 'guild_master' is granted manually (see README)
create table public.player_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Guild Master',
  role text not null default 'player' check (role in ('player', 'guild_master')),
  town_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.towns (id),
  created_at timestamptz not null default now()
);

create table public.resident_registrations (
  id uuid primary key default gen_random_uuid(),
  town_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.towns (id),
  applicant uuid references auth.users (id) on delete set null,
  instagram text not null,
  display_name text not null check (char_length(display_name) between 2 and 24),
  personality text not null,
  appearance jsonb not null,
  consent_data boolean not null check (consent_data),
  consent_show_instagram boolean not null default false,
  consent_at timestamptz not null default now(),
  verification_code text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source text not null default 'self' check (source in ('self', 'admin', 'csv')),
  review_note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
-- duplicate prevention: one live registration per Instagram account per town
create unique index registrations_one_live_per_instagram on public.resident_registrations (town_id, instagram) where status in ('pending', 'approved');
create unique index registrations_one_pending_per_applicant on public.resident_registrations (applicant) where status = 'pending';
create index registrations_by_status on public.resident_registrations (town_id, status, created_at);

-- resident_id (residents.id) is the permanent identity, independent of the Instagram username
create table public.residents (
  id uuid primary key default gen_random_uuid(),
  town_id uuid not null references public.towns (id),
  registration_id uuid unique references public.resident_registrations (id) on delete set null,
  display_name text not null,
  instagram text,
  show_instagram boolean not null default false,
  personality text not null,
  appearance jsonb not null,
  home_building_id text,
  created_at timestamptz not null default now()
);
create unique index residents_unique_instagram on public.residents (town_id, instagram) where instagram is not null;
create index residents_by_town on public.residents (town_id, created_at);

-- who did what (moderation trail + manual recovery)
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  target uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.towns enable row level security;
alter table public.player_profiles enable row level security;
alter table public.resident_registrations enable row level security;
alter table public.residents enable row level security;
alter table public.audit_log enable row level security;

create policy "towns are public" on public.towns for select to anon, authenticated using (true);
create policy "read own profile" on public.player_profiles for select to authenticated using (user_id = auth.uid());
create policy "read own registration" on public.resident_registrations for select to authenticated using (applicant = auth.uid());
-- residents and audit_log: no direct access; use list_residents() / admin functions

-- ---------- validation helpers ----------

create function public.normalize_instagram(raw text) returns text
language plpgsql immutable as $$
declare h text := lower(btrim(coalesce(raw, '')));
begin
  h := regexp_replace(h, '^@', '');
  h := regexp_replace(h, '^(https?://)?(www\.)?instagram\.com/', '');
  h := regexp_replace(h, '/.*$', '');
  if h !~ '^[a-z0-9._]{1,30}$' or h like '%..%' or h like '.%' or h like '%.' then
    return null;
  end if;
  return h;
end $$;

create function public.valid_appearance(a jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(a) = 'object'
    and coalesce(a->>'skin', '') ~ '^#[0-9a-fA-F]{6}$'
    and coalesce(a->>'hair', '') ~ '^#[0-9a-fA-F]{6}$'
    and coalesce(a->>'shirt', '') ~ '^#[0-9a-fA-F]{6}$'
    and coalesce(a->>'pants', '') ~ '^#[0-9a-fA-F]{6}$'
    and (a->>'hat' is null or a->>'hat' ~ '^#[0-9a-fA-F]{6}$')
    and a->>'hairStyle' in ('short', 'long', 'bun', 'spiky')
    and coalesce(a->>'eyes', 'round') in ('round', 'happy', 'sleepy', 'wide')
    and coalesce(a->>'accessory', 'none') in ('none', 'glasses', 'scarf', 'flower')
    and coalesce(a->>'build', 'regular') in ('slim', 'regular', 'sturdy')
    and jsonb_typeof(a->'height') = 'number'
    and (a->>'height')::numeric between 0.9 and 1.1
$$;

create function public.valid_personality(p text) returns boolean
language sql immutable as $$
  select p in ('Cheerful', 'Shy', 'Hardworking', 'Social', 'Greedy', 'Kind', 'Adventurous', 'Lazy')
$$;

create function public.new_verification_code() returns text
language sql volatile as $$
  select 'WTG-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6))
$$;

create function public.is_guild_master() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.player_profiles where user_id = auth.uid() and role = 'guild_master')
$$;

create function public.require_guild_master() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_guild_master() then raise exception 'not_guild_master' using errcode = '42501'; end if;
end $$;

-- ---------- public / applicant functions ----------

-- Residents visible in the game. Instagram is only shown when the resident agreed to it.
create function public.list_residents(p_town uuid default '00000000-0000-0000-0000-000000000001')
returns table (id uuid, display_name text, instagram text, personality text, appearance jsonb, home_building_id text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.display_name, case when r.show_instagram then r.instagram end, r.personality, r.appearance, r.home_building_id, r.created_at
  from public.residents r where r.town_id = p_town order by r.created_at
$$;

-- A follower registers (signed in, e.g. with Supabase anonymous auth). Returns the code to DM.
create function public.register_resident(
  p_instagram text, p_display_name text, p_personality text, p_appearance jsonb,
  p_consent_data boolean, p_show_instagram boolean default false
) returns table (id uuid, verification_code text, status text)
language plpgsql security definer set search_path = public as $$
declare
  h text := public.normalize_instagram(p_instagram);
  v_name text := btrim(coalesce(p_display_name, ''));
  reg public.resident_registrations;
begin
  if auth.uid() is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  if h is null then raise exception 'invalid_instagram'; end if;
  if char_length(v_name) not between 2 and 24 then raise exception 'invalid_name'; end if;
  if not public.valid_personality(p_personality) then raise exception 'invalid_personality'; end if;
  if not public.valid_appearance(p_appearance) then raise exception 'invalid_appearance'; end if;
  if p_consent_data is not true then raise exception 'consent_required'; end if;
  if exists (select 1 from public.resident_registrations r where r.instagram = h and r.status in ('pending', 'approved'))
     or exists (select 1 from public.residents r where r.instagram = h) then
    raise exception 'already_registered';
  end if;
  if exists (select 1 from public.resident_registrations r where r.applicant = auth.uid() and r.status = 'pending') then
    raise exception 'already_pending';
  end if;
  if (select count(*) from public.resident_registrations r where r.applicant = auth.uid() and r.created_at > now() - interval '1 day') >= 3 then
    raise exception 'too_many_attempts';
  end if;
  insert into public.resident_registrations (applicant, instagram, display_name, personality, appearance, consent_data, consent_show_instagram, verification_code)
  values (auth.uid(), h, v_name, p_personality, p_appearance, true, coalesce(p_show_instagram, false), public.new_verification_code())
  returning * into reg;
  return query select reg.id, reg.verification_code, reg.status;
end $$;

-- The applicant's latest registration (status page).
create function public.my_registration()
returns table (id uuid, instagram text, display_name text, status text, verification_code text, review_note text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.instagram, r.display_name, r.status, r.verification_code, r.review_note, r.created_at
  from public.resident_registrations r where r.applicant = auth.uid() order by r.created_at desc limit 1
$$;

-- Consent withdrawal: removes the applicant's registrations and their resident.
create function public.withdraw_my_registration() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  delete from public.residents where registration_id in (select r.id from public.resident_registrations r where r.applicant = auth.uid());
  delete from public.resident_registrations where applicant = auth.uid();
  insert into public.audit_log (actor, action) values (auth.uid(), 'withdraw');
end $$;

-- ---------- Guild Master functions ----------

create function public.admin_list_registrations(p_status text default 'pending')
returns setof public.resident_registrations
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_guild_master();
  return query select * from public.resident_registrations r where r.status = p_status order by r.created_at;
end $$;

create function public.admin_review_registration(p_id uuid, p_approve boolean, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare reg public.resident_registrations; rid uuid;
begin
  perform public.require_guild_master();
  select * into reg from public.resident_registrations where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if reg.status <> 'pending' then raise exception 'already_reviewed'; end if;
  update public.resident_registrations set status = case when p_approve then 'approved' else 'rejected' end,
    review_note = p_note, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id;
  if p_approve then
    insert into public.residents (town_id, registration_id, display_name, instagram, show_instagram, personality, appearance)
    values (reg.town_id, reg.id, reg.display_name, reg.instagram, reg.consent_show_instagram, reg.personality, reg.appearance)
    returning id into rid;
  end if;
  insert into public.audit_log (actor, action, target, detail) values (auth.uid(), case when p_approve then 'approve' else 'reject' end, p_id, jsonb_build_object('note', p_note));
  return rid;
end $$;

-- Manual registration by the Guild Master (consent collected outside the game).
create function public.admin_add_resident(
  p_instagram text, p_display_name text, p_personality text, p_appearance jsonb,
  p_consent_data boolean, p_show_instagram boolean default false, p_source text default 'admin'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare h text := public.normalize_instagram(p_instagram); v_name text := btrim(coalesce(p_display_name, '')); reg_id uuid; rid uuid;
begin
  perform public.require_guild_master();
  if h is null then raise exception 'invalid_instagram'; end if;
  if char_length(v_name) not between 2 and 24 then raise exception 'invalid_name'; end if;
  if not public.valid_personality(p_personality) then raise exception 'invalid_personality'; end if;
  if not public.valid_appearance(p_appearance) then raise exception 'invalid_appearance'; end if;
  if p_consent_data is not true then raise exception 'consent_required'; end if;
  if p_source not in ('admin', 'csv') then raise exception 'invalid_source'; end if;
  if exists (select 1 from public.resident_registrations r where r.instagram = h and r.status in ('pending', 'approved'))
     or exists (select 1 from public.residents r where r.instagram = h) then
    raise exception 'already_registered';
  end if;
  insert into public.resident_registrations (instagram, display_name, personality, appearance, consent_data, consent_show_instagram,
    verification_code, status, source, reviewed_by, reviewed_at)
  values (h, v_name, p_personality, p_appearance, true, coalesce(p_show_instagram, false), 'MANUAL', 'approved', p_source, auth.uid(), now())
  returning id into reg_id;
  insert into public.residents (town_id, registration_id, display_name, instagram, show_instagram, personality, appearance)
  values ('00000000-0000-0000-0000-000000000001', reg_id, v_name, h, coalesce(p_show_instagram, false), p_personality, p_appearance)
  returning id into rid;
  insert into public.audit_log (actor, action, target, detail) values (auth.uid(), 'add_' || p_source, rid, jsonb_build_object('instagram', h));
  return rid;
end $$;

-- CSV import: each row is validated on its own; bad rows are reported, good rows are added.
create function public.admin_import_residents(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare row jsonb; i int := 0; results jsonb := '[]'::jsonb; rid uuid;
begin
  perform public.require_guild_master();
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'invalid_rows'; end if;
  for row in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      rid := public.admin_add_resident(row->>'instagram', row->>'display_name', row->>'personality', row->'appearance',
        (row->>'consent')::boolean, coalesce((row->>'show_instagram')::boolean, false), 'csv');
      results := results || jsonb_build_object('row', i, 'ok', true, 'resident_id', rid);
    exception when others then
      results := results || jsonb_build_object('row', i, 'ok', false, 'error', sqlerrm);
    end;
  end loop;
  return results;
end $$;

create function public.admin_remove_resident(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_guild_master();
  delete from public.resident_registrations where id = (select registration_id from public.residents where id = p_id);
  delete from public.residents where id = p_id;
  insert into public.audit_log (actor, action, target) values (auth.uid(), 'remove', p_id);
end $$;

create function public.admin_set_home(p_id uuid, p_home text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_guild_master();
  if p_home is not null and p_home !~ '^[a-z0-9_]{1,40}$' then raise exception 'invalid_home'; end if;
  update public.residents set home_building_id = p_home where id = p_id;
end $$;

-- ---------- permissions ----------
revoke all on all functions in schema public from public;
grant execute on function public.list_residents(uuid) to anon, authenticated;
grant execute on function public.register_resident(text, text, text, jsonb, boolean, boolean) to authenticated;
grant execute on function public.my_registration() to authenticated;
grant execute on function public.withdraw_my_registration() to authenticated;
grant execute on function public.is_guild_master() to authenticated;
grant execute on function public.admin_list_registrations(text) to authenticated;
grant execute on function public.admin_review_registration(uuid, boolean, text) to authenticated;
grant execute on function public.admin_add_resident(text, text, text, jsonb, boolean, boolean, text) to authenticated;
grant execute on function public.admin_import_residents(jsonb) to authenticated;
grant execute on function public.admin_remove_resident(uuid) to authenticated;
grant execute on function public.admin_set_home(uuid, text) to authenticated;
