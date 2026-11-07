-- Run as migration owner in a disposable Supabase database after the reporting migration.
begin;
delete from public.export_error_usage where minute = date_trunc('minute', now());
delete from public.export_error_daily_usage where day = (now() at time zone 'UTC')::date;
do $$
begin
  if has_table_privilege('anon', 'public.export_error_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.export_error_reports', 'SELECT')
     or has_table_privilege('anon', 'public.export_error_daily_usage', 'INSERT')
     or has_table_privilege('authenticated', 'public.export_error_daily_usage', 'SELECT')
     or has_function_privilege('anon', 'public.reserve_export_error_quota(jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reserve_export_error_quota(jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.reserve_export_error_quota(jsonb)', 'EXECUTE')
     or to_regprocedure('public.reserve_export_error_quota()') is not null then
    raise exception 'Client can bypass endpoint or read private reports';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public'
             and table_name='export_error_reports' and column_name in ('user_id','email','ip','device_id')) then
    raise exception 'Reports contain identity columns';
  end if;
  for i in 1..20 loop
    if not public.reserve_export_error_quota('{"schemaVersion":1}') then raise exception 'Valid quota reservation rejected'; end if;
  end loop;
  if public.reserve_export_error_quota('{"schemaVersion":1}') then raise exception 'Global minute cap bypassed'; end if;
  if (select attempts from public.export_error_daily_usage where day = (now() at time zone 'UTC')::date) <> 20 then
    raise exception 'Minute rejection consumed a daily reservation';
  end if;
  if not exists (select 1 from cron.job where jobname='recordly-export-report-retention' and active) then
    raise exception 'Retention job missing';
  end if;
end;
$$;
-- Daily byte/count boundaries use actual stored JSONB text, not request size.
delete from public.export_error_usage where minute = date_trunc('minute', now());
do $$
declare
  payload jsonb := jsonb_build_object('logs', repeat('é', 7) || chr(10) || '"');
  payload_bytes bigint;
  used_bytes bigint;
begin
  payload_bytes := octet_length(payload::text);
  update public.export_error_daily_usage set attempts = 1, bytes = 16777216 - payload_bytes
    where day = (now() at time zone 'UTC')::date;
  if not public.reserve_export_error_quota(payload) then raise exception 'Exact daily byte boundary rejected'; end if;
  select bytes into used_bytes from public.export_error_daily_usage where day = (now() at time zone 'UTC')::date;
  if used_bytes <> 16777216 then raise exception 'JSONB UTF-8 or escaping was undercounted'; end if;
  if public.reserve_export_error_quota('{}') then raise exception 'Daily byte budget bypassed'; end if;
  if (select attempts from public.export_error_daily_usage where day = (now() at time zone 'UTC')::date) <> 2 then
    raise exception 'Byte rejection changed daily usage';
  end if;
  update public.export_error_daily_usage set attempts = 199, bytes = 1
    where day = (now() at time zone 'UTC')::date;
  if not public.reserve_export_error_quota(payload) then raise exception '200th daily reservation rejected'; end if;
  if public.reserve_export_error_quota(payload) then raise exception 'Daily count cap bypassed'; end if;
  if public.reserve_export_error_quota(null) or public.reserve_export_error_quota('[]')
     or public.reserve_export_error_quota(jsonb_build_object('logs', repeat('x', 1000001))) then
    raise exception 'Invalid or oversized quota input accepted';
  end if;
end;
$$;
-- Yesterday's aggregate cannot consume today's quota, even in a non-UTC session.
delete from public.export_error_usage where minute = date_trunc('minute', now());
delete from public.export_error_daily_usage where day = (now() at time zone 'UTC')::date;
insert into public.export_error_daily_usage (day, attempts, bytes)
values ((now() at time zone 'UTC')::date - 1, 200, 16777216)
on conflict (day) do update set attempts = 200, bytes = 16777216;
set local timezone = 'Pacific/Kiritimati';
do $$
begin
  if not public.reserve_export_error_quota('{}') then raise exception 'Prior day consumed new UTC-day quota'; end if;
  if not exists (select 1 from public.export_error_daily_usage
    where day = (now() at time zone 'UTC')::date and attempts = 1 and bytes = 2) then
    raise exception 'Quota day does not use UTC';
  end if;
end;
$$;
-- Exercise storage of a real-sized log snapshot after the application-report migration.
insert into public.export_error_reports (cloud_plan, diagnostics)
values ('unknown', jsonb_build_object('schemaVersion', 2, 'logs', repeat('x', 290000)));
do $$
begin
  begin
    insert into public.export_error_reports (cloud_plan, diagnostics)
    values ('unknown', jsonb_build_object('logs', repeat('x', 1000001)));
    raise exception 'Oversized diagnostic storage accepted';
  exception when check_violation then null;
  end;
end;
$$;
rollback;
