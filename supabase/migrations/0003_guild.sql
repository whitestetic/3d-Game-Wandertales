-- WanderTales Guild — Phase 5: Guild Members, recruitment events, leaderboard.
-- Guild Members are a separate record on top of a registered resident.
-- Recruitment comments are imported by the Guild Master (CSV of a post's comments; no Meta API).
-- Counting happens HERE on the server from the raw comment rows, never in the browser.
-- Nobody becomes a Guild Member without the Guild Master approving them.

create table public.guild_ranks (
  rank int primary key,
  name text not null,
  min_renown int not null
);
insert into public.guild_ranks values
  (1, 'Novice', 0), (2, 'Apprentice', 100), (3, 'Adventurer', 300), (4, 'Veteran', 700), (5, 'Elite', 1500), (6, 'Legendary', 3000);

create table public.recruitment_events (
  id uuid primary key default gen_random_uuid(),
  town_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.towns (id),
  title text not null check (char_length(title) between 3 and 60),
  post_url text not null check (post_url ~ '^https://(www\.)?instagram\.com/(p|reel)/[A-Za-z0-9_-]+/?$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  min_comments int not null default 5 check (min_comments between 1 and 1000),
  min_chars int not null default 5 check (min_chars between 0 and 200),
  max_per_day int not null default 10 check (max_per_day between 1 and 1000),
  slots int not null default 3 check (slots between 1 and 50),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- Raw imported comments. Text is stored only as a hash (for duplicate detection) plus its length.
create table public.recruitment_comments (
  event_id uuid not null references public.recruitment_events (id) on delete cascade,
  instagram text not null,
  text_hash text not null check (text_hash ~ '^[0-9a-f]{64}$'),
  chars int not null check (chars >= 0),
  commented_at timestamptz not null,
  primary key (event_id, instagram, text_hash, commented_at)
);

create table public.recruitment_entries (
  event_id uuid not null references public.recruitment_events (id) on delete cascade,
  instagram text not null,
  total_comments int not null default 0,
  valid_comments int not null default 0,
  eligible boolean not null default false,
  reason text,
  place int,
  resident_id uuid references public.residents (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  primary key (event_id, instagram)
);

create table public.guild_members (
  id uuid primary key default gen_random_uuid(),
  town_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.towns (id),
  resident_id uuid not null unique references public.residents (id) on delete cascade,
  rank int not null default 1 references public.guild_ranks (rank),
  class text not null check (class in ('Warrior', 'Mage', 'Archer', 'Rogue', 'Healer', 'Paladin')),
  renown int not null default 0 check (renown >= 0),
  recruitment_event_id uuid references public.recruitment_events (id) on delete set null,
  joined_at timestamptz not null default now()
);
create index guild_members_by_town on public.guild_members (town_id, rank desc);

alter table public.guild_ranks enable row level security;
alter table public.recruitment_events enable row level security;
alter table public.recruitment_comments enable row level security;
alter table public.recruitment_entries enable row level security;
alter table public.guild_members enable row level security;
create policy "ranks are public" on public.guild_ranks for select to anon, authenticated using (true);
-- everything else only through the functions below

-- ---------- public reads ----------

create function public.list_recruitment_events()
returns setof public.recruitment_events
language sql stable security definer set search_path = public as $$
  select * from public.recruitment_events order by created_at desc
$$;

-- Comments on Instagram are public, so the leaderboard shows usernames.
create function public.list_leaderboard(p_event uuid)
returns table (place int, instagram text, total_comments int, valid_comments int, eligible boolean, reason text, status text)
language sql stable security definer set search_path = public as $$
  select e.place, e.instagram, e.total_comments, e.valid_comments, e.eligible, e.reason, e.status
  from public.recruitment_entries e where e.event_id = p_event order by e.place nulls last, e.instagram
$$;

create function public.list_guild_members()
returns table (id uuid, resident_id uuid, display_name text, rank int, rank_name text, class text, renown int, joined_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.resident_id, r.display_name, m.rank, k.name, m.class, m.renown, m.joined_at
  from public.guild_members m join public.residents r on r.id = m.resident_id join public.guild_ranks k on k.rank = m.rank
  order by m.rank desc, m.renown desc, m.joined_at
$$;

-- ---------- recruitment (Guild Master) ----------

create function public.admin_create_event(
  p_title text, p_post_url text, p_starts_at timestamptz, p_ends_at timestamptz,
  p_min_comments int default 5, p_slots int default 3, p_min_chars int default 5, p_max_per_day int default 10
) returns uuid
language plpgsql security definer set search_path = public as $$
declare eid uuid;
begin
  perform public.require_guild_master();
  insert into public.recruitment_events (title, post_url, starts_at, ends_at, min_comments, slots, min_chars, max_per_day, created_by)
  values (btrim(p_title), btrim(p_post_url), p_starts_at, p_ends_at, p_min_comments, p_slots, p_min_chars, p_max_per_day, auth.uid())
  returning id into eid;
  insert into public.audit_log (actor, action, target, detail) values (auth.uid(), 'create_event', eid, jsonb_build_object('title', p_title));
  return eid;
end $$;

-- Recount the leaderboard from the raw comments. Anti-spam rules:
--  * only comments inside the event window
--  * at least min_chars characters (mentions/emoji-only comments don't count)
--  * the same text from the same person counts once
--  * at most max_per_day counted comments per person per day
--  * the guild's own account is ignored
create function public.admin_recalculate(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ev public.recruitment_events;
begin
  perform public.require_guild_master();
  select * into ev from public.recruitment_events where id = p_event;
  if not found then raise exception 'not_found'; end if;

  with all_c as (
    select instagram, count(*)::int as total from public.recruitment_comments where event_id = p_event group by instagram
  ), valid as (
    select distinct on (instagram, text_hash) instagram, text_hash, commented_at
    from public.recruitment_comments
    where event_id = p_event and commented_at >= ev.starts_at and commented_at <= ev.ends_at
      and chars >= ev.min_chars and instagram <> 'wandertales.guild'
    order by instagram, text_hash, commented_at
  ), per_day as (
    select instagram, least(count(*), ev.max_per_day)::int as n, max(commented_at) as last_at
    from valid group by instagram, date_trunc('day', commented_at)
  ), scored as (
    select a.instagram, a.total, coalesce(sum(d.n), 0)::int as valid_n, max(d.last_at) as last_at
    from all_c a left join per_day d on d.instagram = a.instagram group by a.instagram, a.total
  ), judged as (
    select s.*, r.id as resident_id, m.id as member_id,
      case
        when m.id is not null then 'Already a Guild Member'
        when r.id is null then 'Not a registered resident'
        when s.valid_n < ev.min_comments then format('Needs %s more valid comments', ev.min_comments - s.valid_n)
      end as why
    from scored s
    left join public.residents r on r.instagram = s.instagram and r.town_id = ev.town_id
    left join public.guild_members m on m.resident_id = r.id
  )
  insert into public.recruitment_entries as e (event_id, instagram, total_comments, valid_comments, eligible, reason, place, resident_id)
  select p_event, j.instagram, j.total, j.valid_n, j.why is null, j.why,
    row_number() over (order by j.valid_n desc, j.last_at asc nulls last, j.instagram)::int, j.resident_id
  from judged j
  on conflict (event_id, instagram) do update set total_comments = excluded.total_comments, valid_comments = excluded.valid_comments,
    eligible = case when e.status = 'approved' then true else excluded.eligible end,
    reason = case when e.status = 'approved' then null else excluded.reason end,
    place = excluded.place, resident_id = excluded.resident_id;
end $$;

-- Import a batch of comments (from a CSV the Guild Master exported). Duplicates are skipped.
create function public.admin_import_comments(p_event uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare row jsonb; h text; added int := 0; dupes int := 0; bad int := 0; n int;
begin
  perform public.require_guild_master();
  if not exists (select 1 from public.recruitment_events where id = p_event and status = 'open') then raise exception 'event_not_open'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then raise exception 'invalid_rows'; end if;
  for row in select * from jsonb_array_elements(p_rows) loop
    h := public.normalize_instagram(row->>'instagram');
    if h is null or coalesce(row->>'text_hash', '') !~ '^[0-9a-f]{64}$' or jsonb_typeof(row->'chars') <> 'number'
       or (row->>'commented_at') is null then
      bad := bad + 1; continue;
    end if;
    begin
      insert into public.recruitment_comments (event_id, instagram, text_hash, chars, commented_at)
      values (p_event, h, row->>'text_hash', greatest(0, (row->>'chars')::int), (row->>'commented_at')::timestamptz)
      on conflict do nothing;
      get diagnostics n = row_count;
      if n = 1 then added := added + 1; else dupes := dupes + 1; end if;
    exception when others then bad := bad + 1;
    end;
  end loop;
  perform public.admin_recalculate(p_event);
  insert into public.audit_log (actor, action, target, detail) values (auth.uid(), 'import_comments', p_event, jsonb_build_object('added', added, 'duplicates', dupes, 'invalid', bad));
  return jsonb_build_object('added', added, 'duplicates', dupes, 'invalid', bad);
end $$;

-- Approve (or reject) one leaderboard entry. Approval creates the Guild Member.
create function public.admin_review_entry(p_event uuid, p_instagram text, p_approve boolean, p_class text default 'Warrior')
returns uuid
language plpgsql security definer set search_path = public as $$
declare ev public.recruitment_events; en public.recruitment_entries; mid uuid;
begin
  perform public.require_guild_master();
  select * into ev from public.recruitment_events where id = p_event;
  if not found then raise exception 'not_found'; end if;
  select * into en from public.recruitment_entries where event_id = p_event and instagram = p_instagram for update;
  if not found then raise exception 'not_found'; end if;
  if en.status <> 'pending' then raise exception 'already_reviewed'; end if;
  if p_approve then
    if not en.eligible then raise exception 'not_eligible'; end if;
    if (select count(*) from public.recruitment_entries where event_id = p_event and status = 'approved') >= ev.slots then raise exception 'no_slots_left'; end if;
    insert into public.guild_members (town_id, resident_id, class, recruitment_event_id)
    values (ev.town_id, en.resident_id, p_class, p_event) returning id into mid;
  end if;
  update public.recruitment_entries set status = case when p_approve then 'approved' else 'rejected' end, reviewed_at = now()
  where event_id = p_event and instagram = p_instagram;
  insert into public.audit_log (actor, action, target, detail) values (auth.uid(), case when p_approve then 'recruit' else 'reject_entry' end, p_event, jsonb_build_object('instagram', p_instagram));
  return mid;
end $$;

create function public.admin_close_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_guild_master();
  update public.recruitment_events set status = 'closed' where id = p_event;
  insert into public.audit_log (actor, action, target) values (auth.uid(), 'close_event', p_event);
end $$;

-- ---------- members (Guild Master) ----------

create function public.admin_update_member(p_member uuid, p_rank int default null, p_class text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_guild_master();
  update public.guild_members set rank = coalesce(p_rank, rank), class = coalesce(p_class, class) where id = p_member;
  if not found then raise exception 'not_found'; end if;
  insert into public.audit_log (actor, action, target, detail) values (auth.uid(), 'update_member', p_member, jsonb_build_object('rank', p_rank, 'class', p_class));
end $$;

-- Quest rewards. Ranks go up automatically at renown thresholds (never down).
create function public.admin_add_renown(p_member uuid, p_amount int, p_reason text default null) returns int
language plpgsql security definer set search_path = public as $$
declare new_rank int;
begin
  perform public.require_guild_master();
  if p_amount not between 1 and 500 then raise exception 'invalid_amount'; end if;
  update public.guild_members m set renown = m.renown + p_amount,
    rank = greatest(m.rank, (select max(k.rank) from public.guild_ranks k where k.min_renown <= m.renown + p_amount))
  where m.id = p_member returning m.rank into new_rank;
  if not found then raise exception 'not_found'; end if;
  insert into public.audit_log (actor, action, target, detail) values (auth.uid(), 'renown', p_member, jsonb_build_object('amount', p_amount, 'reason', p_reason));
  return new_rank;
end $$;

create function public.admin_remove_member(p_member uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.require_guild_master();
  delete from public.guild_members where id = p_member;
  insert into public.audit_log (actor, action, target) values (auth.uid(), 'remove_member', p_member);
end $$;

-- ---------- permissions ----------
revoke all on function public.list_recruitment_events() from public;
revoke all on function public.list_leaderboard(uuid) from public;
revoke all on function public.list_guild_members() from public;
revoke all on function public.admin_create_event(text, text, timestamptz, timestamptz, int, int, int, int) from public, anon;
revoke all on function public.admin_recalculate(uuid) from public, anon;
revoke all on function public.admin_import_comments(uuid, jsonb) from public, anon;
revoke all on function public.admin_review_entry(uuid, text, boolean, text) from public, anon;
revoke all on function public.admin_close_event(uuid) from public, anon;
revoke all on function public.admin_update_member(uuid, int, text) from public, anon;
revoke all on function public.admin_add_renown(uuid, int, text) from public, anon;
revoke all on function public.admin_remove_member(uuid) from public, anon;
grant execute on function public.list_recruitment_events() to anon, authenticated;
grant execute on function public.list_leaderboard(uuid) to anon, authenticated;
grant execute on function public.list_guild_members() to anon, authenticated;
grant execute on function public.admin_create_event(text, text, timestamptz, timestamptz, int, int, int, int) to authenticated;
grant execute on function public.admin_recalculate(uuid) to authenticated;
grant execute on function public.admin_import_comments(uuid, jsonb) to authenticated;
grant execute on function public.admin_review_entry(uuid, text, boolean, text) to authenticated;
grant execute on function public.admin_close_event(uuid) to authenticated;
grant execute on function public.admin_update_member(uuid, int, text) to authenticated;
grant execute on function public.admin_add_renown(uuid, int, text) to authenticated;
grant execute on function public.admin_remove_member(uuid) to authenticated;
