begin;
-- Shared anonymous-report budget: aggregate counters only, without caller identity.
create table public.export_error_daily_usage (
  day date primary key,
  attempts integer not null check (attempts between 1 and 200),
  bytes bigint not null check (bytes between 1 and 16777216)
);
alter table public.export_error_daily_usage enable row level security;
revoke all on public.export_error_daily_usage from public, anon, authenticated;

-- Remove the old entry point so it cannot reserve only the minute quota.
drop function public.reserve_export_error_quota();
create function public.reserve_export_error_quota(report jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  report_bytes bigint;
begin
  if report is null or jsonb_typeof(report) <> 'object' then return false; end if;
  -- Match the stored JSONB-text constraint, including nested JSON escaping.
  report_bytes := octet_length(report::text);
  if report_bytes < 1 or report_bytes > 1000000 then return false; end if;

  insert into public.export_error_usage as usage (minute, attempts)
  values (date_trunc('minute', now()), 1)
  on conflict (minute) do update set attempts = usage.attempts + 1 where usage.attempts < 20;
  if not found then return false; end if;

  -- Conditional UPSERT takes the day-row lock; concurrent callers cannot
  -- overspend either budget. Failed inserts still consume their reservation.
  insert into public.export_error_daily_usage as usage (day, attempts, bytes)
  values ((now() at time zone 'UTC')::date, 1, report_bytes)
  on conflict (day) do update
    set attempts = usage.attempts + 1, bytes = usage.bytes + excluded.bytes
    where usage.attempts < 200 and usage.bytes + excluded.bytes <= 16777216;
  return found;
end;
$$;
revoke all on function public.reserve_export_error_quota(jsonb) from public, anon, authenticated;
grant execute on function public.reserve_export_error_quota(jsonb) to service_role;

-- Preserve diagnostic retention and also prune the new aggregate day counters.
select cron.schedule('recordly-export-report-retention', '17 3 * * *',
  $job$delete from public.export_error_reports where created_at < now() - interval '30 days';
       delete from public.export_error_usage where minute < now() - interval '1 day';
       delete from public.export_error_daily_usage where day < (now() at time zone 'UTC')::date - 1;$job$);
commit;
