-- WanderTales Guild — follower check without the Meta API.
-- The Guild Master uploads @wandertales.guild's own follower list from Instagram's official
-- "Download your information" export. Only SHA-256 hashes of usernames are stored, so the
-- database never holds a readable list of followers who did not register.
-- Registration is refused with 'not_following' when a list exists and the username isn't on it.

create table public.instagram_followers (
  town_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.towns (id) on delete cascade,
  handle_hash text not null check (handle_hash ~ '^[0-9a-f]{64}$'),
  primary key (town_id, handle_hash)
);

create table public.follower_lists (
  town_id uuid primary key references public.towns (id) on delete cascade,
  uploaded_at timestamptz not null default now(),
  follower_count int not null,
  uploaded_by uuid references auth.users (id) on delete set null
);

alter table public.instagram_followers enable row level security;
alter table public.follower_lists enable row level security;
-- no policies: only reachable through the functions below

alter table public.resident_registrations add column follows boolean;

create function public.handle_hash(h text) returns text
language sql immutable as $$ select encode(sha256(convert_to(h, 'UTF8')), 'hex') $$;

-- null = no follower list uploaded yet (follow check is skipped), true/false otherwise
create function public.is_follower(p_instagram text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare h text := public.normalize_instagram(p_instagram);
begin
  if not exists (select 1 from public.follower_lists where town_id = '00000000-0000-0000-0000-000000000001') then return null; end if;
  if h is null then return false; end if;
  return exists (select 1 from public.instagram_followers where town_id = '00000000-0000-0000-0000-000000000001' and handle_hash = public.handle_hash(h));
end $$;

create function public.follower_list_info()
returns table (uploaded_at timestamptz, follower_count int)
language sql stable security definer set search_path = public as $$
  select f.uploaded_at, f.follower_count from public.follower_lists f where f.town_id = '00000000-0000-0000-0000-000000000001'
$$;

-- Replace the follower list (hashes computed in the browser from the export file).
create function public.admin_set_followers(p_hashes text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  perform public.require_guild_master();
  if p_hashes is null or cardinality(p_hashes) = 0 then raise exception 'empty_follower_list'; end if;
  if cardinality(p_hashes) > 1000000 then raise exception 'follower_list_too_large'; end if;
  if exists (select 1 from unnest(p_hashes) x where x !~ '^[0-9a-f]{64}$') then raise exception 'invalid_follower_list'; end if;
  delete from public.instagram_followers where town_id = '00000000-0000-0000-0000-000000000001';
  insert into public.instagram_followers (handle_hash) select distinct x from unnest(p_hashes) x;
  get diagnostics n = row_count;
  insert into public.follower_lists (town_id, follower_count, uploaded_by) values ('00000000-0000-0000-0000-000000000001', n, auth.uid())
  on conflict (town_id) do update set uploaded_at = now(), follower_count = excluded.follower_count, uploaded_by = excluded.uploaded_by;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'set_followers', jsonb_build_object('count', n));
  return n;
end $$;

-- Same as before, plus the follow check.
create or replace function public.register_resident(
  p_instagram text, p_display_name text, p_personality text, p_appearance jsonb,
  p_consent_data boolean, p_show_instagram boolean default false
) returns table (id uuid, verification_code text, status text)
language plpgsql security definer set search_path = public as $$
declare
  h text := public.normalize_instagram(p_instagram);
  v_name text := btrim(coalesce(p_display_name, ''));
  v_follows boolean;
  reg public.resident_registrations;
begin
  if auth.uid() is null then raise exception 'sign_in_required' using errcode = '42501'; end if;
  if h is null then raise exception 'invalid_instagram'; end if;
  if char_length(v_name) not between 2 and 24 then raise exception 'invalid_name'; end if;
  if not public.valid_personality(p_personality) then raise exception 'invalid_personality'; end if;
  if not public.valid_appearance(p_appearance) then raise exception 'invalid_appearance'; end if;
  if p_consent_data is not true then raise exception 'consent_required'; end if;
  v_follows := public.is_follower(h);
  if v_follows is false then raise exception 'not_following'; end if;
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
  insert into public.resident_registrations (applicant, instagram, display_name, personality, appearance, consent_data, consent_show_instagram, verification_code, follows)
  values (auth.uid(), h, v_name, p_personality, p_appearance, true, coalesce(p_show_instagram, false), public.new_verification_code(), v_follows)
  returning * into reg;
  return query select reg.id, reg.verification_code, reg.status;
end $$;

revoke all on function public.handle_hash(text) from public;
revoke all on function public.is_follower(text) from public;
revoke all on function public.follower_list_info() from public;
revoke all on function public.admin_set_followers(text[]) from public;
grant execute on function public.is_follower(text) to anon, authenticated;
grant execute on function public.follower_list_info() to anon, authenticated;
grant execute on function public.admin_set_followers(text[]) to authenticated;
-- create or replace keeps existing grants on register_resident

-- Supabase's default privileges also grant new functions to anon; admin functions check the
-- Guild Master role anyway, but signed-out visitors have no reason to reach them at all.
revoke execute on function public.admin_set_followers(text[]) from anon;
revoke execute on function public.admin_list_registrations(text) from anon;
revoke execute on function public.admin_review_registration(uuid, boolean, text) from anon;
revoke execute on function public.admin_add_resident(text, text, text, jsonb, boolean, boolean, text) from anon;
revoke execute on function public.admin_import_residents(jsonb) from anon;
revoke execute on function public.admin_remove_resident(uuid) from anon;
revoke execute on function public.admin_set_home(uuid, text) from anon;
revoke execute on function public.handle_hash(text) from anon, authenticated;
