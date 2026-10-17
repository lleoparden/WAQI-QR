-- Fix: Supabase installs pgcrypto in the `extensions` schema, while
-- create_qr runs with search_path = public. The old auto-slug used
-- gen_random_bytes(), which therefore failed at runtime.
--
-- This replaces it with the built-in gen_random_uuid(). Run this file once in
-- the Supabase SQL editor. It is safe to run again and does not delete data.

begin;

create or replace function public.create_qr(
  p_label text,
  p_placement text default null,
  p_target_url text default null,
  p_slug text default null,
  p_variant text default null
)
returns public.qr_codes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
  v_row public.qr_codes;
  v_attempt integer;
begin
  perform public._require_admin();

  if p_label is null or btrim(p_label) = '' then
    raise exception 'label is required' using errcode = '22023';
  end if;

  if length(btrim(p_label)) > 120 then
    raise exception 'label is too long' using errcode = '22023';
  end if;

  if p_target_url is not null and p_target_url !~* '^https?://' then
    raise exception 'target_url must start with http:// or https://' using errcode = '22023';
  end if;

  if p_variant is not null and length(btrim(p_variant)) > 40 then
    raise exception 'variant is too long' using errcode = '22023';
  end if;

  if p_slug is not null and btrim(p_slug) <> '' then
    v_slug := lower(btrim(p_slug));
    if v_slug !~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' then
      raise exception 'slug must be 3-32 lowercase letters, numbers, or hyphens' using errcode = '22023';
    end if;

    insert into public.qr_codes (slug, label, placement, target_url, variant)
    values (v_slug, btrim(p_label), nullif(btrim(p_placement), ''), nullif(btrim(p_target_url), ''), nullif(btrim(p_variant), ''))
    returning * into v_row;

    return v_row;
  end if;

  for v_attempt in 1..10 loop
    v_slug := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    begin
      insert into public.qr_codes (slug, label, placement, target_url, variant)
      values (v_slug, btrim(p_label), nullif(btrim(p_placement), ''), nullif(btrim(p_target_url), ''), nullif(btrim(p_variant), ''))
      returning * into v_row;

      return v_row;
    exception when unique_violation then
      -- Extremely unlikely; generate another slug.
      null;
    end;
  end loop;

  raise exception 'could not generate a unique slug' using errcode = '23505';
end;
$$;

revoke all on function public.create_qr(text, text, text, text, text) from public, anon;
grant execute on function public.create_qr(text, text, text, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
