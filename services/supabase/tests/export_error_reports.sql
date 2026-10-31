-- Run as migration owner in a disposable Supabase database after the reporting migration.
begin;
delete from public.export_error_usage where minute = date_trunc('minute', now());
do $$
begin
  if has_table_privilege('anon', 'public.export_error_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.export_error_reports', 'SELECT')
     or has_function_privilege('anon', 'public.reserve_export_error_quota()', 'EXECUTE') then
    raise exception 'Client can bypass endpoint or read private reports';
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public'
             and table_name='export_error_reports' and column_name in ('user_id','email','ip','device_id')) then
    raise exception 'Reports contain identity columns';
  end if;
  for i in 1..20 loop
    if not public.reserve_export_error_quota() then raise exception 'Valid quota reservation rejected'; end if;
  end loop;
  if public.reserve_export_error_quota() then raise exception 'Global minute cap bypassed'; end if;
  if not exists (select 1 from cron.job where jobname='recordly-export-report-retention' and active) then
    raise exception 'Retention job missing';
  end if;
end;
$$;
rollback;
