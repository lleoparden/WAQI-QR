-- Latest scans, with the QR slug/label attached.
-- Run after 0002. Safe to re-run.

begin;

create or replace function public.get_recent_scans(p_limit integer default 20)
returns table (
  id bigint,
  created_at timestamptz,
  qr_id uuid,
  slug text,
  label text,
  visitor_id text,
  is_bot boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();

  return query
  select
    s.id,
    s.created_at,
    s.qr_id,
    q.slug,
    q.label,
    s.visitor_id,
    s.is_bot
  from public.scans s
  join public.qr_codes q on q.id = s.qr_id
  order by s.created_at desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
end;
$$;

revoke all on function public.get_recent_scans(integer) from public, anon;
grant execute on function public.get_recent_scans(integer) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
