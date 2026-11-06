-- WanderTales Guild — Phase 6: cloud save with conflict detection.
-- One save slot per town, readable and writable only by the Guild Master (through the functions below).
-- Every write is a compare-and-set on `rev`: if another device saved since this device last synced,
-- the write is refused and the stored save is returned, so the player can choose which one to keep.
-- Nothing is ever merged or overwritten silently.

create table public.game_saves (
  town_id uuid primary key references public.towns (id),
  rev int not null default 0 check (rev >= 0),
  data jsonb not null default '{}',
  summary jsonb not null default '{}',
  device text not null default '' check (char_length(device) <= 60),
  saved_by uuid references auth.users (id) on delete set null,
  saved_at timestamptz not null default now(),
  check (octet_length(data::text) <= 4000000)
);
alter table public.game_saves enable row level security; -- no policies: only the functions below can touch it

create function public.save_json(r public.game_saves) returns jsonb
language sql immutable as $$
  select jsonb_build_object('rev', r.rev, 'savedAt', r.saved_at, 'device', r.device, 'summary', r.summary, 'data', r.data)
$$;

create function public.cloud_save_load(p_town uuid default '00000000-0000-0000-0000-000000000001') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.game_saves;
begin
  perform public.require_guild_master();
  select * into r from public.game_saves where town_id = p_town;
  if not found or r.rev = 0 then return null; end if;
  return public.save_json(r);
end $$;

-- Returns {"ok": true, "rev": n} or {"ok": false, "current": <stored save>} when p_base_rev is stale.
create function public.cloud_save_write(p_data jsonb, p_summary jsonb, p_device text, p_base_rev int,
  p_town uuid default '00000000-0000-0000-0000-000000000001') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.game_saves;
begin
  perform public.require_guild_master();
  if p_data is null or jsonb_typeof(p_data) <> 'object' or jsonb_typeof(coalesce(p_summary, '{}'::jsonb)) <> 'object' then raise exception 'invalid_save'; end if;
  if octet_length(p_data::text) > 4000000 then raise exception 'save_too_large'; end if;
  insert into public.game_saves (town_id) values (p_town) on conflict do nothing; -- first save creates the slot (rev 0)
  select * into r from public.game_saves where town_id = p_town for update;       -- serialises two devices saving at once
  if r.rev <> coalesce(p_base_rev, 0) then
    return jsonb_build_object('ok', false, 'current', public.save_json(r));
  end if;
  update public.game_saves
    set rev = r.rev + 1, data = p_data, summary = coalesce(p_summary, '{}'::jsonb), device = left(coalesce(p_device, ''), 60), saved_by = auth.uid(), saved_at = now()
    where town_id = p_town returning * into r;
  insert into public.audit_log (actor, action, detail) values (auth.uid(), 'cloud_save', jsonb_build_object('rev', r.rev, 'device', r.device));
  return jsonb_build_object('ok', true, 'rev', r.rev);
end $$;

revoke all on function public.save_json(public.game_saves) from public, anon, authenticated;
revoke all on function public.cloud_save_load(uuid) from public, anon;
revoke all on function public.cloud_save_write(jsonb, jsonb, text, int, uuid) from public, anon;
grant execute on function public.cloud_save_load(uuid) to authenticated;
grant execute on function public.cloud_save_write(jsonb, jsonb, text, int, uuid) to authenticated;
