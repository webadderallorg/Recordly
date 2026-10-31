begin;
-- Deliberately separate from account-linked feedback: no user_id or identity fields.
create table public.export_error_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default date_trunc('hour', now()),
  cloud_plan text not null check (cloud_plan in ('paid', 'not_paid', 'unknown')),
  diagnostics jsonb not null check (jsonb_typeof(diagnostics) = 'object' and octet_length(diagnostics::text) <= 4096)
);
create index export_error_reports_created_at on public.export_error_reports(created_at);
alter table public.export_error_reports enable row level security;
revoke all on public.export_error_reports from public, anon, authenticated;
grant select, insert, delete on public.export_error_reports to service_role;

-- A global cap bounds anonymous writes without persisting IPs or device identifiers.
create table public.export_error_usage (
  minute timestamptz primary key,
  attempts integer not null
);
alter table public.export_error_usage enable row level security;
revoke all on public.export_error_usage from public, anon, authenticated;
create function public.reserve_export_error_quota()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.export_error_usage as usage (minute, attempts)
  values (date_trunc('minute', now()), 1)
  on conflict (minute) do update set attempts = usage.attempts + 1 where usage.attempts < 20;
  return found;
end;
$$;
revoke all on function public.reserve_export_error_quota() from public, anon, authenticated;
grant execute on function public.reserve_export_error_quota() to service_role;

-- Retain diagnostics for 30 days and aggregate quota counters for one day.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('recordly-export-report-retention', '17 3 * * *',
  $job$delete from public.export_error_reports where created_at < now() - interval '30 days';
       delete from public.export_error_usage where minute < now() - interval '1 day';$job$);
commit;
